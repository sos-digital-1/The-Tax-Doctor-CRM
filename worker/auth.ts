import type { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { Env, StaffUser, all, one, run, effectivePerms, PERMS, ROLE_DEFAULTS, hashPassword, verifyPassword, signToken, verifyToken, randomToken, logActivity, hex, generatePassword, passwordProblem } from "./lib";
import { need, has, Vars } from "./guard";
import { mailUserCreated, mailAdminReset, mailResetLink, mailPasswordChanged } from "./emails";

type App = Hono<{ Bindings: Env; Variables: Vars }>;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());

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
  api.get("/perms", (c) => c.json({ perms: PERMS, roles: ROLE_DEFAULTS }));

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
    const rows = await all(c.env.DB, "SELECT id, name, email, role, active, permissions, must_change_password FROM users ORDER BY name");
    if (has(c, "users.manage")) return c.json(rows.map((r: any) => ({ ...r, perms: effectivePerms(r.role, r.permissions) })));
    return c.json(rows.filter((r: any) => r.active).map((r: any) => ({ id: r.id, name: r.name, role: r.role })));
  });

  api.post("/users", need("users.manage"), async (c) => {
    const b = await c.req.json();
    if (!str(b.name) || !str(b.email)) return c.json({ error: "Name and email are required" }, 400);
    if (!["ADMIN", "MANAGER", "STAFF"].includes(b.role)) return c.json({ error: "Invalid role" }, 400);
    if (b.password) { const p = passwordProblem(str(b.password)); if (p) return c.json({ error: p }, 400); }
    const temp = b.password ? str(b.password) : generatePassword();
    try {
      const r = await run(c.env.DB, "INSERT INTO users (name, email, password_hash, role, must_change_password) VALUES (?,?,?,?,1)", str(b.name), str(b.email).toLowerCase(), await hashPassword(temp), b.role);
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
    if (id === me.id && (b.active === false || (b.role && b.role !== "ADMIN"))) return c.json({ error: "You cannot disable or demote yourself" }, 400);
    const target = await one<any>(c.env.DB, "SELECT id, name, email FROM users WHERE id = ?", id);
    if (!target) return c.json({ error: "Not found" }, 404);
    if (b.name) await run(c.env.DB, "UPDATE users SET name = ? WHERE id = ?", str(b.name), id);
    if (b.role && ["ADMIN", "MANAGER", "STAFF"].includes(b.role)) await run(c.env.DB, "UPDATE users SET role = ? WHERE id = ?", b.role, id);
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
}
