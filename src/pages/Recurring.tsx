import { useState } from "react";
import { Link } from "react-router-dom";
import { api, STATUS_LABEL, todayStr } from "../api";
import { Avatar, Check, DueBadge, Empty, Loading, PageHead, StatusBadge, useApp, useLoad, useSelection } from "../ui";
import { TaskModal } from "../components/TaskModals";
import BulkAssign from "../components/BulkAssign";

function Tickets() {
  const { can, toast } = useApp();
  const [period, setPeriod] = useState(todayStr().slice(0, 7));
  const [svc, setSvc] = useState("");
  const [who, setWho] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [bulk, setBulk] = useState(false);
  const selection = useSelection();
  const { data, error, reload } = useLoad(() => api(`/recurring?period=${period}`), [period]);

  const generate = async () => {
    setBusy(true);
    try {
      const r = await api("/recurring/generate", { body: { period } });
      toast(r.created ? `${r.created} new tickets created` : "Everything for this month already exists");
      reload();
    } catch (e: any) { toast(e.message, true); }
    setBusy(false);
  };
  const quick = async (id: number, status: string) => {
    let hold_reason: string | undefined;
    if (status === "ON_HOLD") {
      hold_reason = (window.prompt("Reason for putting this on hold (required):") || "").trim();
      if (hold_reason.length < 3) return;
    }
    try { await api(`/tasks/${id}`, { method: "PATCH", body: { status, hold_reason } }); } catch (e: any) { toast(e.message, true); }
    reload();
  };

  const all: any[] = (data?.tasks || []).filter((t: any) => (!svc || t.service_name === svc) && (!who || (who === "none" ? !t.assigned_to : String(t.assigned_to) === who)));
  const groups: Record<string, any[]> = {};
  all.forEach((t) => (groups[t.service_name] ||= []).push(t));
  const names = [...new Set<string>((data?.tasks || []).map((t: any) => t.service_name))];
  const { users } = useApp();
  const canAssign = can("tasks.assign");
  const apply = async (p: any) => {
    const ids = all.filter((t) => selection.sel.has(t.id)).map((t) => t.id); // screen order
    const set: any = {};
    if ("assigned_to" in p) set.assigned_to = p.assigned_to;
    const r = await api("/tasks/bulk", { body: { ids, set, plan: p.plan, round_robin: p.round_robin } });
    toast(`${r.updated} ticket(s) updated`);
    selection.clear();
    reload();
  };

  return (
    <>
      <div className="filters">
        <input type="month" className="input" style={{ width: 160 }} value={period} onChange={(e) => e.target.value && (setPeriod(e.target.value), selection.clear())} />
        <select className="input" value={svc} onChange={(e) => setSvc(e.target.value)}>
          <option value="">All recurring services</option>
          {names.map((n) => <option key={n}>{n}</option>)}
        </select>
        <select className="input" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Anyone</option><option value="none">Unassigned</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        {data && <span className="muted">{data.tasks.filter((t: any) => t.status === "DONE").length} of {data.tasks.length} done</span>}
        {can("recurring.manage") && <button className="btn primary right" disabled={busy} onClick={generate}>Generate tickets for {period}</button>}
      </div>
      {selection.sel.size > 0 && canAssign && (
        <div className="bulkbar">
          <b>{selection.sel.size} selected</b>
          <button className="btn primary" onClick={() => setBulk(true)}>Assign these...</button>
          <button className="btn" onClick={selection.clear}>Clear</button>
        </div>
      )}
      {!data ? <div className="card"><Loading error={error} /></div> : Object.keys(groups).length === 0 ? (
        <div className="card"><Empty>No recurring tickets for {period} yet.{can("recurring.manage") ? " Click “Generate tickets” to create them from customer enrolments." : ""}</Empty></div>
      ) : (
        Object.entries(groups).map(([name, rows]) => {
          const allOn = rows.every((r) => selection.sel.has(r.id));
          return (
            <div className="card" key={name} style={{ marginBottom: 14 }}>
              <div className="card-h">
                <h2 className="grow">{name}</h2>
                <span className="badge">{rows.filter((r) => r.status === "DONE").length}/{rows.length} done</span>
                <span className="badge">{rows.filter((r) => !r.assigned_to).length} unassigned</span>
              </div>
              <div className="table-wrap"><table>
                <thead><tr>{canAssign && <th style={{ width: 36 }}><Check checked={allOn} onChange={() => { const on = !allOn; rows.forEach((r) => { if (on !== selection.sel.has(r.id)) selection.toggle(r.id); }); }} /></th>}<th>Customer</th><th>For period</th><th>Due</th><th>Assigned</th><th>Status</th><th></th></tr></thead>
                <tbody>{rows.map((t) => (
                  <tr key={t.id} className={"click" + (selection.sel.has(t.id) ? " sel" : "")} onClick={() => setOpen(t.id)}>
                    {canAssign && <td><Check checked={selection.sel.has(t.id)} onChange={() => selection.toggle(t.id)} /></td>}
                    <td><b>{t.customer_name}</b></td>
                    <td>{t.period_label}</td>
                    <td><DueBadge date={t.due_date} done={t.status === "DONE"} /></td>
                    <td>{t.assignee ? <span className="row" style={{ gap: 6 }}><Avatar name={t.assignee} small />{t.assignee.replace(/\(.*\)/, "")}</span> : <span className="muted">Unassigned</span>}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <select className="input" style={{ padding: "3px 6px", width: 160 }} value={t.status} onChange={(e) => quick(t.id, e.target.value)}>
                        {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </td>
                    <td><StatusBadge s={t.status} /></td>
                  </tr>
                ))}</tbody>
              </table></div>
            </div>
          );
        })
      )}
      {open && <TaskModal id={open} onClose={() => setOpen(null)} onChanged={reload} />}
      {bulk && <BulkAssign title={`Assign ${selection.sel.size} recurring ticket(s)`} count={selection.sel.size} onClose={() => setBulk(false)} onApply={apply} />}
    </>
  );
}

/** Who looks after which customer for each recurring service - change once and future months follow. */
function Assignments() {
  const { can, toast, services, users } = useApp();
  const [svc, setSvc] = useState("");
  const [who, setWho] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [bulk, setBulk] = useState(false);
  const [applyOpen, setApplyOpen] = useState(true);
  const selection = useSelection();
  const qs = new URLSearchParams({ category: "RECURRING", ...(svc && { service_id: svc }), ...(who && { assigned: who }), ...(status && { status }) }).toString();
  const { data, error, reload } = useLoad(() => api<any[]>("/enrolments?" + qs), [qs]);
  const canManage = can("recurring.manage");

  const rows = data || [];
  const allOn = rows.length > 0 && rows.every((r) => selection.sel.has(r.id));
  const send = async (body: any) => {
    const ids = rows.filter((r) => selection.sel.has(r.id)).map((r) => r.id);
    const r = await api("/enrolments/bulk", { body: { ids, ...body } });
    toast(`${r.updated} service row(s) updated`);
    selection.clear();
    reload();
  };
  const recSvcs = services.filter((s) => s.category === "RECURRING");

  return (
    <>
      <div className="alert warn" style={{ marginBottom: 12 }}>This list decides who gets the ticket every month. Tick rows, then assign or pause. “Pause” stops new monthly tickets for that customer; existing open tickets stay.</div>
      <div className="filters">
        <select className="input" value={svc} onChange={(e) => { setSvc(e.target.value); selection.clear(); }}>
          <option value="">All recurring services</option>{recSvcs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="input" value={who} onChange={(e) => { setWho(e.target.value); selection.clear(); }}>
          <option value="">Anyone</option><option value="none">Unassigned</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select className="input" value={status} onChange={(e) => { setStatus(e.target.value); selection.clear(); }}>
          <option value="ACTIVE">Active</option><option value="PAUSED">Paused</option><option value="ENDED">Ended</option><option value="">All</option>
        </select>
        <span className="muted right">{rows.length} rows</span>
      </div>
      {selection.sel.size > 0 && canManage && (
        <div className="bulkbar">
          <b>{selection.sel.size} selected</b>
          <button className="btn primary" onClick={() => setBulk(true)}>Assign...</button>
          <button className="btn" onClick={() => send({ status: "PAUSED" })}>Pause</button>
          <button className="btn" onClick={() => send({ status: "ACTIVE" })}>Resume</button>
          <button className="btn" onClick={() => window.confirm("End these services? No more tickets will be created.") && send({ status: "ENDED" })}>End</button>
          <button className="btn" onClick={() => { const d = window.prompt("Due day of month for these rows (0 = month end, blank = service default)"); if (d !== null) send({ due_day: d === "" ? null : Number(d) }); }}>Set due day</button>
          <button className="btn" onClick={selection.clear}>Clear</button>
        </div>
      )}
      <div className="card">
        {!data ? <Loading error={error} /> : rows.length === 0 ? <Empty>Nothing matches.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr>{canManage && <th style={{ width: 36 }}><Check checked={allOn} onChange={() => selection.setAll(rows.map((r) => r.id), !allOn)} /></th>}<th>Service</th><th>Customer</th><th>Due day</th><th>Handled by</th><th>Status</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className={selection.sel.has(r.id) ? "sel" : ""}>
                {canManage && <td><Check checked={selection.sel.has(r.id)} onChange={() => selection.toggle(r.id)} /></td>}
                <td><b>{r.service_name}</b></td>
                <td><Link className="link" to={`/customers/${r.customer_id}`}>{r.customer_name}</Link><div className="small muted">{r.phone}</div></td>
                <td>{r.due_day ?? <span className="muted">default ({r.default_due_day === 0 ? "month end" : r.default_due_day})</span>}</td>
                <td>{r.assignee ? <span className="row" style={{ gap: 6 }}><Avatar name={r.assignee} small />{r.assignee.replace(/\(.*\)/, "")}</span> : <span className="badge warn">Unassigned</span>}</td>
                <td><span className={"badge " + (r.status === "ACTIVE" ? "ok" : r.status === "PAUSED" ? "warn" : "")}>{r.status.charAt(0) + r.status.slice(1).toLowerCase()}</span></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
      {bulk && (
        <BulkAssign title={`Assign ${selection.sel.size} service row(s)`} count={selection.sel.size} onClose={() => setBulk(false)} onApply={(p) => send({ ...p, apply_open: applyOpen })} applyLabel="Assign">
          <label className="row" style={{ cursor: "pointer" }}><input type="checkbox" className="cb" checked={applyOpen} onChange={(e) => setApplyOpen(e.target.checked)} /> Also move this month's open tickets to the new person</label>
        </BulkAssign>
      )}
    </>
  );
}

export default function Recurring() {
  const [tab, setTab] = useState<"tickets" | "assign">("tickets");
  return (
    <>
      <PageHead title="Recurring services" sub="GSTR-1, GSTR-3B, TDS, PF, ESI, Advance Tax and P.Tax - one ticket per customer per period, created on the 1st of each month." />
      <div className="tabs">
        <button className={"tab" + (tab === "tickets" ? " active" : "")} onClick={() => setTab("tickets")}>Monthly tickets</button>
        <button className={"tab" + (tab === "assign" ? " active" : "")} onClick={() => setTab("assign")}>Assignments &amp; stop/pause</button>
      </div>
      {tab === "tickets" ? <Tickets /> : <Assignments />}
    </>
  );
}
