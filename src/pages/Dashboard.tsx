import { Link, useNavigate } from "react-router-dom";
import { api, CATEGORY_LABEL, STATUS_LABEL, daysUntil, fmtDate, fmtDateTime } from "../api";
import { Avatar, DueBadge, Empty, Loading, Panel, StatCard, StatusBadge, money, useApp, useLoad } from "../ui";

export default function Dashboard({ greeting }: { greeting: string }) {
  const { user, can } = useApp();
  const nav = useNavigate();
  const { data, error } = useLoad(() => api("/dashboard"), []);
  const bill = useLoad(() => (can("billing.view") ? api("/billing/summary") : Promise.resolve(null)), []);
  const rep = useLoad(() => (can("reports.view") ? api("/reports/overview") : Promise.resolve(null)), []);
  const act = useLoad(() => (can("reports.view") ? api<any[]>("/activity") : Promise.resolve(null)), []);
  if (!data) return <Loading error={error} />;
  const c = data.counts;

  const byStatus = Object.keys(STATUS_LABEL).map((s) => ({ s, n: data.byCategory.filter((r: any) => r.status === s).reduce((a: number, r: any) => a + r.n, 0) }));
  const maxStatus = Math.max(1, ...byStatus.map((x) => x.n));
  const cats = ["RECURRING", "ANNUAL", "ONE_TIME", "CUSTOM"].map((cat) => {
    const rows = data.byCategory.filter((r: any) => r.category === cat);
    const total = rows.reduce((a: number, r: any) => a + r.n, 0);
    const done = rows.filter((r: any) => r.status === "DONE").reduce((a: number, r: any) => a + r.n, 0);
    return { cat, total, done };
  });
  const statusTone: Record<string, string> = { OPEN: "var(--gray)", IN_PROGRESS: "var(--info)", WAITING_CLIENT: "var(--warn)", REVIEW: "#7c3aed", ON_HOLD: "var(--red)", DONE: "var(--ok)" };

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <div className="greet">{greeting}, {user.name.replace(/\(.*\)/, "").trim().split(" ")[0]}</div>
          <p>Team-wide figures from live data · {fmtDate(data.today)}</p>
        </div>
      </div>

      <div className="grid g5" style={{ marginBottom: 14 }}>
        <StatCard icon="building" label="Customers" value={c.customers} sub="Active clients" onClick={() => nav("/customers")} />
        <StatCard icon="ticket" label="Open tickets" value={c.open} sub={`${c.mine} assigned to me`} onClick={() => nav("/tasks?open=1")} />
        <StatCard icon="alert" tone="red" label="Overdue" value={c.overdue} sub="Past due date" onClick={() => nav("/tasks?due=overdue")} />
        <StatCard icon="clock" tone="warn" label="Due in 7 days" value={c.dueWeek} sub="Coming up" onClick={() => nav("/tasks?due=week")} />
        <StatCard icon="cal" tone="warn" label="Renewals (15 days)" value={c.renewals} sub="Call or email customers" onClick={() => nav("/annual")} />
      </div>
      <div className="grid g5" style={{ marginBottom: 18 }}>
        {can("docs.review") && <StatCard icon="inbox" tone="info" label="Review inbox" value={c.pendingDocs + c.messages} sub={`${c.pendingDocs} files · ${c.messages} messages`} onClick={() => nav("/inbox")} />}
        {bill.data ? (
          <>
            <StatCard icon="money" tone="red" label="Outstanding" value={money(bill.data.outstanding)} sub={`${money(bill.data.overdue)} overdue`} onClick={() => nav("/billing")} />
            <StatCard icon="trend" tone="ok" label="Collected (month)" value={money(bill.data.collected)} sub="Payments received" onClick={() => nav("/billing")} />
            <StatCard icon="file" label="Invoiced (month)" value={money(bill.data.invoiced)} sub="Raised this month" onClick={() => nav("/billing")} />
          </>
        ) : null}
        <StatCard icon="check" tone="ok" label="Done this month" value={cats.reduce((a, x) => a + x.done, 0)} sub={`of ${cats.reduce((a, x) => a + x.total, 0)} tickets`} />
      </div>

      <div className="grid g3" style={{ marginBottom: 14 }}>
        <Panel icon="layout" title="Ticket pipeline" sub="All work, by status">
          <div className="funnel" style={{ padding: "8px 0" }}>
            {byStatus.map((x) => (
              <div className="frow" key={x.s}>
                <span style={{ width: 130 }}>{STATUS_LABEL[x.s]}</span>
                <div className="bar"><i style={{ width: (x.n / maxStatus) * 100 + "%", background: statusTone[x.s] }} /></div>
                <b className="num" style={{ width: 30, textAlign: "right" }}>{x.n}</b>
              </div>
            ))}
          </div>
        </Panel>
        <Panel icon="chart" title="Completion by service type" sub="Done vs total">
          <div className="funnel" style={{ padding: "8px 0" }}>
            {cats.map((x) => (
              <div className="frow" key={x.cat}>
                <span style={{ width: 100 }}>{CATEGORY_LABEL[x.cat]}</span>
                <div className="bar"><i style={{ width: x.total ? (x.done / x.total) * 100 + "%" : 0, background: "var(--red)" }} /></div>
                <span className="num muted" style={{ width: 54, textAlign: "right" }}>{x.done}/{x.total}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel icon="users" title="Team workload" sub="Open tickets per person" action={can("reports.view") ? <Link className="link small" to="/reports">Reports</Link> : null}>
          {rep.data ? (
            <div className="funnel" style={{ padding: "8px 0" }}>
              {rep.data.workload.slice(0, 5).map((w: any) => (
                <div className="frow" key={w.id}>
                  <Avatar name={w.name} small /><span style={{ width: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.name.replace(/\(.*\)/, "")}</span>
                  <div className="bar"><i style={{ width: Math.min(100, (w.open_count || 0) * 6) + "%", background: "var(--gray)" }} /></div>
                  <b className="num" style={{ width: 26, textAlign: "right" }}>{w.open_count || 0}</b>
                </div>
              ))}
              <div className="frow"><span className="avatar sm gray">?</span><span style={{ width: 100 }} className="muted">Unassigned</span><div className="bar"><i style={{ width: Math.min(100, rep.data.unassigned * 6) + "%", background: "var(--red)" }} /></div><b className="num" style={{ width: 26, textAlign: "right" }}>{rep.data.unassigned}</b></div>
            </div>
          ) : <Empty>Visible to managers.</Empty>}
        </Panel>
      </div>

      <div className="grid g2" style={{ marginBottom: 14 }}>
        <Panel icon="alert" title="Needs attention this week" action={<Link className="link small" to="/tasks?open=1">All tickets</Link>}>
          {data.urgent.length === 0 ? <Empty>Nothing urgent. Nice.</Empty> : (
            <div className="table-wrap"><table><tbody>
              {data.urgent.map((t: any) => (
                <tr key={t.id} className="click" onClick={() => nav(`/tasks?open=${t.id}`)}>
                  <td><b>{t.title}</b><div className="small muted">{t.customer_name || "Internal"} · {t.assignee || "Unassigned"}</div></td>
                  <td><StatusBadge s={t.status} /></td>
                  <td><DueBadge date={t.due_date} /></td>
                </tr>
              ))}
            </tbody></table></div>
          )}
        </Panel>
        <Panel icon="cal" title="Renewals - next 15 days" action={<Link className="link small" to="/annual">Open</Link>}>
          {data.renewalsList.length === 0 ? <Empty>No renewals coming up.</Empty> : (
            <div className="table-wrap"><table><tbody>
              {data.renewalsList.map((r: any) => {
                const d = daysUntil(r.next_due)!;
                return (
                  <tr key={r.id}>
                    <td><b>{r.service_name}</b><div className="small muted"><Link className="link" to={`/customers/${r.customer_id}`}>{r.customer_name}</Link> · {r.phone}</div></td>
                    <td>{fmtDate(r.next_due)}</td>
                    <td><span className={"badge " + (d < 0 ? "red" : d <= 7 ? "warn" : "")}>{d < 0 ? `${-d}d overdue` : d === 0 ? "today" : `in ${d}d`}</span></td>
                  </tr>
                );
              })}
            </tbody></table></div>
          )}
        </Panel>
      </div>

      {act.data && (
        <Panel icon="log" title="Recent activity" sub="Who did what" action={<Link className="link small" to="/admin/activity">View all</Link>}>
          <div className="timeline">
            {act.data.slice(0, 7).map((a: any) => (
              <div className="trow" key={a.id}>
                <span className="tag">{a.action.split(".")[0]}</span>
                <span className="grow"><b>{a.actor}</b> · {a.action.replace(".", " ")} {a.detail && <span className="muted">· {String(a.detail).slice(0, 90)}</span>}</span>
                <span className="muted small">{fmtDateTime(a.created_at)}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </>
  );
}
