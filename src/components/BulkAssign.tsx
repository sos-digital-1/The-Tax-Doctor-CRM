import { useMemo, useState } from "react";
import { Modal, Avatar, useApp } from "../ui";

export type AssignPayload = { assigned_to?: number | null; plan?: { user_id: number; count: number }[]; round_robin?: number[] };

/** One dialog for every "give these N items to people" job:
 *  - everything to one person, - split by exact counts (3 to Riya, 2 to Arjun), - share evenly. */
export default function BulkAssign({ title, count, onClose, onApply, children, applyLabel }: { title: string; count: number; onClose: () => void; onApply: (p: AssignPayload) => Promise<void> | void; children?: React.ReactNode; applyLabel?: string }) {
  const { users } = useApp();
  const staff = users.filter((u) => u.active !== 0);
  const [mode, setMode] = useState<"one" | "split" | "even" | "none">("one");
  const [one, setOne] = useState<string>("");
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [even, setEven] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const assigned = useMemo(() => Object.values(counts).reduce((a, b) => a + (b || 0), 0), [counts]);
  const remaining = count - assigned;

  const payload = (): AssignPayload | null => {
    if (mode === "none") return {};
    if (mode === "one") return one === "unassign" ? { assigned_to: null } : one ? { assigned_to: Number(one) } : null;
    if (mode === "split") {
      const plan = Object.entries(counts).filter(([, n]) => n > 0).map(([u, n]) => ({ user_id: Number(u), count: n }));
      return plan.length && remaining >= 0 ? { plan } : null;
    }
    return even.size ? { round_robin: [...even] } : null;
  };
  const p = payload();
  const apply = async () => {
    if (!p) return;
    setBusy(true);
    try { await onApply(p); onClose(); } finally { setBusy(false); }
  };
  const autoFill = () => {
    const per = Math.floor(count / Math.max(staff.length, 1));
    const rest = count - per * staff.length;
    const c: Record<number, number> = {};
    staff.forEach((u, i) => (c[u.id] = per + (i < rest ? 1 : 0)));
    setCounts(c);
  };

  return (
    <Modal title={title} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!p || busy} onClick={apply}>{applyLabel || `Apply to ${count}`}</button></>}>
      <div className="stack">
        <div className="seg" style={{ alignSelf: "flex-start" }}>
          <button className={mode === "one" ? "on" : ""} onClick={() => setMode("one")}>All to one person</button>
          <button className={mode === "split" ? "on" : ""} onClick={() => setMode("split")}>Split by number</button>
          <button className={mode === "even" ? "on" : ""} onClick={() => setMode("even")}>Share evenly</button>
          {children && <button className={mode === "none" ? "on" : ""} onClick={() => setMode("none")}>Keep assignee</button>}
        </div>

        {mode === "one" && (
          <select className="input" value={one} onChange={(e) => setOne(e.target.value)}>
            <option value="">Choose person...</option>
            {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            <option value="unassign">- Unassign (nobody) -</option>
          </select>
        )}

        {mode === "split" && (
          <div className="stack" style={{ gap: 8 }}>
            <div className="row">
              <span className="muted">{count} selected - hand out exact numbers, in the order they appear on screen.</span>
              <button className="btn sm right" onClick={autoFill}>Auto-balance</button>
            </div>
            {staff.map((u) => (
              <div key={u.id} className="row">
                <Avatar name={u.name} small /> <span className="grow">{u.name}</span>
                <input type="number" min={0} max={count} className="input" style={{ width: 80 }} value={counts[u.id] ?? ""} placeholder="0" onChange={(e) => setCounts({ ...counts, [u.id]: Math.max(0, Number(e.target.value)) })} />
              </div>
            ))}
            <div className={"badge " + (remaining < 0 ? "red" : remaining === 0 ? "ok" : "warn")} style={{ alignSelf: "flex-start" }}>
              {remaining < 0 ? `${-remaining} too many` : remaining === 0 ? "All assigned" : `${remaining} will stay as they are`}
            </div>
          </div>
        )}

        {mode === "even" && (
          <div className="stack" style={{ gap: 6 }}>
            <span className="muted">Tick the people who share the work - items are dealt out one by one.</span>
            {staff.map((u) => (
              <label key={u.id} className="row" style={{ cursor: "pointer" }}>
                <input type="checkbox" className="cb" checked={even.has(u.id)} onChange={() => setEven((s) => { const n = new Set(s); n.has(u.id) ? n.delete(u.id) : n.add(u.id); return n; })} />
                <Avatar name={u.name} small /> {u.name}
              </label>
            ))}
            {even.size > 0 && <span className="small muted">About {Math.ceil(count / even.size)} each.</span>}
          </div>
        )}
        {children}
      </div>
    </Modal>
  );
}
