import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import {
  Env, StaffUser, Role, all, one, run, effectivePerms, PERMS, ROLE_DEFAULTS, notifyUsers, notifyCustomer, usersWithPerm, hashPassword, verifyPassword, signToken, verifyToken, randomToken,
  todayIST, addDays, samePhone, logActivity, sendMail, checkUpload, safeName, hex,
} from "./lib";
import { need, has, Vars } from "./guard";
import { registerExtra } from "./extra";
import { registerAuth } from "./auth";
import { generateRecurring, sendRenewalEmail, sendRenewalReminders, nextRenewalDate, dailyJob } from "./jobs";

const app = new Hono<{ Bindings: Env; Variables: Vars }>();
const api = app.basePath("/api");

const STAFF_COOKIE = "td_session";
const PORTAL_COOKIE = "td_portal";
const isSecure = (url: string) => url.startsWith("https:");
const str = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
const nul = (v: unknown) => (str(v) === "" ? null : str(v));
const num = (v: unknown) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));

// ---------------------------------------------------------------- security middleware
api.use("*", async (c, next) => {
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Cache-Control", "no-store");
  // CSRF: browsers always send Origin on cross-site POSTs; refuse mismatches.
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const origin = c.req.header("Origin");
    if (origin && new URL(origin).host !== new URL(c.req.url).host) return c.json({ error: "Cross-origin request blocked" }, 403);
  }
  await next();
});

registerAuth(api, { STAFF_COOKIE, isSecure });

