import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, fmtDate, todayStr } from "../api";
import { Empty, Field, Loading, Modal, PageHead, money, useApp, useLoad } from "../ui";
import { CustomerSelect } from "../components/TaskModals";

export function InvoiceForm({ onClose, onSaved, defaults }: { onClose: () => void; onSaved: (id: number) => void; defaults?: any }) {
  const { toast, services } = useApp();
  const [f, setF] = useState<any>({ customer_id: "", gst_rate: 18, due_date: "", notes: "", ...defaults });
  const [items, setItems] = useState<{ description: string; amount: string }[]>(defaults?.items ?? [{ description: "", amount: "" }]);
  const sub = items.reduce((a, i) => a + (Number(i.amount) || 0), 0);
  const gst = Math.round(sub * Number(f.gst_rate || 0)) / 100;
  const save = async () => {
    try {
      const r = await api("/invoices", { body: { ...f, items } });
      toast(`Invoice ${r.number} created`);
      onSaved(r.id);
      onClose();
    } catch (e: any) { toast(e.message, true); }
  };
  const setItem = (i: number, k: string, v: string) => setItems((p) => p.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <Modal title="New invoice" wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Create invoice</button></>}>
      <div className="stack">
        <div className="form-grid">
          <Field label="Customer"><CustomerSelect value={f.customer_id} onChange={(v) => setF({ ...f, customer_id: v })} /></Field>
          <Field label="Due date"><input type="date" className="input" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} min={todayStr()} /></Field>
        </div>
        <div>
          <label className="f">Line items</label>
          {items.map((it, i) => (
            <div key={i} className="row" style={{ marginBottom: 6 }}>
              <input className="input" list="svc-list" placeholder="Description (type or pick a service)" value={it.description} onChange={(e) => setItem(i, "description", e.target.value)} style={{ flex: 3 }} />
              <input className="input" type="number" min={0} placeholder="Amount" value={it.amount} onChange={(e) => setItem(i, "amount", e.target.value)} style={{ flex: 1 }} />
              {items.length > 1 && <button className="x" onClick={() => setItems(items.filter((_, j) => j !== i))}>×</button>}
            </div>
          ))}
          <datalist id="svc-list">{services.map((s) => <option key={s.id} value={s.name} />)}</datalist>
          <button className="btn sm" onClick={() => setItems([...items, { description: "", amount: "" }])}>+ Add line</button>
        </div>
        <div className="form-grid">
          <Field label="GST %"><select className="input" value={f.gst_rate} onChange={(e) => setF({ ...f, gst_rate: e.target.value })}>{[0, 5, 12, 18, 28].map((r) => <option key={r}>{r}</option>)}</select></Field>
          <div style={{ textAlign: "right" }}>
            <div className="muted">Subtotal {money(sub)}</div>
            <div className="muted">GST {money(gst)}</div>
            <div className="num" style={{ fontSize: 20, fontWeight: 800 }}>Total {money(sub + gst)}</div>
          </div>
        </div>
        <Field label="Notes (printed on the invoice)"><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export function InvoiceModal({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { can, toast } = useApp();
  const { data, reload, error } = useLoad(() => api(`/invoices/${id}`), [id]);
  const [pay, setPay] = useState({ amount: "", method: "UPI", reference: "" });
  if (!data) return <Modal title="Invoice" onClose={onClose}><Loading error={error} /></Modal>;
  const { invoice: inv, items, payments } = data;
  const balance = inv.total - inv.paid;
  const addPay = async () => {
    try { await api(`/invoices/${id}/payments`, { body: pay }); toast("Payment recorded"); setPay({ amount: "", method: "UPI", reference: "" }); reload(); onChanged(); } catch (e: any) { toast(e.message, true); }
  };
  return (
    <Modal title={inv.number} wide onClose={onClose} footer={<><button className="btn" onClick={() => window.print()}>Print / Save PDF</button><button className="btn primary" onClick={onClose}>Close</button></>}>
      <div className="invoice card">
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div><img src="/logo-taxdoctor.svg" alt="The Tax Doctor" style={{ height: 38 }} /><div style={{ fontSize: 12, marginTop: 6 }}>Kolkata, West Bengal</div></div>
          <div className="right" style={{ textAlign: "right" }}><div style={{ fontFamily: "var(--display)", fontSize: 24, fontWeight: 800 }}>TAX INVOICE</div><div>{inv.number}</div><div>Date: {fmtDate(inv.issue_date)}</div>{inv.due_date && <div>Due: {fmtDate(inv.due_date)}</div>}</div>
        </div>
        <hr />
        <div><b>Bill to:</b> {inv.customer_name}<br />{[inv.address, inv.city, inv.state, inv.pincode].filter(Boolean).join(", ")}{inv.gstin && <><br />GSTIN: {inv.gstin}</>}</div>
        <table style={{ marginTop: 14 }}>
          <thead><tr><th>Description</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
          <tbody>
            {items.map((i: any) => <tr key={i.id}><td>{i.description}</td><td style={{ textAlign: "right" }} className="mono">{money(i.amount)}</td></tr>)}
            <tr><td style={{ textAlign: "right" }}>Subtotal</td><td style={{ textAlign: "right" }} className="mono">{money(inv.subtotal)}</td></tr>
            <tr><td style={{ textAlign: "right" }}>GST @ {inv.gst_rate}%</td><td style={{ textAlign: "right" }} className="mono">{money(inv.gst_amount)}</td></tr>
            <tr><td style={{ textAlign: "right" }}><b>Total</b></td><td style={{ textAlign: "right" }} className="mono"><b>{money(inv.total)}</b></td></tr>
            {inv.paid > 0 && <tr><td style={{ textAlign: "right" }}>Paid</td><td style={{ textAlign: "right" }} className="mono">{money(inv.paid)}</td></tr>}
            <tr><td style={{ textAlign: "right" }}><b>Balance due</b></td><td style={{ textAlign: "right" }} className="mono"><b>{money(balance)}</b></td></tr>
          </tbody>
        </table>
        {inv.notes && <p>{inv.notes}</p>}
        <div style={{ textAlign: "center", fontSize: 11, marginTop: 26, color: "#666" }}>Built by Smack Online Services OPC Pvt Ltd</div>
      </div>
      <div className="no-print" style={{ marginTop: 16 }}>
        <h2 style={{ marginBottom: 8 }}>Payments</h2>
        {payments.length === 0 ? <div className="muted">No payments yet.</div> : payments.map((p: any) => <div key={p.id} className="comment" style={{ marginBottom: 6 }}>{money(p.amount)} · {fmtDate(p.paid_on)} · {p.method || "-"} {p.reference && `· ${p.reference}`} <span className="muted small">by {p.by}</span></div>)}
        {can("billing.manage") && inv.status !== "CANCELLED" && balance > 0.005 && (
          <div className="row wrap" style={{ marginTop: 10 }}>
            <input className="input" style={{ width: 130 }} type="number" placeholder={`Max ${balance}`} value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
            <select className="input" style={{ width: 120 }} value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{["UPI", "Cash", "Bank transfer", "Cheque", "Card"].map((m) => <option key={m}>{m}</option>)}</select>
            <input className="input" style={{ width: 180 }} placeholder="Reference" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} />
            <button className="btn primary" disabled={!pay.amount} onClick={addPay}>Record payment</button>
            <button className="btn" onClick={() => setPay({ ...pay, amount: String(balance) })}>Full balance</button>
          </div>
        )}
      </div>
    </Modal>
  );
}

