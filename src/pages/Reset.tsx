import { useState } from "react";
import { api } from "../api";
import { Engineered, LogoTD, PasswordInput, passwordOk } from "../ui";

/** Opened from the emailed link: /reset?token=... */
export default function Reset() {
  const token = new URLSearchParams(location.search).get("token") || "";
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const ready = passwordOk(pw) && pw === again;
  const go = async () => {
    setBusy(true);
    setErr("");
    try {
      await api("/auth/reset", { body: { token, password: pw } });
      setDone(true);
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  };
  return (
    <div className="auth" style={{ gridTemplateColumns: "1fr" }}>
      <div className="auth-form" style={{ background: "var(--bg)" }}>
        <div className="auth-card stack card card-b" style={{ maxWidth: 440, padding: 28 }}>
          <div className="logo-chip" style={{ alignSelf: "flex-start", border: "1px solid var(--border)" }}><LogoTD h={34} /></div>
          {done ? (
            <>
              <h1 style={{ fontSize: 24 }}>Password updated</h1>
              <div className="alert ok">Your password has been changed. You can sign in with it now.</div>
              <a className="btn primary" style={{ justifyContent: "center", padding: 11 }} href="/">Go to sign in</a>
            </>
          ) : !token ? (
            <>
              <h1 style={{ fontSize: 24 }}>Link not valid</h1>
              <div className="alert">This reset link is incomplete. Request a new one from the sign-in page.</div>
              <a className="btn" style={{ justifyContent: "center" }} href="/">Back to sign in</a>
            </>
          ) : (
            <>
              <div>
                <h1 style={{ fontSize: 24 }}>Set a new password</h1>
                <div className="muted" style={{ marginTop: 4 }}>Choose a password you have not used before.</div>
              </div>
              {err && <div className="alert">{err} <a className="link" href="/">Request a new link</a></div>}
              <PasswordInput label="New password" value={pw} onChange={setPw} autoComplete="new-password" autoFocus strength />
              <PasswordInput label="Confirm new password" value={again} onChange={setAgain} autoComplete="new-password" onEnter={() => ready && go()} />
              {again && pw !== again && <div className="small" style={{ color: "var(--red)" }}>The two passwords do not match.</div>}
              <button className="btn primary" style={{ justifyContent: "center", padding: 11, fontSize: 14 }} disabled={!ready || busy} onClick={go}>{busy ? "Saving..." : "Save new password"}</button>
            </>
          )}
          <div style={{ display: "flex", justifyContent: "center" }}><Engineered /></div>
        </div>
      </div>
    </div>
  );
}
