import { useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtDateTime, fmtSize } from "../api";
import { Empty, Loading, Modal, PageHead, useApp, useLoad, waLink } from "../ui";

export default function Inbox() {
  const { toast, refreshBadges } = useApp();
  const { data, error, reload } = useLoad(() => api("/inbox"), []);
  const [rejecting, setRejecting] = useState<any>(null);
  const [reason, setReason] = useState("");

  const done = () => { reload(); refreshBadges(); };
  const accept = async (d: any) => {
    try { await api(`/documents/${d.id}/accept`, { method: "POST" }); toast("Accepted - now in the customer's documents"); done(); } catch (e: any) { toast(e.message, true); }
  };
  const reject = async () => {
    try {
      await api(`/documents/${rejecting.id}/reject`, { body: { reason } });
      toast("Rejected and removed from storage");
      setRejecting(null);
      setReason("");
      done();
    } catch (e: any) { toast(e.message, true); }
  };
  const dismiss = async (m: any) => { await api(`/messages/${m.id}/done`, { method: "POST" }); done(); };

  if (!data) return <Loading error={error} />;
  return (
    <>
      <PageHead title="Review inbox" sub="Nothing a customer uploads reaches their record until you accept it. Rejected files are deleted." />
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-h"><h2 className="grow">Uploaded documents awaiting review</h2><span className="badge dark">{data.pending.length}</span></div>
        {data.pending.length === 0 ? <Empty>No uploads waiting.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>File</th><th>Customer</th><th>For</th><th>Uploaded</th><th></th></tr></thead>
            <tbody>{data.pending.map((d: any) => (
              <tr key={d.id}>
                <td><a className="link" target="_blank" rel="noreferrer" href={`/api/documents/${d.id}/file?inline=1`}>{d.name}</a> <span className="muted small">{fmtSize(d.size)}</span>{d.note && <div className="small muted">“{d.note}”</div>}</td>
                <td><Link className="link" to={`/customers/${d.customer_id}`}>{d.customer_name}</Link></td>
                <td>{d.request_title ? <span className="badge info">{d.request_title}</span> : <span className="badge warn">Not requested</span>}</td>
                <td>{fmtDateTime(d.uploaded_at)}</td>
                <td className="right"><div className="row" style={{ justifyContent: "flex-end" }}>
                  <button className="btn sm primary" onClick={() => accept(d)}>Accept</button>
                  <button className="btn sm danger" onClick={() => setRejecting(d)}>Reject</button>
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
      <div className="card">
        <div className="card-h"><h2 className="grow">Messages from customers</h2><span className="badge dark">{data.messages.length}</span></div>
        {data.messages.length === 0 ? <Empty>No new messages.</Empty> : (
          <div className="table-wrap"><table><tbody>{data.messages.map((m: any) => (
            <tr key={m.id}>
              <td><Link className="link" to={`/customers/${m.customer_id}`}>{m.customer_name}</Link><div className="small muted">{fmtDateTime(m.created_at)}</div></td>
              <td style={{ whiteSpace: "pre-wrap" }}>{m.body}</td>
              <td className="right"><div className="row" style={{ justifyContent: "flex-end" }}>
                <a className="btn sm" href={`tel:${m.phone}`}>Call</a>
                <a className="btn sm" target="_blank" rel="noreferrer" href={waLink(m.phone, "Hello, this is Tax Doctor regarding your message.")}>WhatsApp</a>
                <button className="btn sm" onClick={() => dismiss(m)}>Mark handled</button>
              </div></td>
            </tr>
          ))}</tbody></table></div>
        )}
      </div>
      {rejecting && (
        <Modal title={`Reject ${rejecting.name}`} onClose={() => setRejecting(null)} footer={<><button className="btn" onClick={() => setRejecting(null)}>Cancel</button><button className="btn primary" onClick={reject}>Reject &amp; delete file</button></>}>
          <label className="f">Reason (shown to the customer)</label>
          <textarea className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Image is blurry - please upload a clear scan" autoFocus />
          {rejecting.request_title && <p className="muted small">The request “{rejecting.request_title}” will reopen so the customer can upload again.</p>}
        </Modal>
      )}
    </>
  );
}