// ---------------------------------------------------------------- services catalog
api.get("/services", async (c) => c.json(await all(c.env.DB, "SELECT * FROM services ORDER BY category, name")));
api.post("/services", need("catalogue.manage"), async (c) => {
  const b = await c.req.json();
  if (!str(b.name) || !["ANNUAL", "RECURRING", "ONE_TIME"].includes(b.category)) return c.json({ error: "Name and category are required" }, 400);
  try {
    const r = await run(
      c.env.DB,
      "INSERT INTO services (name, category, frequency, due_day, period_offset, renew_rule, renew_months, description, months) VALUES (?,?,?,?,?,?,?,?,?)",
      str(b.name), b.category, b.frequency || (b.category === "ONE_TIME" ? "ONCE" : "YEARLY"), num(b.due_day), num(b.period_offset) ?? 1, nul(b.renew_rule), num(b.renew_months), nul(b.description), nul(b.months)
    );
    return c.json({ id: r.meta.last_row_id });
  } catch {
    return c.json({ error: "A service with this name already exists" }, 409);
  }
});
api.patch("/services/:id", need("catalogue.manage"), async (c) => {
  const b = await c.req.json();
  const id = Number(c.req.param("id"));
  await run(c.env.DB, "UPDATE services SET name = COALESCE(?, name), due_day = ?, description = ?, active = COALESCE(?, active) WHERE id = ?", nul(b.name), num(b.due_day), nul(b.description), typeof b.active === "boolean" ? (b.active ? 1 : 0) : null, id);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- customers
const CUSTOMER_FIELDS = ["name", "type", "contact_person", "phone", "email", "address", "city", "state", "pincode", "pan", "gstin", "tan", "cin", "notes"] as const;

api.get("/customers", need("customers.view"), async (c) => {
  const q = str(c.req.query("q"));
  const like = `%${q}%`;
  const rows = await all(
    c.env.DB,
    `SELECT c.*,
        (SELECT COUNT(*) FROM tasks t WHERE t.customer_id = c.id AND t.status != 'DONE') AS open_tasks,
        (SELECT COUNT(*) FROM customer_services cs WHERE cs.customer_id = c.id AND cs.status = 'ACTIVE') AS services,
        (SELECT name FROM users u WHERE u.id = c.assigned_to) AS rm,
        (SELECT name FROM users u WHERE u.id = c.manager_id) AS manager
       FROM customers c
      WHERE c.active = 1 ${q ? "AND (c.name LIKE ?1 OR c.phone LIKE ?1 OR c.email LIKE ?1 OR c.gstin LIKE ?1 OR c.pan LIKE ?1 OR c.contact_person LIKE ?1)" : ""}
      ORDER BY c.name LIMIT 500`,
    ...(q ? [like] : [])
  );
  return c.json(rows);
});

api.post("/customers", need("customers.edit"), async (c) => {
  const b = await c.req.json();
  if (!str(b.name) || !str(b.phone)) return c.json({ error: "Name and phone are required" }, 400);
  const dup = await all(c.env.DB, "SELECT id, name FROM customers WHERE active = 1 AND substr(replace(replace(phone,' ',''),'+',''), -10) = ?", str(b.phone).replace(/\D/g, "").slice(-10));
  if (dup.length && !b.force) return c.json({ error: `Phone already used by ${dup[0].name}`, duplicate: true }, 409);
  const vals = CUSTOMER_FIELDS.map((f) => nul(b[f]));
  vals[0] = str(b.name);
  vals[1] = str(b.type) || "Proprietorship";
  const r = await run(c.env.DB, `INSERT INTO customers (${CUSTOMER_FIELDS.join(",")}, assigned_to, manager_id) VALUES (${CUSTOMER_FIELDS.map(() => "?").join(",")}, ?, ?)`, ...vals, has(c, "customers.assign") ? num(b.assigned_to) : null, has(c, "customers.assign") ? num(b.manager_id) : null);
  await logActivity(c.env.DB, c.get("user"), "customer.create", "customer", r.meta.last_row_id as number, str(b.name));
  return c.json({ id: r.meta.last_row_id });
});

api.get("/customers/:id", need("customers.view"), async (c) => {
  const id = Number(c.req.param("id"));
  const customer = await one(c.env.DB, "SELECT c.*, (SELECT name FROM users u WHERE u.id = c.assigned_to) AS rm_name, (SELECT name FROM users u WHERE u.id = c.manager_id) AS manager_name FROM customers c WHERE c.id = ?", id);
  if (!customer) return c.json({ error: "Not found" }, 404);
  const [services, tasks, documents, requests, link, emails] = await Promise.all([
    all(c.env.DB, `SELECT cs.*, s.name AS service_name, s.category, s.frequency, u.name AS assignee FROM customer_services cs JOIN services s ON s.id = cs.service_id LEFT JOIN users u ON u.id = cs.assigned_to WHERE cs.customer_id = ? ORDER BY s.category, s.name`, id),
    all(c.env.DB, `SELECT t.*, u.name AS assignee FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to WHERE t.customer_id = ? ORDER BY (t.status='DONE'), t.due_date LIMIT 100`, id),
    all(c.env.DB, `SELECT id, name, original_name, size, mime, source, uploaded_at, request_id FROM documents WHERE customer_id = ? AND status = 'ACCEPTED' ORDER BY uploaded_at DESC`, id),
    all(c.env.DB, `SELECT * FROM doc_requests WHERE customer_id = ? AND status IN ('REQUESTED','SUBMITTED') ORDER BY created_at DESC`, id),
    one(c.env.DB, "SELECT token, last_used_at, locked_until FROM portal_links WHERE customer_id = ? AND active = 1 ORDER BY id DESC", id),
    all(c.env.DB, "SELECT id, subject, kind, status, created_at FROM email_log WHERE customer_id = ? ORDER BY id DESC LIMIT 20", id),
  ]);
  return c.json({ customer, services, tasks, documents, requests, link: link ? { ...link, url: `${c.env.APP_URL || new URL(c.req.url).origin}/portal/${link.token}` } : null, emails });
});

api.patch("/customers/:id", need("customers.edit"), async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json();
  if (!str(b.name) || !str(b.phone)) return c.json({ error: "Name and phone are required" }, 400);
  const vals = CUSTOMER_FIELDS.map((f) => nul(b[f]));
  vals[0] = str(b.name);
  const cur = await one<any>(c.env.DB, "SELECT assigned_to, manager_id FROM customers WHERE id = ?", id);
  if (!cur) return c.json({ error: "Not found" }, 404);
  const canAssign = has(c, "customers.assign");
  await run(c.env.DB, `UPDATE customers SET ${CUSTOMER_FIELDS.map((f) => `${f} = ?`).join(",")}, assigned_to = ?, manager_id = ? WHERE id = ?`, ...vals, canAssign ? num(b.assigned_to) : cur.assigned_to, canAssign ? num(b.manager_id) : cur.manager_id, id);
  await logActivity(c.env.DB, c.get("user"), "customer.update", "customer", id);
  return c.json({ ok: true });
});

api.delete("/customers/:id", need("customers.delete"), async (c) => {
  const id = Number(c.req.param("id"));
  await run(c.env.DB, "UPDATE customers SET active = 0 WHERE id = ?", id); // archive, never hard-delete client history
  await run(c.env.DB, "UPDATE portal_links SET active = 0 WHERE customer_id = ?", id);
  await logActivity(c.env.DB, c.get("user"), "customer.archive", "customer", id);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- enrolments (annual / recurring)
api.post("/customers/:id/services", async (c) => {
  const customerId = Number(c.req.param("id"));
  const b = await c.req.json();
  const svc = await one<any>(c.env.DB, "SELECT * FROM services WHERE id = ?", num(b.service_id));
  if (!svc || svc.category === "ONE_TIME") return c.json({ error: "Choose an annual or recurring service" }, 400);
  if (!has(c, svc.category === "RECURRING" ? "recurring.manage" : "annual.manage")) return c.json({ error: "You do not have permission to enrol customers in this type of service" }, 403);
  if (svc.category === "ANNUAL" && !str(b.next_due)) return c.json({ error: "Next due date is required for annual services" }, 400);
  try {
    const r = await run(
      c.env.DB,
      "INSERT INTO customer_services (customer_id, service_id, next_due, due_day, assigned_to, fee, reg_no, notes) VALUES (?,?,?,?,?,?,?,?)",
      customerId, svc.id, svc.category === "ANNUAL" ? str(b.next_due) : null, num(b.due_day), num(b.assigned_to), num(b.fee), nul(b.reg_no), nul(b.notes)
    );
    await logActivity(c.env.DB, c.get("user"), "enrol", "customer", customerId, svc.name);
    return c.json({ id: r.meta.last_row_id });
  } catch {
    return c.json({ error: "Customer is already enrolled in this service" }, 409);
  }
});
api.patch("/customer-services/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json();
  const cat = await one<{ category: string }>(c.env.DB, "SELECT s.category FROM customer_services cs JOIN services s ON s.id = cs.service_id WHERE cs.id = ?", id);
  if (!cat) return c.json({ error: "Not found" }, 404);
  if (!has(c, cat.category === "RECURRING" ? "recurring.manage" : "annual.manage")) return c.json({ error: "You do not have permission to change this service" }, 403);
  await run(
    c.env.DB,
    "UPDATE customer_services SET status = COALESCE(?, status), next_due = COALESCE(?, next_due), due_day = ?, assigned_to = ?, fee = ?, reg_no = ?, notes = ? WHERE id = ?",
    nul(b.status), nul(b.next_due), num(b.due_day), num(b.assigned_to), num(b.fee), nul(b.reg_no), nul(b.notes), id
  );
  return c.json({ ok: true });
});
api.delete("/customer-services/:id", need("recurring.manage"), async (c) => {
  await run(c.env.DB, "DELETE FROM customer_services WHERE id = ?", Number(c.req.param("id")));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- renewals (annual)
api.get("/renewals", async (c) => {
  const days = Math.min(Math.max(Number(c.req.query("days") ?? 15), 1), 365);
  const rows = await all(
    c.env.DB,
    `SELECT cs.id, cs.next_due, cs.reg_no, cs.fee, cs.reminded_for, cs.status, cs.assigned_to, u.name AS assignee,
            s.id AS service_id, s.name AS service_name, s.renew_rule, c.id AS customer_id, c.name AS customer_name, c.phone, c.email
       FROM customer_services cs
       JOIN services s ON s.id = cs.service_id AND s.category = 'ANNUAL'
       JOIN customers c ON c.id = cs.customer_id AND c.active = 1
       LEFT JOIN users u ON u.id = cs.assigned_to
      WHERE cs.status = 'ACTIVE' AND cs.next_due IS NOT NULL AND cs.next_due <= ?
      ORDER BY cs.next_due`,
    addDays(todayIST(), days)
  );
  return c.json(rows);
});
api.post("/renewals/run-reminders", need("annual.manage"), async (c) => c.json(await sendRenewalReminders(c.env, 15)));
api.post("/customer-services/:id/remind", need("annual.manage"), async (c) => {
  const r = await one<any>(
    c.env.DB,
    `SELECT cs.id, cs.next_due, cs.reg_no, s.name AS service_name, c.id AS customer_id, c.name AS customer_name, c.email
       FROM customer_services cs JOIN services s ON s.id = cs.service_id JOIN customers c ON c.id = cs.customer_id WHERE cs.id = ?`,
    Number(c.req.param("id"))
  );
  if (!r) return c.json({ error: "Not found" }, 404);
  if (!r.email) return c.json({ error: "This customer has no email address. Call them instead." }, 400);
  const status = await sendRenewalEmail(c.env, r);
  return c.json({ status });
});
api.post("/customer-services/:id/renew", need("annual.manage"), async (c) => {
  const id = Number(c.req.param("id"));
  const r = await one<any>(c.env.DB, "SELECT cs.*, s.renew_rule, s.renew_months, s.name AS service_name FROM customer_services cs JOIN services s ON s.id = cs.service_id WHERE cs.id = ?", id);
  if (!r?.next_due) return c.json({ error: "Not found" }, 404);
  const b = await c.req.json().catch(() => ({} as any));
  const next = str(b.next_due) || nextRenewalDate(r.next_due, r.renew_rule, r.renew_months);
  await run(c.env.DB, "UPDATE customer_services SET next_due = ?, reminded_for = NULL WHERE id = ?", next, id);
  await logActivity(c.env.DB, c.get("user"), "renewed", "customer", r.customer_id, `${r.service_name}: ${r.next_due} -> ${next}`);
  return c.json({ next_due: next });
});

// ---------------------------------------------------------------- recurring
api.get("/recurring", async (c) => {
  const period = str(c.req.query("period")) || todayIST().slice(0, 7);
  const tasks = await all(
    c.env.DB,
    `SELECT t.*, c.name AS customer_name, s.name AS service_name, u.name AS assignee
       FROM tasks t JOIN customers c ON c.id = t.customer_id JOIN services s ON s.id = t.service_id LEFT JOIN users u ON u.id = t.assigned_to
      WHERE t.category = 'RECURRING' AND t.period_key = ? ORDER BY s.name, c.name`,
    period
  );
  const enrolments = (await one<{ n: number }>(c.env.DB, "SELECT COUNT(*) n FROM customer_services cs JOIN services s ON s.id = cs.service_id WHERE s.category = 'RECURRING' AND cs.status = 'ACTIVE'"))!.n;
  return c.json({ period, tasks, enrolments });
});
api.post("/recurring/generate", need("recurring.manage"), async (c) => {
  const { period } = await c.req.json();
  try {
    return c.json(await generateRecurring(c.env, str(period) || todayIST().slice(0, 7), c.get("user").id));
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }
});

// ---------------------------------------------------------------- tasks / tickets
const TASK_SELECT = `SELECT t.*, c.name AS customer_name, s.name AS service_name, u.name AS assignee, cb.name AS creator, hb.name AS held_by_name,
   (SELECT COUNT(*) FROM doc_requests r WHERE r.task_id = t.id AND r.status IN ('REQUESTED','SUBMITTED')) AS open_requests
   FROM tasks t LEFT JOIN customers c ON c.id = t.customer_id LEFT JOIN services s ON s.id = t.service_id
   LEFT JOIN users u ON u.id = t.assigned_to LEFT JOIN users cb ON cb.id = t.created_by LEFT JOIN users hb ON hb.id = t.held_by`;

api.get("/tasks", async (c) => {
  const user = c.get("user");
  const where: string[] = [];
  const p: unknown[] = [];
  const q = c.req.query();
  if (q.status) {
    const list = q.status.split(",");
    where.push(`t.status IN (${list.map(() => "?").join(",")})`);
    p.push(...list);
  } else if (q.open === "1") where.push("t.status != 'DONE'");
  if (q.category) { where.push("t.category = ?"); p.push(q.category); }
  if (q.customer_id) { where.push("t.customer_id = ?"); p.push(Number(q.customer_id)); }
  if (q.service_id) { where.push("t.service_id = ?"); p.push(Number(q.service_id)); }
  if (q.assigned === "me") { where.push("t.assigned_to = ?"); p.push(user.id); }
  else if (q.assigned === "none") where.push("t.assigned_to IS NULL");
  else if (q.assigned) { where.push("t.assigned_to = ?"); p.push(Number(q.assigned)); }
  if (q.due === "overdue") { where.push("t.status NOT IN ('DONE','ON_HOLD') AND t.due_date < ?"); p.push(todayIST()); }
  if (q.due === "week") { where.push("t.status NOT IN ('DONE','ON_HOLD') AND t.due_date BETWEEN ? AND ?"); p.push(todayIST(), addDays(todayIST(), 7)); }
  if (q.q) { where.push("(t.title LIKE ? OR c.name LIKE ?)"); p.push(`%${q.q}%`, `%${q.q}%`); }
  if (!has(c, "tasks.view_all")) { where.push("(t.assigned_to = ? OR t.assigned_to IS NULL)"); p.push(user.id); }
  const rows = await all(c.env.DB, `${TASK_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY (t.status='DONE'), t.due_date IS NULL, t.due_date, t.id DESC LIMIT 500`, ...p);
  return c.json(rows);
});

api.get("/tasks/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const user = c.get("user");
  const task = await one<any>(c.env.DB, `${TASK_SELECT} WHERE t.id = ?`, id);
  if (!task) return c.json({ error: "Not found" }, 404);
  if (!has(c, "tasks.view_all") && task.assigned_to && task.assigned_to !== user.id) return c.json({ error: "This ticket is assigned to someone else" }, 403);
  const [comments, requests, documents, checklist] = await Promise.all([
    all(c.env.DB, "SELECT k.*, u.name AS author FROM task_comments k LEFT JOIN users u ON u.id = k.user_id WHERE k.task_id = ? ORDER BY k.id", id),
    all(c.env.DB, "SELECT * FROM doc_requests WHERE task_id = ? ORDER BY id", id),
    all(c.env.DB, "SELECT d.id, d.name, d.status, d.size, d.request_id, d.uploaded_at FROM documents d JOIN doc_requests r ON r.id = d.request_id WHERE r.task_id = ? AND d.status != 'REJECTED' ORDER BY d.id", id),
    all(c.env.DB, "SELECT * FROM task_checklist WHERE task_id = ? ORDER BY position, id", id),
  ]);
  return c.json({ task, comments, requests, documents, checklist });
});

api.post("/tasks", need("tasks.create"), async (c) => {
  const user = c.get("user");
  const b = await c.req.json();
  if (!str(b.title)) return c.json({ error: "Title is required" }, 400);
  if (b.assigned_to && !has(c, "tasks.assign") && Number(b.assigned_to) !== user.id) return c.json({ error: "Only managers can assign work to others" }, 403);
  const svc = b.service_id ? await one<any>(c.env.DB, "SELECT * FROM services WHERE id = ?", num(b.service_id)) : null;
  const category = svc ? svc.category : "CUSTOM";
  const r = await run(
    c.env.DB,
    `INSERT INTO tasks (title, description, customer_id, service_id, category, due_date, priority, assigned_to, created_by) VALUES (?,?,?,?,?,?,?,?,?)`,
    str(b.title), nul(b.description), num(b.customer_id), svc?.id ?? null, category, nul(b.due_date), ["LOW", "NORMAL", "HIGH", "URGENT"].includes(b.priority) ? b.priority : "NORMAL", num(b.assigned_to), user.id
  );
  if (num(b.assigned_to) && num(b.assigned_to) !== user.id) await notifyUsers(c.env, [num(b.assigned_to)!], { title: `New ticket assigned: ${str(b.title)}`, link: `/tasks?open=1` });
  await logActivity(c.env.DB, user, "task.create", "task", r.meta.last_row_id as number, str(b.title));
  return c.json({ id: r.meta.last_row_id });
});

api.patch("/tasks/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const user = c.get("user");
  const b = await c.req.json();
  const t = await one<any>(c.env.DB, "SELECT * FROM tasks WHERE id = ?", id);
  if (!t) return c.json({ error: "Not found" }, 404);
  if (!has(c, "tasks.assign")) {
    if (t.assigned_to && t.assigned_to !== user.id) return c.json({ error: "This ticket is assigned to someone else" }, 403);
    if ("assigned_to" in b && num(b.assigned_to) !== t.assigned_to && num(b.assigned_to) !== user.id) return c.json({ error: "You cannot assign work to others" }, 403);
  }
  const status = b.status && ["OPEN", "IN_PROGRESS", "WAITING_CLIENT", "REVIEW", "ON_HOLD", "DONE"].includes(b.status) ? b.status : t.status;
  const completed = status === "DONE" ? t.completed_at ?? new Date().toISOString() : null;
  const goingOnHold = status === "ON_HOLD" && t.status !== "ON_HOLD";
  const holdReason = str(b.hold_reason).slice(0, 500);
  if (goingOnHold && holdReason.length < 3) return c.json({ error: "Please write the reason for putting this ticket on hold" }, 400);
  const reasonChanged = status === "ON_HOLD" && !goingOnHold && holdReason.length >= 3 && holdReason !== t.hold_reason;
  await run(
    c.env.DB,
    `UPDATE tasks SET title = ?, description = ?, due_date = ?, priority = ?, status = ?, assigned_to = ?, completed_at = ?, hold_reason = ?, held_at = ?, held_by = ? WHERE id = ?`,
    "title" in b ? str(b.title) || t.title : t.title,
    "description" in b ? nul(b.description) : t.description,
    "due_date" in b ? nul(b.due_date) : t.due_date,
    ["LOW", "NORMAL", "HIGH", "URGENT"].includes(b.priority) ? b.priority : t.priority,
    status,
    "assigned_to" in b ? num(b.assigned_to) : t.assigned_to,
    completed,
    status === "ON_HOLD" ? (reasonChanged || goingOnHold ? holdReason : t.hold_reason) : null,
    status === "ON_HOLD" ? (goingOnHold ? new Date().toISOString() : t.held_at) : null,
    status === "ON_HOLD" ? (goingOnHold ? user.id : t.held_by) : null,
    id
  );
  if (status !== t.status) {
    const note = goingOnHold ? `Put ON HOLD - reason: ${holdReason}` : t.status === "ON_HOLD" ? `Resumed from hold (was: ${t.hold_reason ?? "no reason recorded"}) -> ${status}` : `Status changed: ${t.status} -> ${status}`;
    await run(c.env.DB, "INSERT INTO task_comments (task_id, user_id, body) VALUES (?,?,?)", id, user.id, note);
    await logActivity(c.env.DB, user, "task.status", "task", id, goingOnHold ? `${t.status} -> ON_HOLD: ${holdReason}` : `${t.status} -> ${status}`);
    if (goingOnHold && t.created_by && t.created_by !== user.id) await notifyUsers(c.env, [t.created_by], { title: `Ticket on hold: ${t.title}`, body: holdReason, link: "/tasks?open=1" });
  } else if (reasonChanged) {
    await run(c.env.DB, "INSERT INTO task_comments (task_id, user_id, body) VALUES (?,?,?)", id, user.id, `Hold reason updated: ${holdReason}`);
  }
  // keep the assignee and the ticket's creator in the loop about every change somebody else makes
  const changes: string[] = [];
  if (status !== t.status) changes.push(`status ${t.status.replace("_", " ").toLowerCase()} -> ${status.replace("_", " ").toLowerCase()}`);
  if ("due_date" in b && nul(b.due_date) !== t.due_date) changes.push(`due date ${nul(b.due_date) ?? "cleared"}`);
  if (b.priority && ["LOW", "NORMAL", "HIGH", "URGENT"].includes(b.priority) && b.priority !== t.priority) changes.push(`priority ${b.priority.toLowerCase()}`);
  if (changes.length) {
    const audience = [t.assigned_to, "assigned_to" in b ? num(b.assigned_to) : null, t.created_by].filter((x): x is number => !!x && x !== user.id);
    if (audience.length) await notifyUsers(c.env, audience, { title: `${t.title}`, body: `${user.name.replace(/\(.*\)/, "").trim()}: ${changes.join(", ")}`, link: `/tasks?open=${id}` });
  }
  if ("assigned_to" in b && num(b.assigned_to) !== t.assigned_to) {
    await logActivity(c.env.DB, user, "task.assign", "task", id, String(b.assigned_to));
    if (num(b.assigned_to) && num(b.assigned_to) !== user.id) await notifyUsers(c.env, [num(b.assigned_to)!], { title: `Ticket assigned to you: ${t.title}`, link: "/tasks?assigned=me&open=1" });
  }
  return c.json({ ok: true });
});

api.delete("/tasks/:id", need("tasks.delete"), async (c) => {
  await run(c.env.DB, "DELETE FROM tasks WHERE id = ?", Number(c.req.param("id")));
  await logActivity(c.env.DB, c.get("user"), "task.delete", "task", Number(c.req.param("id")));
  return c.json({ ok: true });
});

api.post("/tasks/:id/comments", async (c) => {
  const { body } = await c.req.json();
  if (!str(body)) return c.json({ error: "Comment is empty" }, 400);
  const id = Number(c.req.param("id"));
  const me = c.get("user");
  await run(c.env.DB, "INSERT INTO task_comments (task_id, user_id, body) VALUES (?,?,?)", id, me.id, str(body));
  const t = await one<any>(c.env.DB, "SELECT title, assigned_to, created_by FROM tasks WHERE id = ?", id);
  const audience = [t?.assigned_to, t?.created_by].filter((x): x is number => !!x && x !== me.id);
  if (t && audience.length) await notifyUsers(c.env, audience, { title: `New comment: ${t.title}`, body: `${me.name.replace(/\(.*\)/, "").trim()}: ${str(body).slice(0, 100)}`, link: `/tasks?open=${id}` });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- portal links + document requests
async function ensureLink(env: Env, customerId: number, userId: number | null) {
  const existing = await one<{ token: string }>(env.DB, "SELECT token FROM portal_links WHERE customer_id = ? AND active = 1 ORDER BY id DESC", customerId);
  if (existing) return existing.token;
  const token = randomToken(20);
  await run(env.DB, "INSERT INTO portal_links (token, customer_id, created_by) VALUES (?,?,?)", token, customerId, userId);
  return token;
}
const portalUrl = (c: any, token: string) => `${c.env.APP_URL || new URL(c.req.url).origin}/portal/${token}`;

api.post("/customers/:id/portal-link", async (c) => {
  const id = Number(c.req.param("id"));
  const { regenerate } = await c.req.json().catch(() => ({} as any));
  if (regenerate) {
    if (!has(c, "customers.delete")) return c.json({ error: "You cannot reset portal links" }, 403);
    await run(c.env.DB, "UPDATE portal_links SET active = 0 WHERE customer_id = ?", id);
  }
  return c.json({ url: portalUrl(c, await ensureLink(c.env, id, c.get("user").id)) });
});

api.post("/doc-requests", need("docs.request"), async (c) => {
  const user = c.get("user");
  const b = await c.req.json();
  const customerId = num(b.customer_id);
  const titles: string[] = (Array.isArray(b.titles) ? b.titles : []).map(str).filter(Boolean);
  if (!customerId || !titles.length) return c.json({ error: "Choose a customer and list at least one document" }, 400);
  const customer = await one<any>(c.env.DB, "SELECT * FROM customers WHERE id = ?", customerId);
  if (!customer) return c.json({ error: "Customer not found" }, 404);
  for (const title of titles) {
    await run(c.env.DB, "INSERT INTO doc_requests (customer_id, task_id, title, description, created_by) VALUES (?,?,?,?,?)", customerId, num(b.task_id), title, nul(b.description), user.id);
  }
  if (b.task_id) await run(c.env.DB, "UPDATE tasks SET status = 'WAITING_CLIENT' WHERE id = ? AND status IN ('OPEN','IN_PROGRESS')", num(b.task_id));
  const url = portalUrl(c, await ensureLink(c.env, customerId, user.id));
  await notifyCustomer(c.env, customerId, { title: "Documents needed", body: titles.join(", ") });
  let emailStatus: string | null = null;
  if (b.send_email && customer.email) {
    emailStatus = await sendMail(c.env, {
      to: customer.email, customerId, kind: "DOC_REQUEST",
      subject: "Documents needed - Tax Doctor",
      text: `Dear ${customer.name},\n\nPlease upload the following documents using your secure link (log in with your registered mobile number):\n\n${titles.map((t) => `  - ${t}`).join("\n")}\n\n${url}\n\nRegards,\nTax Doctor`,
    });
  }
  await logActivity(c.env.DB, user, "docs.request", "customer", customerId, titles.join(", "));
  return c.json({ url, emailStatus, created: titles.length });
});
api.post("/doc-requests/:id/cancel", need("docs.request"), async (c) => {
  const id = Number(c.req.param("id"));
  const r = await one<any>(c.env.DB, "SELECT id, task_id, title, customer_id FROM doc_requests WHERE id = ?", id);
  if (!r) return c.json({ error: "Not found" }, 404);
  await run(c.env.DB, "UPDATE doc_requests SET status = 'CANCELLED' WHERE id = ?", id);
  // nothing left to wait for on that ticket -> it is back with us
  if (r.task_id) {
    const left = await one<{ n: number }>(c.env.DB, "SELECT COUNT(*) n FROM doc_requests WHERE task_id = ? AND status IN ('REQUESTED','SUBMITTED')", r.task_id);
    if (!left!.n) await run(c.env.DB, "UPDATE tasks SET status = 'IN_PROGRESS' WHERE id = ? AND status = 'WAITING_CLIENT'", r.task_id);
  }
  await logActivity(c.env.DB, c.get("user"), "docs.request.cancel", "customer", r.customer_id, r.title);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- documents + review inbox
api.get("/inbox", need("docs.review"), async (c) => {
  const pending = await all(
    c.env.DB,
    `SELECT d.id, d.name, d.original_name, d.size, d.mime, d.note, d.uploaded_at, d.request_id, r.title AS request_title, c.id AS customer_id, c.name AS customer_name, c.phone
       FROM documents d JOIN customers c ON c.id = d.customer_id LEFT JOIN doc_requests r ON r.id = d.request_id
      WHERE d.status = 'PENDING' AND d.source = 'CUSTOMER' ORDER BY d.uploaded_at`
  );
  const messages = await all(c.env.DB, `SELECT m.*, c.name AS customer_name, c.phone FROM portal_messages m JOIN customers c ON c.id = m.customer_id WHERE m.status = 'NEW' ORDER BY m.id`);
  return c.json({ pending, messages });
});
api.post("/messages/:id/done", need("docs.review"), async (c) => {
  await run(c.env.DB, "UPDATE portal_messages SET status = 'DONE' WHERE id = ?", Number(c.req.param("id")));
  return c.json({ ok: true });
});

api.get("/documents/:id/file", async (c) => {
  const d = await one<any>(c.env.DB, "SELECT * FROM documents WHERE id = ?", Number(c.req.param("id")));
  if (!d?.r2_key) return c.json({ error: "File not available" }, 404);
  const obj = await c.env.FILES.get(d.r2_key);
  if (!obj) return c.json({ error: "File missing from storage" }, 404);
  return new Response(obj.body, {
    headers: {
      "Content-Type": d.mime || "application/octet-stream",
      "Content-Disposition": `${c.req.query("inline") ? "inline" : "attachment"}; filename="${encodeURIComponent(d.name)}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
});

api.post("/documents/:id/accept", need("docs.review"), async (c) => {
  const id = Number(c.req.param("id"));
  const user = c.get("user");
  const d = await one<any>(c.env.DB, "SELECT * FROM documents WHERE id = ?", id);
  if (!d || d.status !== "PENDING") return c.json({ error: "Document is not awaiting review" }, 400);
  await run(c.env.DB, "UPDATE documents SET status = 'ACCEPTED', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?", user.id, id);
  if (d.request_id) {
    await run(c.env.DB, "UPDATE doc_requests SET status = 'ACCEPTED', last_reject_reason = NULL WHERE id = ?", d.request_id);
    const req = await one<any>(c.env.DB, "SELECT task_id FROM doc_requests WHERE id = ?", d.request_id);
    if (req?.task_id) {
      const left = await one<{ n: number }>(c.env.DB, "SELECT COUNT(*) n FROM doc_requests WHERE task_id = ? AND status IN ('REQUESTED','SUBMITTED')", req.task_id);
      if (!left!.n) {
        await run(c.env.DB, "UPDATE tasks SET status = 'IN_PROGRESS' WHERE id = ? AND status = 'WAITING_CLIENT'", req.task_id);
        await run(c.env.DB, "INSERT INTO task_comments (task_id, user_id, body) VALUES (?,?,?)", req.task_id, user.id, "All requested documents received and accepted.");
      }
    }
  }
  await notifyCustomer(c.env, d.customer_id, { title: "Document accepted", body: d.name });
  await logActivity(c.env.DB, user, "doc.accept", "document", id, d.name);
  return c.json({ ok: true });
});

api.post("/documents/:id/reject", need("docs.review"), async (c) => {
  const id = Number(c.req.param("id"));
  const user = c.get("user");
  const { reason } = await c.req.json().catch(() => ({} as any));
  const d = await one<any>(c.env.DB, "SELECT * FROM documents WHERE id = ?", id);
  if (!d || d.status !== "PENDING") return c.json({ error: "Document is not awaiting review" }, 400);
  await run(c.env.DB, "UPDATE documents SET status = 'REJECTED', reject_reason = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?", nul(reason), user.id, id);
  if (d.r2_key) await c.env.FILES.delete(d.r2_key); // rejected files are not kept
  await run(c.env.DB, "UPDATE documents SET r2_key = NULL WHERE id = ?", id);
  if (d.request_id) await run(c.env.DB, "UPDATE doc_requests SET status = 'REQUESTED', last_reject_reason = ? WHERE id = ?", nul(reason) ?? "Rejected", d.request_id);
  await notifyCustomer(c.env, d.customer_id, { title: "Document not accepted", body: `${d.name}${reason ? ": " + reason : ""}` });
  await logActivity(c.env.DB, user, "doc.reject", "document", id, `${d.name}: ${reason ?? ""}`);
  return c.json({ ok: true });
});

api.patch("/documents/:id", need("customers.edit"), async (c) => {
  const id = Number(c.req.param("id"));
  const d = await one<any>(c.env.DB, "SELECT id, customer_id, name FROM documents WHERE id = ?", id);
  if (!d) return c.json({ error: "Not found" }, 404);
  const { name } = await c.req.json();
  const wanted = cleanName(str(name));
  if (!wanted) return c.json({ error: "Type a name for the file" }, 400);
  const ext = extOf(d.name);
  const base = ext && wanted.toLowerCase().endsWith(ext) ? wanted.slice(0, -ext.length) : wanted; // the file type never changes
  const next = await uniqueName(c.env.DB, d.customer_id, base, ext, id);
  await run(c.env.DB, "UPDATE documents SET name = ? WHERE id = ?", next, id);
  await logActivity(c.env.DB, c.get("user"), "doc.rename", "document", id, `${d.name} -> ${next}`);
  return c.json({ ok: true, name: next });
});

api.delete("/documents/:id", need("docs.delete"), async (c) => {
  const d = await one<any>(c.env.DB, "SELECT * FROM documents WHERE id = ?", Number(c.req.param("id")));
  if (d?.r2_key) await c.env.FILES.delete(d.r2_key);
  await run(c.env.DB, "DELETE FROM documents WHERE id = ?", Number(c.req.param("id")));
  await logActivity(c.env.DB, c.get("user"), "doc.delete", "document", d?.id, d?.name);
  return c.json({ ok: true });
});

const extOf = (n: string) => { const m = /\.([A-Za-z0-9]{1,6})$/.exec(n); return m ? "." + m[1].toLowerCase() : ""; };
const cleanName = (n: string) => n.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 110);
/** "Sharma Traders PAN card.pdf"; adds (2), (3)... when the customer already has a file with that name */
async function uniqueName(db: D1Database, customerId: number, base: string, ext: string, excludeId = 0) {
  const root = cleanName(base) || "Document";
  let name = root + ext;
  for (let i = 2; i < 50; i++) {
    const hit = await one(db, "SELECT id FROM documents WHERE customer_id = ? AND lower(name) = lower(?) AND status != 'REJECTED' AND id != ?", customerId, name, excludeId);
    if (!hit) break;
    name = `${root} (${i})${ext}`;
  }
  return name;
}

async function storeUpload(env: Env, customerId: number, file: File) {
  const err = checkUpload(file);
  if (err) return { error: err } as const;
  const buf = await file.arrayBuffer();
  const sha = hex(await crypto.subtle.digest("SHA-256", buf));
  const dup = await one<any>(env.DB, "SELECT id, name, status FROM documents WHERE customer_id = ? AND sha256 = ? AND status IN ('PENDING','ACCEPTED')", customerId, sha);
  if (dup) return { error: `This exact file was already uploaded (${dup.name}, ${dup.status.toLowerCase()})` } as const;
  const key = `customers/${customerId}/${Date.now()}-${randomToken(4)}-${safeName(file.name)}`;
  await env.FILES.put(key, buf, { httpMetadata: { contentType: file.type || "application/octet-stream" } });
  return { key, sha, size: file.size, mime: file.type || "application/octet-stream" } as const;
}

api.post("/customers/:id/documents", need("customers.edit"), async (c) => {
  const customerId = Number(c.req.param("id"));
  const form = await c.req.formData();
  const file = form.get("file") as File | null;
  if (!file) return c.json({ error: "No file" }, 400);
  const s = await storeUpload(c.env, customerId, file);
  if ("error" in s) return c.json({ error: s.error }, 400);
  const user = c.get("user");
  const ext = extOf(file.name);
  const wanted = cleanName(str(form.get("name")));
  const display = wanted ? await uniqueName(c.env.DB, customerId, wanted.toLowerCase().endsWith(ext) && ext ? wanted.slice(0, -ext.length) : wanted, ext) : await uniqueName(c.env.DB, customerId, safeName(file.name).replace(/\.[A-Za-z0-9]{1,6}$/, ""), ext);
  const r = await run(c.env.DB, `INSERT INTO documents (customer_id, name, original_name, r2_key, size, mime, sha256, source, status, note, reviewed_by, reviewed_at) VALUES (?,?,?,?,?,?,?, 'STAFF','ACCEPTED',?,?, datetime('now'))`, customerId, display, safeName(file.name), s.key, s.size, s.mime, s.sha, nul(form.get("note")), user.id);
  await logActivity(c.env.DB, user, "doc.upload", "customer", customerId, file.name);
  return c.json({ id: r.meta.last_row_id });
});

// ---------------------------------------------------------------- customer portal (phone number = login)
const portalAuth = async (c: any, next: any) => {
  const p = await verifyToken<{ t: string; cid: number; tok: string }>(getCookie(c, PORTAL_COOKIE), c.env.SESSION_SECRET);
  if (!p || p.t !== "portal") return c.json({ error: "Please sign in again" }, 401);
  const link = await one<any>(c.env.DB, "SELECT l.active, c.active AS cactive FROM portal_links l JOIN customers c ON c.id = l.customer_id WHERE l.token = ? AND l.customer_id = ?", p.tok, p.cid);
  if (!link?.active || !link.cactive) return c.json({ error: "This link is no longer active" }, 401);
  c.set("customerId", p.cid);
  await next();
};

api.get("/portal/info/:token", async (c) => {
  const l = await one<any>(c.env.DB, "SELECT l.active, c.name FROM portal_links l JOIN customers c ON c.id = l.customer_id WHERE l.token = ? AND c.active = 1", c.req.param("token"));
  if (!l || !l.active) return c.json({ error: "This link is invalid or has expired. Please ask your Tax Doctor contact for a new one." }, 404);
  return c.json({ ok: true });
});

api.post("/portal/login", async (c) => {
  const { token, phone } = await c.req.json().catch(() => ({} as any));
  const l = await one<any>(c.env.DB, "SELECT l.*, c.phone, c.name FROM portal_links l JOIN customers c ON c.id = l.customer_id WHERE l.token = ? AND l.active = 1 AND c.active = 1", str(token));
  if (!l) return c.json({ error: "This link is invalid or has expired." }, 404);
  if (l.locked_until && l.locked_until > new Date().toISOString()) return c.json({ error: "Too many wrong attempts. Please try again after 15 minutes." }, 429);
  if (!samePhone(str(phone), l.phone)) {
    const fails = l.failed_attempts + 1;
    await run(c.env.DB, "UPDATE portal_links SET failed_attempts = ?, locked_until = ? WHERE id = ?", fails >= 5 ? 0 : fails, fails >= 5 ? new Date(Date.now() + 15 * 60000).toISOString() : null, l.id);
    return c.json({ error: "This mobile number is not registered with us." }, 401);
  }
  await run(c.env.DB, "UPDATE portal_links SET failed_attempts = 0, locked_until = NULL, last_used_at = datetime('now') WHERE id = ?", l.id);
  const jwt = await signToken({ t: "portal", cid: l.customer_id, tok: l.token }, c.env.SESSION_SECRET, 4 * 3600);
  setCookie(c, PORTAL_COOKIE, jwt, { httpOnly: true, sameSite: "Strict", secure: isSecure(c.req.url), path: "/", maxAge: 4 * 3600 });
  return c.json({ ok: true });
});
api.post("/portal/logout", (c) => {
  deleteCookie(c, PORTAL_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

api.get("/portal/me", portalAuth, async (c) => {
  const cid = c.get("customerId");
  const customer = await one<any>(c.env.DB, "SELECT name FROM customers WHERE id = ?", cid);
  const requests = await all(c.env.DB, "SELECT id, title, description, status, last_reject_reason, created_at FROM doc_requests WHERE customer_id = ? AND status IN ('REQUESTED','SUBMITTED') ORDER BY id", cid);
  const submissions = await all(c.env.DB, "SELECT id, name, status, reject_reason, uploaded_at, request_id FROM documents WHERE customer_id = ? AND source = 'CUSTOMER' ORDER BY id DESC LIMIT 50", cid);
  const messages = await all(c.env.DB, "SELECT body, status, created_at FROM portal_messages WHERE customer_id = ? ORDER BY id DESC LIMIT 10", cid);
  return c.json({ customer: customer.name, requests, submissions, messages });
});

api.post("/portal/upload", portalAuth, async (c) => {
  const cid = c.get("customerId");
  const form = await c.req.formData();
  const file = form.get("file") as File | null;
  const requestId = num(form.get("request_id"));
  if (!file) return c.json({ error: "Please choose a file" }, 400);
  if (requestId) {
    const r = await one<any>(c.env.DB, "SELECT status, title FROM doc_requests WHERE id = ? AND customer_id = ?", requestId, cid);
    if (!r || r.status !== "REQUESTED") return c.json({ error: "This request is not open for upload" }, 400);
  }
  const pendingCount = await one<{ n: number }>(c.env.DB, "SELECT COUNT(*) n FROM documents WHERE customer_id = ? AND status = 'PENDING'", cid);
  if (pendingCount!.n >= 30) return c.json({ error: "Too many files awaiting review. Please wait for our team to review them." }, 429);
  const s = await storeUpload(c.env, cid, file);
  if ("error" in s) return c.json({ error: s.error }, 400);
  let display = safeName(file.name);
  if (requestId) {
    const rq = await one<any>(c.env.DB, "SELECT title FROM doc_requests WHERE id = ?", requestId);
    const cu = await one<any>(c.env.DB, "SELECT name FROM customers WHERE id = ?", cid);
    if (rq?.title && cu?.name) display = await uniqueName(c.env.DB, cid, `${cu.name} ${rq.title}`, extOf(file.name)); // jjiajfijia.pdf -> "Gexart Ventures GST Certificate.pdf"
  }
  await run(c.env.DB, `INSERT INTO documents (customer_id, request_id, name, original_name, r2_key, size, mime, sha256, source, status, note) VALUES (?,?,?,?,?,?,?,?, 'CUSTOMER','PENDING',?)`, cid, requestId, display, safeName(file.name), s.key, s.size, s.mime, s.sha, nul(form.get("note")));
  if (requestId) await run(c.env.DB, "UPDATE doc_requests SET status = 'SUBMITTED' WHERE id = ?", requestId);
  const who = await one<{ name: string }>(c.env.DB, "SELECT name FROM customers WHERE id = ?", cid);
  await notifyUsers(c.env, await usersWithPerm(c.env, "docs.review"), { title: `${who?.name ?? "A customer"} uploaded a document`, body: safeName(file.name), link: "/inbox" });
  return c.json({ ok: true });
});

api.post("/portal/message", portalAuth, async (c) => {
  const { body } = await c.req.json();
  if (!str(body) || str(body).length > 2000) return c.json({ error: "Please write a short message" }, 400);
  await run(c.env.DB, "INSERT INTO portal_messages (customer_id, body) VALUES (?,?)", c.get("customerId"), str(body));
  const who = await one<{ name: string }>(c.env.DB, "SELECT name FROM customers WHERE id = ?", c.get("customerId"));
  await notifyUsers(c.env, await usersWithPerm(c.env, "docs.review"), { title: `Message from ${who?.name ?? "a customer"}`, body: str(body).slice(0, 120), link: "/inbox" });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- dashboard, emails, activity
api.get("/dashboard", async (c) => {
  const user = c.get("user");
  const today = todayIST();
  const scope = !has(c, "tasks.view_all") ? `AND (t.assigned_to = ${user.id} OR t.assigned_to IS NULL)` : "";
  const n = async (sql: string, ...p: unknown[]) => (await one<{ n: number }>(c.env.DB, sql, ...p))!.n;
  const [customers, open, overdue, dueWeek, renewals, pendingDocs, messages, mine] = await Promise.all([
    n("SELECT COUNT(*) n FROM customers WHERE active = 1"),
    n(`SELECT COUNT(*) n FROM tasks t WHERE t.status != 'DONE' ${scope}`),
    n(`SELECT COUNT(*) n FROM tasks t WHERE t.status NOT IN ('DONE','ON_HOLD') AND t.due_date < ? ${scope}`, today),
    n(`SELECT COUNT(*) n FROM tasks t WHERE t.status NOT IN ('DONE','ON_HOLD') AND t.due_date BETWEEN ? AND ? ${scope}`, today, addDays(today, 7)),
    n(`SELECT COUNT(*) n FROM customer_services cs JOIN services s ON s.id = cs.service_id AND s.category = 'ANNUAL' JOIN customers c ON c.id = cs.customer_id AND c.active = 1 WHERE cs.status = 'ACTIVE' AND cs.next_due <= ?`, addDays(today, 15)),
    n("SELECT COUNT(*) n FROM documents WHERE status = 'PENDING' AND source = 'CUSTOMER'"),
    n("SELECT COUNT(*) n FROM portal_messages WHERE status = 'NEW'"),
    n("SELECT COUNT(*) n FROM tasks WHERE status != 'DONE' AND assigned_to = ?", user.id),
  ]);
  const byCategory = await all(c.env.DB, `SELECT category, status, COUNT(*) n FROM tasks t WHERE 1=1 ${scope} GROUP BY category, status`);
  const urgent = await all(c.env.DB, `${TASK_SELECT} WHERE t.status NOT IN ('DONE','ON_HOLD') AND t.due_date <= ? ${scope} ORDER BY t.due_date LIMIT 8`, addDays(today, 7));
  const renewalsList = await all(
    c.env.DB,
    `SELECT cs.id, cs.next_due, s.name AS service_name, c.id AS customer_id, c.name AS customer_name, c.phone
       FROM customer_services cs JOIN services s ON s.id = cs.service_id AND s.category = 'ANNUAL' JOIN customers c ON c.id = cs.customer_id AND c.active = 1
      WHERE cs.status = 'ACTIVE' AND cs.next_due <= ? ORDER BY cs.next_due LIMIT 8`,
    addDays(today, 15)
  );
  return c.json({ counts: { customers, open, overdue, dueWeek, renewals, pendingDocs, messages, mine }, byCategory, urgent, renewalsList, today });
});

api.get("/emails", need("reports.view"), async (c) => c.json(await all(c.env.DB, "SELECT e.*, c.name AS customer_name FROM email_log e LEFT JOIN customers c ON c.id = e.customer_id ORDER BY e.id DESC LIMIT 200")));
api.get("/activity", need("reports.view"), async (c) => c.json(await all(c.env.DB, "SELECT * FROM activity ORDER BY id DESC LIMIT 200")));

registerExtra(api, { PORTAL_COOKIE, STAFF_COOKIE });

api.notFound((c) => c.json({ error: "Not found" }, 404));
api.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Something went wrong on the server" }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_e: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(dailyJob(env));
  },
} satisfies ExportedHandler<Env>;
