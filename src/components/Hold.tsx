import { useState } from "react";
import { Modal } from "../ui";

export const HOLD_REASONS = [
  "Waiting for documents from the customer",
  "Waiting for customer's approval / payment",
  "Government portal / department issue",
  "Customer asked to postpone",
  "Pending clarification from senior",
];

/** Asks for a written reason before a ticket (or several) can be put on hold. */
export default function HoldModal({ count = 1, initial = "", resume, onClose, onSubmit }: { count?: number; initial?: string; resume?: boolean; onClose: () => void; onSubmit: (reason: string) => Promise<void> | void }) {
  const [reason, setReason] = useState(initial);
  const [busy, setBusy] = useState(false);
  const ok = reason.trim().length >= 3;
  const go = async () => {
    setBusy(true);
    try { await onSubmit(reason.trim()); onClose(); } finally { setBusy(false); }
  };
  return (
    <Modal
      title={resume ? "Edit hold reason" : count > 1 ? `Put ${count} tickets on hold` : "Put ticket on hold"}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!ok || busy} onClick={go}>{resume ? "Save reason" : "Put on hold"}</button></>}
    >
      <div className="stack">
        {!resume && <div className="alert warn">On-hold tickets stay open but are not counted as overdue. The reason is saved on the ticket and shown to the team.</div>}
        <div>
          <label className="f">Reason for hold (required)</label>
          <textarea className="input" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer has not sent bank statements yet" maxLength={500} />
        </div>
        <div className="row wrap" style={{ gap: 6 }}>
          {HOLD_REASONS.map((r) => <button key={r} className="badge" style={{ cursor: "pointer" }} onClick={() => setReason(r)}>{r}</button>)}
        </div>
      </div>
    </Modal>
  );
}
