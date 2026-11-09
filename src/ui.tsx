import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { User, STATUS_LABEL, daysUntil, fmtDate } from "./api";

export type Meta = {
  user: User;
  users: { id: number; name: string; role: string; active?: number }[];
  services: any[];
  toast: (msg: string, err?: boolean) => void;
  isManager: boolean; // can assign work to others
  isAdmin: boolean;
  can: (perm: string) => boolean;
  refreshBadges: () => void;
};
export const Ctx = createContext<Meta>(null as any);
export const useApp = () => useContext(Ctx);

// Stale-while-revalidate: going back to a page shows the last data instantly while fresh data loads behind it.
const CACHE = new Map<string, any>();
export const clearCache = () => CACHE.clear();
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const key = fn.toString() + "|" + JSON.stringify(deps);
  const [data, setData] = useState<T | null>(() => CACHE.get(key) ?? null);
  const [loading, setLoading] = useState(!CACHE.has(key));
  const [error, setError] = useState("");
  const seq = useRef(0);
  const load = useCallback(() => {
    const n = ++seq.current;
    if (CACHE.has(key)) { setData(CACHE.get(key)); setLoading(false); } else setLoading(true);
    fn()
      .then((d) => {
        if (n !== seq.current) return;
        if (CACHE.size > 80) CACHE.delete(CACHE.keys().next().value as string);
        CACHE.set(key, d);
        setData(d);
        setError("");
      })
      .catch((e) => n === seq.current && setError(e.message))
      .finally(() => n === seq.current && setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(load, [load]);
  const set = useCallback((v: any) => setData((cur) => { const next = typeof v === "function" ? v(cur) : v; if (next) CACHE.set(key, next); return next; }), [key]);
  return { data, loading, error, reload: load, setData: set as React.Dispatch<React.SetStateAction<T | null>> };
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={"modal" + (wide ? " wide" : "")} role="dialog" aria-label={title}>
        <div className="modal-h">
          <h2 className="grow">{title}</h2>
          <button className="x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, full }: { label: string; children: ReactNode; full?: boolean }) {
  return (
    <div className={full ? "full" : ""}>
      <label className="f">{label}</label>
      {children}
    </div>
  );
}

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="grow">
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children}
    </div>
  );
}

const STATUS_CLASS: Record<string, string> = { OPEN: "dark", IN_PROGRESS: "info", WAITING_CLIENT: "warn", REVIEW: "info", ON_HOLD: "red", DONE: "ok" };
export const StatusBadge = ({ s }: { s: string }) => <span className={"badge " + (STATUS_CLASS[s] || "")}>{STATUS_LABEL[s] || s}</span>;

const PRIO_CLASS: Record<string, string> = { URGENT: "red", HIGH: "warn", NORMAL: "", LOW: "" };
export const PrioBadge = ({ p }: { p: string }) => <span className={"badge " + (PRIO_CLASS[p] || "")}>{p.charAt(0) + p.slice(1).toLowerCase()}</span>;

export function DueBadge({ date, done }: { date?: string | null; done?: boolean }) {
  if (!date) return <span className="muted">-</span>;
  const d = daysUntil(date)!;
  let cls = "", note = "";
  if (!done) {
    if (d < 0) { cls = "red"; note = `${-d}d overdue`; }
    else if (d === 0) { cls = "red"; note = "today"; }
    else if (d <= 7) { cls = "warn"; note = `in ${d}d`; }
  }
  return (
    <span>
      {fmtDate(date)} {note && <span className={"badge " + cls}>{note}</span>}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Loading({ error }: { error?: string }) {
  return <div className="empty">{error ? <span style={{ color: "var(--red)" }}>{error}</span> : "Loading..."}</div>;
}

export function confirmAction(msg: string) {
  return window.confirm(msg);
}

export const waLink = (phone: string, text: string) => `https://wa.me/91${phone.replace(/\D/g, "").slice(-10)}?text=${encodeURIComponent(text)}`;

export function copy(text: string, toast: Meta["toast"]) {
  navigator.clipboard?.writeText(text).then(() => toast("Copied to clipboard"), () => toast("Copy failed - select and copy manually", true));
}

const ICONS: Record<string, string> = {
  dash: "M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  ticket: "M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2zM9 12h6M9 16h4",
  repeat: "M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3",
  cal: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
  bolt: "M13 2L3 14h9l-1 8 10-12h-9z",
  inbox: "M22 12h-6l-2 3h-4l-2-3H2M5.5 5.1L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  mail: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  log: "M22 12h-4l-3 9L9 3l-3 9H2",
  chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  bell: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  money: "M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM16 12h.01M3 10h18",
  chart: "M3 3v18h18M7 14l4-4 3 3 5-6",
  key: "M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3",
  plus: "M12 5v14M5 12h14",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  building: "M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9v.01M9 13v.01M9 17v.01",
  alert: "M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2",
  check: "M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4L12 14l-3-3",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8",
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  phone: "M17 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zM12 18h.01",
  monitor: "M20 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zM8 21h8M12 17v4",
  trend: "M22 7l-8.5 8.5-5-5L2 17M16 7h6v6",
  paperclip: "M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5",
  menu: "M3 6h18M3 12h18M3 18h18",
  panel: "M3 3h18v18H3zM9 3v18",
  send: "M22 2L11 13M22 2l-7 20-4-9-9-4z",
  layout: "M3 3h18v7H3zM3 14h8v7H3zM15 14h6v7h-6z",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
};
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name] || ICONS.dash} />
    </svg>
  );
}

