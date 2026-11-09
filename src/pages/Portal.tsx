import { FormEvent, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api, compressImage, fmtDateTime } from "../api";
import { Footer, LogoTD } from "../ui";

function UploadRow({ request, onDone }: { request?: any; onDone: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setErr("");
    const form = new FormData();
    form.append("file", await compressImage(file)); // phone photos are shrunk before upload
    if (request) form.append("request_id", String(request.id));
    if (note) form.append("note", note);
    try {
      await api("/portal/upload", { form });
      setFile(null);
      setNote("");
      if (ref.current) ref.current.value = "";
      onDone();
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy(false);
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <input ref={ref} type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip" />
      {!request && <input className="input" placeholder="What is this file? (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />}
      {err && <div className="alert">{err}</div>}
      <div><button className="btn primary" disabled={!file || busy} onClick={submit}>{busy ? "Uploading..." : "Upload"}</button></div>
    </div>
  );
}

export default function Portal() {
  const { token } = useParams();
  // the installable app is for staff only - customers just use this link
  useEffect(() => { document.querySelector('link[rel="manifest"]')?.remove(); }, []);
  const [state, setState] = useState<"loading" | "invalid" | "login" | "in">("loading");
  const [phone, setPhone] = useState("");
  const [err, setErr] = useState("");
  const [me, setMe] = useState<any>(null);
  const [msg, setMsg] = useState("");
  const [sent, setSent] = useState(false);

  const load = async () => {
    try {
      setMe(await api("/portal/me"));
      setState("in");
      return true;
    } catch {
      return false;
    }
  };
  useEffect(() => {
    (async () => {
      if (await load()) return;
      try {
        await api(`/portal/info/${token}`);
        setState("login");
      } catch {
        setState("invalid");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const login = async (e: FormEvent) => {
    e.preventDefault();
    setErr("");
    try {
      await api("/portal/login", { body: { token, phone } });
      await load();
    } catch (e: any) {
      setErr(e.message);
    }
  };
  const sendMsg = async () => {
    try {
      await api("/portal/message", { body: { body: msg } });
      setMsg("");
      setSent(true);
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const Head = (
    <div className="portal-head">
      <div className="row" style={{ maxWidth: 720, margin: "0 auto" }}>
        <div className="logo-chip"><LogoTD h={30} /></div>
        <span className="muted small right">Secure document portal</span>
        {state === "in" && <button className="btn sm" style={{ background: "#1a1a1d", color: "#ddd", borderColor: "#333" }} onClick={() => api("/portal/logout", { method: "POST" }).then(() => { setMe(null); setState("login"); })}>Sign out</button>}
      </div>
    </div>
  );

  if (state === "loading") return <div className="portal">{Head}<div className="empty">Loading...</div></div>;
  if (state === "invalid")
    return <div className="portal">{Head}<div className="portal-body"><div className="card card-b"><h2>Link not valid</h2><p className="muted">This link is invalid or has expired. Please ask your Tax Doctor contact to send you a new one.</p></div></div></div>;

  if (state === "login")
    return (
      <div className="portal">{Head}
        <div className="portal-body">
          <form className="card card-b stack" onSubmit={login}>
            <h2 style={{ fontSize: 18 }}>Sign in with your mobile number</h2>
            <p className="muted" style={{ margin: 0 }}>Enter the mobile number registered with Tax Doctor to see the documents we need from you.</p>
            {err && <div className="alert">{err}</div>}
            <input className="input" inputMode="numeric" autoComplete="tel" autoFocus placeholder="10-digit mobile number" value={phone} onChange={(e) => setPhone(e.target.value)} style={{ fontSize: 18, padding: 12 }} />
            <button className="btn primary" style={{ justifyContent: "center", padding: 11 }} disabled={phone.replace(/\D/g, "").length < 10}>Continue</button>
          </form>
        </div>
        <Footer />
      </div>
    );

  return (
    <div className="portal">{Head}
      <div className="portal-body stack">
        <div>
          <h1>Welcome, {me.customer}</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>Files you upload are reviewed by our team before they are added to your records.</p>
        </div>

        <div className="card">
          <div className="card-h"><h2>Documents we need from you</h2></div>
          <div className="card-b stack">
            {me.requests.length === 0 && <div className="muted">Nothing is pending right now. Thank you!</div>}
            {me.requests.map((r: any) => (
              <div key={r.id} className="req">
                <div className="row wrap"><b className="grow">{r.title}</b>{r.status === "SUBMITTED" ? <span className="badge info">Uploaded - under review</span> : <span className="badge warn">Needed</span>}</div>
                {r.description && <div className="muted small">{r.description}</div>}
                {r.status === "REQUESTED" && r.last_reject_reason && <div className="alert" style={{ marginTop: 8 }}>Your last upload was not accepted: {r.last_reject_reason}</div>}
                {r.status === "REQUESTED" && <div style={{ marginTop: 10 }}><UploadRow request={r} onDone={load} /></div>}
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-h"><h2>Send us something else</h2></div>
          <div className="card-b stack">
            <div className="muted small">Have another document? Upload it here - our team will review it first.</div>
            <UploadRow onDone={load} />
            <hr style={{ border: 0, borderTop: "1px solid var(--border)", width: "100%" }} />
            <div className="muted small">Or send us a message / request:</div>
            <textarea className="input" maxLength={2000} value={msg} onChange={(e) => { setMsg(e.target.value); setSent(false); }} placeholder="Type your message..." />
            {sent && <div className="alert ok">Message sent. We will get back to you.</div>}
            {err && <div className="alert">{err}</div>}
            <div><button className="btn" disabled={!msg.trim()} onClick={sendMsg}>Send message</button></div>
          </div>
        </div>

        {me.submissions.length > 0 && (
          <div className="card">
            <div className="card-h"><h2>Your uploads</h2></div>
            <div className="table-wrap"><table><tbody>
              {me.submissions.map((s: any) => (
                <tr key={s.id}>
                  <td>{s.name}<div className="small muted">{fmtDateTime(s.uploaded_at)}</div>{s.status === "REJECTED" && s.reject_reason && <div className="small" style={{ color: "var(--red)" }}>{s.reject_reason}</div>}</td>
                  <td className="right"><span className={"badge " + ({ PENDING: "info", ACCEPTED: "ok", REJECTED: "red" } as any)[s.status]}>{{ PENDING: "Under review", ACCEPTED: "Accepted", REJECTED: "Not accepted" }[s.status as "PENDING"]}</span></td>
                </tr>
              ))}
            </tbody></table></div>
          </div>
        )}
      </div>
      <Footer />
    </div>
  );
}
