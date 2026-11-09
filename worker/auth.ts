import type { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { Env, StaffUser, all, one, run, effectivePerms, PERMS, roleDefaults, loadRoleDefaults, hashPassword, verifyPassword, signToken, verifyToken, randomToken, logActivity, hex, generatePassword, passwordProblem } from "./lib";
import { need, has, Vars } from "./guard";
import { mailUserCreated, mailAdminReset, mailResetLink, mailPasswordChanged } from "./emails";

type App = Hono<{ Bindings: Env; Variables: Vars }>;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());

const ROLES = ["ADMIN", "TECH", "MANAGER", "STAFF"];
const TECH_NAME = "Tech Admin";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SESSION_SECONDS = 30 * 24 * 3600; // stay signed in like a chat app; refreshed while you use it
const REFRESH_AFTER = 12 * 3600;
const PUBLIC = ["/api/auth/login", "/api/auth/forgot", "/api/auth/reset", "/api/health"];
const ALLOWED_WHILE_CHANGING = ["/api/auth/me", "/api/auth/password", "/api/auth/logout"];

const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
const originOf = (c: any) => new URL(c.req.url).origin;

export function registerAuth(api: App, o: { STAFF_COOKIE: string; isSecure: (url: string) => boolean }) {
  const issue = async (c: any, uid: number) => {
    const token = await signToken({ t: "staff", uid, iat: Math.floor(Date.now() / 1000) }, c.env.SESSION_SECRET, SESSION_SECONDS);
    setCookie(c, o.STAFF_COOKIE, token, { httpOnly: true, sameSite: "Strict", secure: o.isSecure(c.req.url), path: "/", maxAge: SESSION_SECONDS });
  };

  // ------------------------------------------------------------ session check for every other route
  api.use("*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (PUBLIC.includes(path) || path.startsWith("/api/portal/") || path.startsWith("/api/push/") || path.startsWith("/api/dl/")) return next();
    const p = await verifyToken<{ t: string; uid: number; iat?: number }>(getCookie(c, o.STAFF_COOKIE), c.env.SESSION_SECRET);
    if (!p || p.t !== "staff") return c.json({ error: "Not signed in" }, 401);
    const u = await one<StaffUser & { active: number; permissions: string | null; must_change_password: number }>(c.env.DB, "SELECT id, name, email, role, active, permissions, must_change_password FROM users WHERE id = ?", p.uid);
    if (!u || !u.active) return c.json({ error: "Account disabled" }, 401);
    await loadRoleDefaults(c.env.DB);
    if (u.must_change_password && !ALLOWED_WHILE_CHANGING.includes(path)) return c.json({ error: "Please set a new password first", code: "PASSWORD_CHANGE_REQUIRED" }, 403);
    c.set("user", { id: u.id, name: u.name, email: u.email, role: u.role, perms: effectivePerms(u.role, u.permissions), must_change: !!u.must_change_password });
    if (!p.iat || Date.now() / 1000 - p.iat > REFRESH_AFTER) await issue(c, u.id); // sliding session
    await next();
  });

  api.get("/health", (c) => c.json({ ok: true }));

  // ------------------------------------------------------------ sign in / out
  api.post("/auth/login", async (c) => {
    const { email, password } = await c.req.json().catch(() => ({} as any));
    const u = await one<any>(c.env.DB, "SELECT * FROM users WHERE email = ?", str(email).toLowerCase());
    const now = new Date().toISOString();
    if (u?.locked_until && u.locked_until > now) return c.json({ error: "Too many attempts. Try again in a few minutes, or use 'Forgot password'." }, 429);
    if (!u || !u.active || !(await verifyPassword(str(password), u.password_hash))) {
      if (u) {
        const fails = u.failed_attempts + 1;
        await run(c.env.DB, "UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?", fails >= 5 ? 0 : fails, fails >= 5 ? new Date(Date.now() + 15 * 60000).toISOString() : null, u.id);
      }
      return c.json({ error: "Invalid email or password" }, 401);
    }
    await run(c.env.DB, "UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?", u.id);
    await issue(c, u.id);
    await logActivity(c.env.DB, u, "login");
    return c.json({ user: { id: u.id, name: u.name, email: u.email, role: u.role, perms: effectivePerms(u.role, u.permissions), must_change: !!u.must_change_password } });
  });
  api.post("/auth/logout", (c) => {
    deleteCookie(c, o.STAFF_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });
  api.get("/auth/me", (c) => c.json({ user: c.get("user") }));
  api.get("/perms", (c) => c.json({ perms: PERMS, roles: roleDefaults() }));

  // Super Admin: default access for a whole role. Individual overrides on a person still apply on top.
  api.put("/roles/:role/perms", async (c) => {
    const me = c.get("user");
    if (me.role !== "ADMIN" && me.role !== "TECH") return c.json({ error: "Only a Super Admin can change role permissions" }, 403);
    const role = c.req.param("role");
    if (role !== "MANAGER" && role !== "STAFF") return c.json({ error: "Only Manager and Staff defaults can be changed" }, 400);
    const b = await c.req.json().catch(() => ({} as any));
    const keys = (Array.isArray(b.perms) ? b.perms : []).filter((k: unknown) => PERMS.some((p) => p.key === k));
    await run(c.env.DB, "INSERT INTO role_permissions (role, perms, updated_at) VALUES (?,?,datetime('now')) ON CONFLICT(role) DO UPDATE SET perms = excluded.perms, updated_at = excluded.updated_at", role, JSON.stringify(keys));
    await loadRoleDefaults(c.env.DB, true);
    await logActivity(c.env.DB, me, "role.perms", "role", undefined, `${role}: ${keys.length} permissions`);
    return c.json({ ok: true });
  });
  api.delete("/roles/:role/perms", async (c) => {
    const me = c.get("user");
    if (me.role !== "ADMIN" && me.role !== "TECH") return c.json({ error: "Only a Super Admin can change role permissions" }, 403);
    await run(c.env.DB, "DELETE FROM role_permissions WHERE role = ?", c.req.param("role"));
    await loadRoleDefaults(c.env.DB, true);
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------ change password (signed in, incl. forced first-login change)
  api.post("/auth/password", async (c) => {
    const { current, next } = await c.req.json().catch(() => ({} as any));
    const u = await one<any>(c.env.DB, "SELECT * FROM users WHERE id = ?", c.get("user").id);
    if (!(await verifyPassword(str(current), u.password_hash))) return c.json({ error: "Current password is wrong" }, 400);
    const problem = passwordProblem(str(next));
    if (problem) return c.json({ error: problem }, 400);
    if (str(next) === str(current)) return c.json({ error: "Choose a password different from the current one" }, 400);
    await run(c.env.DB, "UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = datetime('now'), failed_attempts = 0 WHERE id = ?", await hashPassword(str(next)), u.id);
    await logActivity(c.env.DB, u, "password.change");
    await mailPasswordChanged(c.env, u).catch(() => {});
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------ forgot / reset by emailed link
  api.post("/auth/forgot", async (c) => {
    const { email } = await c.req.json().catch(() => ({} as any));
    const u = await one<any>(c.env.DB, "SELECT id, name, email, active FROM users WHERE email = ?", str(email).toLowerCase());
    if (u?.active) {
      const recent = await one<{ n: number }>(c.env.DB, "SELECT COUNT(*) n FROM password_resets WHERE user_id = ? AND created_at > datetime('now','-1 hour')", u.id);
      if ((recent?.n ?? 0) < 3) {
        const token = randomToken(32);
        await run(c.env.DB, "INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?,?,?)", u.id, await sha256(token), new Date(Date.now() + 60 * 60000).toISOString());
        await mailResetLink(c.env, u, `${(c.env.APP_URL || originOf(c)).replace(/\/$/, "")}/reset?token=${token}`);
      }
    }
    // same answer whether or not the address exists, so this cannot be used to discover accounts
    return c.json({ ok: true, message: "If that email belongs to an account, a reset link is on its way. It works for 60 minutes." });
  });

  api.post("/auth/reset", async (c) => {
    const { token, password } = await c.req.json().catch(() => ({} as any));
    const problem = passwordProblem(str(password));
    if (problem) return c.json({ error: problem }, 400);
    const r = await one<any>(c.env.DB, "SELECT pr.id, pr.user_id, u.name, u.email FROM password_resets pr JOIN users u ON u.id = pr.user_id WHERE pr.token_hash = ? AND pr.used = 0 AND pr.expires_at > ? AND u.active = 1", await sha256(str(token)), new Date().toISOString());
    if (!r) return c.json({ error: "This reset link is invalid or has expired. Please request a new one." }, 400);
    await run(c.env.DB, "UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = datetime('now'), failed_attempts = 0, locked_until = NULL WHERE id = ?", await hashPassword(str(password)), r.user_id);
    await run(c.env.DB, "UPDATE password_resets SET used = 1 WHERE user_id = ?", r.user_id);
    await logActivity(c.env.DB, { id: r.user_id, name: r.name }, "password.reset");
    await mailPasswordChanged(c.env, r).catch(() => {});
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------ users (admin)
  api.get("/users", async (c) => {
    // everyone needs the list for assignment dropdowns; only id/name/role exposed to non-admins
    await loadRoleDefaults(c.env.DB);
    const rows = await all(c.env.DB, "SELECT id, name, email, phone, designation, role, active, permissions, must_change_password FROM users ORDER BY name");
    if (has(c, "users.manage")) return c.json(rows.map((r: any) => ({ ...r, perms: effectivePerms(r.role, r.permissions) })));
    return c.json(rows.filter((r: any) => r.active).map((r: any) => ({ id: r.id, name: r.name, role: r.role })));
  });

  api.post("/users", need("users.manage"), async (c) => {
    const b = await c.req.json();
    const me0 = c.get("user");
    if (b.role === "TECH") b.name = TECH_NAME;
    if (!str(b.name) || !str(b.email)) return c.json({ error: "Name and email are required" }, 400);
    if (!ROLES.includes(b.role)) return c.json({ error: "Invalid role" }, 400);
    if (!EMAIL_RE.test(str(b.email))) return c.json({ error: "Enter a valid email address" }, 400);
    if (b.role === "TECH") {
      if (me0.role !== "ADMIN" && me0.role !== "TECH") return c.json({ error: "Only the Super Admin can create the Tech Admin" }, 403);
      if (await one(c.env.DB, "SELECT id FROM users WHERE role = 'TECH'")) return c.json({ error: "There can be only one Tech Admin, and it already exists" }, 409);
      b.name = TECH_NAME;
    }
    if (b.role === "ADMIN" && me0.role !== "ADMIN" && me0.role !== "TECH") return c.json({ error: "Only a Super Admin can create another Super Admin" }, 403);
    if (b.password) { const p = passwordProblem(str(b.password)); if (p) return c.json({ error: p }, 400); }
    const temp = b.password ? str(b.password) : generatePassword();
    try {
      const r = await run(c.env.DB, "INSERT INTO users (name, email, password_hash, role, must_change_password, phone, designation) VALUES (?,?,?,?,1,?,?)", str(b.name), str(b.email).toLowerCase(), await hashPassword(temp), b.role, str(b.phone) || null, str(b.designation) || null);
      await run(c.env.DB, "INSERT OR IGNORE INTO chat_members (channel_id, user_id) VALUES (1, ?)", r.meta.last_row_id);
      await logActivity(c.env.DB, c.get("user"), "user.create", "user", r.meta.last_row_id as number, str(b.email));
      const emailStatus = await mailUserCreated(c.env, { name: str(b.name), email: str(b.email).toLowerCase() }, temp, originOf(c));
      // if the email could not really be sent, hand the temporary password to the admin once
      return c.json({ id: r.meta.last_row_id, emailStatus, temp_password: emailStatus === "SENT" ? undefined : temp });
    } catch {
      return c.json({ error: "A user with this email already exists" }, 409);
    }
  });

  api.patch("/users/:id", need("users.manage"), async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json();
    const me = c.get("user");
    if (id === me.id && (b.active === false || (b.role && b.role !== me.role))) return c.json({ error: "You cannot disable or change the role of your own account" }, 400);
    const target = await one<any>(c.env.DB, "SELECT id, name, email, role FROM users WHERE id = ?", id);
    if (!target) return c.json({ error: "Not found" }, 404);
    const top = me.role === "ADMIN" || me.role === "TECH";
    if ((target.role === "ADMIN" || target.role === "TECH") && !top) return c.json({ error: "Only a Super Admin can change this account" }, 403);
    if (b.role && b.role !== target.role) {
      if (!ROLES.includes(b.role)) return c.json({ error: "Invalid role" }, 400);
      if (b.role === "TECH") return c.json({ error: "The Tech Admin is a single fixed account and cannot be assigned to others" }, 400);
      if (target.role === "TECH") return c.json({ error: "The Tech Admin role cannot be changed" }, 400);
      if (b.role === "ADMIN" && !top) return c.json({ error: "Only a Super Admin can make another Super Admin" }, 403);
      await run(c.env.DB, "UPDATE users SET role = ? WHERE id = ?", b.role, id);
    }
    if (typeof b.name === "string" && str(b.name) && target.role !== "TECH") await run(c.env.DB, "UPDATE users SET name = ? WHERE id = ?", str(b.name), id);
    if (typeof b.phone === "string") await run(c.env.DB, "UPDATE users SET phone = ? WHERE id = ?", str(b.phone) || null, id);
    if (typeof b.designation === "string") await run(c.env.DB, "UPDATE users SET designation = ? WHERE id = ?", str(b.designation) || null, id);
    if (typeof b.email === "string" && str(b.email).toLowerCase() !== target.email) {
      const em = str(b.email).toLowerCase();
      if (!EMAIL_RE.test(em)) return c.json({ error: "Enter a valid email address" }, 400);
      if (await one(c.env.DB, "SELECT id FROM users WHERE email = ? AND id != ?", em, id)) return c.json({ error: "Another user already has this email" }, 409);
      await run(c.env.DB, "UPDATE users SET email = ? WHERE id = ?", em, id);
      await logActivity(c.env.DB, me, "user.email", "user", id, `${target.email} -> ${em}`);
    }
    if (b.permissions && typeof b.permissions === "object") {
      const clean = (a: unknown) => (Array.isArray(a) ? a.filter((k) => PERMS.some((p) => p.key === k)) : []);
      await run(c.env.DB, "UPDATE users SET permissions = ? WHERE id = ?", JSON.stringify({ grant: clean(b.permissions.grant), deny: clean(b.permissions.deny) }), id);
    }
    if (typeof b.active === "boolean") await run(c.env.DB, "UPDATE users SET active = ? WHERE id = ?", b.active ? 1 : 0, id);

    let result: Record<string, unknown> = { ok: true };
    if (b.reset === "temp") {
      // new temporary password, emailed; replaced by the user at next sign-in
      const temp = generatePassword();
      await run(c.env.DB, "UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL WHERE id = ?", await hashPassword(temp), id);
      const emailStatus = await mailAdminReset(c.env, target, temp, originOf(c));
      result = { ok: true, emailStatus, temp_password: emailStatus === "SENT" ? undefined : temp };
      await logActivity(c.env.DB, me, "user.reset", "user", id, "temporary password");
    } else if (b.reset === "link") {
      const token = randomToken(32);
      await run(c.env.DB, "INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?,?,?)", id, await sha256(token), new Date(Date.now() + 60 * 60000).toISOString());
      const link = `${(c.env.APP_URL || originOf(c)).replace(/\/$/, "")}/reset?token=${token}`;
      const emailStatus = await mailResetLink(c.env, target, link);
      result = { ok: true, emailStatus, reset_link: emailStatus === "SENT" ? undefined : link };
      await logActivity(c.env.DB, me, "user.reset", "user", id, "reset link");
    } else if (b.password) {
      const p = passwordProblem(str(b.password));
      if (p) return c.json({ error: p }, 400);
      await run(c.env.DB, "UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL WHERE id = ?", await hashPassword(str(b.password)), id);
      await logActivity(c.env.DB, me, "user.reset", "user", id, "set manually");
    }
    await logActivity(c.env.DB, me, "user.update", "user", id);
    return c.json(result);
  });

  // ------------------------------------------------------------ everything a user owns (used to preview a delete)
  const refs = async (db: D1Database) => {
    const r = await db.prepare(`SELECT m.name AS tbl, f."from" AS col FROM sqlite_master m, pragma_foreign_key_list(m.name) f WHERE m.type = 'table' AND f."table" = 'users' AND m.name NOT LIKE 'sqlite_%' AND m.name NOT LIKE '_cf_%'`).all<{ tbl: string; col: string }>();
    return r.results ?? [];
  };
  const LABEL: Record<string, string> = { tasks: "tickets", customer_services: "recurring / annual services", customers: "customers", documents: "documents reviewed", chat_messages: "chat messages", activity_log: "activity entries" };
  const DROP = (t: string) => /push|notif|reset/.test(t); // personal, not business data: removed with the user

  api.get("/users/:id/summary", need("users.manage"), async (c) => {
    const id = Number(c.req.param("id"));
    const u = await one<any>(c.env.DB, "SELECT id, name, email, role FROM users WHERE id = ?", id);
    if (!u) return c.json({ error: "Not found" }, 404);
    const counts: Record<string, number> = {};
    for (const { tbl, col } of await refs(c.env.DB)) {
      if (DROP(tbl) || tbl === "chat_members") continue;
      const n = await one<{ n: number }>(c.env.DB, `SELECT COUNT(*) n FROM "${tbl}" WHERE "${col}" = ?`, id);
      const k = LABEL[tbl] ?? tbl.replace(/_/g, " ");
      if (n?.n) counts[k] = (counts[k] ?? 0) + n.n;
    }
    return c.json({ user: u, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) });
  });

  // Delete a user completely. Everything they own is handed to another user first; nothing is lost.
  api.delete("/users/:id", need("users.manage"), async (c) => {
    const me = c.get("user");
    if (me.role !== "ADMIN" && me.role !== "TECH") return c.json({ error: "Only a Super Admin can delete users" }, 403);
    const id = Number(c.req.param("id"));
    const b = await c.req.json().catch(() => ({} as any));
    const to = Number(b.transfer_to);
    if (id === me.id) return c.json({ error: "You cannot delete your own account" }, 400);
    const u = await one<any>(c.env.DB, "SELECT id, name, email, role FROM users WHERE id = ?", id);
    if (!u) return c.json({ error: "Not found" }, 404);
    if (u.role === "TECH") return c.json({ error: "The Tech Admin account cannot be deleted" }, 400);
    if (u.role === "ADMIN" && (await one<{ n: number }>(c.env.DB, "SELECT COUNT(*) n FROM users WHERE role IN ('ADMIN','TECH') AND active = 1 AND id != ?", id))!.n < 1) return c.json({ error: "This is the last Super Admin" }, 400);
    const dest = await one<any>(c.env.DB, "SELECT id, name FROM users WHERE id = ? AND active = 1", to);
    if (!dest || dest.id === id) return c.json({ error: "Choose another active user to receive this user's work" }, 400);
    if (String(b.confirm ?? "").toLowerCase() !== u.email.toLowerCase()) return c.json({ error: "Type the user's email to confirm" }, 400);

    const stmts: D1PreparedStatement[] = [];
    for (const { tbl, col } of await refs(c.env.DB)) {
      if (tbl === "chat_members") {
        stmts.push(c.env.DB.prepare(`INSERT OR IGNORE INTO chat_members (channel_id, user_id) SELECT channel_id, ? FROM chat_members WHERE user_id = ?`).bind(to, id));
        stmts.push(c.env.DB.prepare(`DELETE FROM chat_members WHERE user_id = ?`).bind(id));
      } else if (DROP(tbl)) stmts.push(c.env.DB.prepare(`DELETE FROM "${tbl}" WHERE "${col}" = ?`).bind(id));
      else stmts.push(c.env.DB.prepare(`UPDATE "${tbl}" SET "${col}" = ? WHERE "${col}" = ?`).bind(to, id));
    }
    stmts.push(c.env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(id));
    try { await c.env.DB.batch(stmts); } catch (e: any) { return c.json({ error: "Could not delete: " + (e?.message ?? e) }, 500); }
    await logActivity(c.env.DB, me, "user.delete", "user", id, `${u.email} removed; data moved to ${dest.name}`);
    return c.json({ ok: true, moved_to: dest.name });
  });

  // ------------------------------------------------------------ my own profile (name, phone, designation, email)
  api.get("/auth/profile", async (c) => c.json(await one<any>(c.env.DB, "SELECT id, name, email, phone, designation, role FROM users WHERE id = ?", c.get("user").id)));
  api.patch("/auth/profile", async (c) => {
    const me = c.get("user");
    const b = await c.req.json().catch(() => ({} as any));
    const u = await one<any>(c.env.DB, "SELECT * FROM users WHERE id = ?", me.id);
    if (typeof b.name === "string") {
      if (!str(b.name)) return c.json({ error: "Name cannot be empty" }, 400);
      if (u.role !== "TECH") await run(c.env.DB, "UPDATE users SET name = ? WHERE id = ?", str(b.name), me.id);
    }
    if (typeof b.phone === "string") await run(c.env.DB, "UPDATE users SET phone = ? WHERE id = ?", str(b.phone) || null, me.id);
    if (typeof b.designation === "string") await run(c.env.DB, "UPDATE users SET designation = ? WHERE id = ?", str(b.designation) || null, me.id);
    if (typeof b.email === "string" && str(b.email).toLowerCase() !== u.email) {
      const em = str(b.email).toLowerCase();
      if (!EMAIL_RE.test(em)) return c.json({ error: "Enter a valid email address" }, 400);
      if (!(await verifyPassword(str(b.current), u.password_hash))) return c.json({ error: "Enter your current password to change your email" }, 400);
      if (await one(c.env.DB, "SELECT id FROM users WHERE email = ? AND id != ?", em, me.id)) return c.json({ error: "Another user already has this email" }, 409);
      await run(c.env.DB, "UPDATE users SET email = ? WHERE id = ?", em, me.id);
    }
    await logActivity(c.env.DB, me, "profile.update", "user", me.id);
    return c.json({ ok: true, user: await one<any>(c.env.DB, "SELECT id, name, email, phone, designation, role FROM users WHERE id = ?", me.id) });
  });
}
