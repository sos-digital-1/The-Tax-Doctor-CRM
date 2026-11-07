import { useState } from "react";
import { Link } from "react-router-dom";
import { api, daysUntil, fmtDate } from "../api";
import { Empty, Loading, PageHead, useApp, useLoad, waLink } from "../ui";
import { NewTaskModal } from "../components/TaskModals";

export default function Renewals() {
  const { toast, can, refreshBadges } = useApp();
  const manage = can("annual.manage");
  const [days, setDays] = useState(15);
  const [ticket, setTicket] = useState<any>(null);
  const { data, error, reload } = useLoad(() => api<any[]>(`/renewals?days=${days}`), [days]);

  const remind = async (r: any) => {
    try {
      const x = await api(`/customer-services/${r.id}/remind`, { method: "POST" });
      toast(x.status === "SENT" ? `Reminder emailed to ${r.customer_name}` : "Logged - no mail provider configured yet, so nothing was actually emailed");
      reload();
    } catch (e: any) {
      toast(e.message, true);
    }
  };
  const renew = async (r: any) => {
    if (!window.confirm(`Mark ${r.service_name} for ${r.customer_name} as renewed? The next due date will roll forward.`)) return;
    const x = await api(`/customer-services/${r.id}/renew`, { method: "POST", body: {} });
    toast(`Next due: ${fmtDate(x.next_due)}`);
    reload();
    refreshBadges();
  };
  const runAll = async () => {
    const x = await api("/renewals/run-reminders", { method: "POST" });
    toast(`${x.due} due in 15 days, ${x.emailed} new reminder(s) processed`);
    reload();
  };

  return (
    <>
      <PageHead title="Annual services &amp; renewals" sub="Trade licences, P.Tax, FSSAI, ITR, ROC, DSC - see what is coming up, call the customer, email a reminder.">
        <select className="input" style={{ width: 170 }} value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={15}>Next 15 days</option><option value={30}>Next 30 days</option><option value={60}>Next 60 days</option><option value={90}>Next 90 days</option><option value={365}>Whole year</option>
        </select>
        {manage && <button className="btn" onClick={runAll}>Email all due in 15 days</button>}
      </PageHead>
      <div className="alert warn" style={{ marginBottom: 14 }}>Customers are emailed automatically once, 15 days before the due date (daily check at 8:30 AM IST). Customers with no email appear here for a phone call.</div>
      <div className="card">
        {!data ? <Loading error={error} /> : data.length === 0 ? <Empty>Nothing due in this window.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Service</th><th>Customer</th><th>Due</th><th>Reminder</th><th>Handled by</th><th></th></tr></thead>
            <tbody>{data.map((r) => {
              const d = daysUntil(r.next_due)!;
              return (
                <tr key={r.id}>
                  <td><b>{r.service_name}</b>{r.reg_no && <div className="small muted mono">{r.reg_no}</div>}</td>
                  <td><Link className="link" to={`/customers/${r.customer_id}`}>{r.customer_name}</Link><div className="small muted">{r.phone}{r.email ? "" : " · no email"}</div></td>
                  <td>{fmtDate(r.next_due)} <span className={"badge " + (d < 0 ? "red" : d <= 15 ? "warn" : "")}>{d < 0 ? `${-d}d overdue` : d === 0 ? "today" : `in ${d}d`}</span></td>
                  <td>{r.reminded_for === r.next_due ? <span className="badge ok">Emailed</span> : <span className="muted">Not yet</span>}</td>
                  <td>{r.assignee || "-"}</td>
                  <td className="right"><div className="row" style={{ justifyContent: "flex-end" }}>
                    <a className="btn sm" href={`tel:${r.phone}`}>Call</a>
                    <a className="btn sm" target="_blank" rel="noreferrer" href={waLink(r.phone, `Hello ${r.customer_name}, your ${r.service_name} is due on ${fmtDate(r.next_due)}. Please contact Tax Doctor to renew it on time.`)}>WhatsApp</a>
                    {manage && <button className="btn sm" onClick={() => remind(r)}>Email</button>}
                    {can("tasks.create") && <button className="btn sm" onClick={() => setTicket({ customer_id: String(r.customer_id), service_id: String(r.service_id), title: `${r.service_name} renewal`, due_date: r.next_due })}>Ticket</button>}
                    {manage && <button className="btn sm primary" onClick={() => renew(r)}>Renewed</button>}
                  </div></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </div>
      {ticket && <NewTaskModal onClose={() => setTicket(null)} onSaved={reload} defaults={ticket} />}
    </>
  );
}
