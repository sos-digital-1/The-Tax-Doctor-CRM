import { useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { api, fmtDateTime, roleLabel } from "../api";
import { Avatar, Empty, Field, Loading, Modal, PageHead, PasswordInput, copy, passwordOk, useApp, useLoad } from "../ui";

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
  const admin = u.role === "ADMIN" || u.role === "TECH";
  return (
    <Modal title={`Access for ${u.name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button>{!admin && <button className="btn" onClick={() => setOn(new Set(defaults))}>Reset to {u.role.toLowerCase()} defaults</button>}{!admin && <button className="btn primary" onClick={save}>Save</button>}</>}>
      {admin && <div className="alert warn" style={{ marginBottom: 12 }}>Super Admin and Tech Admin always have every permission.</div>}
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

function RolePermModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const { data, reload } = useLoad(() => api("/perms"), []);
  const [role, setRole] = useState<"STAFF" | "MANAGER">("STAFF");
  const [edit, setEdit] = useState<Record<string, Set<string>>>({});
  if (!data) return <Modal title="Role permissions" onClose={onClose}><Loading /></Modal>;
  const cur = edit[role] ?? new Set<string>(data.roles[role]);
  const groups: Record<string, any[]> = {};
  data.perms.forEach((p: any) => (groups[p.group] ||= []).push(p));
  const toggle = (k: string) => { const n = new Set(cur); n.has(k) ? n.delete(k) : n.add(k); setEdit({ ...edit, [role]: n }); };
  const save = async () => {
    try { await api(`/roles/${role}/perms`, { method: "PUT", body: { perms: [...cur] } }); toast(`${role === "STAFF" ? "Staff" : "Manager"} permissions saved for everyone in that role`); setEdit({ ...edit, [role]: undefined as any }); reload(); onSaved(); } catch (e: any) { toast(e.message, true); }
  };
  const reset = async () => { try { await api(`/roles/${role}/perms`, { method: "DELETE" }); setEdit({ ...edit, [role]: undefined as any }); toast("Back to the standard defaults"); reload(); onSaved(); } catch (e: any) { toast(e.message, true); } };
  return (
    <Modal title="Role permissions" wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn" onClick={reset}>Reset to standard</button><button className="btn primary" onClick={save}>Save for all {role === "STAFF" ? "staff" : "managers"}</button></>}>
      <div className="stack">
        <div className="seg">{(["STAFF", "MANAGER"] as const).map((r) => <button key={r} className={role === r ? "on" : ""} onClick={() => setRole(r)}>{r === "STAFF" ? "Staff" : "Manager"}</button>)}</div>
        <div className="small muted">These are the default permissions for everyone with this role. A person's own overrides (Permissions button on their row) still apply on top. Super Admin and Tech Admin always have everything.</div>
        {Object.entries(groups).map(([g, list]) => (
          <div key={g}>
            <div className="crumb">{g}</div>
            {list.map((p: any) => (
              <label key={p.key} className="check"><input type="checkbox" className="cb" checked={cur.has(p.key)} onChange={() => toggle(p.key)} /><span className="grow">{p.label}</span></label>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  );
}

function MailResult({ r, name, onClose }: { r: any; name: string; onClose: () => void }) {
  const { toast } = useApp();
  const secret = r.temp_password || r.reset_link;
  return (
    <Modal title={r.reset_link ? "Reset link" : "Account details"} onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
      <div className="stack">
        {r.emailStatus === "SENT" && <div className="alert ok">Email sent to {name}. {r.reset_link === undefined && r.temp_password === undefined ? "They will be asked to choose their own password at first sign-in." : ""}</div>}
        {r.emailStatus === "LOGGED" && <div className="alert warn">Email is not connected yet (EmailJS keys are missing on the server), so nothing was emailed. Give the details below to {name} yourself.</div>}
        {r.emailStatus === "FAILED" && <div className="alert">The email could not be sent (see Email log). Give the details below to {name} yourself.</div>}
        {secret && (
          <>
            <div className="small muted">Shown once - it is not stored anywhere readable.</div>
            <div className="row"><input className="input mono" readOnly value={secret} onFocus={(e) => e.target.select()} /><button className="btn" onClick={() => copy(secret, toast)}>Copy</button></div>
            {r.temp_password && <div className="small muted">{name} must change this temporary password at first sign-in.</div>}
          </>
        )}
      </div>
    </Modal>
  );
}

function ResetModal({ u, onClose, onResult }: { u: any; onClose: () => void; onResult: (r: any) => void }) {
  const { toast } = useApp();
  const [mode, setMode] = useState<"temp" | "link" | "manual">("temp");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const body = mode === "manual" ? { password: pw } : { reset: mode };
      const r = await api(`/users/${u.id}`, { method: "PATCH", body });
      if (mode === "manual") toast(`Password set. ${u.name} must change it at next sign-in.`);
      else onResult(r);
      onClose();
    } catch (e: any) {
      toast(e.message, true);
      setBusy(false);
    }
  };
  return (
    <Modal title={`Reset password for ${u.name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || (mode === "manual" && !passwordOk(pw))} onClick={go}>{mode === "temp" ? "Email a temporary password" : mode === "link" ? "Email a reset link" : "Set password"}</button></>}>
      <div className="stack">
        {[
          ["temp", "Email a temporary password", "A strong password is generated and emailed. They choose their own at first sign-in."],
          ["link", "Email a reset link", "They get a link (valid 60 minutes) and pick their own new password."],
          ["manual", "Set a password myself", "You type it and tell them. They must still change it at first sign-in."],
        ].map(([k, t, d]) => (
          <label key={k} className="req" style={{ cursor: "pointer", display: "flex", gap: 10, alignItems: "flex-start", borderColor: mode === k ? "var(--red)" : undefined }}>
            <input type="radio" name="rm" className="cb" checked={mode === k} onChange={() => setMode(k as any)} style={{ marginTop: 3 }} />
            <span><b>{t}</b><div className="small muted">{d}</div></span>
          </label>
        ))}
        {mode === "manual" && <PasswordInput label="New password" value={pw} onChange={setPw} autoComplete="new-password" strength />}
      </div>
    </Modal>
  );
}

