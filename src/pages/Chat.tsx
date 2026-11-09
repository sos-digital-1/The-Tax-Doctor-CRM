import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, compressImage, fmtDateTime, fmtSize, roleLabel } from "../api";
import { Avatar, Field, Icon, Modal, PageHead, useApp } from "../ui";

// turn "TD-0012" into a link to that ticket
function renderBody(body: string) {
  return body.split(/(TD-\d{3,6})/gi).map((part, i) => {
    const m = /^TD-0*(\d+)$/i.exec(part);
    return m ? <Link key={i} to={`/tasks?open=${m[1]}`} style={{ textDecoration: "underline", fontWeight: 700 }}>{part}</Link> : <Fragment key={i}>{part}</Fragment>;
  });
}

const ts = (v?: string | null) => (v ? new Date(v.replace(" ", "T") + "Z").getTime() : 0);

/** Active now (heartbeat in the last ~50 s) / Last seen ... / Inactive (not seen for a day or more) */
export function presenceOf(lastSeen: string | null | undefined, now: number) {
  const t = ts(lastSeen);
  if (!t) return { state: "inactive", label: "Inactive", active: false };
  const sec = Math.max(0, Math.round((now - t) / 1000));
  if (sec <= 50) return { state: "active", label: "Active now", active: true };
  const min = Math.round(sec / 60);
  if (min < 60) return { state: "away", label: `Last seen ${Math.max(min, 1)} min ago`, active: false };
  const hr = Math.round(min / 60);
  if (hr < 24) return { state: "away", label: `Last seen ${hr} h ago`, active: false };
  const day = Math.round(hr / 24);
  return { state: "inactive", label: day <= 1 ? "Inactive · last seen yesterday" : `Inactive · last seen ${day} days ago`, active: false };
}
const Dot = ({ active }: { active: boolean }) => <span className={"pdot" + (active ? " on" : "")} />;

