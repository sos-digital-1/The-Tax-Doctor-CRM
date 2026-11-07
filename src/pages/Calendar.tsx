import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, todayStr } from "../api";
import { Loading, PageHead, useLoad } from "../ui";
import { TaskModal } from "../components/TaskModals";

const STATUTORY: Record<string, string> = {
  "7": "TDS/TCS payment", "11": "GSTR-1", "13": "GSTR-1 (QRMP) / IFF", "15": "PF / ESI payment", "20": "GSTR-3B", "22": "GSTR-3B (QRMP, some states)", "24": "GSTR-3B (QRMP, other states)",
};
const FIXED: Record<string, string> = { "06-15": "Advance tax 1st instalment", "09-15": "Advance tax 2nd instalment", "12-15": "Advance tax 3rd instalment", "03-15": "Advance tax 4th instalment", "07-31": "ITR (non-audit) / TDS Q1", "10-31": "TDS Q2 / ITR (audit)", "01-31": "TDS Q3", "05-31": "TDS Q4", "09-30": "Tax audit / DIR-3 KYC", "12-31": "GSTR-9 / 9C", "03-31": "Licence renewals (KMC, P.Tax) / GST LUT" };

export default function Calendar() {
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const [open, setOpen] = useState<number | null>(null);
  const nav = useNavigate();
  const { data, error, reload } = useLoad(() => api(`/calendar?month=${month}`), [month]);
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const lead = (first.getDay() + 6) % 7; // Monday first
  const days = new Date(y, m, 0).getDate();
  const cells = Array.from({ length: Math.ceil((lead + days) / 7) * 7 }, (_, i) => i - lead + 1);
  const shift = (d: number) => { const n = new Date(y, m - 1 + d, 1); setMonth(`${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`); };
  const today = todayStr();

  return (
    <>
      <PageHead title="Compliance calendar" sub="Every ticket and renewal by due date, with statutory dates marked.">
        <button className="btn" onClick={() => shift(-1)}>‹</button>
        <input type="month" className="input" style={{ width: 160 }} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        <button className="btn" onClick={() => shift(1)}>›</button>
        <button className="btn" onClick={() => setMonth(todayStr().slice(0, 7))}>Today</button>
      </PageHead>
      {!data ? <Loading error={error} /> : (
        <div className="cal">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="dh">{d}</div>)}
          {cells.map((d, i) => {
            if (d < 1 || d > days) return <div key={i} className="day off" />;
            const date = `${month}-${String(d).padStart(2, "0")}`;
            const t = data.tasks.filter((x: any) => x.due_date === date);
            const r = data.renewals.filter((x: any) => x.due_date === date);
            const note = FIXED[`${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`] || STATUTORY[String(d)];
            return (
              <div key={i} className={"day" + (date === today ? " today" : "")}>
                <b>{d}</b>
                {note && <div className="small muted" style={{ fontSize: 10.5, lineHeight: 1.2 }}>{note}</div>}
                {t.slice(0, 3).map((x: any) => <span key={x.id} className={"ev" + (x.status === "DONE" ? " done" : x.due_date < today ? " late" : "")} title={`${x.title} - ${x.customer_name || ""}`} onClick={() => setOpen(x.id)}>{x.title}</span>)}
                {t.length > 3 && <span className="small muted">+{t.length - 3} more</span>}
                {r.slice(0, 2).map((x: any) => <span key={"r" + x.id} className="ev ren" onClick={() => nav("/annual")} title={x.customer_name}>{x.service_name}: {x.customer_name}</span>)}
              </div>
            );
          })}
        </div>
      )}
      {open && <TaskModal id={open} onClose={() => setOpen(null)} onChanged={reload} />}
      <div className="small muted" style={{ marginTop: 10 }}>Statutory dates shown are the common ones - confirm against the latest notifications, as extensions are announced from time to time.</div>
    </>
  );
}
