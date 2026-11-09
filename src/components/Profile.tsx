import { useState } from "react";
import { api, roleLabel } from "../api";
import { Field, Loading, Modal, PasswordInput, useLoad } from "../ui";

/** Everyone can keep their own name, email, mobile and designation up to date. Changing the email asks for the current password. */
export default function ProfileModal({ onClose, onSaved }: { onClose: () => void; onSaved: (msg: string) => void }) {
  const { data } = useLoad(() => api<any>("/auth/profile"), []);
  const [f, setF] = useState<any>(null);
  const [cur, setCur] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const form = f ?? (data ? { name: data.name, email: data.email, phone: data.phone || "", designation: data.designation || "" } : null);
  if (!data || !form) return <Modal title="My profile" onClose={onClose}><Loading /></Modal>;
  const tech = data.role === "TECH";
  const emailChanged = form.email.trim().toLowerCase() !== data.email;
  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      await api("/auth/profile", { method: "PATCH", body: { ...form, current: cur } });
      onSaved(emailChanged ? "Profile saved. Sign in with your new email next time." : "Profile saved");
      onClose();
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  };
  return (
    <Modal title="My profile" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !form.name.trim() || !form.email.trim() || (emailChanged && !cur)} onClick={save}>Save</button></>}>
      <div className="stack">
        {err && <div className="alert">{err}</div>}
        <div className="small muted">Role: <b>{roleLabel(data.role)}</b> (set by your administrator)</div>
        <div className="form-grid">
          <Field label="Name"><input className="input" value={tech ? "Tech Admin" : form.name} disabled={tech} onChange={(e) => setF({ ...form, name: e.target.value })} /></Field>
          <Field label="Designation"><input className="input" value={form.designation} onChange={(e) => setF({ ...form, designation: e.target.value })} /></Field>
          <Field label="Email (your login)" full><input className="input" type="email" value={form.email} onChange={(e) => setF({ ...form, email: e.target.value })} /></Field>
          <Field label="Mobile"><input className="input" inputMode="tel" value={form.phone} onChange={(e) => setF({ ...form, phone: e.target.value })} /></Field>
        </div>
        {emailChanged && <PasswordInput label="Current password (needed to change your email)" value={cur} onChange={setCur} autoComplete="current-password" />}
      </div>
    </Modal>
  );
}
