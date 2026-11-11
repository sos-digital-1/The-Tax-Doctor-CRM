import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { Avatar, Icon, useApp } from "../ui";

/** Messenger-style chat that is reachable from every page: icon in the top bar, a panel with your chats, and it pops up by itself when someone writes to you. */
const short = (t?: string) => {
  if (!t) return "";
  const d = new Date(t.replace(" ", "T") + "Z"), s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return Math.round(s / 60) + "m";
  if (s < 86400) return Math.round(s / 3600) + "h";
  if (s < 7 * 86400) return Math.round(s / 86400) + "d";
  return Math.round(s / (7 * 86400)) + "w";
};
const clean = (n: string) => (n || "").replace(/\(.*\)/, "").trim();

export default function ChatPopup() {
  const { user } = useApp();
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<number | null>(null); // null = chat list, else open conversation
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [q, setQ] = useState("");
  const [chans, setChans] = useState<any[]>([]);
  const [presence, setPresence] = useState<Record<number, string | null>>({});
  const [msgs, setMsgs] = useState<any[]>([]);
  const [text, setText] = useState("");
  const wrap = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const prev = useRef<Record<number, number> | null>(null);
  const last = useRef(0);
  const onChatPage = loc.pathname.startsWith("/chat");

  const load = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    api<any[]>("/chat/channels").then((r) => {
      // pop up when somebody writes to us (not on the first load, not while already on the Team chat page)
      if (prev.current) {
        const fresh = r.filter((c) => c.unread > (prev.current![c.id] ?? 0));
        if (fresh.length && !onChatPage) { setOpen(true); if (fresh.length === 1 && view === null) { setView(fresh[0].id); } }
      }
      prev.current = Object.fromEntries(r.map((c) => [c.id, c.unread]));
      setChans(r);
    }).catch(() => {});
    api<any[]>("/chat/presence").then((r) => setPresence(Object.fromEntries(r.map((u) => [u.id, u.last_seen])))).catch(() => {});
  }, [onChatPage, view]);
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);

  // open conversation: load + keep polling for new messages (this also marks them read)
  useEffect(() => {
    last.current = 0;
    setMsgs([]);
    if (view === null || !open) return;
    let stop = false;
    const poll = async () => {
      try {
        const r = await api<any[]>(`/chat/channels/${view}/messages?after=${last.current}`);
        if (stop || !r.length) return;
        last.current = r[r.length - 1].id;
        setMsgs((m) => [...m, ...r.filter((x) => !m.some((y) => y.id === x.id))]);
      } catch {}
    };
    poll();
    const t = setInterval(() => document.visibilityState === "visible" && poll(), 2500);
    return () => { stop = true; clearInterval(t); };
  }, [view, open]);
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [msgs.length, view]);

  // click outside closes it
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const send = async () => {
    const body = text.trim();
    if (!body || view === null) return;
    setText("");
    try {
      await api(`/chat/channels/${view}/messages`, { body: { body } });
      const r = await api<any[]>(`/chat/channels/${view}/messages?after=${last.current}`);
      if (r.length) { last.current = r[r.length - 1].id; setMsgs((m) => [...m, ...r.filter((x) => !m.some((y) => y.id === x.id))]); }
    } catch { setText(body); }
  };

  const total = chans.reduce((a, c) => a + (c.unread || 0), 0);
  const active = (uid?: number) => { const t = uid ? presence[uid] : null; return !!t && Date.now() - new Date(t.replace(" ", "T") + "Z").getTime() < 50000; };
  const list = chans.filter((c) => (tab === "all" || c.unread > 0) && (!q || (c.name || "").toLowerCase().includes(q.toLowerCase())));
  const cur = chans.find((c) => c.id === view);
  const title = (c: any) => (c.kind === "DM" ? clean(c.name) : "# " + c.name);

  return (
    <div ref={wrap} style={{ position: "relative" }}>
      <button className="tbtn" title="Chats" onClick={() => setOpen(!open)}><Icon name="chat" />{total > 0 && <span className="dot">{total > 9 ? "9+" : total}</span>}</button>
      {open && (
        <div className="cpop" onClick={(e) => e.stopPropagation()}>
          {view === null || !cur ? (
            <>
              <div className="cpop-h"><h3>Chats</h3><span className="grow" /><button className="tbtn" title="Open full chat" onClick={() => { setOpen(false); nav("/chat"); }}>⤢</button></div>
              <div className="cpop-s"><Icon name="search" size={15} /><input placeholder="Search chats" value={q} onChange={(e) => setQ(e.target.value)} /></div>
              <div className="cpop-t">
                <button className={tab === "all" ? "on" : ""} onClick={() => setTab("all")}>All</button>
                <button className={tab === "unread" ? "on" : ""} onClick={() => setTab("unread")}>Unread{total > 0 ? ` (${total})` : ""}</button>
              </div>
              <div className="cpop-l">
                {list.length === 0 && <div className="empty">{tab === "unread" ? "No unread chats." : "No chats yet."}</div>}
                {list.map((c) => (
                  <button key={c.id} className="cpop-i" onClick={() => setView(c.id)}>
                    <span className="pwrap">{c.kind === "DM" ? <Avatar name={c.name} /> : <span className="avatar gray">#</span>}{c.kind === "DM" && <span className={"pdot" + (active(c.other_id) ? " on" : "")} />}</span>
                    <span className="grow" style={{ minWidth: 0, textAlign: "left" }}>
                      <b style={{ display: "block", fontWeight: c.unread ? 800 : 600 }}>{title(c)}</b>
                      <span className="small muted" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: c.unread ? 700 : 400 }}>{c.last_body || "No messages yet"}</span>
                    </span>
                    <span className="small muted">{short(c.last_at)}</span>
                    {c.unread > 0 && <span className="badge red">{c.unread}</span>}
                  </button>
                ))}
              </div>
              <button className="cpop-f" onClick={() => { setOpen(false); nav("/chat"); }}>See all in Team chat</button>
            </>
          ) : (
            <>
              <div className="cpop-h">
                <button className="tbtn" title="Back" onClick={() => setView(null)}>‹</button>
                <div className="grow" style={{ minWidth: 0 }}>
                  <b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title(cur)}</b>
                  {cur.kind === "DM" ? <span className={"small pstate" + (active(cur.other_id) ? " active" : "")}>{active(cur.other_id) ? "Active now" : "Offline"}</span> : <span className="small muted">{cur.members} members</span>}
                </div>
                <button className="tbtn" title="Open full chat" onClick={() => { setOpen(false); nav("/chat"); }}>⤢</button>
                <button className="tbtn" title="Close" onClick={() => setOpen(false)}>×</button>
              </div>
              <div className="cpop-m" ref={box}>
                {msgs.length === 0 && <div className="empty">Say hello.</div>}
                {msgs.map((m) => (
                  <div key={m.id} className={"msg" + (m.user_id === user.id ? " me" : "")}>
                    <div style={{ minWidth: 0 }}>
                      {m.user_id !== user.id && cur.kind !== "DM" && <div className="small muted">{clean(m.author)}</div>}
                      <div className="bubble">{m.file_name ? <div className="small">📎 {m.file_name}</div> : null}{m.body}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="cpop-c">
                <input className="input" placeholder="Write a message..." value={text} maxLength={4000} autoFocus onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
                <button className="btn primary" disabled={!text.trim()} onClick={send}><Icon name="send" size={16} /></button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
