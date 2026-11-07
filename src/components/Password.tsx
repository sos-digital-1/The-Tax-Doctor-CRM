import { useState } from "react";
import { api } from "../api";
import { Engineered, Modal, PasswordInput, passwordOk } from "../ui";

/** Change password from the profile menu. */
export function ChangePasswordModal({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = cur && passwordOk(next) && next === again && next !== cur;
  const go = async () => {
    setBusy(true);
    setErr("");
    try {
      await api("/auth/password", { body: { current: cur, next } });
      onDone("Password changed. A confirmation was emailed to you.");
      onClose();
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  };
  return (
    <Modal title="Change password" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!ready || busy} onClick={go}>Change password</button></>}>
      <div className="stack">
        {err && <div className="alert">{err}</div>}
        <PasswordInput label="Current password" value={cur} onChange={setCur} autoComplete="current-password" autoFocus />
        <PasswordInput label="New password" value={next} onChange={setNext} autoComplete="new-password" strength />
        <PasswordInput label="Confirm new password" value={again} onChange={setAgain} autoComplete="new-password" onEnter={() => ready && go()} />
        {again && next !== again && <div className="small" style={{ color: "var(--red)" }}>The two passwords do not match.</div>}
        <div className="small muted">Forgot your current password? Sign out and use “Forgot password” on the sign-in page.</div>
      </div>
    </Modal>
  );
}

/** Full-screen step shown after signing in with a temporary password. Nothing else works until it is done. */
export function ForcePassword({ name, onDone, onLogout }: { name: string; onDone: () => void; onLogout: () => void }) {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = cur && passwordOk(next) && next === again && next !== cur;
  const go = async () => {
    setBusy(true);
    setErr("");
    try {
      await api("/auth/password", { body: { current: cur, next } });
      onDone();
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  };
  return (
    <div className="auth" style={{ gridTemplateColumns: "1fr" }}>
      <div className="auth-form" style={{ background: "var(--bg)" }}>
        <div className="auth-card stack card card-b" style={{ maxWidth: 440, padding: 28 }}>
          <div>
            <h1 style={{ fontSize: 24 }}>Choose your own password</h1>
            <div className="muted" style={{ marginTop: 4 }}>Welcome, {name.replace(/\(.*\)/, "").trim().split(" ")[0]}. You signed in with a temporary password - set a new one to continue.</div>
          </div>
          {err && <div className="alert">{err}</div>}
          <PasswordInput label="Temporary password (from your email)" value={cur} onChange={setCur} autoComplete="current-password" autoFocus />
          <PasswordInput label="New password" value={next} onChange={setNext} autoComplete="new-password" strength />
          <PasswordInput label="Confirm new password" value={again} onChange={setAgain} autoComplete="new-password" onEnter={() => ready && go()} />
          {again && next !== again && <div className="small" style={{ color: "var(--red)" }}>The two passwords do not match.</div>}
          <button className="btn primary" style={{ justifyContent: "center", padding: 11, fontSize: 14 }} disabled={!ready || busy} onClick={go}>{busy ? "Saving..." : "Save and continue"}</button>
          <button className="link small" style={{ alignSelf: "center" }} onClick={onLogout}>Sign out</button>
          <div style={{ display: "flex", justifyContent: "center" }}><Engineered /></div>
        </div>
      </div>
    </div>
  );
}