function EditUserModal({ u, canEmail, onClose, onSaved }: { u: any; canEmail: boolean; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [f, setF] = useState({ name: u.name, email: u.email, phone: u.phone || "", designation: u.designation || "" });
  const [busy, setBusy] = useState(false);
  const tech = u.role === "TECH";
  const save = async () => {
    setBusy(true);
    try { await api(`/users/${u.id}`, { method: "PATCH", body: f }); toast("Details saved"); onSaved(); onClose(); } catch (e: any) { toast(e.message, true); setBusy(false); }
  };
  return (
    <Modal title={`Edit ${u.name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !f.name.trim() || !f.email.trim()} onClick={save}>Save</button></>}>
      <div className="form-grid">
        <Field label="Name"><input className="input" value={tech ? "Tech Admin" : f.name} disabled={tech} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Designation"><input className="input" value={f.designation} placeholder="e.g. GST executive" onChange={(e) => setF({ ...f, designation: e.target.value })} /></Field>
        <Field label="Email (their login)" full><input className="input" type="email" disabled={!canEmail} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Mobile"><input className="input" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      </div>
      {f.email.trim().toLowerCase() !== u.email && <div className="alert warn" style={{ marginTop: 12 }}>They will sign in with the new email from now on.</div>}
    </Modal>
  );
}

function DeleteUserModal({ u, users, onClose, onDone }: { u: any; users: any[]; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const { data } = useLoad(() => api<any>(`/users/${u.id}/summary`), [u.id]);
  const [to, setTo] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const options = users.filter((x) => x.id !== u.id && x.active);
  const go = async () => {
    setBusy(true);
    try { const r = await api(`/users/${u.id}`, { method: "DELETE", body: { transfer_to: Number(to), confirm } }); toast(`${u.name} removed. Their work moved to ${r.moved_to}.`); onDone(); onClose(); } catch (e: any) { toast(e.message, true); setBusy(false); }
  };
  return (
    <Modal title={`Delete ${u.name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn danger" disabled={busy || !to || confirm.trim().toLowerCase() !== u.email.toLowerCase()} onClick={go}>Delete user &amp; move their work</button></>}>
      <div className="stack">
        <div className="alert">This removes the account completely and cannot be undone. Nothing else is lost: everything they own is handed to the person you choose.</div>
        {!data ? <Loading /> : data.total === 0 ? <div className="small muted">This user does not own any tickets, customers or services.</div> : (
          <div className="req"><b>Will be moved</b>
            <div className="small" style={{ marginTop: 6 }}>{Object.entries(data.counts).map(([k, n]) => <div key={k}>{String(n)} {k}</div>)}</div>
          </div>
        )}
        <Field label="Move everything to">
          <select className="input" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose a person...</option>{options.map((x) => <option key={x.id} value={x.id}>{x.name} - {roleLabel(x.role)}</option>)}</select>
        </Field>
        <Field label={`Type ${u.email} to confirm`}><input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" /></Field>
      </div>
    </Modal>
  );
}

function Users() {
  const { toast, user } = useApp();
  const { data, reload } = useLoad(() => api<any[]>("/users"), []);
  const [adding, setAdding] = useState(false);
  const [perm, setPerm] = useState<any>(null);
  const [reset, setReset] = useState<any>(null);
  const [edit, setEdit] = useState<any>(null);
  const [roles, setRoles] = useState(false);
  const [del, setDel] = useState<any>(null);
  const [result, setResult] = useState<{ r: any; name: string } | null>(null);
  const [f, setF] = useState({ name: "", email: "", role: "STAFF", password: "", phone: "", designation: "" });
  const [busy, setBusy] = useState(false);
  const top = user.role === "ADMIN" || user.role === "TECH";
  const hasTech = (data || []).some((x) => x.role === "TECH");
  const create = async () => {
    setBusy(true);
    try {
      const r = await api("/users", { body: f.role === "TECH" ? { ...f, name: "Tech Admin" } : f });
      setAdding(false);
      setResult({ r, name: f.role === "TECH" ? "Tech Admin" : f.name });
      setF({ name: "", email: "", role: "STAFF", password: "", phone: "", designation: "" });
      reload();
    } catch (e: any) { toast(e.message, true); }
    setBusy(false);
  };
  const patch = async (id: number, body: any) => {
    try { await api(`/users/${id}`, { method: "PATCH", body }); reload(); } catch (e: any) { toast(e.message, true); }
  };
  return (
    <>
      <PageHead title="Users & access" sub="Pick a role, then fine-tune per person - for example let one person run recurring services, or stop another from touching them.">
        {(user.role === "ADMIN" || user.role === "TECH") && <button className="btn" onClick={() => setRoles(true)}>Role permissions</button>}
        <button className="btn primary" onClick={() => setAdding(true)}>+ New user</button>
      </PageHead>
      <div className="card">
        {!data ? <Loading /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Name</th><th>Role</th><th>Contact</th><th>Access</th><th>Status</th><th></th></tr></thead>
            <tbody>{data.map((u) => {
              let custom = 0;
              try { const o = JSON.parse(u.permissions || "{}"); custom = (o.grant?.length || 0) + (o.deny?.length || 0); } catch {}
              return (
                <tr key={u.id}>
                  <td><div className="row"><Avatar name={u.name} /><div><b>{u.name}</b><div className="small muted">{u.email}</div></div></div></td>
                  <td>{u.role === "TECH" ? <span className="badge dark">Tech Admin</span> : <select className="input" style={{ width: 140, padding: "3px 6px" }} disabled={u.id === user.id || (u.role === "ADMIN" && !top)} value={u.role} onChange={(e) => patch(u.id, { role: e.target.value })}><option value="ADMIN">Super Admin</option><option value="MANAGER">Manager</option><option value="STAFF">Staff</option></select>}{u.designation && <div className="small muted">{u.designation}</div>}</td>
                  <td className="small">{u.phone || <span className="muted">-</span>}</td>
                  <td><button className="btn sm" onClick={() => setPerm(u)}>Permissions{custom ? ` (${custom} custom)` : ""}</button> <span className="small muted">{u.perms.length} allowed</span></td>
                  <td><span className={"badge " + (u.active ? "ok" : "red")}>{u.active ? "Active" : "Disabled"}</span>{u.must_change_password ? <span className="badge warn" style={{ marginLeft: 6 }} title="Still on a temporary password">Temp password</span> : null}</td>
                  <td className="right" style={{ whiteSpace: "nowrap" }}><button className="btn sm" onClick={() => setEdit(u)}>Edit</button> <button className="btn sm" onClick={() => setReset(u)}>Reset password</button> {u.id !== user.id && u.role !== "TECH" && <button className="btn sm" onClick={() => patch(u.id, { active: !u.active })}>{u.active ? "Disable" : "Enable"}</button>} {top && u.id !== user.id && u.role !== "TECH" && <button className="btn sm danger" onClick={() => setDel(u)}>Delete</button>}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </div>
      {roles && <RolePermModal onClose={() => setRoles(false)} onSaved={reload} />}
      {edit && <EditUserModal u={edit} canEmail={top || edit.role === "STAFF" || edit.role === "MANAGER"} onClose={() => setEdit(null)} onSaved={reload} />}
      {del && <DeleteUserModal u={del} users={data || []} onClose={() => setDel(null)} onDone={reload} />}
      {perm && <PermModal u={perm} onClose={() => setPerm(null)} onSaved={reload} />}
      {reset && <ResetModal u={reset} onClose={() => setReset(null)} onResult={(r) => setResult({ r, name: reset.name })} />}
      {result && <MailResult r={result.r} name={result.name} onClose={() => setResult(null)} />}
      {adding && (
        <Modal title="New user" onClose={() => setAdding(false)} footer={<><button className="btn" onClick={() => setAdding(false)}>Cancel</button><button className="btn primary" disabled={busy || (!f.name && f.role !== "TECH") || !f.email || (!!f.password && !passwordOk(f.password))} onClick={create}>Create &amp; email login</button></>}>
          <div className="form-grid">
            <Field label="Name"><input className="input" value={f.role === "TECH" ? "Tech Admin" : f.name} disabled={f.role === "TECH"} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Role"><select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="STAFF">Staff</option><option value="MANAGER">Manager</option>{top && <option value="ADMIN">Super Admin</option>}{top && !hasTech && <option value="TECH">Tech Admin (only one allowed)</option>}</select></Field>
            <Field label="Designation"><input className="input" value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} /></Field>
            <Field label="Mobile"><input className="input" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
            <Field label="Email (their login)" full><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <div className="full">
              <PasswordInput label="Temporary password (optional)" value={f.password} onChange={(v) => setF({ ...f, password: v })} autoComplete="new-password" strength={!!f.password} hint="Leave empty and we generate a strong one and email it. Either way they must choose their own at first sign-in." />
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function ServiceForm({ initial, onClose, onSaved }: { initial?: any; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const edit = !!initial?.id;
  const [f, setF] = useState<any>({ name: "", category: "RECURRING", frequency: "MONTHLY", due_day: "", months: "", renew_rule: "ACTUAL", renew_months: 12, description: "", ...initial });
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const rec = f.category === "RECURRING";
  const save = async () => {
    const body: any = { name: f.name, description: f.description, due_day: f.due_day === "" || f.due_day == null ? null : Number(f.due_day) };
    if (rec) { body.frequency = f.frequency; body.months = f.frequency === "QUARTERLY" ? (f.months || "4,7,10,1") : f.frequency === "HALF_YEARLY" ? (f.months || "4,10") : null; }
    if (f.category === "ANNUAL") { body.renew_rule = f.renew_rule; body.renew_months = Number(f.renew_months) || 12; }
    try {
      if (edit) await api(`/services/${initial.id}`, { method: "PATCH", body });
      else await api("/services", { body: { ...body, category: f.category, frequency: f.category === "ONE_TIME" ? "ONCE" : f.category === "ANNUAL" ? "YEARLY" : f.frequency } });
      toast(edit ? "Service updated" : "Service added");
      window.dispatchEvent(new Event("td-services"));
      onSaved();
      onClose();
    } catch (e: any) { toast(e.message, true); }
  };
  return (
    <Modal title={edit ? `Edit ${initial.name}` : "Add service"} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!f.name.trim()} onClick={save}>{edit ? "Save changes" : "Add"}</button></>}>
      <div className="form-grid">
        <Field label="Name" full><input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Type"><select className="input" value={f.category} disabled={edit} onChange={(e) => set("category", e.target.value)}><option value="RECURRING">Recurring (every month / quarter)</option><option value="ANNUAL">Annual (renewals)</option><option value="ONE_TIME">One-time</option></select></Field>
        {rec && <Field label="Repeats"><select className="input" value={f.frequency} onChange={(e) => set("frequency", e.target.value)}><option value="MONTHLY">Every month</option><option value="QUARTERLY">Every quarter</option><option value="HALF_YEARLY">Every 6 months</option></select></Field>}
        {rec && <Field label="Due day of month (0 = month end)"><input type="number" min={0} max={31} className="input" value={f.due_day ?? ""} onChange={(e) => set("due_day", e.target.value)} /></Field>}
        {rec && f.frequency !== "MONTHLY" && <Field label="Months it is filed in (numbers)"><input className="input" value={f.months ?? ""} placeholder={f.frequency === "QUARTERLY" ? "4,7,10,1" : "4,10"} onChange={(e) => set("months", e.target.value)} /></Field>}
        {f.category === "ANNUAL" && <Field label="Renewal rule"><select className="input" value={f.renew_rule ?? "ACTUAL"} onChange={(e) => set("renew_rule", e.target.value)}><option value="ACTUAL">On the actual date next year</option><option value="MAR31">By 31 March</option></select></Field>}
        {f.category === "ANNUAL" && <Field label="Valid for (months) - the tenure"><input type="number" min={1} className="input" value={f.renew_months ?? 12} onChange={(e) => set("renew_months", e.target.value)} /></Field>}
        <Field label="Description" full><input className="input" value={f.description ?? ""} onChange={(e) => set("description", e.target.value)} /></Field>
      </div>
      {edit && rec && <div className="small muted" style={{ marginTop: 10 }}>Changes apply to tickets created from now on. Tickets that already exist are not changed.</div>}
    </Modal>
  );
}

function Catalogue() {
  const { toast } = useApp();
  const { data, reload } = useLoad(() => api<any[]>("/services"), []);
  const [form, setForm] = useState<any>(null); // {} = new, service = edit
  const sync = () => { reload(); window.dispatchEvent(new Event("td-services")); };
  const toggle = async (s: any) => { await api(`/services/${s.id}`, { method: "PATCH", body: { active: !s.active } }); sync(); };
  const remove = async (s: any) => {
    if (!window.confirm(`Delete "${s.name}"?\n\nIf customers or tickets already use it, it is archived instead (hidden from new work, nothing is lost).`)) return;
    try { const r = await api(`/services/${s.id}`, { method: "DELETE" }); toast(r.archived ? `${s.name} is in use, so it was archived (history kept)` : `${s.name} deleted`); sync(); } catch (e: any) { toast(e.message, true); }
  };
  const tenure = (s: any) => s.category === "RECURRING"
    ? `${{ MONTHLY: "Every month", QUARTERLY: "Every quarter", HALF_YEARLY: "Every 6 months" }[s.frequency as string] || s.frequency.toLowerCase()}${s.due_day != null ? (s.due_day === 0 ? " · due month end" : ` · due ${s.due_day}th`) : ""}`
    : s.category === "ANNUAL" ? `Valid ${s.renew_months || 12} months${s.renew_rule === "MAR31" ? " · by 31 March" : ""}` : "One time";
  return (
    <>
      <PageHead title="Service catalogue" sub="The list of services your firm offers. Add, edit, change how often a service repeats, or delete it.">
        <button className="btn primary" onClick={() => setForm({})}>+ Add service</button>
      </PageHead>
      {["RECURRING", "ANNUAL", "ONE_TIME"].map((cat) => (
        <div className="card" key={cat} style={{ marginBottom: 14 }}>
          <div className="card-h"><h2>{{ RECURRING: "Recurring services", ANNUAL: "Annual services", ONE_TIME: "One-time services" }[cat]}</h2></div>
          <div className="table-wrap"><table><tbody>
            {(data || []).filter((s) => s.category === cat).map((s) => (
              <tr key={s.id} style={{ opacity: s.active ? 1 : 0.5 }}>
                <td><b>{s.name}</b>{!s.active && <span className="badge" style={{ marginLeft: 6 }}>archived</span>}<div className="small muted">{s.description}</div></td>
                <td><span className="badge">{tenure(s)}</span></td>
                <td className="right" style={{ whiteSpace: "nowrap" }}><button className="btn sm" onClick={() => setForm(s)}>Edit</button> <button className="btn sm" onClick={() => toggle(s)}>{s.active ? "Disable" : "Enable"}</button> <button className="btn sm danger" onClick={() => remove(s)}>Delete</button></td>
              </tr>
            ))}
          </tbody></table></div>
        </div>
      ))}
      {form && <ServiceForm initial={form.id ? form : undefined} onClose={() => setForm(null)} onSaved={reload} />}
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
