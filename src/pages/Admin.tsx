import { useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { api, fmtDateTime } from "../api";
import Apps from "../components/Apps";
import { Avatar, Empty, Field, Loading, Modal, PageHead, useApp, useLoad } from "../ui";

function PermModal({ u, onClose, onSaved }: { u: any; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const { data } = useLoad(() => api("/perms"), []);
  const [on, setOn] = useState<Set<string> | null>(null);
  const cur = on ?? new Set<string>(u.perms);
  if (!data) return <Modal title="Permissions" onClose={onClose}><Loading /></Modal>;
  const defaults = new Set<string>(data.roles[u.role]);
  const groups: Record<string, any[]> = {};
  data.perms.forEach((p: any) => (groups[p.group] ||= []).push(p));
  const toggle = (k: string) => { const n = new Set(cur); n.has(k) ? n.delete(k) : n.add(k); setOn(n); };
  const save = async () => {
    const grant = [...cur].filter((k) => !defaults.has(k));
    const deny = [...defaults].filter((k) => !cur.has(k));
    try { await api(`/users/${u.id}`, { method: "PATCH", body: { permissions: { grant, deny } } }); toast("Permissions saved"); onSaved(); onClose(); } catch (e: any) { toast(e.message, true); }
  };
  const admin = u.role === "ADMIN";
  return (
    <Modal title={`Access for ${u.name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button>{!admin && <button className="btn" onClick={() => setOn(new Set(defaults))}>Reset to {u.role.toLowerCase()} defaults</button>}{!admin && <button className="btn primary" onClick={save}>Save</button>}</>}>
      {admin && <div className="alert warn" style={{ marginBottom: 12 }}>Admins always have every permission.</div>}
      <div className="stack">
        {Object.entries(groups).map(([g, list]) => (
          <div key={g}>
            <div className="crumb">{g}</div>
            {list.map((p: any) => (
              <label key={p.key} className="check" style={{ opacity: admin ? 0.6 : 1 }}>
                <input type="checkbox" className="cb" disabled={admin} checked={admin || cur.has(p.key)} onChange={() => toggle(p.key)} />
                <span className="grow">{p.label}</span>
                {!admin && (cur.has(p.key) !== defaults.has(p.key)) && <span className="badge warn">custom</span>}
              </label>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  );
}

function Users() {
  const { toast, user } = useApp();
  const { data, reload } = useLoad(() => api<any[]>("/users"), []);
  const [adding, setAdding] = useState(false);
  const [perm, setPerm] = useState<any>(null);
  const [f, setF] = useState({ name: "", email: "", role: "STAFF", password: "" });
  const create = async () => {
    try { await api("/users", { body: f }); toast("User created"); setAdding(false); setF({ name: "", email: "", role: "STAFF", password: "" }); reload(); } catch (e: any) { toast(e.message, true); }
  };
  const patch = async (id: number, body: any) => {
    try { await api(`/users/${id}`, { method: "PATCH", body }); reload(); } catch (e: any) { toast(e.message, true); }
  };
  const reset = (u: any) => {
    const p = window.prompt(`New password for ${u.name} (min 8 characters)`);
    if (p) patch(u.id, { password: p }).then(() => toast("Password changed"));
  };
  return (
    <>
      <PageHead title="Users & access" sub="Pick a role, then fine-tune per person - for example let one person run recurring services, or stop another from touching them.">
        <button className="btn primary" onClick={() => setAdding(true)}>+ New user</button>
      </PageHead>
      <div className="card">
        {!data ? <Loading /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Name</th><th>Role</th><th>Access</th><th>Status</th><th></th></tr></thead>
            <tbody>{data.map((u) => {
              let custom = 0;
              try { const o = JSON.parse(u.permissions || "{}"); custom = (o.grant?.length || 0) + (o.deny?.length || 0); } catch {}
              return (
                <tr key={u.id}>
                  <td><div className="row"><Avatar name={u.name} /><div><b>{u.name}</b><div className="small muted">{u.email}</div></div></div></td>
                  <td><select className="input" style={{ width: 130, padding: "3px 6px" }} disabled={u.id === user.id} value={u.role} onChange={(e) => patch(u.id, { role: e.target.value })}><option value="ADMIN">Admin</option><option value="MANAGER">Manager</option><option value="STAFF">Staff</option></select></td>
                  <td><button className="btn sm" onClick={() => setPerm(u)}>Permissions{custom ? ` (${custom} custom)` : ""}</button> <span className="small muted">{u.perms.length} of 21 allowed</span></td>
                  <td><span className={"badge " + (u.active ? "ok" : "red")}>{u.active ? "Active" : "Disabled"}</span></td>
                  <td className="right"><button className="btn sm" onClick={() => reset(u)}>Reset password</button> {u.id !== user.id && <button className="btn sm" onClick={() => patch(u.id, { active: !u.active })}>{u.active ? "Disable" : "Enable"}</button>}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </div>
      <div style={{ marginTop: 18 }}><Apps /></div>
      {perm && <PermModal u={perm} onClose={() => setPerm(null)} onSaved={reload} />}
      {adding && (
        <Modal title="New user" onClose={() => setAdding(false)} footer={<><button className="btn" onClick={() => setAdding(false)}>Cancel</button><button className="btn primary" onClick={create}>Create user</button></>}>
          <div className="form-grid">
            <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Role"><select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="STAFF">Staff</option><option value="MANAGER">Manager</option><option value="ADMIN">Admin</option></select></Field>
            <Field label="Email" full><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <Field label="Initial password (min 8 characters)" full><input className="input" type="text" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </>
  );
}

function Catalogue() {
  const { toast } = useApp();
  const { data, reload } = useLoad(() => api<any[]>("/services"), []);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState<any>({ name: "", category: "ONE_TIME", frequency: "ONCE", due_day: "", renew_rule: "ACTUAL", renew_months: 12 });
  const create = async () => {
    try { await api("/services", { body: f }); toast("Service added"); setAdding(false); reload(); } catch (e: any) { toast(e.message, true); }
  };
  const toggle = async (s: any) => { await api(`/services/${s.id}`, { method: "PATCH", body: { ...s, active: !s.active } }); reload(); };
  const setDay = async (s: any, v: string) => { await api(`/services/${s.id}`, { method: "PATCH", body: { ...s, due_day: v === "" ? null : Number(v) } }); toast("Default due day updated for future tickets"); reload(); };
  return (
    <>
      <PageHead title="Service catalogue" sub="The list of services your firm offers. Add new ones any time - for example a new licence type.">
        <button className="btn primary" onClick={() => setAdding(true)}>+ Add service</button>
      </PageHead>
      {["RECURRING", "ANNUAL", "ONE_TIME"].map((cat) => (
        <div className="card" key={cat} style={{ marginBottom: 14 }}>
          <div className="card-h"><h2>{{ RECURRING: "Recurring services", ANNUAL: "Annual services", ONE_TIME: "One-time services" }[cat]}</h2></div>
          <div className="table-wrap"><table><tbody>
            {(data || []).filter((s) => s.category === cat).map((s) => (
              <tr key={s.id} style={{ opacity: s.active ? 1 : 0.5 }}>
                <td><b>{s.name}</b><div className="small muted">{s.description}</div></td>
                <td><span className="badge">{s.frequency.toLowerCase()}</span>{s.renew_rule === "MAR31" && <span className="badge red" style={{ marginLeft: 6 }}>by 31 March</span>}</td>
                <td>{cat === "RECURRING" ? <span className="row small">Due day <input className="input" style={{ width: 64, padding: "3px 6px" }} type="number" min={0} max={31} defaultValue={s.due_day ?? ""} onBlur={(e) => e.target.value !== String(s.due_day ?? "") && setDay(s, e.target.value)} /></span> : null}</td>
                <td className="right"><button className="btn sm" onClick={() => toggle(s)}>{s.active ? "Disable" : "Enable"}</button></td>
              </tr>
            ))}
          </tbody></table></div>
        </div>
      ))}
      {adding && (
        <Modal title="Add service" onClose={() => setAdding(false)} footer={<><button className="btn" onClick={() => setAdding(false)}>Cancel</button><button className="btn primary" disabled={!f.name} onClick={create}>Add</button></>}>
          <div className="form-grid">
            <Field label="Name" full><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Category"><select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value, frequency: e.target.value === "ONE_TIME" ? "ONCE" : e.target.value === "RECURRING" ? "MONTHLY" : "YEARLY" })}><option value="ONE_TIME">One-time</option><option value="ANNUAL">Annual</option><option value="RECURRING">Recurring</option></select></Field>
            {f.category === "RECURRING" && <Field label="Frequency"><select className="input" value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })}><option value="MONTHLY">Monthly</option></select></Field>}
            {f.category === "RECURRING" && <Field label="Due day of month (0 = month end)"><input type="number" className="input" value={f.due_day} onChange={(e) => setF({ ...f, due_day: e.target.value })} /></Field>}
            {f.category === "ANNUAL" && <Field label="Renewal rule"><select className="input" value={f.renew_rule} onChange={(e) => setF({ ...f, renew_rule: e.target.value })}><option value="ACTUAL">On actual date next year</option><option value="MAR31">By 31 March</option></select></Field>}
            {f.category === "ANNUAL" && <Field label="Valid for (months)"><input type="number" className="input" value={f.renew_months} onChange={(e) => setF({ ...f, renew_months: e.target.value })} /></Field>}
          </div>
        </Modal>
      )}
    </>
  );
}

function Emails() {
  const { data, error } = useLoad(() => api<any[]>("/emails"), []);
  return (
    <>
      <PageHead title="Email log" sub="Every email the system has sent or attempted. “Logged only” means no mail provider is connected yet." />
      <div className="card">{!data ? <Loading error={error} /> : data.length === 0 ? <Empty>No emails yet.</Empty> : (
        <div className="table-wrap"><table>
          <thead><tr><th>When</th><th>To</th><th>Subject</th><th>Type</th><th>Status</th></tr></thead>
          <tbody>{data.map((e) => <tr key={e.id}><td>{fmtDateTime(e.created_at)}</td><td>{e.customer_name || ""}<div className="small muted">{e.to_email}</div></td><td>{e.subject}</td><td><span className="badge">{e.kind}</span></td><td><span className={"badge " + (e.status === "SENT" ? "ok" : e.status === "FAILED" ? "red" : "warn")} title={e.error || ""}>{e.status === "LOGGED" ? "Logged only" : e.status}</span></td></tr>)}</tbody>
        </table></div>
      )}</div>
    </>
  );
}

function Activity() {
  const { data, error } = useLoad(() => api<any[]>("/activity"), []);
  return (
    <>
      <PageHead title="Activity log" sub="Who did what - the latest 200 actions." />
      <div className="card">{!data ? <Loading error={error} /> : (
        <div className="table-wrap"><table>
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead>
          <tbody>{data.map((a) => <tr key={a.id}><td>{fmtDateTime(a.created_at)}</td><td>{a.actor}</td><td><span className="badge">{a.action}</span></td><td className="small">{a.detail}</td></tr>)}</tbody>
        </table></div>
      )}</div>
    </>
  );
}

export default function Admin() {
  const { tab } = useParams();
  const { can } = useApp();
  if (tab === "users") return can("users.manage") ? <Users /> : <Navigate to="/" />;
  if (tab === "services") return can("catalogue.manage") ? <Catalogue /> : <Navigate to="/" />;
  if (!can("reports.view")) return <Navigate to="/" />;
  if (tab === "emails") return <Emails />;
  if (tab === "activity") return <Activity />;
  return <Navigate to="/" />;
}
