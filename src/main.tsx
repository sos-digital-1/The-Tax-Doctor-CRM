import { StrictMode, Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import "./styles.css";
import "./premium.css";
import { api, fmtDateTime, User } from "./api";
import { Avatar, Ctx, Engineered, Icon, Meta, clearCache } from "./ui";
import { ChangePasswordModal, ForcePassword } from "./components/Password";
import Login from "./pages/Login";
import Palette from "./components/Palette";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Customers = lazy(() => import("./pages/Customers"));
const CustomerDetail = lazy(() => import("./pages/CustomerDetail"));
const Tasks = lazy(() => import("./pages/Tasks"));
const Recurring = lazy(() => import("./pages/Recurring"));
const Renewals = lazy(() => import("./pages/Renewals"));
const Inbox = lazy(() => import("./pages/Inbox"));
const Admin = lazy(() => import("./pages/Admin"));
const Chat = lazy(() => import("./pages/Chat"));
const Billing = lazy(() => import("./pages/Billing"));
const Reports = lazy(() => import("./pages/Reports"));
const Calendar = lazy(() => import("./pages/Calendar"));
const Portal = lazy(() => import("./pages/Portal"));
const Reset = lazy(() => import("./pages/Reset"));
const AppsPage = lazy(() => import("./pages/AppsPage"));
const isElectron = /Electron\//.test(navigator.userAgent);

try {
  const t = localStorage.getItem("td-theme");
  if (t) document.documentElement.dataset.theme = t;
} catch {}

const urlB64ToUint8 = (b: string) => Uint8Array.from(atob((b + "=".repeat((4 - (b.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

function Shell({ user, onLogout }: { user: User & { perms: string[] }; onLogout: () => void }) {
  const [users, setUsers] = useState<Meta["users"]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [toastMsg, setToastMsg] = useState<{ m: string; err?: boolean } | null>(null);
  const [badges, setBadges] = useState({ inbox: 0, renewals: 0, chat: 0, notif: 0 });
  const [menu, setMenu] = useState<"" | "notif" | "user" | "create">("");
  const [notifs, setNotifs] = useState<any[]>([]);
  const [palette, setPalette] = useState(false);
  const [collapsed, setCollapsed] = useState(() => { try { return !!localStorage.getItem("td-collapsed"); } catch { return false; } });
  const [mobileNav, setMobileNav] = useState(false);
  const [installEvt, setInstallEvt] = useState<any>(null);
  const [pushState, setPushState] = useState<"unsupported" | "off" | "on" | "nokey">("off");
  const [pwModal, setPwModal] = useState(false);
  const [bannerHidden, setBannerHidden] = useState(() => { try { return Date.now() - Number(localStorage.getItem("td-notify-later") || 0) < 3 * 86400000; } catch { return false; } });
  const loc = useLocation();
  const nav = useNavigate();
  const can = useCallback((p: string) => user.perms.includes(p), [user]);

  const toast = useCallback((m: string, err?: boolean) => {
    setToastMsg({ m, err });
    setTimeout(() => setToastMsg(null), 3500);
  }, []);

  const refreshBadges = useCallback(() => {
    api("/pulse").then((p) => setBadges({ inbox: p.inbox, renewals: p.renewals, chat: p.chat, notif: p.notifications })).catch(() => {});
  }, []);

  useEffect(() => {
    api("/users").then(setUsers).catch(() => {});
    api("/services").then(setServices).catch(() => {});
  }, []);
  useEffect(() => { refreshBadges(); setMenu(""); }, [loc.pathname, refreshBadges]);
  useEffect(() => { if (menu === "notif") api("/notifications").then((r) => setNotifs(r.items)).catch(() => {}); }, [menu]);
  // unread count in the window / tab title, like a chat app
  useEffect(() => {
    const n = badges.notif + badges.chat;
    document.title = (n > 0 ? `(${n}) ` : "") + document.title.replace(/^\(\d+\)\s*/, "");
  }, [badges.notif, badges.chat, loc.pathname]);
  // warm the page chunks while idle so navigation feels instant
  useEffect(() => {
    const warm = () => { [import("./pages/Customers"), import("./pages/Tasks"), import("./pages/Chat"), import("./pages/Recurring"), import("./pages/Billing"), import("./components/TaskModals")].forEach((p) => p.catch(() => {})); };
    const w = window as any;
    const id = w.requestIdleCallback ? w.requestIdleCallback(warm, { timeout: 4000 }) : setTimeout(warm, 2000);
    return () => (w.cancelIdleCallback ? w.cancelIdleCallback(id) : clearTimeout(id));
  }, []);
  // meaningful window / desktop-tab titles (customer pages set their own)
  useEffect(() => {
    if (/^\/customers\/\d+/.test(loc.pathname)) return;
    const names: Record<string, string> = { "/apps": "Get the apps", "/": "Dashboard", "/customers": "Customers", "/tasks": "Tickets", "/one-time": "One-time", "/recurring": "Recurring", "/annual": "Annual & renewals", "/inbox": "Review inbox", "/calendar": "Calendar", "/billing": "Billing", "/chat": "Team chat", "/reports": "Reports", "/admin/users": "Users & apps", "/admin/services": "Service catalogue", "/admin/emails": "Email log", "/admin/activity": "Activity log" };
    document.title = (names[loc.pathname] || "Tax Doctor") + " · Tax Doctor";
  }, [loc.pathname]);
  // one small call every 20 s while the app is visible, and straight away when you come back to it
  useEffect(() => {
    const tick = () => document.visibilityState === "visible" && refreshBadges();
    const t = setInterval(tick, 20000);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", tick); window.removeEventListener("focus", tick); };
  }, [refreshBadges]);

  // keyboard: Ctrl/Cmd+K opens search
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette(true); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // PWA: service worker, install prompt, push state
  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setInstallEvt(e); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").then(async (reg) => {
        if (!("PushManager" in window)) return setPushState("unsupported");
        const k = await api("/push/key").catch(() => ({ key: null }));
        if (!k.key) return setPushState("nokey");
        setPushState((await reg.pushManager.getSubscription()) ? "on" : "off");
      }).catch(() => setPushState("unsupported"));
    } else setPushState("unsupported");
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const enablePush = async () => {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return toast("Notifications are blocked in the browser settings", true);
      const reg = await navigator.serviceWorker.ready;
      const { key } = await api("/push/key");
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(key) });
      await api("/push/subscribe", { body: { endpoint: sub.endpoint } });
      setPushState("on");
      toast("Alerts enabled on this device");
    } catch (e: any) {
      toast("Could not enable alerts: " + e.message, true);
    }
  };

  const meta: Meta = { user, users, services, toast, can, isManager: can("tasks.assign"), isAdmin: user.role === "ADMIN", refreshBadges };
  const toggleTheme = () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("td-theme", next); } catch {}
  };
  const readAll = async () => { await api("/notifications/read", { body: {} }); refreshBadges(); };
  const openNotif = async (n: any) => { await api("/notifications/read", { body: { id: n.id } }); setMenu(""); refreshBadges(); if (n.link) nav(n.link); };

  type NavItem = [string, string, string, boolean, number?];
  const groups: [string, NavItem[]][] = [
    ["Workspace", [
      ["/", "Dashboard", "dash", true],
      ["/customers", "Customers", "building", can("customers.view")],
      ["/inbox", "Review inbox", "inbox", can("docs.review"), badges.inbox],
    ]],
    ["Services", [
      ["/recurring", "Recurring", "repeat", true],
      ["/annual", "Annual & renewals", "cal", true, badges.renewals],
      ["/one-time", "One-time", "bolt", true],
    ]],
    ["Work", [
      ["/tasks", "Tickets", "ticket", true],
      ["/calendar", "Calendar", "clock", true],
      ["/chat", "Team chat", "chat", can("chat.use"), badges.chat],
    ]],
    ["Finance & insights", [
      ["/billing", "Billing", "money", can("billing.view")],
      ["/reports", "Reports", "chart", can("reports.view")],
    ]],
    ["System", [
      ["/apps", "Get the apps", "download", true],
      ["/admin/services", "Service catalogue", "list", can("catalogue.manage")],
      ["/admin/users", "Users & access", "shield", can("users.manage")],
      ["/admin/emails", "Email log", "mail", can("reports.view")],
      ["/admin/activity", "Activity log", "log", can("reports.view")],
    ]],
  ];
  const hour = new Date().getHours();

  return (
    <Ctx.Provider value={meta}>
      <div className="app" onClick={() => menu && setMenu("")}>
        <aside className={"side" + (collapsed ? " collapsed" : "") + (mobileNav ? " open" : "")}>
          <div className="side-brand">
            <div className="brand-chip"><img className="full" src="/logo-taxdoctor.svg" alt="The Tax Doctor" /><img className="mark" src="/logo-mark.svg" alt="" /></div>
            <div className="sub-brand">Practice management</div>
          </div>
          <nav className="side-nav">
            {groups.map(([g, items]) => {
              const vis = items.filter((i) => i[3]);
              if (!vis.length) return null;
              return (
                <div key={g}>
                  <div className="ngroup">{g}</div>
                  {vis.map(([to, label, icon, , count]) => (
                    <NavLink key={to} to={to} end={to === "/"} className="nlink" title={label} onClick={() => setMobileNav(false)}>
                      <Icon name={icon} /><span>{label}</span>{count ? <span className="count">{count}</span> : null}
                    </NavLink>
                  ))}
                </div>
              );
            })}
          </nav>
          <div className="side-foot">
            <button className="collapse-btn" onClick={() => { setCollapsed(!collapsed); try { localStorage.setItem("td-collapsed", collapsed ? "" : "1"); } catch {} }}><Icon name="panel" size={16} />{!collapsed && "Collapse menu"}</button>
            <Engineered />
          </div>
        </aside>
        <div className="main-col">
          <header className="topbar" onClick={(e) => e.stopPropagation()}>
            <button className="tbtn only-mobile" onClick={() => setMobileNav(!mobileNav)}><Icon name="menu" /></button>
            <div className="tsearch"><button onClick={() => setPalette(true)}><Icon name="search" size={16} /> Search customers, tickets, phone, GSTIN... <kbd>Ctrl K</kbd></button></div>
            <div className="grow" />
            <div style={{ position: "relative" }}>
              <button className="btn-new" onClick={() => setMenu(menu === "create" ? "" : "create")}><Icon name="plus" size={16} /> New</button>
              {menu === "create" && (
                <div className="menu" style={{ minWidth: 220 }}>
                  {can("tasks.create") && <button className="mi" onClick={() => nav("/tasks?new=1")}><Icon name="ticket" size={16} /> New ticket</button>}
                  {can("customers.edit") && <button className="mi" onClick={() => nav("/customers?new=1")}><Icon name="building" size={16} /> New customer</button>}
                  {can("billing.manage") && <button className="mi" onClick={() => nav("/billing?new=1")}><Icon name="money" size={16} /> New invoice</button>}
                  {can("docs.request") && <button className="mi" onClick={() => nav("/customers")}><Icon name="upload" size={16} /> Request documents</button>}
                </div>
              )}
            </div>
            <button className="tbtn" title="Light / dark" onClick={toggleTheme}><Icon name={document.documentElement.dataset.theme === "dark" ? "sun" : "moon"} /></button>
            <div style={{ position: "relative" }}>
              <button className="tbtn" title="Notifications" onClick={() => setMenu(menu === "notif" ? "" : "notif")}><Icon name="bell" />{badges.notif > 0 && <span className="dot">{badges.notif}</span>}</button>
              {menu === "notif" && (
                <div className="menu" style={{ width: 380 }}>
                  <div className="mh"><span className="grow">Notifications</span><button className="link small" onClick={readAll}>Mark all read</button></div>
                  <div style={{ maxHeight: 380, overflowY: "auto" }}>
                    {notifs.length === 0 && <div className="empty">You are all caught up.</div>}
                    {notifs.map((n) => (
                      <button key={n.id} className="mi" style={{ alignItems: "flex-start", opacity: n.read ? 0.6 : 1 }} onClick={() => openNotif(n)}>
                        <span style={{ width: 8, height: 8, borderRadius: 9, background: n.read ? "transparent" : "var(--red)", marginTop: 6, flexShrink: 0 }} />
                        <span><b>{n.title}</b>{n.body && <span className="muted"> · {n.body}</span>}<div className="small muted">{fmtDateTime(n.created_at)}</div></span>
                      </button>
                    ))}
                  </div>
                  {pushState === "off" && <button className="mi" style={{ borderTop: "1px solid var(--border)", color: "var(--red)", fontWeight: 600 }} onClick={enablePush}>Enable alerts on this device</button>}
                  {pushState === "on" && <div className="small muted" style={{ padding: "8px 14px", borderTop: "1px solid var(--border)" }}>Alerts are on for this device.</div>}
                  {pushState === "nokey" && <div className="small muted" style={{ padding: "8px 14px", borderTop: "1px solid var(--border)" }}>Phone alerts need push keys configured on the server.</div>}
                </div>
              )}
            </div>
            <div style={{ position: "relative" }}>
              <button className="who" onClick={() => setMenu(menu === "user" ? "" : "user")}><Avatar name={user.name} /><b>{user.name.replace(/\(.*\)/, "")}</b></button>
              {menu === "user" && (
                <div className="menu" style={{ minWidth: 260 }}>
                  <div className="mh"><div><div>{user.name}</div><div className="small muted" style={{ fontWeight: 400 }}>{user.email} · {user.role.charAt(0) + user.role.slice(1).toLowerCase()}</div></div></div>
                  {installEvt && <button className="mi" onClick={() => { installEvt.prompt(); setInstallEvt(null); }}><Icon name="phone" size={16} /> Install as app on this device</button>}
                  <button className="mi" onClick={() => nav("/apps")}><Icon name="download" size={16} /> Get the Android &amp; Windows apps</button>
                  <button className="mi" onClick={() => { setMenu(""); setPwModal(true); }}><Icon name="key" size={16} /> Change password</button>
                  <button className="mi" style={{ color: "var(--red)", fontWeight: 600 }} onClick={onLogout}>Sign out</button>
                </div>
              )}
            </div>
          </header>
          <main className="main">
            <div className="content">
              {!isElectron && !bannerHidden && pushState === "off" && "Notification" in window && Notification.permission === "default" && (
                <div className="notice-bar">
                  <Icon name="bell" />
                  <span className="grow">Get an alert when a ticket is assigned or updated, or a colleague messages you - even when the app is closed.</span>
                  <button className="btn" onClick={enablePush}>Turn on notifications</button>
                  <button className="btn ghost" onClick={() => { setBannerHidden(true); try { localStorage.setItem("td-notify-later", String(Date.now())); } catch {} }}>Not now</button>
                </div>
              )}
              <Suspense fallback={<div className="empty">Loading...</div>}>
                <Routes>
                  <Route path="/" element={<Dashboard greeting={hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"} />} />
                  <Route path="/customers" element={<Customers />} />
                  <Route path="/customers/:id" element={<CustomerDetail />} />
                  <Route path="/tasks" element={<Tasks />} />
                  <Route path="/one-time" element={<Tasks category="ONE_TIME" />} />
                  <Route path="/recurring" element={<Recurring />} />
                  <Route path="/annual" element={<Renewals />} />
                  <Route path="/inbox" element={<Inbox />} />
                  <Route path="/calendar" element={<Calendar />} />
                  <Route path="/billing" element={<Billing />} />
                  <Route path="/chat" element={<Chat />} />
                  <Route path="/reports" element={<Reports />} />
                  <Route path="/apps" element={<AppsPage />} />
                  <Route path="/admin/:tab" element={<Admin />} />
                  <Route path="*" element={<Navigate to="/" />} />
                </Routes>
              </Suspense>
            </div>
          </main>
        </div>
      </div>
      {palette && <Palette onClose={() => setPalette(false)} />}
      {pwModal && <ChangePasswordModal onClose={() => setPwModal(false)} onDone={(m) => toast(m)} />}
      {toastMsg && <div className={"toast" + (toastMsg.err ? " err" : "")}>{toastMsg.m}</div>}
    </Ctx.Provider>
  );
}

function Root() {
  const [user, setUser] = useState<(User & { perms: string[]; must_change?: boolean }) | null | undefined>(undefined);
  const isPortal = useRef(location.pathname.startsWith("/portal/")).current;
  const isReset = useRef(location.pathname === "/reset").current;
  useEffect(() => {
    if (isPortal || isReset) return;
    api("/auth/me").then((d) => setUser(d.user)).catch(() => setUser(null));
    const out = () => { clearCache(); setUser(null); }; // session ended elsewhere
    window.addEventListener("td-unauth", out);
    return () => window.removeEventListener("td-unauth", out);
  }, [isPortal, isReset]);
  if (isPortal) return <Suspense fallback={null}><Routes><Route path="/portal/:token" element={<Portal />} /></Routes></Suspense>;
  if (isReset) return <Suspense fallback={null}><Reset /></Suspense>;
  if (user === undefined) return <div className="empty">Loading...</div>;
  const logout = () => api("/auth/logout", { method: "POST" }).finally(() => { clearCache(); setUser(null); });
  if (!user) return <Login onLogin={(u: any) => { clearCache(); setUser(u); }} />;
  if (user.must_change) return <ForcePassword name={user.name} onLogout={logout} onDone={() => api("/auth/me").then((d) => setUser(d.user)).catch(() => setUser(null))} />;
  return <Shell user={user} onLogout={logout} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Root />
    </BrowserRouter>
  </StrictMode>
);
