import type { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { Env, all, one, run, verifyToken, signToken, todayIST, addDays, logActivity, notifyUsers, encryptSecret, decryptSecret, randomToken, safeName, hex } from "./lib";
import { need, has, Vars } from "./guard";

type App = Hono<{ Bindings: Env; Variables: Vars }>;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
const nul = (v: unknown) => (str(v) === "" ? null : str(v));
const num = (v: unknown) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));
const ph = (n: number) => Array(n).fill("?").join(",");

export function registerExtra(api: App, o: { PORTAL_COOKIE: string; STAFF_COOKIE: string }) {
  // ------------------------------------------------------------ notifications + push (staff only)
  api.get("/notifications", async (c) => {
    const uid = c.get("user").id;
    await run(c.env.DB, "UPDATE users SET last_seen = datetime('now') WHERE id = ?", uid); // presence heartbeat
    const items = await all(c.env.DB, "SELECT id, title, body, link, read, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30", uid);
    const unread = (await one<{ n: number }>(c.env.DB, "SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read = 0", uid))!.n;
    return c.json({ items, unread });
  });
  // one light call that powers every badge (replaces several separate polls); also refreshes "active now"
  api.get("/pulse", async (c) => {
    const u = c.get("user");
    await run(c.env.DB, "UPDATE users SET last_seen = datetime('now') WHERE id = ?", u.id);
    const n = async (sql: string, ...p: unknown[]) => (await one<{ n: number }>(c.env.DB, sql, ...p))!.n;
    const today = todayIST();
    const [notif, chat, docs, msgs, renewals] = await Promise.all([
      n("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read = 0", u.id),
      has(c, "chat.use") ? n("SELECT COUNT(*) n FROM chat_messages m JOIN chat_members cm ON cm.channel_id = m.channel_id AND cm.user_id = ?1 WHERE m.id > cm.last_read_id AND m.user_id != ?1", u.id) : Promise.resolve(0),
      has(c, "docs.review") ? n("SELECT COUNT(*) n FROM documents WHERE status = 'PENDING' AND source = 'CUSTOMER'") : Promise.resolve(0),
      has(c, "docs.review") ? n("SELECT COUNT(*) n FROM portal_messages WHERE status = 'NEW'") : Promise.resolve(0),
      n("SELECT COUNT(*) n FROM customer_services cs JOIN services s ON s.id = cs.service_id AND s.category = 'ANNUAL' JOIN customers c ON c.id = cs.customer_id AND c.active = 1 WHERE cs.status = 'ACTIVE' AND cs.next_due <= ?", addDays(today, 15)),
    ]);
    return c.json({ notifications: notif, chat, inbox: docs + msgs, renewals });
  });

  // desktop app: "anything new since id X?" - never marks anything as read
  api.get("/notifications/poll", async (c) => {
    const uid = c.get("user").id;
    const since = Number(c.req.query("since") ?? 0);
    const latest = (await one<{ m: number }>(c.env.DB, "SELECT COALESCE(MAX(id),0) m FROM notifications WHERE user_id = ?", uid))!.m;
    if (!since) return c.json({ items: [], latest });
    const items = await all(c.env.DB, "SELECT id, title, body, link FROM notifications WHERE user_id = ? AND id > ? ORDER BY id LIMIT 20", uid, since);
    return c.json({ items, latest });
  });

  api.post("/notifications/read", async (c) => {
    const { id } = await c.req.json().catch(() => ({} as any));
    if (id) await run(c.env.DB, "UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?", Number(id), c.get("user").id);
    else await run(c.env.DB, "UPDATE notifications SET read = 1 WHERE user_id = ?", c.get("user").id);
    return c.json({ ok: true });
  });

  const pushUser = async (c: any) => {
    const p = await verifyToken<{ t: string; uid: number }>(getCookie(c, o.STAFF_COOKIE), c.env.SESSION_SECRET);
    return p?.t === "staff" ? p.uid : null;
  };
  api.get("/push/key", (c) => c.json({ key: c.env.VAPID_PUBLIC || null }));
  api.post("/push/subscribe", async (c) => {
    const uid = await pushUser(c);
    if (!uid) return c.json({ error: "Not signed in" }, 401);
    const { endpoint } = await c.req.json();
    if (!str(endpoint).startsWith("https://")) return c.json({ error: "Bad endpoint" }, 400);
    await run(c.env.DB, "INSERT INTO push_subscriptions (user_id, endpoint) VALUES (?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id", uid, str(endpoint));
    return c.json({ ok: true });
  });
  api.post("/push/unsubscribe", async (c) => {
    const { endpoint } = await c.req.json().catch(() => ({} as any));
    if (endpoint) await run(c.env.DB, "DELETE FROM push_subscriptions WHERE endpoint = ?", str(endpoint));
    return c.json({ ok: true });
  });
  // service worker calls this after a payload-less push to learn what to display
  api.get("/push/latest", async (c) => {
    const uid = await pushUser(c);
    if (!uid) return c.json({ items: [] });
    const items = await all(c.env.DB, "SELECT id, title, body, link FROM notifications WHERE user_id = ? AND pushed = 0 AND read = 0 ORDER BY id DESC LIMIT 3", uid);
    if (items.length) await run(c.env.DB, `UPDATE notifications SET pushed = 1 WHERE id IN (${ph(items.length)})`, ...items.map((i: any) => i.id));
    return c.json({ items });
  });

  // ------------------------------------------------------------ internal chat
  const member = (db: D1Database, ch: number, uid: number) => one(db, "SELECT 1 x FROM chat_members WHERE channel_id = ? AND user_id = ?", ch, uid);

  api.get("/chat/channels", need("chat.use"), async (c) => {
    const uid = c.get("user").id;
    const rows = await all<any>(
      c.env.DB,
      `SELECT ch.id, ch.name, ch.kind, ch.dm_key,
         (SELECT COUNT(*) FROM chat_messages m WHERE m.channel_id = ch.id AND m.id > cm.last_read_id AND m.user_id != ?1) AS unread,
         (SELECT body FROM chat_messages m WHERE m.channel_id = ch.id ORDER BY m.id DESC LIMIT 1) AS last_body,
         (SELECT created_at FROM chat_messages m WHERE m.channel_id = ch.id ORDER BY m.id DESC LIMIT 1) AS last_at,
         (SELECT COUNT(*) FROM chat_members x WHERE x.channel_id = ch.id) AS members
       FROM chat_channels ch JOIN chat_members cm ON cm.channel_id = ch.id AND cm.user_id = ?1
       ORDER BY last_at IS NULL, last_at DESC`,
      uid
    );
    const users = await all<any>(c.env.DB, "SELECT id, name FROM users");
    const nameOf = (id: number) => users.find((u) => u.id === id)?.name ?? "User";
    return c.json(
      rows.map((r) => {
        if (r.kind === "DM") {
          const other = r.dm_key.split("-").map(Number).find((x: number) => x !== uid) ?? uid;
          return { ...r, name: nameOf(other), other_id: other };
        }
        return r;
      })
    );
  });
  // who is around: last_seen is refreshed by the app every ~15 seconds while it is open and visible
  api.get("/chat/presence", need("chat.use"), async (c) => c.json(await all(c.env.DB, "SELECT id, name, role, last_seen FROM users WHERE active = 1 ORDER BY name")));
  // read receipts: how far each member of this conversation has read
  api.get("/chat/channels/:id/members", need("chat.use"), async (c) => {
    const ch = Number(c.req.param("id"));
    if (!(await member(c.env.DB, ch, c.get("user").id))) return c.json({ error: "Not a member" }, 403);
    return c.json(await all(c.env.DB, "SELECT u.id, u.name, u.last_seen, cm.last_read_id FROM chat_members cm JOIN users u ON u.id = cm.user_id WHERE cm.channel_id = ? ORDER BY u.name", ch));
  });
  api.get("/chat/unread", need("chat.use"), async (c) => {
    const r = await one<{ n: number }>(c.env.DB, `SELECT COUNT(*) n FROM chat_messages m JOIN chat_members cm ON cm.channel_id = m.channel_id AND cm.user_id = ?1 WHERE m.id > cm.last_read_id AND m.user_id != ?1`, c.get("user").id);
    return c.json({ unread: r!.n });
  });
  api.post("/chat/dm", need("chat.use"), async (c) => {
    const me = c.get("user").id;
    const other = num((await c.req.json()).user_id);
    if (!other || other === me) return c.json({ error: "Choose a colleague" }, 400);
    const key = [me, other].sort((a, b) => a - b).join("-");
    let ch = await one<{ id: number }>(c.env.DB, "SELECT id FROM chat_channels WHERE dm_key = ?", key);
    if (!ch) {
      const r = await run(c.env.DB, "INSERT INTO chat_channels (kind, dm_key, created_by) VALUES ('DM', ?, ?)", key, me);
      ch = { id: r.meta.last_row_id as number };
      await run(c.env.DB, "INSERT INTO chat_members (channel_id, user_id) VALUES (?,?),(?,?)", ch.id, me, ch.id, other);
    }
    return c.json({ id: ch.id });
  });
  api.post("/chat/channels", need("chat.use"), async (c) => {
    const me = c.get("user").id;
    const b = await c.req.json();
    const name = str(b.name).replace(/^#/, "").slice(0, 40);
    if (!name) return c.json({ error: "Give the channel a name" }, 400);
    const ids = [...new Set([me, ...((b.member_ids as number[]) ?? []).map(Number)])];
    const r = await run(c.env.DB, "INSERT INTO chat_channels (name, kind, created_by) VALUES (?, 'CHANNEL', ?)", name, me);
    for (const u of ids) await run(c.env.DB, "INSERT OR IGNORE INTO chat_members (channel_id, user_id) VALUES (?,?)", r.meta.last_row_id, u);
    return c.json({ id: r.meta.last_row_id });
  });
  api.get("/chat/channels/:id/messages", need("chat.use"), async (c) => {
    const ch = Number(c.req.param("id"));
    const uid = c.get("user").id;
    await run(c.env.DB, "UPDATE users SET last_seen = datetime('now') WHERE id = ?", uid);
    if (!(await member(c.env.DB, ch, uid))) return c.json({ error: "Not a member" }, 403);
    const after = Number(c.req.query("after") ?? 0);
    const rows = await all(
      c.env.DB,
      `SELECT * FROM (SELECT m.id, m.body, m.created_at, m.user_id, m.file_name, m.file_mime, m.file_size, u.name AS author FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.channel_id = ? AND m.id > ? ORDER BY m.id DESC LIMIT 100) ORDER BY id`,
      ch, after
    );
    if (rows.length) await run(c.env.DB, "UPDATE chat_members SET last_read_id = MAX(last_read_id, ?) WHERE channel_id = ? AND user_id = ?", (rows[rows.length - 1] as any).id, ch, uid);
    return c.json(rows);
  });
  const CHAT_EXT = ["jpg", "jpeg", "png", "webp", "gif", "mp4", "webm", "mov", "mp3", "m4a", "wav", "ogg", "pdf", "doc", "docx", "xls", "xlsx", "csv", "txt", "zip"];
  const CHAT_MAX = 20 * 1024 * 1024;

  api.post("/chat/channels/:id/messages", need("chat.use"), async (c) => {
    const ch = Number(c.req.param("id"));
    const me = c.get("user");
    if (!(await member(c.env.DB, ch, me.id))) return c.json({ error: "Not a member" }, 403);
    let body = "";
    let file: File | null = null;
    if ((c.req.header("content-type") || "").includes("multipart/form-data")) {
      const form = await c.req.formData();
      body = str(form.get("body")).slice(0, 4000);
      const f = form.get("file");
      if (f && typeof f !== "string") file = f as File;
    } else {
      body = str((await c.req.json()).body).slice(0, 4000);
    }
    if (!body && !file) return c.json({ error: "Message is empty" }, 400);
    let key: string | null = null;
    if (file) {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (!file.size) return c.json({ error: "Empty file" }, 400);
      if (file.size > CHAT_MAX) return c.json({ error: "File is larger than 20 MB" }, 400);
      if (!CHAT_EXT.includes(ext)) return c.json({ error: `.${ext} files are not allowed in chat` }, 400);
      key = `chat/${ch}/${Date.now()}-${randomToken(4)}-${safeName(file.name)}`;
      await c.env.FILES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type || "application/octet-stream" } });
    }
    const r = await run(c.env.DB, "INSERT INTO chat_messages (channel_id, user_id, body, file_key, file_name, file_mime, file_size) VALUES (?,?,?,?,?,?,?)", ch, me.id, body, key, file ? safeName(file.name) : null, file ? file.type || "application/octet-stream" : null, file?.size ?? null);
    await run(c.env.DB, "UPDATE chat_members SET last_read_id = ? WHERE channel_id = ? AND user_id = ?", r.meta.last_row_id, ch, me.id);
    const info = await one<{ kind: string; name: string; n: number }>(c.env.DB, "SELECT kind, name, (SELECT COUNT(*) FROM chat_members WHERE channel_id = chat_channels.id) n FROM chat_channels WHERE id = ?", ch);
    if (info && (info.kind === "DM" || info.n <= 8)) {
      const others = (await all<{ user_id: number }>(c.env.DB, "SELECT user_id FROM chat_members WHERE channel_id = ? AND user_id != ?", ch, me.id)).map((x) => x.user_id);
      await notifyUsers(c.env, others, { title: info.kind === "DM" ? `${me.name}` : `#${info.name} - ${me.name}`, body: (body || `Sent ${file?.name}`).slice(0, 120), link: "/chat" });
    }
    return c.json({ id: r.meta.last_row_id });
  });

  api.get("/chat/files/:msgId", need("chat.use"), async (c) => {
    const m = await one<any>(c.env.DB, "SELECT m.* FROM chat_messages m JOIN chat_members cm ON cm.channel_id = m.channel_id AND cm.user_id = ? WHERE m.id = ?", c.get("user").id, Number(c.req.param("msgId")));
    if (!m?.file_key) return c.json({ error: "Not found" }, 404);
    const obj = await c.env.FILES.get(m.file_key);
    if (!obj) return c.json({ error: "File missing" }, 404);
    const mime: string = m.file_mime || "application/octet-stream";
    const inline = /^(image\/(jpeg|png|webp|gif)|video\/|audio\/|application\/pdf)/.test(mime) && !c.req.query("download");
    return new Response(obj.body, { headers: { "Content-Type": mime, "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(m.file_name)}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600" } });
  });

  // ------------------------------------------------------------ app downloads (APK / Windows installer) with expiring links + QR
  const DL: Record<string, { key: string; label: string; mime: string }> = {
    android: { key: "downloads/TaxDoctor-Team.apk", label: "Android app (APK)", mime: "application/vnd.android.package-archive" },
    windows: { key: "downloads/TaxDoctor-Team-Setup.exe", label: "Windows desktop app", mime: "application/vnd.microsoft.portable-executable" },
  };
  api.get("/downloads", async (c) => {
    const out: any[] = [];
    for (const [id, d] of Object.entries(DL)) {
      const head = await c.env.FILES.head(d.key);
      out.push({ id, label: d.label, available: !!head, size: head?.size ?? null, uploaded: head?.uploaded ?? null, file: d.key.split("/")[1] });
    }
    return c.json({ items: out, base: c.env.APP_URL || new URL(c.req.url).origin });
  });
  api.post("/downloads/link", async (c) => {
    const { id } = await c.req.json();
    if (!DL[id]) return c.json({ error: "Unknown app" }, 400);
    const token = await signToken({ t: "dl", id }, c.env.SESSION_SECRET, 48 * 3600);
    await logActivity(c.env.DB, c.get("user"), "download.link", "app", undefined, id);
    return c.json({ url: `${c.env.APP_URL || new URL(c.req.url).origin}/api/dl/${token}`, expires_hours: 48 });
  });
  // public, but only with a valid signed token that an admin generated
  api.get("/dl/:token", async (c) => {
    const p = await verifyToken<{ t: string; id: string }>(c.req.param("token"), c.env.SESSION_SECRET);
    if (!p || p.t !== "dl" || !DL[p.id]) return c.text("This download link has expired. Ask your administrator for a new one.", 410);
    const obj = await c.env.FILES.get(DL[p.id].key);
    if (!obj) return c.text("This app has not been uploaded yet.", 404);
    return new Response(obj.body, { headers: { "Content-Type": DL[p.id].mime, "Content-Disposition": `attachment; filename="${DL[p.id].key.split("/")[1]}"`, "Cache-Control": "no-store", "Content-Length": String(obj.size) } });
  });

  // ------------------------------------------------------------ bulk assignment
  api.post("/tasks/bulk", need("tasks.assign"), async (c) => {
    const me = c.get("user");
    const b = await c.req.json();
    const ids: number[] = (b.ids ?? []).map(Number).filter(Boolean);
    if (!ids.length) return c.json({ error: "Select at least one ticket" }, 400);
    const counts = new Map<number, number>();
    const assign = async (taskId: number, uid: number | null) => {
      await run(c.env.DB, "UPDATE tasks SET assigned_to = ? WHERE id = ?", uid, taskId);
      if (uid) counts.set(uid, (counts.get(uid) ?? 0) + 1);
    };
    if (Array.isArray(b.plan) && b.plan.length) {
      // e.g. [{user_id: 2, count: 3}, {user_id: 5, count: 2}] assigned in the order selected
      let i = 0;
      for (const step of b.plan) for (let k = 0; k < Number(step.count) && i < ids.length; k++) await assign(ids[i++], Number(step.user_id));
    } else if (Array.isArray(b.round_robin) && b.round_robin.length) {
      const users = b.round_robin.map(Number);
      for (let i = 0; i < ids.length; i++) await assign(ids[i], users[i % users.length]);
    } else if ("assigned_to" in (b.set ?? {})) {
      const uid = num(b.set.assigned_to);
      for (const id of ids) await assign(id, uid);
    }
    const set = b.set ?? {};
    if (set.status === "ON_HOLD") {
      const reason = str(set.hold_reason).slice(0, 500);
      if (reason.length < 3) return c.json({ error: "Please write the reason for putting these tickets on hold" }, 400);
      await run(c.env.DB, `UPDATE tasks SET status = 'ON_HOLD', completed_at = NULL, hold_reason = ?, held_at = datetime('now'), held_by = ? WHERE id IN (${ph(ids.length)}) AND status != 'ON_HOLD'`, reason, me.id, ...ids);
      for (const id of ids) await run(c.env.DB, "INSERT INTO task_comments (task_id, user_id, body) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM tasks WHERE id = ? AND hold_reason = ?)", id, me.id, `Put ON HOLD - reason: ${reason}`, id, reason);
    } else if (set.status && ["OPEN", "IN_PROGRESS", "WAITING_CLIENT", "REVIEW", "DONE"].includes(set.status))
      await run(c.env.DB, `UPDATE tasks SET status = ?, hold_reason = NULL, held_at = NULL, held_by = NULL, completed_at = ${set.status === "DONE" ? "COALESCE(completed_at, datetime('now'))" : "NULL"} WHERE id IN (${ph(ids.length)})`, set.status, ...ids);
    if (set.priority && ["LOW", "NORMAL", "HIGH", "URGENT"].includes(set.priority)) await run(c.env.DB, `UPDATE tasks SET priority = ? WHERE id IN (${ph(ids.length)})`, set.priority, ...ids);
    if ("due_date" in set && set.due_date) await run(c.env.DB, `UPDATE tasks SET due_date = ? WHERE id IN (${ph(ids.length)})`, str(set.due_date), ...ids);
    for (const [uid, n] of counts) if (uid !== me.id) await notifyUsers(c.env, [uid], { title: `${me.name} assigned ${n} ticket${n > 1 ? "s" : ""} to you`, link: "/tasks?assigned=me&open=1" });
    await logActivity(c.env.DB, me, "task.bulk", "task", undefined, `${ids.length} tickets: ${JSON.stringify(b.plan ?? b.round_robin ?? b.set)}`);
    return c.json({ updated: ids.length });
  });

  api.get("/enrolments", need("customers.view"), async (c) => {
    const q = c.req.query();
    const where = ["1=1"];
    const p: unknown[] = [];
    if (q.category) { where.push("s.category = ?"); p.push(q.category); }
    if (q.service_id) { where.push("s.id = ?"); p.push(Number(q.service_id)); }
    if (q.status) { where.push("cs.status = ?"); p.push(q.status); }
    if (q.assigned === "none") where.push("cs.assigned_to IS NULL");
    else if (q.assigned) { where.push("cs.assigned_to = ?"); p.push(Number(q.assigned)); }
    const rows = await all(
      c.env.DB,
      `SELECT cs.id, cs.status, cs.due_day, cs.next_due, cs.assigned_to, cs.fee, u.name AS assignee, s.id AS service_id, s.name AS service_name, s.category, s.due_day AS default_due_day,
              c.id AS customer_id, c.name AS customer_name, c.phone
         FROM customer_services cs JOIN services s ON s.id = cs.service_id JOIN customers c ON c.id = cs.customer_id AND c.active = 1 LEFT JOIN users u ON u.id = cs.assigned_to
        WHERE ${where.join(" AND ")} ORDER BY s.name, c.name LIMIT 1000`,
      ...p
    );
    return c.json(rows);
  });

  api.post("/enrolments/bulk", async (c) => {
    const me = c.get("user");
    const b = await c.req.json();
    const ids: number[] = (b.ids ?? []).map(Number).filter(Boolean);
    if (!ids.length) return c.json({ error: "Select at least one row" }, 400);
    const rows = await all<any>(c.env.DB, `SELECT cs.id, s.category FROM customer_services cs JOIN services s ON s.id = cs.service_id WHERE cs.id IN (${ph(ids.length)})`, ...ids);
    for (const r of rows) if (!has(c, r.category === "RECURRING" ? "recurring.manage" : "annual.manage")) return c.json({ error: "You do not have permission to change some of these services" }, 403);
    const counts = new Map<number, number>();
    const setAssignee = async (id: number, uid: number | null) => {
      await run(c.env.DB, "UPDATE customer_services SET assigned_to = ? WHERE id = ?", uid, id);
      if (b.apply_open) await run(c.env.DB, "UPDATE tasks SET assigned_to = ? WHERE customer_service_id = ? AND status != 'DONE'", uid, id);
      if (uid) counts.set(uid, (counts.get(uid) ?? 0) + 1);
    };
    if (Array.isArray(b.plan) && b.plan.length) {
      let i = 0;
      for (const step of b.plan) for (let k = 0; k < Number(step.count) && i < ids.length; k++) await setAssignee(ids[i++], Number(step.user_id));
    } else if (Array.isArray(b.round_robin) && b.round_robin.length) {
      const users = b.round_robin.map(Number);
      for (let i = 0; i < ids.length; i++) await setAssignee(ids[i], users[i % users.length]);
    } else if ("assigned_to" in b) {
      for (const id of ids) await setAssignee(id, num(b.assigned_to));
    }
    if (b.status && ["ACTIVE", "PAUSED", "ENDED"].includes(b.status)) await run(c.env.DB, `UPDATE customer_services SET status = ? WHERE id IN (${ph(ids.length)})`, b.status, ...ids);
    if (b.due_day !== undefined && has(c, "recurring.manage")) await run(c.env.DB, `UPDATE customer_services SET due_day = ? WHERE id IN (${ph(ids.length)})`, num(b.due_day), ...ids);
    for (const [uid, n] of counts) if (uid !== me.id) await notifyUsers(c.env, [uid], { title: `${n} recurring service${n > 1 ? "s" : ""} assigned to you`, link: "/recurring" });
    await logActivity(c.env.DB, me, "enrolment.bulk", "customer_services", undefined, `${ids.length} rows`);
    return c.json({ updated: ids.length });
  });

  api.post("/customers/bulk", need("customers.edit"), async (c) => {
    const b = await c.req.json();
    const ids: number[] = (b.ids ?? []).map(Number).filter(Boolean);
    if (!ids.length) return c.json({ error: "Select customers first" }, 400);
    if ("assigned_to" in b) {
      if (!has(c, "tasks.assign")) return c.json({ error: "You cannot assign customers to others" }, 403);
      await run(c.env.DB, `UPDATE customers SET assigned_to = ? WHERE id IN (${ph(ids.length)})`, num(b.assigned_to), ...ids);
    }
    return c.json({ updated: ids.length });
  });

  api.post("/customers/import", need("customers.import"), async (c) => {
    const { rows } = await c.req.json();
    let created = 0;
    const skipped: { row: number; reason: string }[] = [];
    for (let i = 0; i < (rows ?? []).length && i < 2000; i++) {
      const r = rows[i];
      const phone = str(r.phone).replace(/\D/g, "").slice(-10);
      if (!str(r.name) || phone.length !== 10) { skipped.push({ row: i + 2, reason: "Name and a 10-digit phone are required" }); continue; }
      const dup = await one(c.env.DB, "SELECT id FROM customers WHERE active = 1 AND substr(replace(replace(phone,' ',''),'+',''), -10) = ?", phone);
      if (dup) { skipped.push({ row: i + 2, reason: "Phone already exists" }); continue; }
      await run(c.env.DB, "INSERT INTO customers (name,type,contact_person,phone,email,address,city,state,pincode,pan,gstin,tan,cin,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        str(r.name), nul(r.type) ?? "Proprietorship", nul(r.contact_person), phone, nul(r.email), nul(r.address), nul(r.city), nul(r.state) ?? "West Bengal", nul(r.pincode), nul(r.pan)?.toUpperCase() ?? null, nul(r.gstin)?.toUpperCase() ?? null, nul(r.tan), nul(r.cin), nul(r.notes));
      created++;
    }
    await logActivity(c.env.DB, c.get("user"), "customer.import", "customer", undefined, `${created} created, ${skipped.length} skipped`);
    return c.json({ created, skipped });
  });

  // ------------------------------------------------------------ ticket checklist
  api.post("/tasks/:id/checklist", async (c) => {
    const id = Number(c.req.param("id"));
    const text = str((await c.req.json()).text);
    if (!text) return c.json({ error: "Empty item" }, 400);
    const pos = (await one<{ n: number }>(c.env.DB, "SELECT COALESCE(MAX(position),0)+1 n FROM task_checklist WHERE task_id = ?", id))!.n;
    await run(c.env.DB, "INSERT INTO task_checklist (task_id, text, position) VALUES (?,?,?)", id, text, pos);
    return c.json({ ok: true });
  });
  api.patch("/checklist/:id", async (c) => {
    const b = await c.req.json();
    await run(c.env.DB, "UPDATE task_checklist SET done = COALESCE(?, done), text = COALESCE(?, text) WHERE id = ?", typeof b.done === "boolean" ? (b.done ? 1 : 0) : null, nul(b.text), Number(c.req.param("id")));
    return c.json({ ok: true });
  });
  api.delete("/checklist/:id", async (c) => {
    await run(c.env.DB, "DELETE FROM task_checklist WHERE id = ?", Number(c.req.param("id")));
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------ billing
  api.get("/invoices", need("billing.view"), async (c) => {
    const q = c.req.query();
    const where = ["1=1"];
    const p: unknown[] = [];
    if (q.status === "OPEN") where.push("i.status IN ('UNPAID','PARTIAL')");
    else if (q.status) { where.push("i.status = ?"); p.push(q.status); }
    if (q.customer_id) { where.push("i.customer_id = ?"); p.push(Number(q.customer_id)); }
    const rows = await all(c.env.DB, `SELECT i.*, c.name AS customer_name FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE ${where.join(" AND ")} ORDER BY i.id DESC LIMIT 500`, ...p);
    return c.json(rows);
  });
  api.get("/billing/summary", need("billing.view"), async (c) => {
    const today = todayIST();
    const month = today.slice(0, 7);
    const n = async (sql: string, ...p: unknown[]) => (await one<{ n: number }>(c.env.DB, sql, ...p))!.n ?? 0;
    return c.json({
      outstanding: await n("SELECT COALESCE(SUM(total - paid),0) n FROM invoices WHERE status IN ('UNPAID','PARTIAL')"),
      overdue: await n("SELECT COALESCE(SUM(total - paid),0) n FROM invoices WHERE status IN ('UNPAID','PARTIAL') AND due_date < ?", today),
      collected: await n("SELECT COALESCE(SUM(amount),0) n FROM payments WHERE substr(paid_on,1,7) = ?", month),
      invoiced: await n("SELECT COALESCE(SUM(total),0) n FROM invoices WHERE status != 'CANCELLED' AND substr(issue_date,1,7) = ?", month),
    });
  });
  api.get("/invoices/:id", need("billing.view"), async (c) => {
    const id = Number(c.req.param("id"));
    const invoice = await one<any>(c.env.DB, "SELECT i.*, c.name AS customer_name, c.address, c.city, c.state, c.pincode, c.gstin, c.phone, c.email FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ?", id);
    if (!invoice) return c.json({ error: "Not found" }, 404);
    const [items, payments] = await Promise.all([
      all(c.env.DB, "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id", id),
      all(c.env.DB, "SELECT p.*, u.name AS by FROM payments p LEFT JOIN users u ON u.id = p.created_by WHERE p.invoice_id = ? ORDER BY p.id", id),
    ]);
    return c.json({ invoice, items, payments });
  });
  api.post("/invoices", need("billing.manage"), async (c) => {
    const b = await c.req.json();
    const items = (b.items ?? []).map((i: any) => ({ description: str(i.description), amount: Number(i.amount) })).filter((i: any) => i.description && i.amount > 0);
    if (!num(b.customer_id) || !items.length) return c.json({ error: "Choose a customer and add at least one line with an amount" }, 400);
    const rate = num(b.gst_rate) ?? 18;
    const subtotal = items.reduce((a: number, i: any) => a + i.amount, 0);
    const gst = Math.round(subtotal * rate) / 100;
    const seq = (await one<{ n: number }>(c.env.DB, "SELECT COALESCE(MAX(id),0)+1 n FROM invoices"))!.n;
    const number = `INV-${todayIST().slice(0, 4)}-${String(seq).padStart(4, "0")}`;
    const r = await run(c.env.DB, "INSERT INTO invoices (number, customer_id, task_id, issue_date, due_date, gst_rate, subtotal, gst_amount, total, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      number, num(b.customer_id), num(b.task_id), nul(b.issue_date) ?? todayIST(), nul(b.due_date) ?? addDays(todayIST(), 15), rate, subtotal, gst, subtotal + gst, nul(b.notes), c.get("user").id);
    for (const i of items) await run(c.env.DB, "INSERT INTO invoice_items (invoice_id, description, amount) VALUES (?,?,?)", r.meta.last_row_id, i.description, i.amount);
    await logActivity(c.env.DB, c.get("user"), "invoice.create", "invoice", r.meta.last_row_id as number, number);
    return c.json({ id: r.meta.last_row_id, number });
  });
  api.post("/invoices/:id/payments", need("billing.manage"), async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json();
    const inv = await one<any>(c.env.DB, "SELECT * FROM invoices WHERE id = ?", id);
    const amount = Number(b.amount);
    if (!inv || inv.status === "CANCELLED") return c.json({ error: "Invoice not available" }, 400);
    if (!(amount > 0) || amount > inv.total - inv.paid + 0.005) return c.json({ error: `Amount must be between 0 and the balance (${(inv.total - inv.paid).toFixed(2)})` }, 400);
    await run(c.env.DB, "INSERT INTO payments (invoice_id, amount, paid_on, method, reference, created_by) VALUES (?,?,?,?,?,?)", id, amount, nul(b.paid_on) ?? todayIST(), nul(b.method), nul(b.reference), c.get("user").id);
    const paid = Math.round((inv.paid + amount) * 100) / 100;
    await run(c.env.DB, "UPDATE invoices SET paid = ?, status = ? WHERE id = ?", paid, paid >= inv.total - 0.005 ? "PAID" : "PARTIAL", id);
    await logActivity(c.env.DB, c.get("user"), "payment.add", "invoice", id, `${amount}`);
    return c.json({ ok: true });
  });
  api.post("/invoices/:id/cancel", need("billing.manage"), async (c) => {
    const id = Number(c.req.param("id"));
    const inv = await one<any>(c.env.DB, "SELECT paid FROM invoices WHERE id = ?", id);
    if (inv?.paid > 0) return c.json({ error: "Payments are recorded against this invoice and it cannot be cancelled" }, 400);
    await run(c.env.DB, "UPDATE invoices SET status = 'CANCELLED' WHERE id = ?", id);
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------ credentials vault
  api.get("/customers/:id/vault", need("vault.view"), async (c) =>
    c.json(await all(c.env.DB, "SELECT id, label, url, username, notes, (secret_enc IS NOT NULL) AS has_secret, created_at FROM vault WHERE customer_id = ? ORDER BY label", Number(c.req.param("id"))))
  );
  api.post("/customers/:id/vault", need("vault.manage"), async (c) => {
    const b = await c.req.json();
    if (!str(b.label)) return c.json({ error: "Label is required (e.g. GST portal)" }, 400);
    const r = await run(c.env.DB, "INSERT INTO vault (customer_id, label, url, username, secret_enc, notes, created_by) VALUES (?,?,?,?,?,?,?)",
      Number(c.req.param("id")), str(b.label), nul(b.url), nul(b.username), b.secret ? await encryptSecret(c.env, String(b.secret)) : null, nul(b.notes), c.get("user").id);
    await logActivity(c.env.DB, c.get("user"), "vault.create", "vault", r.meta.last_row_id as number, str(b.label));
    return c.json({ id: r.meta.last_row_id });
  });
  api.patch("/vault/:id", need("vault.manage"), async (c) => {
    const b = await c.req.json();
    const id = Number(c.req.param("id"));
    await run(c.env.DB, "UPDATE vault SET label = COALESCE(?, label), url = ?, username = ?, notes = ? WHERE id = ?", nul(b.label), nul(b.url), nul(b.username), nul(b.notes), id);
    if (b.secret) await run(c.env.DB, "UPDATE vault SET secret_enc = ? WHERE id = ?", await encryptSecret(c.env, String(b.secret)), id);
    await logActivity(c.env.DB, c.get("user"), "vault.update", "vault", id);
    return c.json({ ok: true });
  });
  api.delete("/vault/:id", need("vault.manage"), async (c) => {
    await run(c.env.DB, "DELETE FROM vault WHERE id = ?", Number(c.req.param("id")));
    await logActivity(c.env.DB, c.get("user"), "vault.delete", "vault", Number(c.req.param("id")));
    return c.json({ ok: true });
  });
  api.post("/vault/:id/reveal", need("vault.view"), async (c) => {
    const v = await one<any>(c.env.DB, "SELECT * FROM vault WHERE id = ?", Number(c.req.param("id")));
    if (!v?.secret_enc) return c.json({ secret: "" });
    await logActivity(c.env.DB, c.get("user"), "vault.reveal", "vault", v.id, `${v.label} (customer ${v.customer_id})`);
    return c.json({ secret: await decryptSecret(c.env, v.secret_enc) });
  });

  // ------------------------------------------------------------ reports, calendar, search
  api.get("/reports/overview", need("reports.view"), async (c) => {
    const today = todayIST();
    const month = today.slice(0, 7);
    const workload = await all(
      c.env.DB,
      `SELECT u.id, u.name,
          SUM(CASE WHEN t.status != 'DONE' THEN 1 ELSE 0 END) AS open_count,
          SUM(CASE WHEN t.status NOT IN ('DONE','ON_HOLD') AND t.due_date < ?1 THEN 1 ELSE 0 END) AS overdue,
          SUM(CASE WHEN t.status = 'DONE' AND substr(t.completed_at,1,7) = ?2 THEN 1 ELSE 0 END) AS done_month
        FROM users u LEFT JOIN tasks t ON t.assigned_to = u.id WHERE u.active = 1 GROUP BY u.id ORDER BY open_count DESC`,
      today, month
    );
    const unassigned = (await one<{ n: number }>(c.env.DB, "SELECT COUNT(*) n FROM tasks WHERE assigned_to IS NULL AND status != 'DONE'"))!.n;
    const byService = await all(
      c.env.DB,
      `SELECT s.name, s.category, COUNT(*) AS total, SUM(CASE WHEN t.status = 'DONE' THEN 1 ELSE 0 END) AS done, SUM(CASE WHEN t.status NOT IN ('DONE','ON_HOLD') AND t.due_date < ? THEN 1 ELSE 0 END) AS overdue
         FROM tasks t JOIN services s ON s.id = t.service_id WHERE substr(COALESCE(t.due_date, t.created_at),1,7) = ? GROUP BY s.id ORDER BY total DESC LIMIT 20`,
      today, month
    );
    let revenue: any[] = [], topDue: any[] = [];
    if (has(c, "billing.view")) {
      revenue = await all(
        c.env.DB,
        `SELECT m AS month, (SELECT COALESCE(SUM(total),0) FROM invoices WHERE status != 'CANCELLED' AND substr(issue_date,1,7) = m) AS invoiced, (SELECT COALESCE(SUM(amount),0) FROM payments WHERE substr(paid_on,1,7) = m) AS collected
           FROM (SELECT DISTINCT substr(issue_date,1,7) AS m FROM invoices UNION SELECT DISTINCT substr(paid_on,1,7) FROM payments) ORDER BY m DESC LIMIT 6`
      );
      topDue = await all(c.env.DB, "SELECT c.id, c.name, SUM(i.total - i.paid) AS due FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.status IN ('UNPAID','PARTIAL') GROUP BY c.id ORDER BY due DESC LIMIT 8");
    }
    return c.json({ workload, unassigned, byService, revenue: revenue.reverse(), topDue, month });
  });

  api.get("/calendar", async (c) => {
    const month = str(c.req.query("month")) || todayIST().slice(0, 7);
    const scope = !has(c, "tasks.view_all") ? "AND (t.assigned_to = ? OR t.assigned_to IS NULL)" : "";
    const tasks = await all(
      c.env.DB,
      `SELECT t.id, t.title, t.due_date, t.status, t.category, t.priority, cu.name AS customer_name, u.name AS assignee FROM tasks t LEFT JOIN customers cu ON cu.id = t.customer_id LEFT JOIN users u ON u.id = t.assigned_to
        WHERE substr(t.due_date,1,7) = ? ${scope} ORDER BY t.due_date LIMIT 800`,
      month, ...(scope ? [c.get("user").id] : [])
    );
    const renewals = await all(
      c.env.DB,
      `SELECT cs.id, cs.next_due AS due_date, s.name AS service_name, cu.name AS customer_name FROM customer_services cs JOIN services s ON s.id = cs.service_id AND s.category = 'ANNUAL' JOIN customers cu ON cu.id = cs.customer_id AND cu.active = 1
        WHERE cs.status = 'ACTIVE' AND substr(cs.next_due,1,7) = ? ORDER BY cs.next_due`,
      month
    );
    return c.json({ month, tasks, renewals });
  });

  api.get("/search", async (c) => {
    const q = str(c.req.query("q"));
    if (q.length < 2) return c.json({ customers: [], tasks: [] });
    const like = `%${q}%`;
    const customers = has(c, "customers.view")
      ? await all(c.env.DB, "SELECT id, name, phone, gstin, city FROM customers WHERE active = 1 AND (name LIKE ?1 OR phone LIKE ?1 OR gstin LIKE ?1 OR pan LIKE ?1 OR email LIKE ?1) ORDER BY name LIMIT 6", like)
      : [];
    const idNum = /^td-?0*(\d+)$/i.exec(q);
    const scope = !has(c, "tasks.view_all") ? "AND (t.assigned_to = ? OR t.assigned_to IS NULL)" : "";
    const tasks = await all(
      c.env.DB,
      `SELECT t.id, t.title, t.status, cu.name AS customer_name FROM tasks t LEFT JOIN customers cu ON cu.id = t.customer_id WHERE (t.title LIKE ? ${idNum ? "OR t.id = ?" : ""}) ${scope} ORDER BY t.id DESC LIMIT 6`,
      like, ...(idNum ? [Number(idNum[1])] : []), ...(scope ? [c.get("user").id] : [])
    );
    return c.json({ customers, tasks });
  });
}
