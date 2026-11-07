export type Env = {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;
  SESSION_SECRET: string;
  MAIL_API_KEY?: string; // Resend API key (optional). Without it, emails are only logged.
  MAIL_FROM?: string;
  APP_URL?: string;
  VAULT_KEY?: string;     // falls back to SESSION_SECRET
  VAPID_PUBLIC?: string;  // base64url, 65-byte uncompressed P-256 point
  VAPID_PRIVATE?: string; // base64url, 32-byte private scalar
  VAPID_SUBJECT?: string;
};

export type Role = "ADMIN" | "MANAGER" | "STAFF";
export type StaffUser = { id: number; name: string; email: string; role: Role };

const enc = new TextEncoder();

// ---------- encoding ----------
export const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const b64url = (buf: ArrayBuffer | Uint8Array) => b64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const fromB64url = (s: string) => fromB64(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
export const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

// ---------- passwords (PBKDF2-SHA256, 100k = Workers max) ----------
async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256);
}
export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `${b64(salt)}:${b64(await pbkdf2(password, salt))}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [s, h] = stored.split(":");
  if (!s || !h) return false;
  const got = new Uint8Array(await pbkdf2(password, fromB64(s)));
  const want = fromB64(h);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

// ---------- signed tokens ----------
async function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function signToken(payload: Record<string, unknown>, secret: string, ttlSeconds: number) {
  const body = b64url(enc.encode(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })));
  const sig = b64url(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body)));
  return `${body}.${sig}`;
}
export async function verifyToken<T = any>(token: string | undefined, secret: string): Promise<T | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64url(sig), enc.encode(body));
    if (!ok) return null;
  } catch {
    return null; // malformed token
  }
  try {
    const p = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    if (p.exp < Math.floor(Date.now() / 1000)) return null;
    return p as T;
  } catch {
    return null;
  }
}

export function randomToken(bytes = 24) {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)).buffer as ArrayBuffer);
}

// ---------- dates (India Standard Time) ----------
export function todayIST(offsetDays = 0) {
  const d = new Date(Date.now() + 5.5 * 3600 * 1000 + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}
export function addDays(date: string, days: number) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function addMonths(date: string, months: number) {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}
/** day 0 or > month length => last day of month */
export function clampDate(y: number, m: number, day: number) {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const d = day <= 0 || day > last ? last : day;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const digits = (s: string) => (s || "").replace(/\D/g, "");
export const samePhone = (a: string, b: string) => {
  const x = digits(a).slice(-10);
  const y = digits(b).slice(-10);
  return x.length === 10 && x === y;
};

// ---------- D1 helpers ----------
export async function all<T = any>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  const r = await db.prepare(sql).bind(...params).all<T>();
  return r.results ?? [];
}
export async function one<T = any>(db: D1Database, sql: string, ...params: unknown[]): Promise<T | null> {
  return (await db.prepare(sql).bind(...params).first<T>()) ?? null;
}
export async function run(db: D1Database, sql: string, ...params: unknown[]) {
  return db.prepare(sql).bind(...params).run();
}

export async function logActivity(db: D1Database, user: { id: number; name: string } | null, action: string, entity?: string, entityId?: number, detail?: string) {
  await run(db, "INSERT INTO activity (user_id, actor, action, entity, entity_id, detail) VALUES (?,?,?,?,?,?)", user?.id ?? null, user?.name ?? "system", action, entity ?? null, entityId ?? null, detail ?? null);
}

// ---------- email ----------
export async function sendMail(env: Env, m: { to: string; subject: string; text: string; customerId?: number; kind?: string }) {
  let status = "LOGGED";
  let error: string | null = null;
  if (env.MAIL_API_KEY) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.MAIL_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: env.MAIL_FROM, to: [m.to], subject: m.subject, text: m.text }),
      });
      if (res.ok) status = "SENT";
      else {
        status = "FAILED";
        error = (await res.text()).slice(0, 300);
      }
    } catch (e: any) {
      status = "FAILED";
      error = String(e?.message ?? e);
    }
  }
  await run(env.DB, "INSERT INTO email_log (customer_id, to_email, subject, body, kind, status, error) VALUES (?,?,?,?,?,?,?)", m.customerId ?? null, m.to, m.subject, m.text, m.kind ?? "GENERAL", status, error);
  return status;
}

// ---------- uploads ----------
export const MAX_UPLOAD = 10 * 1024 * 1024;
const ALLOWED_EXT = ["pdf", "jpg", "jpeg", "png", "webp", "doc", "docx", "xls", "xlsx", "csv", "txt", "zip"];
export function checkUpload(file: File): string | null {
  if (!file || typeof file === "string" || !file.size) return "No file received";
  if (file.size > MAX_UPLOAD) return "File is larger than 10 MB";
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXT.includes(ext)) return `File type .${ext} is not allowed (allowed: ${ALLOWED_EXT.join(", ")})`;
  return null;
}
export const safeName = (n: string) => n.replace(/[^\w.\- ]+/g, "_").slice(0, 120);


// ---------------------------------------------------------------- permissions
export const PERMS: { key: string; label: string; group: string }[] = [
  { key: "customers.view", label: "View customers", group: "Customers" },
  { key: "customers.edit", label: "Add / edit customers", group: "Customers" },
  { key: "customers.delete", label: "Archive customers", group: "Customers" },
  { key: "customers.import", label: "Import / export customer lists", group: "Customers" },
  { key: "tasks.view_all", label: "See every ticket (not only own + unassigned)", group: "Tickets" },
  { key: "tasks.create", label: "Create tickets", group: "Tickets" },
  { key: "tasks.assign", label: "Assign / bulk-assign tickets to others", group: "Tickets" },
  { key: "tasks.delete", label: "Delete tickets", group: "Tickets" },
  { key: "recurring.manage", label: "Manage recurring: generate, enrol, pause or stop services", group: "Services" },
  { key: "annual.manage", label: "Manage annual services: enrol, renew, send reminders", group: "Services" },
  { key: "catalogue.manage", label: "Edit service catalogue", group: "Services" },
  { key: "docs.request", label: "Request documents / create portal links", group: "Documents" },
  { key: "docs.review", label: "Accept or reject customer uploads", group: "Documents" },
  { key: "docs.delete", label: "Delete documents", group: "Documents" },
  { key: "billing.view", label: "View invoices & payments", group: "Billing" },
  { key: "billing.manage", label: "Create invoices & record payments", group: "Billing" },
  { key: "vault.view", label: "View customer credentials vault", group: "Vault" },
  { key: "vault.manage", label: "Add / edit vault entries", group: "Vault" },
  { key: "reports.view", label: "Reports, email log & activity log", group: "Admin" },
  { key: "chat.use", label: "Use internal chat", group: "Admin" },
  { key: "users.manage", label: "Manage users & permissions", group: "Admin" },
];
const ALL = PERMS.map((p) => p.key);
export const ROLE_DEFAULTS: Record<Role, string[]> = {
  ADMIN: ALL,
  MANAGER: ALL.filter((k) => k !== "users.manage"),
  STAFF: ["customers.view", "customers.edit", "tasks.create", "docs.request", "docs.review", "chat.use"],
};
export function effectivePerms(role: Role, raw?: string | null): string[] {
  if (role === "ADMIN") return ALL;
  let o: { grant?: string[]; deny?: string[] } = {};
  try { o = raw ? JSON.parse(raw) : {}; } catch {}
  const set = new Set([...ROLE_DEFAULTS[role], ...(o.grant ?? [])]);
  for (const d of o.deny ?? []) set.delete(d);
  return [...set].filter((k) => ALL.includes(k));
}

// ---------------------------------------------------------------- vault encryption (AES-GCM)
async function vaultKey(env: Env) {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode("td-vault:" + (env.VAULT_KEY || env.SESSION_SECRET)));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function encryptSecret(env: Env, plain: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await vaultKey(env), enc.encode(plain));
  return `${b64(iv)}:${b64(ct)}`;
}
export async function decryptSecret(env: Env, stored: string) {
  const [iv, ct] = stored.split(":");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, await vaultKey(env), fromB64(ct));
  return new TextDecoder().decode(pt);
}

// ---------------------------------------------------------------- notifications + web push (VAPID, payload-less)
async function vapidJwt(env: Env, audience: string) {
  const pub = fromB64url(env.VAPID_PUBLIC!);
  const jwk = { kty: "EC", crv: "P-256", d: env.VAPID_PRIVATE!, x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)), ext: true };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64url(enc.encode(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || "mailto:admin@example.com" })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}

async function pushTo(env: Env, subs: { id: number; endpoint: string }[]) {
  if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE) return;
  await Promise.allSettled(
    subs.map(async (s) => {
      try {
        const jwt = await vapidJwt(env, new URL(s.endpoint).origin);
        const res = await fetch(s.endpoint, { method: "POST", headers: { Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC}`, TTL: "86400", Urgency: "normal", "Content-Length": "0" } });
        if (res.status === 404 || res.status === 410) await run(env.DB, "DELETE FROM push_subscriptions WHERE id = ?", s.id);
      } catch {}
    })
  );
}

