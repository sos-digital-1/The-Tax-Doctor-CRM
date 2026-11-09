import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, CATEGORY_LABEL, compressImage, fmtDate, fmtDateTime, fmtSize } from "../api";
import { Avatar, DueBadge, Empty, Field, Icon, Loading, Modal, copy, money, useApp, useLoad, waLink } from "../ui";
import { InvoiceForm, InvoiceModal } from "./Billing";
import { CustomerForm } from "./Customers";
import { TaskTable } from "./Tasks";
import { DocRequestModal, NewTaskModal, TaskModal, UserSelect } from "../components/TaskModals";

function EnrolModal({ customerId, onClose, onSaved }: { customerId: number; onClose: () => void; onSaved: () => void }) {
  const { services, toast } = useApp();
  const list = services.filter((s) => s.category !== "ONE_TIME" && s.active);
  const [f, setF] = useState<any>({ service_id: "", next_due: "", due_day: "", assigned_to: "", fee: "", reg_no: "", notes: "" });
  const set = (k: string, v: string) => setF((p: any) => ({ ...p, [k]: v }));
  const svc = list.find((s) => String(s.id) === f.service_id);
  const save = async () => {
    try {
      await api(`/customers/${customerId}/services`, { body: f });
      toast("Service added");
      onSaved();
      onClose();
    } catch (e: any) {
      toast(e.message, true);
    }
  };
  return (
    <Modal title="Add recurring / annual service" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!f.service_id} onClick={save}>Add service</button></>}>
      <div className="form-grid">
        <Field label="Service" full>
          <select className="input" value={f.service_id} onChange={(e) => set("service_id", e.target.value)}>
            <option value="">Select...</option>
            <optgroup label="Recurring">{list.filter((s) => s.category === "RECURRING").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>
            <optgroup label="Annual">{list.filter((s) => s.category === "ANNUAL").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>
          </select>
        </Field>
        {svc?.category === "ANNUAL" && (
          <>
            <Field label="Next due / expiry date *"><input type="date" className="input" value={f.next_due} onChange={(e) => set("next_due", e.target.value)} /></Field>
            <Field label="Licence / registration no."><input className="input" value={f.reg_no} onChange={(e) => set("reg_no", e.target.value)} /></Field>
          </>
        )}
        {svc?.category === "RECURRING" && <Field label={`Due day of month (default ${svc.due_day || "month end"})`}><input type="number" min={0} max={31} className="input" value={f.due_day} onChange={(e) => set("due_day", e.target.value)} placeholder="Leave empty for default" /></Field>}
        <Field label="Fee (Rs)"><input type="number" className="input" value={f.fee} onChange={(e) => set("fee", e.target.value)} /></Field>
        <Field label="Handled by" full><UserSelect value={f.assigned_to} onChange={(v) => set("assigned_to", v)} /></Field>
        <Field label="Notes" full><input className="input" value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

const splitExt = (n: string) => { const m = /^(.*?)(\.[A-Za-z0-9]{1,6})$/.exec(n); return m ? [m[1], m[2]] : [n, ""]; };

/** Staff upload: pick a file, then give it a tidy name (default: "<Customer> <what it is>"). */
function UploadButton({ customerId, customerName, openTitles, onDone }: { customerId: number; customerName: string; openTitles: string[]; onDone: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const { toast } = useApp();
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const pick = async (f?: File) => {
    if (!f) return;
    const small = await compressImage(f);
    setFile(small);
    setLabel(customerName + " ");
  };
  const ext = file ? splitExt(file.name)[1] : "";
  const send = async (keepOriginal: boolean) => {
    if (!file) return;
    setBusy(true);
    const form = new FormData();
    form.append("file", file);
    if (!keepOriginal && label.trim()) form.append("name", label.trim() + ext);
    try {
      await api(`/customers/${customerId}/documents`, { form });
      toast("Document added");
      setFile(null);
      onDone();
    } catch (e: any) {
      toast(e.message, true);
    }
    setBusy(false);
    if (ref.current) ref.current.value = "";
  };
  return (
    <>
      <input ref={ref} type="file" hidden onChange={(e) => pick(e.target.files?.[0])} />
      <button className="btn sm" onClick={() => ref.current?.click()}>+ Upload file</button>
      {file && (
        <Modal title="Name this document" onClose={() => { setFile(null); if (ref.current) ref.current.value = ""; }} footer={<><button className="btn" disabled={busy} onClick={() => send(true)}>Keep original name</button><button className="btn primary" disabled={busy || !label.trim()} onClick={() => send(false)}>{busy ? "Uploading..." : "Upload"}</button></>}>
          <div className="stack">
            <div className="small muted">File chosen: <b>{file.name}</b></div>
            <div>
              <label className="f">Save as</label>
              <div className="row"><input className="input" autoFocus value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && label.trim() && send(false)} /><span className="muted mono">{ext}</span></div>
            </div>
            {openTitles.length > 0 && (
              <div>
                <div className="small muted" style={{ marginBottom: 6 }}>Quick pick from what you asked this customer for:</div>
                <div className="row wrap" style={{ gap: 6 }}>{openTitles.map((t) => <button key={t} className="badge" style={{ cursor: "pointer" }} onClick={() => setLabel(`${customerName} ${t}`)}>{t}</button>)}</div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

function RenameDocModal({ doc, onClose, onDone }: { doc: any; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const [base, ext] = splitExt(doc.name);
  const [name, setName] = useState(base);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api(`/documents/${doc.id}`, { method: "PATCH", body: { name: name.trim() + ext } });
      toast(`Renamed to ${r.name}`);
      onDone();
      onClose();
    } catch (e: any) {
      toast(e.message, true);
      setBusy(false);
    }
  };
  return (
    <Modal title="Rename document" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !name.trim()} onClick={save}>Save name</button></>}>
      <div className="stack">
        <div className="row"><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && save()} /><span className="muted mono">{ext}</span></div>
        {doc.original_name && doc.original_name !== doc.name && <div className="small muted">Originally uploaded as <b>{doc.original_name}</b></div>}
        <div className="small muted">The file type ({ext || "none"}) stays the same.</div>
      </div>
    </Modal>
  );
}

function BillingTab({ customerId }: { customerId: number }) {
  const { can } = useApp();
  const { data, reload } = useLoad(() => api<any[]>(`/invoices?customer_id=${customerId}`), [customerId]);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const owed = (data || []).filter((i) => i.status === "UNPAID" || i.status === "PARTIAL").reduce((a, i) => a + i.total - i.paid, 0);
  return (
    <div className="card">
      <div className="card-h"><h2 className="grow">Invoices</h2>{owed > 0 && <span className="badge red">Owes {money(owed)}</span>}{can("billing.manage") && <button className="btn sm primary" onClick={() => setAdding(true)}>+ Invoice</button>}</div>
      {!data ? <Loading /> : data.length === 0 ? <Empty>No invoices yet.</Empty> : (
        <div className="table-wrap"><table><tbody>
          {data.map((i) => <tr key={i.id} className="click" onClick={() => setOpen(i.id)}><td><b>{i.number}</b><div className="small muted">{fmtDate(i.issue_date)}</div></td><td className="mono" style={{ textAlign: "right" }}>{money(i.total)}</td><td className="mono" style={{ textAlign: "right" }}>{money(i.total - i.paid)} due</td><td><span className={"badge " + ({ UNPAID: "warn", PARTIAL: "info", PAID: "ok", CANCELLED: "" } as any)[i.status]}>{i.status.toLowerCase()}</span></td></tr>)}
        </tbody></table></div>
      )}
      {adding && <InvoiceForm onClose={() => setAdding(false)} onSaved={(id) => { reload(); setOpen(id); }} defaults={{ customer_id: String(customerId) }} />}
      {open && <InvoiceModal id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  );
}

function VaultTab({ customerId }: { customerId: number }) {
  const { can, toast } = useApp();
  const { data, reload } = useLoad(() => api<any[]>(`/customers/${customerId}/vault`), [customerId]);
  const [edit, setEdit] = useState<any>(null);
  const [shown, setShown] = useState<Record<number, string>>({});
  const reveal = async (id: number) => {
    const r = await api(`/vault/${id}/reveal`, { method: "POST", body: {} });
    setShown((s) => ({ ...s, [id]: r.secret }));
    setTimeout(() => setShown((s) => { const n = { ...s }; delete n[id]; return n; }), 20000);
  };
  const save = async () => {
    try {
      if (edit.id) await api(`/vault/${edit.id}`, { method: "PATCH", body: edit });
      else await api(`/customers/${customerId}/vault`, { body: edit });
      toast("Saved"); setEdit(null); reload();
    } catch (e: any) { toast(e.message, true); }
  };
  return (
    <div className="card">
      <div className="card-h"><h2 className="grow">Portal credentials</h2>{can("vault.manage") && <button className="btn sm primary" onClick={() => setEdit({ label: "", url: "", username: "", secret: "", notes: "" })}>+ Add</button>}</div>
      <div className="alert warn" style={{ margin: 12 }}>Passwords are stored encrypted. Each reveal is logged against your name and hides again after 20 seconds.</div>
      {!data ? <Loading /> : data.length === 0 ? <Empty>No credentials stored.</Empty> : (
        <div className="table-wrap"><table>
          <thead><tr><th>For</th><th>Username</th><th>Password</th><th></th></tr></thead>
          <tbody>{data.map((v) => (
            <tr key={v.id}>
              <td><b>{v.label}</b>{v.url && <div className="small"><a className="link" href={v.url} target="_blank" rel="noopener noreferrer">{v.url}</a></div>}{v.notes && <div className="small muted">{v.notes}</div>}</td>
              <td className="mono">{v.username || "-"}</td>
              <td className="mono">{v.has_secret ? (shown[v.id] !== undefined ? <b>{shown[v.id]}</b> : "••••••••") : "-"}</td>
              <td className="right">
                {v.has_secret && shown[v.id] === undefined && <button className="btn sm" onClick={() => reveal(v.id)}>Reveal</button>}
                {shown[v.id] !== undefined && <button className="btn sm" onClick={() => copy(shown[v.id], toast)}>Copy</button>}{" "}
                {can("vault.manage") && <><button className="btn sm" onClick={() => setEdit({ ...v, secret: "" })}>Edit</button> <button className="btn sm danger" onClick={async () => { if (window.confirm("Delete this entry?")) { await api(`/vault/${v.id}`, { method: "DELETE" }); reload(); } }}>Delete</button></>}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {edit && (
        <Modal title={edit.id ? "Edit credential" : "Add credential"} onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" disabled={!edit.label} onClick={save}>Save</button></>}>
          <div className="form-grid">
            <Field label="For (e.g. GST portal)" full><input className="input" value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })} /></Field>
            <Field label="Website" full><input className="input" value={edit.url ?? ""} onChange={(e) => setEdit({ ...edit, url: e.target.value })} /></Field>
            <Field label="Username"><input className="input" autoComplete="off" value={edit.username ?? ""} onChange={(e) => setEdit({ ...edit, username: e.target.value })} /></Field>
            <Field label={edit.id ? "New password (blank = keep)" : "Password"}><input className="input" type="password" autoComplete="new-password" value={edit.secret} onChange={(e) => setEdit({ ...edit, secret: e.target.value })} /></Field>
            <Field label="Notes" full><input className="input" value={edit.notes ?? ""} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default function CustomerDetail() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const { toast, can } = useApp();
  const { data, error, reload } = useLoad(() => api(`/customers/${id}`), [id]);
  useEffect(() => { if (data?.customer?.name) document.title = data.customer.name + " · Tax Doctor"; }, [data?.customer?.name]);
  const [tab, setTab] = useState("overview");
  const [edit, setEdit] = useState(false);
  const [enrol, setEnrol] = useState(false);
  const [newTask, setNewTask] = useState(false);
  const [openTask, setOpenTask] = useState<number | null>(null);
  const [req, setReq] = useState(false);
  const [renaming, setRenaming] = useState<any>(null);

  if (!data) return <Loading error={error} />;
  const { customer: c, services, tasks, documents, requests, link, emails } = data;

  const getLink = async (regenerate = false) => {
    if (regenerate && !window.confirm("The old link will stop working. Continue?")) return;
    const r = await api(`/customers/${id}/portal-link`, { body: { regenerate } });
    reload();
    return r.url as string;
  };
  const archive = async () => {
    if (!window.confirm(`Archive ${c.name}? They will be hidden from lists and their portal link stops working.`)) return;
    await api(`/customers/${id}`, { method: "DELETE" });
    nav("/customers");
  };
  const patchSvc = async (sid: number, body: any) => {
    await api(`/customer-services/${sid}`, { method: "PATCH", body });
    reload();
  };
  const url = link?.url as string | undefined;
  const cancelRequest = async (r: any) => {
    if (r.status === "SUBMITTED" && !window.confirm(`${r.title} was already uploaded and is waiting for your review. Remove the request anyway?`)) return;
    try {
      await api(`/doc-requests/${r.id}/cancel`, { method: "POST" });
      toast(`Removed: ${r.title}`);
      reload();
    } catch (e: any) { toast(e.message, true); }
  };

  return (
    <>
      <div className="card record">
        <div className="rec-icon">{c.name.trim()[0]?.toUpperCase()}</div>
        <div className="grow">
          <div className="crumb">Customer</div>
          <h1>{c.name}</h1>
          <div className="rec-fields">
            <div><span>Constitution</span><b>{c.type}</b></div>
            <div><span>Mobile</span><b>{c.phone}</b></div>
            <div><span>GSTIN</span><b className="mono">{c.gstin || "-"}</b></div>
            <div><span>PAN</span><b className="mono">{c.pan || "-"}</b></div>
            <div><span>Manager</span><b>{c.manager_name ? c.manager_name.replace(/\(.*\)/, "") : "-"}</b></div>
            <div><span>Relationship manager</span><b>{c.rm_name ? c.rm_name.replace(/\(.*\)/, "") : "-"}</b></div>
          </div>
        </div>
        <div className="row wrap">
          {can("customers.edit") && <button className="btn" onClick={() => setEdit(true)}>Edit</button>}
          {can("docs.request") && <button className="btn" onClick={() => setReq(true)}>Request documents</button>}
          {can("tasks.create") && <button className="btn primary" onClick={() => setNewTask(true)}>+ Ticket</button>}
        </div>
      </div>
      <div className="tabs">
        {[["overview", "Overview"], ["services", `Services (${services.length})`], ["tickets", `Tickets (${tasks.length})`], ["documents", `Documents (${documents.length})`], ["portal", "Portal & emails"], ...(can("billing.view") ? [["billing", "Billing"]] : []), ...(can("vault.view") ? [["vault", "Credentials"]] : [])].map(([k, l]) => (
          <button key={k} className={"tab" + (tab === k ? " active" : "")} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid g2">
          <div className="card card-b">
            <dl className="kv">
              <dt>Contact person</dt><dd>{c.contact_person || "-"}</dd>
              <dt>Mobile</dt><dd>{c.phone} <a className="link" href={`tel:${c.phone}`}>Call</a> · <a className="link" target="_blank" rel="noreferrer" href={waLink(c.phone, `Hello ${c.contact_person || c.name},`)}>WhatsApp</a></dd>
              <dt>Email</dt><dd>{c.email ? <a className="link" href={`mailto:${c.email}`}>{c.email}</a> : "-"}</dd>
              <dt>Address</dt><dd>{[c.address, c.city, c.state, c.pincode].filter(Boolean).join(", ") || "-"}</dd>
              <dt>PAN</dt><dd className="mono">{c.pan || "-"}</dd>
              <dt>GSTIN</dt><dd className="mono">{c.gstin || "-"}</dd>
              <dt>TAN</dt><dd className="mono">{c.tan || "-"}</dd>
              <dt>CIN / LLPIN</dt><dd className="mono">{c.cin || "-"}</dd>
              <dt>Notes</dt><dd style={{ whiteSpace: "pre-wrap" }}>{c.notes || "-"}</dd>
            </dl>
            {can("customers.delete") && <button className="btn sm danger" style={{ marginTop: 16 }} onClick={archive}>Archive customer</button>}
          </div>
          <div className="stack">
            {requests.length > 0 && (
              <div className="card">
                <div className="card-h"><h2>Waiting on customer</h2></div>
                <div className="table-wrap"><table><tbody>
                  {requests.map((r: any) => (
                    <tr key={r.id}>
                      <td>{r.title}</td>
                      <td><span className={"badge " + (r.status === "SUBMITTED" ? "info" : "warn")}>{r.status === "SUBMITTED" ? "Awaiting your review" : "Requested"}</span></td>
                      <td style={{ width: 44, textAlign: "right" }}>
                        {can("docs.request") && (
                          <button className="x" title="Remove this request" aria-label={`Remove request for ${r.title}`} onClick={() => cancelRequest(r)}>×</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody></table></div>
              </div>
            )}
            <div className="card">
              <div className="card-h"><h2>Upcoming</h2></div>
              {services.filter((s: any) => s.category === "ANNUAL" && s.next_due).length === 0 ? <Empty>No annual services enrolled.</Empty> : (
                <div className="table-wrap"><table><tbody>
                  {services.filter((s: any) => s.category === "ANNUAL" && s.next_due).map((s: any) => <tr key={s.id}><td>{s.service_name}</td><td><DueBadge date={s.next_due} /></td></tr>)}
                </tbody></table></div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "services" && (
        <div className="card">
          <div className="card-h"><h2 className="grow">Annual &amp; recurring services</h2>{(can("recurring.manage") || can("annual.manage")) && <button className="btn sm primary" onClick={() => setEnrol(true)}>+ Add service</button>}</div>
          {services.length === 0 ? <Empty>Not enrolled in any service yet. One-time jobs are created as tickets.</Empty> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Service</th><th>Type</th><th>Next due</th><th>Reg. no.</th><th>Fee</th><th>Handled by</th><th>Status</th></tr></thead>
              <tbody>{services.map((s: any) => (
                <tr key={s.id}>
                  <td><b>{s.service_name}</b></td>
                  <td><span className="badge">{CATEGORY_LABEL[s.category]} · {s.frequency.toLowerCase()}</span></td>
                  <td>{s.category === "ANNUAL" ? <DueBadge date={s.next_due} /> : s.due_day ? `Day ${s.due_day}` : "Default"}</td>
                  <td className="mono small">{s.reg_no || "-"}</td>
                  <td>{s.fee ? "Rs " + s.fee : "-"}</td>
                  <td>{s.assignee || "-"}</td>
                  <td>
                    <select className="input" style={{ padding: "3px 6px", width: 110 }} disabled={!can(s.category === "RECURRING" ? "recurring.manage" : "annual.manage")} value={s.status} onChange={(e) => patchSvc(s.id, { ...s, status: e.target.value })}>
                      <option value="ACTIVE">Active</option><option value="PAUSED">Paused</option><option value="ENDED">Ended</option>
                    </select>
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      )}

      {tab === "tickets" && <div className="card">{<TaskTable rows={tasks} onOpen={setOpenTask} showCustomer={false} />}</div>}

      {tab === "documents" && (
        <div className="card">
          <div className="card-h"><h2 className="grow">Accepted documents</h2><UploadButton customerId={id} customerName={c.name} openTitles={requests.map((r: any) => r.title)} onDone={reload} /></div>
          {documents.length === 0 ? <Empty>No documents yet. Customer uploads appear here once you accept them in the review inbox.</Empty> : (
            <div className="table-wrap"><table>
              <thead><tr><th>File</th><th>From</th><th>Added</th><th></th></tr></thead>
              <tbody>{documents.map((d: any) => (
                <tr key={d.id}>
                  <td><b>{d.name}</b> <span className="muted small">{fmtSize(d.size)}</span>{d.original_name && d.original_name !== d.name && <div className="small muted" title="Name as it was uploaded">was: {d.original_name}</div>}</td>
                  <td><span className="badge">{d.source === "CUSTOMER" ? "Customer" : "Our team"}</span></td>
                  <td>{fmtDate(d.uploaded_at)}</td>
                  <td className="right"><a className="link" target="_blank" rel="noreferrer" href={`/api/documents/${d.id}/file?inline=1`}>View</a> · {can("customers.edit") && <><button className="link" onClick={() => setRenaming(d)}>Rename</button> · </>}<a className="link" href={`/api/documents/${d.id}/file`}>Download</a>
                    {can("docs.delete") && <> · <button className="link" style={{ color: "var(--muted)" }} onClick={async () => { if (window.confirm("Delete this document permanently?")) { await api(`/documents/${d.id}`, { method: "DELETE" }); reload(); } }}>Delete</button></>}
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      )}

      {tab === "billing" && can("billing.view") && <BillingTab customerId={id} />}
      {tab === "vault" && can("vault.view") && <VaultTab customerId={id} />}

      {tab === "portal" && (
        <div className="grid g2">
          <div className="card card-b stack">
            <h2>Customer portal link</h2>
            <p className="muted" style={{ margin: 0 }}>The customer opens this link and signs in with their registered mobile number ({c.phone}). They can only upload what you request, plus extra files and messages that you review first.</p>
            {url ? (
              <>
                <input className="input" readOnly value={url} onFocus={(e) => e.target.select()} />
                <div className="row wrap">
                  <button className="btn" onClick={() => copy(url, toast)}>Copy link</button>
                  <a className="btn" target="_blank" rel="noreferrer" href={waLink(c.phone, `Hello ${c.contact_person || c.name}, please use this secure link to share your documents with Tax Doctor: ${url} (sign in with your registered mobile number).`)}>Send on WhatsApp</a>
                  {can("customers.delete") && <button className="btn danger" onClick={() => getLink(true)}>Reset link</button>}
                </div>
                <div className="small muted">{link.last_used_at ? `Last opened ${fmtDateTime(link.last_used_at)}` : "Never opened yet"}</div>
              </>
            ) : (
              <button className="btn primary" onClick={() => getLink()}>Create portal link</button>
            )}
          </div>
          <div className="card">
            <div className="card-h"><h2>Emails sent to this customer</h2></div>
            {emails.length === 0 ? <Empty>None yet.</Empty> : (
              <div className="table-wrap"><table><tbody>
                {emails.map((e: any) => <tr key={e.id}><td>{e.subject}<div className="small muted">{fmtDateTime(e.created_at)}</div></td><td><span className={"badge " + (e.status === "SENT" ? "ok" : e.status === "FAILED" ? "red" : "warn")}>{e.status === "LOGGED" ? "Logged only" : e.status}</span></td></tr>)}
              </tbody></table></div>
            )}
          </div>
        </div>
      )}

      {edit && <CustomerForm initial={c} onClose={() => setEdit(false)} onSaved={reload} />}
      {enrol && <EnrolModal customerId={id} onClose={() => setEnrol(false)} onSaved={reload} />}
      {newTask && <NewTaskModal onClose={() => setNewTask(false)} onSaved={reload} defaults={{ customer_id: String(id) }} />}
      {openTask && <TaskModal id={openTask} onClose={() => setOpenTask(null)} onChanged={reload} />}
      {renaming && <RenameDocModal doc={renaming} onClose={() => setRenaming(null)} onDone={reload} />}
      {req && <DocRequestModal customerId={id} onClose={() => setReq(false)} onSaved={reload} />}
    </>
  );
}
