import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, CATEGORY_LABEL, STATUS_LABEL } from "../api";
import { Avatar, Check, DueBadge, Empty, Loading, PageHead, PrioBadge, StatusBadge, useApp, useLoad, useSelection } from "../ui";
import { NewTaskModal, TaskModal } from "../components/TaskModals";
import BulkAssign from "../components/BulkAssign";
import HoldModal from "../components/Hold";

export function TaskTable({ rows, onOpen, showCustomer = true, selectable }: { rows: any[]; onOpen: (id: number) => void; showCustomer?: boolean; selectable?: ReturnType<typeof useSelection> }) {
  if (!rows.length) return <Empty>No tickets match.</Empty>;
  const allOn = selectable && rows.every((r) => selectable.sel.has(r.id));
  return (
    <div className="table-wrap"><table>
      <thead><tr>
        {selectable && <th style={{ width: 36 }}><Check checked={!!allOn} onChange={() => selectable.setAll(rows.map((r) => r.id), !allOn)} /></th>}
        <th>Ticket</th>{showCustomer && <th>Customer</th>}<th>Type</th><th>Status</th><th>Priority</th><th>Assigned</th><th>Due</th>
      </tr></thead>
      <tbody>
        {rows.map((t) => (
          <tr key={t.id} className={"click" + (selectable?.sel.has(t.id) ? " sel" : "")} onClick={() => onOpen(t.id)}>
            {selectable && <td><Check checked={selectable.sel.has(t.id)} onChange={() => selectable.toggle(t.id)} /></td>}
            <td><b>{t.title}</b><div className="small muted">TD-{String(t.id).padStart(4, "0")}{t.open_requests ? ` · ${t.open_requests} doc request(s) open` : ""}</div></td>
            {showCustomer && <td>{t.customer_name || <span className="muted">Internal</span>}</td>}
            <td><span className="badge">{CATEGORY_LABEL[t.category]}</span></td>
            <td><StatusBadge s={t.status} />{t.status === "ON_HOLD" && t.hold_reason && <div className="small muted" title={t.hold_reason} style={{ maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.hold_reason}</div>}</td>
            <td><PrioBadge p={t.priority} /></td>
            <td>{t.assignee ? <span className="row" style={{ gap: 6 }}><Avatar name={t.assignee} small /> {t.assignee.replace(/\(.*\)/, "")}</span> : <span className="muted">Unassigned</span>}</td>
            <td><DueBadge date={t.due_date} done={t.status === "DONE"} /></td>
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}

const COLS = ["OPEN", "IN_PROGRESS", "WAITING_CLIENT", "REVIEW", "ON_HOLD", "DONE"];

function Board({ rows, onOpen, onMove }: { rows: any[]; onOpen: (id: number) => void; onMove: (id: number, status: string) => void }) {
  const [over, setOver] = useState("");
  return (
    <div className="board">
      {COLS.map((s) => {
        const list = rows.filter((r) => r.status === s);
        return (
          <div key={s} className={"col" + (over === s ? " over" : "")} onDragOver={(e) => { e.preventDefault(); setOver(s); }} onDragLeave={() => setOver("")} onDrop={(e) => { setOver(""); const id = Number(e.dataTransfer.getData("id")); if (id) onMove(id, s); }}>
            <h3>{STATUS_LABEL[s]} <span className="badge">{list.length}</span></h3>
            {list.slice(0, 60).map((t) => (
              <div key={t.id} className="kcard" draggable onDragStart={(e) => e.dataTransfer.setData("id", String(t.id))} onClick={() => onOpen(t.id)}>
                <b>{t.title}</b>
                <div className="small muted" style={{ margin: "2px 0 6px" }}>{t.customer_name || "Internal"}</div>
                {t.status === "ON_HOLD" && t.hold_reason && <div className="small" style={{ color: "var(--red)", marginBottom: 6 }}>⏸ {t.hold_reason}</div>}
                <div className="row wrap" style={{ gap: 6 }}>
                  <PrioBadge p={t.priority} />
                  {t.due_date && <DueBadge date={t.due_date} done={t.status === "DONE"} />}
                  {t.assignee && <span className="right"><Avatar name={t.assignee} small /></span>}
                </div>
              </div>
            ))}
            {list.length > 60 && <div className="small muted">+{list.length - 60} more - use filters</div>}
          </div>
        );
      })}
    </div>
  );
}

export default function Tasks({ category }: { category?: string }) {
  const { users, can, toast, services } = useApp();
  const [sp, setSp] = useSearchParams();
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState<"list" | "board">(() => (localStorage.getItem("td-view") as any) || "list");
  const [bulk, setBulk] = useState(false);
  const selection = useSelection();
  const canAssign = can("tasks.assign");

  const f = { status: sp.get("status") || "", assigned: sp.get("assigned") || "", due: sp.get("due") || "", q: sp.get("q") || "", open: sp.get("open") === "1" ? "1" : "", service_id: sp.get("service_id") || "" };
  useEffect(() => {
    const o = Number(sp.get("open"));
    if (o > 1) { setOpen(o); const n = new URLSearchParams(sp); n.delete("open"); setSp(n, { replace: true }); }
    if (sp.get("new")) { setAdding(true); const n = new URLSearchParams(sp); n.delete("new"); setSp(n, { replace: true }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setFilter = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    v ? n.set(k, v) : n.delete(k);
    if (k === "status") n.delete("open");
    setSp(n, { replace: true });
    selection.clear();
  };
  const qs = new URLSearchParams({ ...(category ? { category } : {}), ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) }).toString();
  const { data, error, reload, setData } = useLoad(() => api<any[]>("/tasks?" + qs), [qs]);

  const [holdFor, setHoldFor] = useState<number | null>(null);
  const move = async (id: number, status: string, hold_reason?: string) => {
    if (status === "ON_HOLD" && !hold_reason) { setHoldFor(id); return; } // a reason is required
    setData((d) => d && d.map((t) => (t.id === id ? { ...t, status, hold_reason: hold_reason ?? null } : t))); // optimistic
    try { await api(`/tasks/${id}`, { method: "PATCH", body: { status, hold_reason } }); } catch (e: any) { toast(e.message, true); reload(); }
  };
  const applyBulk = async (p: any, extras: any) => {
    const set: any = { ...extras };
    if (set.status === "ON_HOLD" && String(set.hold_reason || "").trim().length < 3) { toast("Write the reason for putting these tickets on hold", true); throw new Error("reason"); }
    if ("assigned_to" in p) set.assigned_to = p.assigned_to;
    // keep the on-screen order, so "first 3 to Arjun" means the first 3 rows shown
    const ids = (data || []).filter((t) => selection.sel.has(t.id)).map((t) => t.id);
    const r = await api("/tasks/bulk", { body: { ids, set, plan: p.plan, round_robin: p.round_robin } });
    toast(`${r.updated} ticket(s) updated`);
    selection.clear();
    reload();
  };
  const [extras, setExtras] = useState<any>({});

  const title = category === "ONE_TIME" ? "One-time services" : "Tickets";
  return (
    <>
      <PageHead title={title} sub={category === "ONE_TIME" ? "Registrations, agreements, incorporations and other one-off jobs." : "Every job across recurring, annual, one-time and custom work."}>
        <div className="seg">
          <button className={view === "list" ? "on" : ""} onClick={() => { setView("list"); localStorage.setItem("td-view", "list"); }}>List</button>
          <button className={view === "board" ? "on" : ""} onClick={() => { setView("board"); localStorage.setItem("td-view", "board"); }}>Board</button>
        </div>
        {can("tasks.create") && <button className="btn primary" onClick={() => setAdding(true)}>+ New ticket</button>}
      </PageHead>
      <div className="filters">
        <input className="input" style={{ minWidth: 240 }} placeholder="Search ticket or customer..." value={f.q} onChange={(e) => setFilter("q", e.target.value)} />
        <select className="input" value={f.status || (f.open ? "OPEN_ALL" : "")} onChange={(e) => (e.target.value === "OPEN_ALL" ? (setFilter("status", ""), setFilter("open", "1")) : (setFilter("open", ""), setFilter("status", e.target.value)))}>
          <option value="">Any status</option>
          <option value="OPEN_ALL">All not done</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="input" value={f.assigned} onChange={(e) => setFilter("assigned", e.target.value)}>
          <option value="">Anyone</option>
          <option value="me">Assigned to me</option>
          <option value="none">Unassigned</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select className="input" value={f.due} onChange={(e) => setFilter("due", e.target.value)}>
          <option value="">Any due date</option>
          <option value="overdue">Overdue</option>
          <option value="week">Next 7 days</option>
        </select>
        {!category && (
          <select className="input" value={f.service_id} onChange={(e) => setFilter("service_id", e.target.value)}>
            <option value="">Any service</option>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>

      {selection.sel.size > 0 && canAssign && (
        <div className="bulkbar">
          <b>{selection.sel.size} selected</b>
          <button className="btn primary" onClick={() => { setExtras({}); setBulk(true); }}>Assign / update...</button>
          <button className="btn" onClick={selection.clear}>Clear</button>
        </div>
      )}

      {!data ? <div className="card"><Loading error={error} /></div> : view === "board" ? (
        data.length === 0 ? <div className="card"><Empty>No tickets match.</Empty></div> : <Board rows={data} onOpen={setOpen} onMove={move} />
      ) : (
        <div className="card"><TaskTable rows={data} onOpen={setOpen} selectable={canAssign ? selection : undefined} /></div>
      )}

      {holdFor && <HoldModal onClose={() => setHoldFor(null)} onSubmit={(reason) => move(holdFor, "ON_HOLD", reason)} />}
      {open && <TaskModal id={open} onClose={() => setOpen(null)} onChanged={reload} />}
      {adding && <NewTaskModal onClose={() => setAdding(false)} onSaved={reload} />}
      {bulk && (
        <BulkAssign title={`Assign ${selection.sel.size} ticket(s)`} count={selection.sel.size} onClose={() => setBulk(false)} onApply={(p) => applyBulk(p, extras)} applyLabel={`Apply to ${selection.sel.size}`}>
          <div className="form-grid">
            <div><label className="f">Also set status</label>
              <select className="input" value={extras.status || ""} onChange={(e) => setExtras({ ...extras, status: e.target.value || undefined })}>
                <option value="">Leave as is</option>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div><label className="f">Also set priority</label>
              <select className="input" value={extras.priority || ""} onChange={(e) => setExtras({ ...extras, priority: e.target.value || undefined })}>
                <option value="">Leave as is</option>{["LOW", "NORMAL", "HIGH", "URGENT"].map((p) => <option key={p}>{p}</option>)}
              </select></div>
            {extras.status === "ON_HOLD" && <div className="full"><label className="f">Reason for hold (required)</label><input className="input" value={extras.hold_reason || ""} onChange={(e) => setExtras({ ...extras, hold_reason: e.target.value })} placeholder="e.g. Waiting for documents from the customer" /></div>}
            <div className="full"><label className="f">Also set due date</label><input type="date" className="input" value={extras.due_date || ""} onChange={(e) => setExtras({ ...extras, due_date: e.target.value || undefined })} /></div>
          </div>
        </BulkAssign>
      )}
    </>
  );
}
