import { FormEvent, useState } from "react";
import { api, User } from "../api";
import { Engineered, LogoTD, PasswordInput } from "../ui";

export default function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [mode, setMode] = useState<"login" | "forgot" | "sent">("login");
  const [email, setEmail] = useState(() => { try { return localStorage.getItem("td-email") || ""; } catch { return ""; } });
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await api("/auth/login", { body: { email, password } });
      try { localStorage.setItem("td-email", email); } catch {}
      onLogin(r.user);
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  };
  const forgot = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await api("/auth/forgot", { body: { email } });
      setInfo(r.message);
      setMode("sent");
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy(false);
  };

  return (
    <div className="auth">
      <div className="auth-art">
        <div className="logo-chip" style={{ alignSelf: "flex-start", height: 44, padding: "6px 14px" }}><LogoTD h={34} /></div>
        <div>
          <h2>Every filing, renewal and client file in one place.</h2>
          <p>GST, TDS, PF, ESI, licences, ROC and more - assigned, tracked and never missed.</p>
        </div>
        <div className="stack" style={{ gap: 10 }}><Engineered /><div className="small" style={{ color: "#8b8f9a" }}>Internal team portal · authorised staff only</div></div>
      </div>
      <div className="auth-form">
        {mode === "login" && (
          <form className="auth-card stack" onSubmit={submit}>
            <div>
              <h1 style={{ fontSize: 26 }}>Sign in</h1>
              <div className="muted">Use your Tax Doctor staff account.</div>
            </div>
            {err && <div className="alert">{err}</div>}
            <div>
              <label className="f">Email</label>
              <input className="input" type="email" autoFocus={!email} required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} style={{ padding: 10 }} />
            </div>
            <PasswordInput label="Password" value={password} onChange={setPassword} autoComplete="current-password" autoFocus={!!email} />
            <button className="btn primary" style={{ justifyContent: "center", padding: 11, fontSize: 14 }} disabled={busy || !email || !password}>{busy ? "Signing in..." : "Sign in"}</button>
            <button type="button" className="link" style={{ alignSelf: "center" }} onClick={() => { setErr(""); setMode("forgot"); }}>Forgot password?</button>
            <div className="small muted" style={{ textAlign: "center" }}>New here? Your administrator emails you a temporary password - you will choose your own at first sign-in.</div>
          </form>
        )}
        {mode === "forgot" && (
          <form className="auth-card stack" onSubmit={forgot}>
            <div>
              <h1 style={{ fontSize: 26 }}>Reset your password</h1>
              <div className="muted">Enter your account email and we will send you a link to choose a new password.</div>
            </div>
            {err && <div className="alert">{err}</div>}
            <div>
              <label className="f">Email</label>
              <input className="input" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} style={{ padding: 10 }} />
            </div>
            <button className="btn primary" style={{ justifyContent: "center", padding: 11, fontSize: 14 }} disabled={busy || !email}>{busy ? "Sending..." : "Email me a reset link"}</button>
            <button type="button" className="link" style={{ alignSelf: "center" }} onClick={() => setMode("login")}>Back to sign in</button>
          </form>
        )}
        {mode === "sent" && (
          <div className="auth-card stack">
            <h1 style={{ fontSize: 26 }}>Check your email</h1>
            <div className="alert ok">{info}</div>
            <div className="small muted">Nothing arrived after a few minutes? Check spam, or ask your administrator to reset it for you.</div>
            <button className="btn" onClick={() => setMode("login")}>Back to sign in</button>
          </div>
        )}
      </div>
    </div>
  );
}
