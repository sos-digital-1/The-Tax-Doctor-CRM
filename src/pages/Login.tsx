import { FormEvent, useState } from "react";
import { api, User } from "../api";
import { Engineered } from "../ui";

export default function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await api("/auth/login", { body: { email, password } });
      onLogin(r.user);
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-art">
        <div className="logo-chip" style={{ alignSelf: "flex-start", height: 44, padding: "6px 14px" }}><img src="/logo-taxdoctor.svg" alt="The Tax Doctor" style={{ height: 30 }} /></div>
        <div>
          <h2>Every filing, renewal and client file in one place.</h2>
          <p>GST, TDS, PF, ESI, licences, ROC and more - assigned, tracked and never missed.</p>
        </div>
        <div className="stack" style={{ gap: 10 }}><Engineered /><div className="small" style={{ color: "#8b8f9a" }}>Internal team portal · authorised staff only</div></div>
      </div>
      <div className="auth-form">
        <form className="auth-card stack" onSubmit={submit}>
          <div>
            <h1 style={{ fontSize: 26 }}>Sign in</h1>
            <div className="muted">Use your Tax Doctor staff account.</div>
          </div>
          {err && <div className="alert">{err}</div>}
          <div>
            <label className="f">Email</label>
            <input className="input" type="email" autoFocus required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} style={{ padding: 10 }} />
          </div>
          <div>
            <label className="f">Password</label>
            <input className="input" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ padding: 10 }} />
          </div>
          <button className="btn primary" style={{ justifyContent: "center", padding: 11, fontSize: 14 }} disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button>
        </form>
      </div>
    </div>
  );
}
