import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { Icon } from "../ui";

export default function Palette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ customers: any[]; tasks: any[] }>({ customers: [], tasks: [] });
  const [idx, setIdx] = useState(0);
  const nav = useNavigate();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  useEffect(() => {
    if (q.trim().length < 2) return setRes({ customers: [], tasks: [] });
    const t = setTimeout(() => api("/search?q=" + encodeURIComponent(q)).then((r) => { setRes(r); setIdx(0); }).catch(() => {}), 120);
    return () => clearTimeout(t);
  }, [q]);

  const items = [
    ...res.customers.map((c) => ({ key: "c" + c.id, label: c.name, sub: `Customer · ${c.phone}${c.gstin ? " · " + c.gstin : ""}`, to: `/customers/${c.id}` })),
    ...res.tasks.map((t) => ({ key: "t" + t.id, label: t.title, sub: `Ticket TD-${String(t.id).padStart(4, "0")} · ${t.customer_name || "Internal"}`, to: `/tasks?open=${t.id}` })),
  ];
  const go = (i: number) => { const it = items[i]; if (it) { nav(it.to); onClose(); } };

  return (
    <div className="overlay" style={{ paddingTop: "12vh" }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 620 }}>
        <div className="row" style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <Icon name="search" />
          <input
            ref={ref}
            className="input"
            style={{ border: 0, boxShadow: "none", fontSize: 16, padding: 4 }}
            placeholder="Search customers (name, phone, GSTIN, PAN) or tickets (TD-0012)..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, items.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
              if (e.key === "Enter") go(idx);
            }}
          />
        </div>
        <div style={{ maxHeight: 380, overflowY: "auto" }}>
          {q.trim().length >= 2 && items.length === 0 && <div className="empty">No results.</div>}
          {q.trim().length < 2 && <div className="empty">Type at least 2 characters. Tip: press Ctrl+K anywhere.</div>}
          {items.map((it, i) => (
            <div key={it.key} className="chat-item" style={{ background: i === idx ? "var(--surface-2)" : undefined }} onMouseEnter={() => setIdx(i)} onClick={() => go(i)}>
              <div className="grow"><b>{it.label}</b><div className="small muted">{it.sub}</div></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
