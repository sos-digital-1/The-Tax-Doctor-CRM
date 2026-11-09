import { useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Avatar, Check, Empty, Field, Loading, Modal, PageHead, useApp, useLoad, useSelection } from "../ui";
import { UserSelect } from "../components/TaskModals";
import BulkAssign from "../components/BulkAssign";

export const CUSTOMER_TYPES = ["Individual", "Proprietorship", "Partnership", "LLP", "Private Limited", "Public Limited", "Trust / Society", "HUF", "Other"];

export function CustomerForm({ initial, onClose, onSaved }: { initial?: any; onClose: () => void; onSaved: (id?: number) => void }) {
  const { toast, can } = useApp();
  const [f, setF] = useState<any>({ type: "Proprietorship", state: "West Bengal", city: "Kolkata", ...initial });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF((p: any) => ({ ...p, [k]: v }));
  const text = (k: string, label: string, full?: boolean, ph?: string) => (
    <Field label={label} full={full}><input className="input" value={f[k] ?? ""} placeholder={ph} onChange={(e) => set(k, e.target.value)} /></Field>
  );
  const save = async (force = false) => {
    setBusy(true);
    try {
      const r = initial?.id ? await api(`/customers/${initial.id}`, { method: "PATCH", body: f }) : await api("/customers", { body: { ...f, force } });
      toast("Customer saved");
      onSaved(r.id);
      onClose();
    } catch (e: any) {
      if (e.data?.duplicate && window.confirm(`${e.message}. Create anyway?`)) return save(true);
      toast(e.message, true);
      setBusy(false);
    }
  };
  return (
    <Modal title={initial?.id ? "Edit customer" : "New customer"} wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !f.name || !f.phone} onClick={() => save()}>Save customer</button></>}>
      <div className="form-grid">
        {text("name", "Business / customer name *", true)}
        <Field label="Constitution">
          <select className="input" value={f.type} onChange={(e) => set("type", e.target.value)}>{CUSTOMER_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
        </Field>
        {text("contact_person", "Contact person")}
        {text("phone", "Mobile * (used for portal login)", false, "10-digit number")}
        {text("email", "Email")}
        {text("address", "Business address", true)}
        {text("city", "City")}
        {text("pincode", "PIN code")}
        {text("pan", "PAN", false, "ABCDE1234F")}
        {text("gstin", "GSTIN")}
        {text("tan", "TAN")}
        {text("cin", "CIN / LLPIN")}
        <Field label="Manager (senior owner of this client)"><UserSelect value={f.manager_id} onChange={(v) => set("manager_id", v)} disabled={!can("customers.assign")} /></Field>
        <Field label="Relationship manager (day-to-day staff)"><UserSelect value={f.assigned_to} onChange={(v) => set("assigned_to", v)} disabled={!can("customers.assign")} /></Field>
        <Field label="Internal notes" full><textarea className="input" value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

// minimal CSV parser (quotes, commas, newlines)
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cur: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { cur.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; cur.push(cell); rows.push(cur); cur = []; cell = ""; }
    else cell += ch;
  }
  if (cell || cur.length) { cur.push(cell); rows.push(cur); }
  const head = (rows.shift() || []).map((h) => h.trim().toLowerCase().replace(/[^a-z]+/g, "_"));
  const alias: Record<string, string> = { business_name: "name", customer_name: "name", customer: "name", mobile: "phone", mobile_no: "phone", contact_no: "phone", phone_no: "phone", contact: "contact_person", email_id: "email", gst: "gstin", gst_no: "gstin", pin: "pincode", pin_code: "pincode", constitution: "type" };
  return rows.filter((r) => r.some((c) => c.trim())).map((r) => Object.fromEntries(head.map((h, i) => [alias[h] || h, (r[i] ?? "").trim()])));
}

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const [rows, setRows] = useState<any[]>([]);
  const [res, setRes] = useState<any>(null);
  const ref = useRef<HTMLInputElement>(null);
  const run = async () => {
    try { const r = await api("/customers/import", { body: { rows } }); setRes(r); onDone(); } catch (e: any) { toast(e.message, true); }
  };
  return (
    <Modal title="Import customers from CSV" onClose={onClose} footer={res ? <button className="btn primary" onClick={onClose}>Done</button> : <><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!rows.length} onClick={run}>Import {rows.length || ""}</button></>}>
      <div className="stack">
        {!res && (
          <>
            <p className="muted" style={{ margin: 0 }}>Columns recognised: <b>name, phone</b> (required), type, contact_person, email, address, city, pincode, pan, gstin, tan, cin, notes. Export from Excel as CSV. Existing phone numbers are skipped.</p>
            <input ref={ref} type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setRows(parseCsv(await f.text())); }} />
            {rows.length > 0 && <div className="alert ok">{rows.length} rows ready. First: {rows[0].name} · {rows[0].phone}</div>}
            <a className="link" href={"data:text/csv;charset=utf-8," + encodeURIComponent("name,phone,type,contact_person,email,address,city,pincode,pan,gstin\nSample Traders,9830000000,Proprietorship,A. Kumar,a@example.com,12 Park St,Kolkata,700016,ABCDE1234F,19ABCDE1234F1Z5\n")} download="customers-template.csv">Download template</a>
          </>
        )}
        {res && (
          <>
            <div className="alert ok">{res.created} customers imported.</div>
            {res.skipped.length > 0 && <div className="alert warn">{res.skipped.length} skipped: {res.skipped.slice(0, 8).map((s: any) => `row ${s.row} (${s.reason})`).join("; ")}</div>}
          </>
        )}
      </div>
    </Modal>
  );
}