export default function Chat() {
  const { user, users, toast } = useApp();
  const [channels, setChannels] = useState<any[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [msgs, setMsgs] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [lightbox, setLightbox] = useState("");
  const [drag, setDrag] = useState(false);
  const [conv, setConv] = useState(false); // phones: false = conversation list, true = open conversation
  const fileInput = useRef<HTMLInputElement>(null);
  const [modal, setModal] = useState<"" | "dm" | "channel">("");
  const [chName, setChName] = useState("");
  const [chMembers, setChMembers] = useState<Set<number>>(new Set());
  const [presence, setPresence] = useState<Record<number, string | null>>({});
  const [members, setMembers] = useState<any[]>([]);
  const [now, setNow] = useState(Date.now());
  const last = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const activeRef = useRef<number | null>(null);

  const loadChannels = useCallback(() => api<any[]>("/chat/channels").then((r) => { setChannels(r); if (activeRef.current === null && r[0]) { activeRef.current = r[0].id; setActive(r[0].id); } }).catch(() => {}), []);
  useEffect(() => { loadChannels(); const t = setInterval(loadChannels, 6000); return () => clearInterval(t); }, [loadChannels]);

  // presence: who is active / last seen (refreshed often; the clock keeps "x min ago" fresh)
  useEffect(() => {
    const load = () => api<any[]>("/chat/presence").then((r) => { setPresence(Object.fromEntries(r.map((u) => [u.id, u.last_seen]))); setNow(Date.now()); }).catch(() => {});
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 8000);
    const c = setInterval(() => setNow(Date.now()), 20000);
    return () => { clearInterval(t); clearInterval(c); };
  }, []);

  // switch channel: reload history; then poll for newer messages
  useEffect(() => {
    activeRef.current = active;
    last.current = 0;
    setMsgs([]);
    setMembers([]);
    if (!active) return;
    let stop = false;
    const poll = async () => {
      try {
        api<any[]>(`/chat/channels/${active}/members`).then((m) => !stop && setMembers(m)).catch(() => {});
        const r = await api<any[]>(`/chat/channels/${active}/messages?after=${last.current}`);
        if (stop || !r.length) return;
        last.current = r[r.length - 1].id;
        setMsgs((m) => [...m, ...r.filter((x) => !m.some((y) => y.id === x.id))]);
        loadChannels();
      } catch {}
    };
    poll();
    const t = setInterval(() => document.visibilityState === "visible" && poll(), 2500);
    return () => { stop = true; clearInterval(t); };
  }, [active, loadChannels]);
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [msgs.length]);

  const pick = async (f?: File | null) => {
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) return toast("Files can be up to 20 MB", true);
    const small = await compressImage(f);
    setFile(small);
    setPreview(small.type.startsWith("image/") ? URL.createObjectURL(small) : "");
  };
  const clearFile = () => { setFile(null); setPreview(""); if (fileInput.current) fileInput.current.value = ""; };

  const send = async () => {
    const body = text.trim();
    if ((!body && !file) || !active) return;
    const sending = file;
    setText("");
    clearFile();
    try {
      if (sending) {
        const form = new FormData();
        form.append("body", body);
        form.append("file", sending);
        await api(`/chat/channels/${active}/messages`, { form });
      } else await api(`/chat/channels/${active}/messages`, { body: { body } });
      const r = await api<any[]>(`/chat/channels/${active}/messages?after=${last.current}`);
      if (r.length) { last.current = r[r.length - 1].id; setMsgs((m) => [...m, ...r.filter((x) => !m.some((y) => y.id === x.id))]); }
    } catch (e: any) { toast(e.message, true); setText(body); if (sending) setFile(sending); }
  };
  const startDm = async (uid: number) => {
    const r = await api("/chat/dm", { body: { user_id: uid } });
    setModal("");
    await loadChannels();
    setActive(r.id);
    setConv(true);
  };
  const createChannel = async () => {
    try {
      const r = await api("/chat/channels", { body: { name: chName, member_ids: [...chMembers] } });
      setModal(""); setChName(""); setChMembers(new Set());
      await loadChannels();
      setActive(r.id);
    } catch (e: any) { toast(e.message, true); }
  };

  const cur = channels.find((c) => c.id === active);
  const pOf = (uid?: number) => presenceOf(uid ? presence[uid] : null, now);
  const otherMembers = members.filter((m) => m.id !== user.id);
  // "Seen" = every other member has read up to this message
  const receipt = (m: any) => {
    if (!otherMembers.length) return null;
    const seen = otherMembers.filter((o) => o.last_read_id >= m.id);
    const all = seen.length === otherMembers.length;
    const title = seen.length ? "Seen by " + seen.map((o) => o.name.replace(/\(.*\)/, "").trim()).join(", ") : "Not seen yet";
    if (cur?.kind === "DM") return { label: all ? "Seen" : "Unseen", seen: all, title };
    return { label: all ? "Seen by all" : seen.length ? `Seen by ${seen.length}/${otherMembers.length}` : "Unseen", seen: all, title };
  };
  const others = users.filter((u) => u.id !== user.id && u.active !== 0);
  return (
    <>
      <PageHead title="Team chat" sub="Talk to colleagues, share ticket numbers like TD-0012 and they become links." />
      <div className={"card chat" + (conv ? " conv" : "")}>
        <div className="chat-side">
          <div className="row" style={{ padding: 10 }}>
            <button className="btn sm grow" onClick={() => setModal("dm")}>+ Direct message</button>
            <button className="btn sm grow" onClick={() => setModal("channel")}>+ Channel</button>
          </div>
          {channels.map((c) => (
            <div key={c.id} className={"chat-item" + (c.id === active ? " on" : "")} onClick={() => { setActive(c.id); setConv(true); }}>
              {c.kind === "DM" ? <span className="pwrap"><Avatar name={c.name} /><Dot active={pOf(c.other_id).active} /></span> : <span className="avatar gray">#</span>}
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row"><b className="grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.kind === "DM" ? c.name.replace(/\(.*\)/, "") : "# " + c.name}</b>{c.unread > 0 && <span className="badge red">{c.unread}</span>}</div>
                <div className="small muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.last_body || "No messages yet"}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="chat-main" onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }} style={drag ? { outline: "2px dashed var(--red)", outlineOffset: -6 } : undefined}>
          <div className="card-h">
            <button className="btn sm chat-back" onClick={() => setConv(false)} aria-label="Back to chats">‹</button>
            <div className="grow">
              <h2>{cur ? (cur.kind === "DM" ? cur.name : "# " + cur.name) : "Select a conversation"}</h2>
              {cur && cur.kind === "DM" && <div className={"small pstate " + pOf(cur.other_id).state}><Dot active={pOf(cur.other_id).active} /> {pOf(cur.other_id).label}</div>}
              {cur && cur.kind !== "DM" && <div className="small muted">{cur.members} members · {members.filter((m) => presenceOf(m.last_seen, now).active).length} active now</div>}
            </div>
          </div>
          <div className="msgs" ref={box}>
            {msgs.map((m) => (
              <div key={m.id} className={"msg" + (m.user_id === user.id ? " me" : "")}>
                <Avatar name={m.author || "?"} small />
                <div>
                  <div className="small muted" style={{ textAlign: m.user_id === user.id ? "right" : "left" }}>{m.user_id === user.id ? "You" : m.author?.replace(/\(.*\)/, "")} · {fmtDateTime(m.created_at)}</div>
                  <div className="bubble">
                    {m.file_name && <Attachment m={m} onOpen={setLightbox} />}
                    {m.body && renderBody(m.body)}
                  </div>
                  {m.user_id === user.id && (() => { const r = receipt(m); return r ? <div className={"receipt" + (r.seen ? " seen" : "")} title={r.title}>{r.seen ? "✓✓" : "✓"} {r.label}</div> : null; })()}
                </div>
              </div>
            ))}
            {active && msgs.length === 0 && <div className="empty">Say hello.</div>}
          </div>
          {active && (
            <>
              {file && (
                <div className="attach-preview">
                  {preview ? <img src={preview} alt="" /> : <Icon name="file" />}
                  <div className="grow"><b>{file.name}</b><div className="small muted">{fmtSize(file.size)}</div></div>
                  <button className="x" onClick={clearFile}>×</button>
                </div>
              )}
              <div className="row" style={{ padding: 12, borderTop: "1px solid var(--border)" }}>
                <input ref={fileInput} type="file" hidden accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip" onChange={(e) => pick(e.target.files?.[0])} />
                <button className="btn" title="Attach photo, video, audio or document (up to 20 MB)" onClick={() => fileInput.current?.click()}><Icon name="paperclip" size={16} /></button>
                <input className="input" placeholder="Write a message... (Enter to send, paste or drop images)" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} onPaste={(e) => { const f = [...e.clipboardData.files][0]; if (f) { e.preventDefault(); pick(f); } }} maxLength={4000} />
                <button className="btn primary" onClick={send}><Icon name="send" size={16} /> Send</button>
              </div>
            </>
          )}
        </div>
      </div>

      {lightbox && (
        <div className="overlay" style={{ placeItems: "center" }} onClick={() => setLightbox("")}>
          <img src={lightbox} alt="" style={{ maxWidth: "92vw", maxHeight: "88vh", borderRadius: 12 }} />
        </div>
      )}
      {modal === "dm" && (
        <Modal title="Message a colleague" onClose={() => setModal("")}>
          {others.length === 0 && <div className="empty">No other users yet.</div>}
          {others.map((u) => { const pr = presenceOf(presence[u.id], now); return <div key={u.id} className="chat-item" onClick={() => startDm(u.id)}><span className="pwrap"><Avatar name={u.name} /><Dot active={pr.active} /></span><div className="grow"><b>{u.name}</b><div className={"small pstate " + pr.state}>{pr.label}</div></div><span className="badge">{roleLabel(u.role)}</span></div>; })}
        </Modal>
      )}
      {modal === "channel" && (
        <Modal title="New channel" onClose={() => setModal("")} footer={<><button className="btn" onClick={() => setModal("")}>Cancel</button><button className="btn primary" disabled={!chName.trim()} onClick={createChannel}>Create</button></>}>
          <div className="stack">
            <Field label="Channel name"><input className="input" placeholder="e.g. gst-team" value={chName} onChange={(e) => setChName(e.target.value)} /></Field>
            <Field label="Members">
              {others.map((u) => (
                <label key={u.id} className="check"><input type="checkbox" className="cb" checked={chMembers.has(u.id)} onChange={() => setChMembers((s) => { const n = new Set(s); n.has(u.id) ? n.delete(u.id) : n.add(u.id); return n; })} /> {u.name}</label>
              ))}
            </Field>
          </div>
        </Modal>
      )}
    </>
  );
}

function Attachment({ m, onOpen }: { m: any; onOpen: (u: string) => void }) {
  const url = `/api/chat/files/${m.id}`;
  const mime: string = m.file_mime || "";
  if (/^image\/(jpeg|png|webp|gif)/.test(mime)) return <img className="media" src={url} alt={m.file_name} loading="lazy" onClick={() => onOpen(url)} />;
  if (mime.startsWith("video/")) return <video src={url} controls preload="metadata" style={{ maxWidth: 300, borderRadius: 10, display: "block", marginBottom: 6 }} />;
  if (mime.startsWith("audio/")) return <audio src={url} controls style={{ display: "block", marginBottom: 6, maxWidth: 260 }} />;
  return (
    <a className="filechip" href={url + "?download=1"}>
      <Icon name="file" />
      <span className="grow" style={{ minWidth: 0 }}><b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.file_name}</b><span className="small" style={{ opacity: 0.75 }}>{fmtSize(m.file_size)}</span></span>
      <Icon name="download" size={16} />
    </a>
  );
}