const STATUS_BADGE: Record<string, string> = { UNPAID: "warn", PARTIAL: "info", PAID: "ok", CANCELLED: "" };

export default function Billing() {
  const { can } = useApp();
  const [sp, setSp] = useSearchParams();
  const [status, setStatus] = useState("OPEN");
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const sum = useLoad(() => api("/billing/summary"), []);
  const { data, error, reload } = useLoad(() => api<any[]>("/invoices?status=" + status), [status]);
  useEffect(() => { if (sp.get("new")) { setAdding(true); setSp({}, { replace: true }); } }, []); // eslint-disable-line
  const s = sum.data;
  return (
    <>
      <PageHead title="Billing" sub="Invoices with GST, part-payments and what each customer still owes.">
        {can("billing.manage") && <button className="btn primary" onClick={() => setAdding(true)}>+ New invoice</button>}
      </PageHead>
      {s && (
        <div className="grid g4" style={{ marginBottom: 14 }}>
          <div className="card stat red"><div className="n">{money(s.outstanding)}</div><div className="l">Outstanding</div></div>
          <div className="card stat red"><div className="n">{money(s.overdue)}</div><div className="l">Overdue</div></div>
          <div className="card stat"><div className="n">{money(s.collected)}</div><div className="l">Collected this month</div></div>
          <div className="card stat"><div className="n">{money(s.invoiced)}</div><div className="l">Invoiced this month</div></div>
        </div>
      )}
      <div className="filters">
        <div className="seg">{[["OPEN", "Unpaid"], ["PAID", "Paid"], ["CANCELLED", "Cancelled"], ["", "All"]].map(([k, l]) => <button key={k} className={status === k ? "on" : ""} onClick={() => setStatus(k)}>{l}</button>)}</div>
      </div>
      <div className="card">
        {!data ? <Loading error={error} /> : data.length === 0 ? <Empty>No invoices.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Invoice</th><th>Customer</th><th>Date</th><th>Due</th><th style={{ textAlign: "right" }}>Total</th><th style={{ textAlign: "right" }}>Balance</th><th>Status</th></tr></thead>
            <tbody>{data.map((i) => (
              <tr key={i.id} className="click" onClick={() => setOpen(i.id)}>
                <td><b>{i.number}</b></td>
                <td><Link className="link" to={`/customers/${i.customer_id}`} onClick={(e) => e.stopPropagation()}>{i.customer_name}</Link></td>
                <td>{fmtDate(i.issue_date)}</td>
                <td>{fmtDate(i.due_date)} {i.status !== "PAID" && i.status !== "CANCELLED" && i.due_date < todayStr() && <span className="badge red">overdue</span>}</td>
                <td className="mono" style={{ textAlign: "right" }}>{money(i.total)}</td>
                <td className="mono" style={{ textAlign: "right" }}>{money(i.total - i.paid)}</td>
                <td><span className={"badge " + STATUS_BADGE[i.status]}>{i.status.charAt(0) + i.status.slice(1).toLowerCase()}</span></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
      {adding && <InvoiceForm onClose={() => setAdding(false)} onSaved={(id) => { reload(); sum.reload(); setOpen(id); }} />}
      {open && <InvoiceModal id={open} onClose={() => setOpen(null)} onChanged={() => { reload(); sum.reload(); }} />}
    </>
  );
}
