import { Link } from "react-router-dom";
import { api, CATEGORY_LABEL } from "../api";
import { Avatar, Empty, Loading, PageHead, money, useLoad } from "../ui";

export default function Reports() {
  const { data, error } = useLoad(() => api("/reports/overview"), []);
  if (!data) return <Loading error={error} />;
  const maxOpen = Math.max(1, ...data.workload.map((w: any) => w.open_count || 0), data.unassigned);
  const maxRev = Math.max(1, ...data.revenue.map((r: any) => Math.max(r.invoiced, r.collected)));
  return (
    <>
      <PageHead title="Reports" sub={`Team workload and completion for ${data.month}.`} />
      <div className="grid g2" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="card-h"><h2>Team workload (open tickets)</h2></div>
          <div className="card-b stack" style={{ gap: 10 }}>
            {data.workload.map((w: any) => (
              <div key={w.id} className="row">
                <Avatar name={w.name} small /><span style={{ width: 150 }}>{w.name.replace(/\(.*\)/, "")}</span>
                <div className="pill-bar grow"><i style={{ width: ((w.open_count || 0) / maxOpen) * 100 + "%", background: "var(--gray)" }} /></div>
                <b className="num" style={{ width: 28, textAlign: "right" }}>{w.open_count || 0}</b>
                {w.overdue > 0 && <span className="badge red">{w.overdue} overdue</span>}
                <span className="badge ok">{w.done_month || 0} done</span>
              </div>
            ))}
            <div className="row">
              <span className="avatar sm gray">?</span><span style={{ width: 150 }} className="muted">Unassigned</span>
              <div className="pill-bar grow"><i style={{ width: (data.unassigned / maxOpen) * 100 + "%", background: "var(--red)" }} /></div>
              <b className="num" style={{ width: 28, textAlign: "right" }}>{data.unassigned}</b>
              <Link className="link small" to="/tasks?assigned=none&open=1">assign</Link>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-h"><h2>Completion by service (this month)</h2></div>
          {data.byService.length === 0 ? <Empty>No tickets this month.</Empty> : (
            <div className="card-b stack" style={{ gap: 8 }}>
              {data.byService.map((s: any) => (
                <div key={s.name} className="row">
                  <span style={{ width: 170 }} title={CATEGORY_LABEL[s.category]}>{s.name}</span>
                  <div className="pill-bar grow"><i style={{ width: (s.done / s.total) * 100 + "%", background: "var(--ok)" }} /></div>
                  <span className="num muted" style={{ width: 54, textAlign: "right" }}>{s.done}/{s.total}</span>
                  {s.overdue > 0 && <span className="badge red">{s.overdue}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {data.revenue.length > 0 && (
        <div className="grid g2">
          <div className="card">
            <div className="card-h"><h2>Invoiced vs collected</h2></div>
            <div className="card-b row" style={{ alignItems: "flex-end", height: 190, gap: 18 }}>
              {data.revenue.map((r: any) => (
                <div key={r.month} className="grow" style={{ textAlign: "center" }}>
                  <div className="row" style={{ alignItems: "flex-end", height: 140, justifyContent: "center", gap: 4 }}>
                    <div title={"Invoiced " + money(r.invoiced)} style={{ width: 22, height: (r.invoiced / maxRev) * 130 + 2, background: "var(--gray)", borderRadius: 4 }} />
                    <div title={"Collected " + money(r.collected)} style={{ width: 22, height: (r.collected / maxRev) * 130 + 2, background: "var(--red)", borderRadius: 4 }} />
                  </div>
                  <div className="small muted">{r.month}</div>
                </div>
              ))}
            </div>
            <div className="small muted" style={{ padding: "0 16px 12px" }}>■ dark = invoiced &nbsp; <span style={{ color: "var(--red)" }}>■</span> red = collected</div>
          </div>
          <div className="card">
            <div className="card-h"><h2>Who owes the most</h2></div>
            {data.topDue.length === 0 ? <Empty>Nothing outstanding.</Empty> : (
              <div className="table-wrap"><table><tbody>
                {data.topDue.map((c: any) => <tr key={c.id}><td><Link className="link" to={`/customers/${c.id}`}>{c.name}</Link></td><td className="mono" style={{ textAlign: "right" }}>{money(c.due)}</td></tr>)}
              </tbody></table></div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
