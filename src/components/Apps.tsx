import { useState } from "react";
import qrcode from "qrcode-generator";
import { api, fmtDateTime, fmtSize } from "../api";
import { Icon, Panel, copy, useApp, useLoad } from "../ui";

function qrSvg(text: string) {
  const q = qrcode(0, "M");
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

const HELP: Record<string, { icon: string; steps: string[]; upload: string }> = {
  android: {
    icon: "phone",
    steps: ["Scan the QR code with the phone camera (or open the link in Chrome).", "Download the APK, open it and allow \"Install unknown apps\" for Chrome when asked.", "Open Tax Doctor Team, enter the server address once, then sign in."],
    upload: "npx wrangler r2 object put tax-doctor-files/downloads/TaxDoctor-Team.apk --file android/TaxDoctor-Team.apk",
  },
  windows: {
    icon: "monitor",
    steps: ["Open the link on the Windows PC and download the installer.", "Run it - choose the install folder, finish the wizard and open Tax Doctor Team.", "Enter the server address once, then sign in. Open a tab per customer to work in parallel."],
    upload: "npx wrangler r2 object put tax-doctor-files/downloads/TaxDoctor-Team-Setup.exe --file desktop/dist/TaxDoctor-Team-Setup.exe",
  },
};

export default function Apps() {
  const { toast } = useApp();
  const { data, error } = useLoad(() => api("/downloads"), []);
  const [links, setLinks] = useState<Record<string, { url: string; svg: string }>>({});

  const make = async (id: string) => {
    try {
      const r = await api("/downloads/link", { body: { id } });
      setLinks((l) => ({ ...l, [id]: { url: r.url, svg: qrSvg(r.url) } }));
    } catch (e: any) { toast(e.message, true); }
  };

  return (
    <Panel icon="download" title="Get the team apps" sub="For staff and admins only. Customers never install anything - they just open their portal link.">
      {error && <div className="alert" style={{ margin: 16 }}>{error}</div>}
      <div className="grid g2" style={{ padding: 16 }}>
        {(data?.items || []).map((a: any) => {
          const h = HELP[a.id];
          const l = links[a.id];
          return (
            <div key={a.id} className="card" style={{ boxShadow: "none" }}>
              <div className="card-h">
                <div className="sicon sm red"><Icon name={h.icon} size={16} /></div>
                <h2 className="grow">{a.label}</h2>
                {a.available ? <span className="badge ok">Ready · {fmtSize(a.size)}</span> : <span className="badge warn">Not uploaded yet</span>}
              </div>
              <div className="dl-card">
                <div className="qr">{l ? <div dangerouslySetInnerHTML={{ __html: l.svg }} /> : <div className="empty" style={{ padding: 40, fontSize: 11 }}>QR appears here</div>}</div>
                <div className="stack" style={{ gap: 10 }}>
                  <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>{h.steps.map((s) => <li key={s}>{s}</li>)}</ol>
                  <div className="row wrap">
                    <button className="btn primary sm" disabled={!a.available} onClick={() => make(a.id)}>{l ? "New link + QR" : "Create link + QR"}</button>
                    {l && <button className="btn sm" onClick={() => copy(l.url, toast)}>Copy link</button>}
                  </div>
                  {l && <div className="small muted">Link works for 48 hours, then stops. {a.uploaded && `File uploaded ${fmtDateTime(String(a.uploaded))}.`}</div>}
                  {!a.available && (
                    <div className="alert warn small">Upload the file to storage first: <code style={{ wordBreak: "break-all" }}>{h.upload}</code></div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