export const initials = (n: string) => n.replace(/\(.*\)/, "").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
export const Avatar = ({ name, small, gray }: { name: string; small?: boolean; gray?: boolean }) => <span className={"avatar" + (small ? " sm" : "") + (gray ? " gray" : "")} title={name}>{initials(name)}</span>;

export function Footer() {
  return (
    <div className="footer" style={{ display: "flex", justifyContent: "center" }}>
      <Engineered />
    </div>
  );
}

export function Path({ steps, current, onPick }: { steps: [string, string][]; current: string; onPick: (k: string) => void }) {
  const idx = steps.findIndex(([k]) => k === current);
  return (
    <div className="path">
      {steps.map(([k, l], i) => (
        <button key={k} className={i < idx ? "done" : i === idx ? "current" : ""} onClick={() => onPick(k)}>{l}</button>
      ))}
    </div>
  );
}

export const money = (n: number | null | undefined) => "Rs " + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

/** shared row selection state for bulk actions */
export function useSelection() {
  const [sel, setSel] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const setAll = (ids: number[], on: boolean) => setSel(on ? new Set(ids) : new Set());
  return { sel, toggle, setAll, clear: () => setSel(new Set()), ids: [...sel] };
}

export function Check({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return <input type="checkbox" className="cb" checked={checked} onChange={onChange} onClick={(e) => e.stopPropagation()} />;
}

/** The Tax Doctor logo exactly as supplied. h = visible height in px. */
export function LogoTD({ h = 28, className = "" }: { h?: number; className?: string }) {
  return <span className={"logo-td " + className} role="img" aria-label="The Tax Doctor" style={{ height: h }} />;
}

export function Engineered({ dark }: { dark?: boolean }) {
  return (
    <div className={"engineered" + (dark ? " dark" : "")}>
      <span>Built by</span>
      <img src="/brand/smack-online-services.webp" alt="Smack Online Services OPC Pvt Ltd" />
    </div>
  );
}

export function StatCard({ icon, label, value, sub, tone, onClick }: { icon: string; label: string; value: React.ReactNode; sub?: string; tone?: "red" | "ok" | "warn" | "info"; onClick?: () => void }) {
  return (
    <div className={"scard" + (onClick ? " click" : "")} onClick={onClick}>
      <div className={"sicon" + (tone ? " " + tone : "")}><Icon name={icon} size={20} /></div>
      <div className="grow">
        <div className="sl">{label}</div>
        <div className="sn num">{value}</div>
        {sub && <div className="ss">{sub}</div>}
      </div>
    </div>
  );
}

export function Panel({ icon, title, sub, action, children }: { icon: string; title: string; sub?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card panel">
      <div className="panel-h">
        <div className="sicon sm"><Icon name={icon} size={16} /></div>
        <div className="grow"><h2>{title}</h2>{sub && <div className="muted small">{sub}</div>}</div>
        {action}
      </div>
      {children}
    </div>
  );
}


// ---------------------------------------------------------------- password field with show/hide + strength
export function passwordScore(p: string) {
  let n = 0;
  if (p.length >= 8) n++;
  if (p.length >= 12) n++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) n++;
  if (/\d/.test(p)) n++;
  if (/[^A-Za-z0-9]/.test(p)) n++;
  return Math.min(n, 4);
}
export const passwordOk = (p: string) => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);

export function PasswordInput({ value, onChange, label, placeholder, autoComplete, autoFocus, strength, onEnter, hint }: { value: string; onChange: (v: string) => void; label?: string; placeholder?: string; autoComplete?: string; autoFocus?: boolean; strength?: boolean; onEnter?: () => void; hint?: string }) {
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const sc = passwordScore(value);
  const names = ["Too weak", "Weak", "Fair", "Good", "Strong"];
  return (
    <div>
      {label && <label className="f">{label}</label>}
      <div className="pwfield">
        <input
          className="input"
          type={show ? "text" : "password"}
          value={value}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          placeholder={placeholder}
          spellCheck={false}
          autoCapitalize="none"
          onChange={(e) => onChange(e.target.value)}
          onKeyUp={(e) => setCaps(e.getModifierState && e.getModifierState("CapsLock"))}
          onKeyDown={(e) => e.key === "Enter" && onEnter && onEnter()}
        />
        <button type="button" className="pweye" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"} title={show ? "Hide password" : "Show password"}>
          {show ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M17.9 17.9A10.1 10.1 0 0 1 12 20c-7 0-10-8-10-8a18 18 0 0 1 5.1-5.9M9.9 4.2A9.1 9.1 0 0 1 12 4c7 0 10 8 10 8a18 18 0 0 1-2.2 3.2M1 1l22 22M14.1 14.1a3 3 0 1 1-4.2-4.2" /></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" /></svg>
          )}
        </button>
      </div>
      {caps && <div className="small" style={{ color: "var(--warn)", marginTop: 4 }}>Caps Lock is on</div>}
      {strength && value && (
        <div style={{ marginTop: 6 }}>
          <div className="pwbar"><i className={"s" + sc} style={{ width: (sc + 1) * 20 + "%" }} /></div>
          <div className="small muted">{names[sc]}{!passwordOk(value) && " - use 8+ characters with a letter and a number"}</div>
        </div>
      )}
      {hint && <div className="small muted" style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  );
}
