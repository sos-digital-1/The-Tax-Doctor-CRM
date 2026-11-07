import { useState } from "react";
import { api, fmtDate, fmtDateTime, fmtSize, STATUS_LABEL, todayStr } from "../api";
import { Field, Modal, Path, PrioBadge, StatusBadge, copy, useApp, useLoad, waLink, Loading } from "../ui";
import { Link } from "react-router-dom";
import HoldModal from "./Hold";

export function CustomerSelect({ value, onChange, allowNone }: { value: any; onChange: (v: string) => void; allowNone?: boolean }) {
  const { data } = useLoad(() => api<any[]>("/customers"), []);
  return (
    <select className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
      <option value="">{allowNone ? "- none (internal) -" : "Select customer..."}</option>
      {(data || []).map((c) => (
        <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>
      ))}
    </select>
  );
}

export function UserSelect({ value, onChange, disabled }: { value: any; onChange: (v: string) => void; disabled?: boolean }) {
  const { users } = useApp();
  return (
    <select className="input" value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">Unassigned</option>
      {users.filter((u) => u.active !== 0).map((u) => (
        <option key={u.id} value={u.id}>{u.name}</option>
      ))}
    </select>
  );
}

export function NewTaskModal({ onClose, onSaved, defaults }: { onClose: () => void; onSaved: () => void; defaults?: any }) {
  const { services, toast, user, isManager } = useApp();
  const [f, setF] = useState<any>({ title: "", customer_id: "", service_id: "", due_date: "", priority: "NORMAL", assigned_to: isManager ? "" : String(user.id), description: "", ...defaults });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const pickService = (id: string) => {
    const s = services.find((x) => String(x.id) === id);
    setF((p: any) => ({ ...p, service_id: id, title: p.title || (s && s.name) || "" }));
  };
  const save = async () => {
    setBusy(true);
    try {
      await api("/tasks", { body: f });
      toast("Ticket created");
      onSaved();
      onClose();
    } catch (e: any) {
      toast(e.message, true);
      setBusy(false);
    }
  };
  const oneTime = services.filter((s) => s.category === "ONE_TIME");
  const others = services.filter((s) => s.category !== "ONE_TIME");
  return (
    <Modal title="New ticket" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !f.title} onClick={save}>Create ticket</button></>}>
      <div className="form-grid">
        <Field label="Customer" full><CustomerSelect value={f.customer_id} onChange={(v) => set("customer_id", v)} allowNone /></Field>
        <Field label="Service type" full>
          <select className="input" value={f.service_id} onChange={(e) => pickService(e.target.value)}>
            <option value="">Custom work (not in the list)</option>
            <optgroup label="One-time services">{oneTime.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>
            <optgroup label="Annual / recurring">{others.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>
          </select>
        </Field>
        <Field label="Title" full><input className="input" value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="What needs to be done?" /></Field>
        <Field label="Due date"><input type="date" className="input" value={f.due_date} onChange={(e) => set("due_date", e.target.value)} /></Field>
        <Field label="Priority">
          <select className="input" value={f.priority} onChange={(e) => set("priority", e.target.value)}>
            {["LOW", "NORMAL", "HIGH", "URGENT"].map((p) => <option key={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Assign to" full><UserSelect value={f.assigned_to} onChange={(v) => set("assigned_to", v)} disabled={!isManager} /></Field>
        <Field label="Details" full><textarea className="input" value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

const COMMON_DOCS = ["PAN card", "Aadhaar card", "GST certificate", "Bank statement (6 months)", "Address proof", "Photograph", "Rent agreement / NOC", "Previous year ITR", "Sale / purchase invoices", "Trade licence copy"];

export function DocRequestModal({ customerId, taskId, onClose, onSaved }: { customerId?: number; taskId?: number; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [cid, setCid] = useState<string>(customerId ? String(customerId) : "");
  const [text, setText] = useState("");
  const [email, setEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ url: string; emailStatus: string | null } | null>(null);
  const [phone, setPhone] = useState("");

  const add = (t: string) => setText((p) => (p.split("\n").includes(t) ? p : (p ? p.replace(/\n*$/, "\n") : "") + t));
  const send = async () => {
    setBusy(true);
    try {
      const titles = text.split("\n").map((s) => s.trim()).filter(Boolean);
      const r = await api("/doc-requests", { body: { customer_id: Number(cid), task_id: taskId, titles, send_email: email } });
      const c = await api("/customers/" + cid);
      setPhone(c.customer.phone);
      setResult(r);
      onSaved();
    } catch (e: any) {
      toast(e.message, true);
    }
    setBusy(false);
  };

  if (result)
    return (
      <Modal title="Request sent" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
        <div className="stack">
          <div className="alert ok">Documents requested. The customer sees them in their portal after logging in with their registered mobile number.</div>
          {result.emailStatus === "LOGGED" && <div className="alert warn">Email was recorded in the log but not actually sent - no mail provider is configured yet.</div>}
          {result.emailStatus === "SENT" && <div className="alert ok">Email sent to the customer.</div>}
          <Field label="Portal link to share"><input className="input" readOnly value={result.url} onFocus={(e) => e.target.select()} /></Field>
          <div className="row wrap">
            <button className="btn" onClick={() => copy(result.url, toast)}>Copy link</button>
            <a className="btn" target="_blank" rel="noreferrer" href={waLink(phone, `Hello, please upload the requested documents here: ${result.url} (log in with your registered mobile number).`)}>Send on WhatsApp</a>
          </div>
        </div>
      </Modal>
    );

  return (
    <Modal title="Request documents" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !cid || !text.trim()} onClick={send}>Create request</button></>}>
      <div className="stack">
        {!customerId && <Field label="Customer"><CustomerSelect value={cid} onChange={setCid} /></Field>}
        <Field label="Documents needed (one per line)">
          <textarea className="input" style={{ minHeight: 120 }} value={text} onChange={(e) => setText(e.target.value)} placeholder={"PAN card\nBank statement (6 months)"} />
        </Field>
        <div className="row wrap">
          {COMMON_DOCS.map((d) => <button key={d} className="badge" style={{ cursor: "pointer" }} onClick={() => add(d)}>+ {d}</button>)}
        </div>
        <label className="row"><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> Also email the portal link to the customer</label>
      </div>
    </Modal>
  );
}

export function TaskModal({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { toast, user, isManager, can } = useApp();
  const { data, reload, error } = useLoad(() => api(`/tasks/${id}`), [id]);
  const [comment, setComment] = useState("");
  const [step, setStep] = useState("");
  const [showReq, setShowReq] = useState(false);
  const [hold, setHold] = useState<"" | "new" | "edit">("");

  if (!data) return <Modal title="Ticket" onClose={onClose}><Loading error={error} /></Modal>;
  const t = data.task;
  const patch = async (b: any) => {
    try {
      await api(`/tasks/${id}`, { method: "PATCH", body: b });
      reload();
      onChanged();
    } catch (e: any) {
      toast(e.message, true);
    }
  };
  const addComment = async () => {
    if (!comment.trim()) return;
    await api(`/tasks/${id}/comments`, { body: { body: comment } });
    setComment("");
    reload();
  };
  const remove = async () => {
    if (!window.confirm("Delete this ticket permanently?")) return;
    await api(`/tasks/${id}`, { method: "DELETE" });
    onChanged();
    onClose();
  };

  return (
    <Modal title={`TD-${String(t.id).padStart(4, "0")}`} onClose={onClose} wide>
      <div className="stack">
        <div>
          <h1 style={{ fontSize: 19 }}>{t.title}</h1>
          <div className="row wrap" style={{ marginTop: 6 }}>
            <StatusBadge s={t.status} /> <PrioBadge p={t.priority} />
            {t.customer_name && <Link className="link" to={`/customers/${t.customer_id}`} onClick={onClose}>{t.customer_name}</Link>}
            {t.period_label && <span className="badge">{t.period_label}</span>}
          </div>
        </div>
        {t.status === "ON_HOLD" && (
          <div className="alert warn" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div className="grow">
              <b>On hold</b> - {t.hold_reason || "no reason recorded"}
              <div className="small" style={{ opacity: 0.8 }}>{t.held_by_name ? `by ${t.held_by_name}` : ""}{t.held_at ? ` · ${fmtDateTime(String(t.held_at).replace("T", " ").replace(/\.\d+Z$/, ""))}` : ""}</div>
            </div>
            <button className="btn sm" onClick={() => setHold("edit")}>Edit reason</button>
            <button className="btn sm primary" onClick={() => patch({ status: "IN_PROGRESS" })}>Resume work</button>
          </div>
        )}
        <div className="row wrap">
          <div className="grow" style={{ minWidth: 0 }}>
            <Path steps={(Object.entries(STATUS_LABEL) as [string, string][]).filter(([k]) => k !== "ON_HOLD")} current={t.status} onPick={(k) => patch({ status: k })} />
          </div>
          {t.status !== "ON_HOLD" && t.status !== "DONE" && <button className="btn" onClick={() => setHold("new")}>Put on hold</button>}
        </div>
        <div className="form-grid">
          <Field label="Assigned to">
            <select className="input" value={t.assigned_to ?? ""} disabled={!isManager && !!t.assigned_to && t.assigned_to !== user.id} onChange={(e) => patch({ assigned_to: e.target.value || null })}>
              <option value="">Unassigned</option>
              <UserOptions restrictToSelf={!isManager} />
            </select>
          </Field>
          <Field label="Due date"><input type="date" className="input" value={t.due_date ?? ""} onChange={(e) => patch({ due_date: e.target.value })} /></Field>
          <Field label="Priority">
            <select className="input" value={t.priority} onChange={(e) => patch({ priority: e.target.value })}>
              {["LOW", "NORMAL", "HIGH", "URGENT"].map((p) => <option key={p}>{p}</option>)}
            </select>
          </Field>
        </div>
        {t.description && <div className="comment" style={{ whiteSpace: "pre-wrap" }}>{t.description}</div>}

        <div className="card">
          <div className="card-h"><h2 className="grow">Checklist</h2><span className="badge">{(data.checklist || []).filter((c: any) => c.done).length}/{(data.checklist || []).length}</span></div>
          <div className="card-b">
            {(data.checklist || []).map((c: any) => (
              <label key={c.id} className={"check" + (c.done ? " done" : "")}>
                <input type="checkbox" className="cb" checked={!!c.done} onChange={async (e) => { await api(`/checklist/${c.id}`, { method: "PATCH", body: { done: e.target.checked } }); reload(); }} />
                <span className="grow">{c.text}</span>
                <button className="x" style={{ fontSize: 16 }} title="Remove" onClick={async (e) => { e.preventDefault(); await api(`/checklist/${c.id}`, { method: "DELETE" }); reload(); }}>×</button>
              </label>
            ))}
            <div className="row" style={{ marginTop: 6 }}>
              <input className="input" placeholder="Add a step..." value={step} onChange={(e) => setStep(e.target.value)} onKeyDown={async (e) => { if (e.key === "Enter" && step.trim()) { await api(`/tasks/${id}/checklist`, { body: { text: step } }); setStep(""); reload(); } }} />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-h">
            <h2 className="grow">Documents from customer</h2>
            {t.customer_id && can("docs.request") && <button className="btn sm" onClick={() => setShowReq(true)}>Request documents</button>}
          </div>
          {data.requests.filter((r: any) => r.status !== "CANCELLED").length === 0 ? (
            <div className="empty">No documents requested for this ticket.</div>
          ) : (
            <div className="table-wrap"><table><tbody>
              {data.requests.filter((r: any) => r.status !== "CANCELLED").map((r: any) => {
                const doc = data.documents.filter((d: any) => d.request_id === r.id).slice(-1)[0];
                return (
                  <tr key={r.id}>
                    <td>{r.title}{r.last_reject_reason && r.status === "REQUESTED" && <div className="small" style={{ color: "var(--red)" }}>Rejected: {r.last_reject_reason}</div>}</td>
                    <td><span className={"badge " + ({ REQUESTED: "warn", SUBMITTED: "info", ACCEPTED: "ok" } as any)[r.status]}>{r.status === "SUBMITTED" ? "Awaiting your review" : r.status.charAt(0) + r.status.slice(1).toLowerCase()}</span></td>
                    <td className="right">{doc && <a className="link" href={`/api/documents/${doc.id}/file?inline=1`} target="_blank" rel="noreferrer">View {fmtSize(doc.size)}</a>}{can("docs.request") && r.status !== "ACCEPTED" && <button className="x" style={{ marginLeft: 10 }} title="Remove this request" aria-label={`Remove request for ${r.title}`} onClick={async () => { if (r.status === "SUBMITTED" && !window.confirm("This was already uploaded and is waiting for review. Remove the request anyway?")) return; await api(`/doc-requests/${r.id}/cancel`, { method: "POST" }); reload(); onChanged(); }}>×</button>}</td>
                  </tr>
                );
              })}
            </tbody></table></div>
          )}
        </div>

        <div>
          <h2 style={{ marginBottom: 8 }}>Activity &amp; comments</h2>
          <div className="stack" style={{ gap: 8 }}>
            {data.comments.map((c: any) => (
              <div key={c.id} className="comment">
                <div className="small muted"><b style={{ color: "var(--text)" }}>{c.author || "System"}</b> · {fmtDateTime(c.created_at)}</div>
                <div style={{ whiteSpace: "pre-wrap" }}>{c.body}</div>
              </div>
            ))}
            <div className="row">
              <input className="input" placeholder="Add a comment..." value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addComment()} />
              <button className="btn" onClick={addComment}>Post</button>
            </div>
          </div>
        </div>
        <div className="row small muted">
          <span>Created {fmtDate(t.created_at)} by {t.creator || "system"}</span>
          {can("tasks.delete") && <button className="link right danger" onClick={remove}>Delete ticket</button>}
        </div>
      </div>
      {hold && <HoldModal initial={hold === "edit" ? t.hold_reason || "" : ""} resume={hold === "edit"} onClose={() => setHold("")} onSubmit={(reason) => patch({ status: "ON_HOLD", hold_reason: reason })} />}
      {showReq && <DocRequestModal customerId={t.customer_id} taskId={t.id} onClose={() => setShowReq(false)} onSaved={() => { reload(); onChanged(); }} />}
    </Modal>
  );
}

function UserOptions({ restrictToSelf }: { restrictToSelf: boolean }) {
  const { users, user } = useApp();
  return <>{users.filter((u) => u.active !== 0 && (!restrictToSelf || u.id === user.id)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</>;
}

export { todayStr };