export async function notifyUsers(env: Env, userIds: number[], n: { title: string; body?: string; link?: string }) {
  const ids = [...new Set(userIds)].filter(Boolean);
  for (const uid of ids) await run(env.DB, "INSERT INTO notifications (user_id, title, body, link) VALUES (?,?,?,?)", uid, n.title, n.body ?? null, n.link ?? null);
  if (!ids.length) return;
  const subs = await all<{ id: number; endpoint: string }>(env.DB, `SELECT id, endpoint FROM push_subscriptions WHERE user_id IN (${ids.map(() => "?").join(",")})`, ...ids);
  await pushTo(env, subs);
}
export async function notifyCustomer(env: Env, customerId: number, n: { title: string; body?: string }) {
  await run(env.DB, "INSERT INTO notifications (customer_id, title, body) VALUES (?,?,?)", customerId, n.title, n.body ?? null);
  const subs = await all<{ id: number; endpoint: string }>(env.DB, "SELECT id, endpoint FROM push_subscriptions WHERE customer_id = ?", customerId);
  await pushTo(env, subs);
}
export const usersWithPerm = async (env: Env, perm: string) => {
  const rows = await all<{ id: number; role: Role; permissions: string | null }>(env.DB, "SELECT id, role, permissions FROM users WHERE active = 1");
  return rows.filter((u) => effectivePerms(u.role, u.permissions).includes(perm)).map((u) => u.id);
};