export default function Customers() {
  const { can, toast } = useApp();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState("");
  const [mine, setMine] = useState(false);
  const [adding, setAdding] = useState(!!sp.get("new"));
  const [importing, setImporting] = useState(false);
  const [bulk, setBulk] = useState(false);
  const selection = useSelection();
  const nav = useNavigate();
  const { data, error, reload } = useLoad(() => api<any[]>("/customers?q=" + encodeURIComponent(q)), [q]);
  const { user } = useApp();
  const rows = (data || []).filter((c) => !mine || c.assigned_to === user.id || c.manager_id === user.id);
  const [bulkField, setBulkField] = useState<"assigned_to" | "manager_id">("assigned_to");
  const allOn = rows.length > 0 && rows.every((r) => selection.sel.has(r.id));

  const exportCsv = () => {
    const cols = ["name", "type", "contact_person", "phone", "email", "address", "city", "pincode", "pan", "gstin", "manager", "rm"];
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "customers.csv";
    a.click();
  };

  return (
    <>
      <PageHead title="Customers" sub="Everyone we serve - contacts, registrations, services and documents.">
        {can("customers.import") && <button className="btn" onClick={() => setImporting(true)}>Import CSV</button>}
        {can("customers.import") && <button className="btn" onClick={exportCsv}>Export</button>}
        {can("customers.edit") && <button className="btn primary" onClick={() => setAdding(true)}>+ New customer</button>}
      </PageHead>
      <div className="filters">
        <input className="input" style={{ minWidth: 320 }} placeholder="Search name, phone, email, PAN, GSTIN..." value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="row small" style={{ cursor: "pointer" }}><input type="checkbox" className="cb" checked={mine} onChange={(e) => setMine(e.target.checked)} /> My clients only</label>
        <span className="muted small right">{rows.length} customers</span>
      </div>
      {selection.sel.size > 0 && can("customers.assign") && (
        <div className="bulkbar"><b>{selection.sel.size} selected</b><button className="btn primary" onClick={() => { setBulkField("manager_id"); setBulk(true); }}>Set manager...</button><button className="btn primary" onClick={() => { setBulkField("assigned_to"); setBulk(true); }}>Set relationship manager...</button><button className="btn" onClick={selection.clear}>Clear</button></div>
      )}
      <div className="card">
        {!data ? <Loading error={error} /> : rows.length === 0 ? <Empty>No customers found.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr>{can("customers.assign") && <th style={{ width: 36 }}><Check checked={allOn} onChange={() => selection.setAll(rows.map((r) => r.id), !allOn)} /></th>}<th>Customer</th><th>Contact</th><th>GSTIN / PAN</th><th>Manager</th><th>Relationship mgr</th><th>Services</th><th>Open tickets</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className={"click" + (selection.sel.has(c.id) ? " sel" : "")} onClick={() => nav(`/customers/${c.id}`)}>
                  {can("customers.assign") && <td><Check checked={selection.sel.has(c.id)} onChange={() => selection.toggle(c.id)} /></td>}
                  <td><b>{c.name}</b><div className="small muted">{c.type}{c.city ? ` · ${c.city}` : ""}</div></td>
                  <td>{c.contact_person || "-"}<div className="small muted">{c.phone}{c.email ? ` · ${c.email}` : ""}</div></td>
                  <td className="mono small">{c.gstin || "-"}<div className="muted">{c.pan || ""}</div></td>
                  <td>{c.manager ? <span className="row" style={{ gap: 6 }}><Avatar name={c.manager} small />{c.manager.replace(/\(.*\)/, "")}</span> : <span className="muted">-</span>}</td>
                  <td>{c.rm ? <span className="row" style={{ gap: 6 }}><Avatar name={c.rm} small />{c.rm.replace(/\(.*\)/, "")}</span> : <span className="muted">-</span>}</td>
                  <td>{c.services}</td>
                  <td>{c.open_tasks ? <span className="badge dark">{c.open_tasks}</span> : <span className="muted">0</span>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
      {adding && <CustomerForm onClose={() => { setAdding(false); setSp({}, { replace: true }); }} onSaved={(id) => { reload(); id && nav(`/customers/${id}`); }} />}
      {importing && <ImportModal onClose={() => setImporting(false)} onDone={reload} />}
      {bulk && (
        <BulkAssign title={bulkField === "manager_id" ? "Set manager" : "Set relationship manager"} count={selection.sel.size} onClose={() => setBulk(false)} onApply={async (p) => {
          if (p.assigned_to === undefined && !p.plan && !p.round_robin) return;
          // customers use a single owner each; split/even are dealt out in screen order
          const ids = rows.filter((r) => selection.sel.has(r.id)).map((r) => r.id);
          const jobs: Promise<any>[] = [];
          if ("assigned_to" in p) jobs.push(api("/customers/bulk", { body: { ids, [bulkField]: p.assigned_to } }));
          else if (p.plan) { let i = 0; for (const s of p.plan) { const part = ids.slice(i, i + s.count); i += s.count; if (part.length) jobs.push(api("/customers/bulk", { body: { ids: part, [bulkField]: s.user_id } })); } }
          else if (p.round_robin) p.round_robin.forEach((u, k) => { const part = ids.filter((_, i) => i % p.round_robin!.length === k); if (part.length) jobs.push(api("/customers/bulk", { body: { ids: part, [bulkField]: u } })); });
          await Promise.all(jobs);
          toast(bulkField === "manager_id" ? "Managers updated" : "Relationship managers updated");
          selection.clear();
          reload();
        }} />
      )}
    </>
  );
}
