// The Tax Doctor - team desktop app (Windows). Staff / admin only: customers never use this, they only get a portal link.
// Built by Smack Online Services OPC Pvt Ltd
//
// Works tab-wise like an internal bank app: one locked-down window, every module / customer in its own tab so several
// customers can be worked on at the same time without interrupting each other. Tabs can sit on top or down the left side.
// New tabs open a Chrome-style start page with search. Auto-locks when idle, no dev tools, only talks to your server.
const { app, BaseWindow, WebContentsView, Menu, ipcMain, shell, session, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

const MODULES = [
  ["Dashboard", "/"], ["Customers", "/customers"], ["Tickets", "/tasks"], ["Recurring", "/recurring"], ["Annual & renewals", "/annual"], ["One-time", "/one-time"],
  ["Review inbox", "/inbox"], ["Calendar", "/calendar"], ["Billing", "/billing"], ["Team chat", "/chat"], ["Reports", "/reports"],
];
const BAR_H = 48; // horizontal tab bar height
const RAIL_W = 244; // vertical tab rail width
const IDLE_MS = 15 * 60 * 1000;
const PARTITION = "persist:taxdoctor";
const NEWTAB = "@newtab";

if (!app.requestSingleInstanceLock()) app.quit();

const cfgFile = () => path.join(app.getPath("userData"), "config.json");
const readCfg = () => { try { return JSON.parse(fs.readFileSync(cfgFile(), "utf8")); } catch { return {}; } };
const saveCfg = () => { try { fs.writeFileSync(cfgFile(), JSON.stringify(cfg, null, 2)); } catch {} };

let win, shellView, lockView, cfg;
let tabs = []; // { id, view, title, path, kind: 'app' | 'newtab' }
let active = null;
let nextId = 1;
let idleTimer = null;
let locked = false;
let setupView = null;

const origin = () => new URL(cfg.serverUrl).origin;
const layoutMode = () => (cfg.tabLayout === "left" ? "left" : "top");

function layout() {
  if (!win) return;
  const [w, h] = win.getContentSize();
  const left = layoutMode() === "left";
  const cx = left ? RAIL_W : 0, cy = left ? 0 : BAR_H, cw = w - cx, ch = h - cy;
  shellView.setBounds(left ? { x: 0, y: 0, width: RAIL_W, height: h } : { x: 0, y: 0, width: w, height: BAR_H });
  const off = { x: 0, y: h, width: 0, height: 0 };
  for (const t of tabs) t.view.setBounds(t.id === active && !locked && !setupView ? { x: cx, y: cy, width: cw, height: ch } : off);
  lockView.setBounds(locked ? { x: cx, y: cy, width: cw, height: ch } : off);
  if (setupView) setupView.setBounds({ x: cx, y: cy, width: cw, height: ch });
}
const pushTabs = () => shellView.webContents.send("tabs", { tabs: tabs.map((t) => ({ id: t.id, title: t.title, kind: t.kind })), active, locked, layout: layoutMode() });

function resetIdle() {
  clearTimeout(idleTimer);
  if (locked || !cfg?.serverUrl) return;
  idleTimer = setTimeout(lockNow, IDLE_MS);
}
async function lockNow() {
  if (locked || !tabs.length) return;
  locked = true;
  try { await session.fromPartition(PARTITION).fetch(origin() + "/api/auth/logout", { method: "POST", headers: { Origin: origin() } }); } catch {}
  layout(); pushTabs(); lockView.webContents.focus();
}
function unlock() {
  locked = false;
  tabs.filter((t) => t.kind === "app").forEach((t) => t.view.webContents.reload());
  layout(); pushTabs(); resetIdle();
}

const isInternal = (url) => { try { return new URL(url).origin === origin(); } catch { return false; } };
function openExternalSafe(url) {
  try { const u = new URL(url); if (["https:", "http:", "tel:", "mailto:"].includes(u.protocol)) shell.openExternal(url); } catch {}
}
function addRecent(item) {
  cfg.recent = [item, ...(cfg.recent || []).filter((r) => r.path !== item.path)].slice(0, 8);
  saveCfg();
}

function addTab(p = NEWTAB, opts = {}) {
  if (!cfg?.serverUrl) return;
  const isNew = p === NEWTAB;
  const view = new WebContentsView({
    webPreferences: { partition: PARTITION, preload: isNew ? path.join(__dirname, "preload-ntp.js") : undefined, contextIsolation: true, sandbox: true, nodeIntegration: false, devTools: !app.isPackaged && !isNew, spellcheck: false },
  });
  const id = nextId++;
  const tab = { id, view, kind: isNew ? "newtab" : "app", title: isNew ? "New tab" : (MODULES.find((m) => m[1] === p) || [p])[0], path: isNew ? "" : p };
  if (opts.after != null) { const i = tabs.findIndex((t) => t.id === opts.after); tabs.splice(i + 1, 0, tab); } else tabs.push(tab);
  win.contentView.addChildView(view);
  const wc = view.webContents;
  wireTab(tab);
  if (isNew) wc.loadFile(path.join(__dirname, "newtab.html")); else wc.loadURL(origin() + p);
  activate(id);
  return id;
}

function wireTab(tab) {
  const wc = tab.view.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (isInternal(url)) { const u = new URL(url); setImmediate(() => addTab(u.pathname + u.search, { after: tab.id })); } else openExternalSafe(url);
    return { action: "deny" };
  });
  wc.on("will-navigate", (e, url) => { if (tab.kind === "app" && !isInternal(url)) { e.preventDefault(); openExternalSafe(url); } });
  wc.on("page-title-updated", (e, title) => {
    e.preventDefault();
    if (tab.kind !== "app") return;
    tab.title = title.replace(/\s*[·|-]\s*(The )?Tax Doctor.*$/i, "").trim() || tab.title;
    if (/^\/customers\/\d+/.test(tab.path)) addRecent({ title: tab.title, path: tab.path.split("?")[0] });
    pushTabs();
  });
  wc.on("did-navigate-in-page", (e, url) => {
    try { const u = new URL(url); tab.path = u.pathname; const m = MODULES.find((x) => x[1] === u.pathname); if (m) tab.title = m[0]; pushTabs(); } catch {}
  });
  wc.on("before-input-event", (e, input) => {
    resetIdle();
    if (input.type !== "keyDown") return;
    const ctrl = input.control || input.meta;
    const k = input.key.toLowerCase();
    if (app.isPackaged && ((ctrl && input.shift && (k === "i" || k === "j")) || input.key === "F12")) e.preventDefault();
    if (ctrl && k === "w") { e.preventDefault(); closeTab(tab.id); }
    if (ctrl && k === "t") { e.preventDefault(); addTab(NEWTAB); }
    if (ctrl && /^[1-9]$/.test(input.key)) { e.preventDefault(); const t = tabs[Number(input.key) - 1]; if (t) activate(t.id); }
    if (ctrl && input.key === "Tab") { e.preventDefault(); const i = tabs.findIndex((x) => x.id === active); activate(tabs[(i + (input.shift ? tabs.length - 1 : 1)) % tabs.length].id); }
  });
  wc.on("did-fail-load", (e, code, desc, url, isMain) => {
    if (isMain && code !== -3 && tab.kind === "app") wc.loadFile(path.join(__dirname, "setup.html"), { query: { error: desc, server: cfg.serverUrl } });
  });
}

function activate(id) {
  active = id; layout(); pushTabs();
  const t = tabs.find((x) => x.id === id);
  if (t) t.view.webContents.focus();
  resetIdle();
}
function closeTab(id) {
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  const [t] = tabs.splice(i, 1);
  win.contentView.removeChildView(t.view);
  t.view.webContents.close();
  if (!tabs.length) return addTab(NEWTAB);
  if (active === id) active = tabs[Math.min(i, tabs.length - 1)].id;
  layout(); pushTabs();
}
function popupModules() {
  Menu.buildFromTemplate(MODULES.map(([label, p]) => ({ label, click: () => addTab(p) }))).popup({ window: undefined });
}

function createWindow() {
  win = new BaseWindow({ width: 1480, height: 920, minWidth: 1000, minHeight: 620, backgroundColor: "#0b0b0d", title: "Tax Doctor Team", icon: path.join(__dirname, "build/icon.png") });
  if (cfg.protectScreen !== false) win.setContentProtection(true); // blocks screenshots / screen recording of this window
  Menu.setApplicationMenu(null);

  const shellPrefs = { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, devTools: !app.isPackaged };
  shellView = new WebContentsView({ webPreferences: shellPrefs });
  win.contentView.addChildView(shellView);
  shellView.webContents.loadFile(path.join(__dirname, "shell.html"));
  lockView = new WebContentsView({ webPreferences: { ...shellPrefs, devTools: false } });
  win.contentView.addChildView(lockView);
  lockView.webContents.loadFile(path.join(__dirname, "lock.html"));

  win.on("resize", layout);
  win.on("closed", () => app.quit());
  win.on("focus", resetIdle);
  shellView.webContents.on("did-finish-load", () => { layout(); pushTabs(); });
  shellView.webContents.setWindowOpenHandler(({ url }) => { openExternalSafe(url); return { action: "deny" }; });
  lockView.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
}

// ---- IPC from shell (tab strip) ----
ipcMain.on("new-tab", (_e, p) => { if (p === NEWTAB || (typeof p === "string" && p.startsWith("/"))) addTab(p); });
ipcMain.on("popup-modules", popupModules);
ipcMain.on("activate", (_e, id) => activate(id));
ipcMain.on("close", (_e, id) => closeTab(id));
ipcMain.on("lock", lockNow);
ipcMain.on("unlock", unlock);
ipcMain.on("set-layout", (_e, mode) => { cfg.tabLayout = mode === "left" ? "left" : "top"; saveCfg(); layout(); pushTabs(); });
ipcMain.on("reorder", (_e, from, to) => {
  const a = tabs.findIndex((t) => t.id === from), b = tabs.findIndex((t) => t.id === to);
  if (a < 0 || b < 0 || a === b) return;
  const [t] = tabs.splice(a, 1); tabs.splice(b, 0, t); pushTabs();
});
ipcMain.on("tab-menu", (_e, id) => {
  const t = tabs.find((x) => x.id === id);
  if (!t) return;
  Menu.buildFromTemplate([
    { label: "Duplicate tab", enabled: t.kind === "app", click: () => addTab(t.path || "/", { after: id }) },
    { label: "New tab to the right", click: () => addTab(NEWTAB, { after: id }) },
    { type: "separator" },
    { label: "Tabs on the " + (layoutMode() === "left" ? "top" : "left side"), click: () => { cfg.tabLayout = layoutMode() === "left" ? "top" : "left"; saveCfg(); layout(); pushTabs(); } },
    { type: "separator" },
    { label: "Close other tabs", click: () => tabs.filter((x) => x.id !== id).forEach((x) => closeTab(x.id)) },
    { label: "Close tab", click: () => closeTab(id) },
  ]).popup({ window: undefined });
});
ipcMain.on("change-server", async () => {
  const r = await dialog.showMessageBox(win, { type: "question", buttons: ["Cancel", "Reset server address"], defaultId: 0, cancelId: 0, message: "Change the server address?", detail: "You will be asked for the new address next time the app starts." });
  if (r.response === 1) { delete cfg.serverUrl; saveCfg(); app.relaunch(); app.quit(); }
});
ipcMain.handle("save-server", (_e, url) => {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return { ok: false, error: "Use an http:// or https:// address" };
    if (u.protocol === "http:" && !/^(localhost|127\.0\.0\.1|192\.168\.|10\.)/.test(u.hostname)) return { ok: false, error: "Use https:// for any address outside your local network" };
    cfg.serverUrl = u.origin; saveCfg();
    return { ok: true };
  } catch { return { ok: false, error: "That does not look like a web address" }; }
});
ipcMain.on("setup-done", () => {
  if (setupView) { win.contentView.removeChildView(setupView); setupView.webContents.close(); setupView = null; }
  addTab("/");
});

// ---- IPC from the New Tab page ----
const fromNewTab = (e) => { try { return e.senderFrame.url.startsWith("file:") && e.senderFrame.url.endsWith("newtab.html"); } catch { return false; } };
ipcMain.handle("ntp-init", (e) => (fromNewTab(e) ? { modules: MODULES, recent: cfg.recent || [], server: cfg.serverUrl } : null));
ipcMain.handle("ntp-search", async (e, q) => {
  if (!fromNewTab(e) || typeof q !== "string" || q.length < 2) return { customers: [], tasks: [] };
  try {
    const r = await session.fromPartition(PARTITION).fetch(origin() + "/api/search?q=" + encodeURIComponent(q.slice(0, 80)), { credentials: "include" });
    if (r.status === 401) return { needLogin: true, customers: [], tasks: [] };
    return await r.json();
  } catch { return { error: true, customers: [], tasks: [] }; }
});
ipcMain.on("ntp-go", (e, p) => {
  if (!fromNewTab(e) || typeof p !== "string" || !p.startsWith("/")) return;
  const tab = tabs.find((t) => t.view.webContents === e.sender);
  if (!tab) return;
  // turn this tab into a normal app tab pointing at the chosen place; wire it for app behaviour
  tab.kind = "app"; tab.path = p; tab.title = (MODULES.find((m) => m[1] === p) || ["Loading..."])[0];
  tab.view.webContents.loadURL(origin() + p);
  pushTabs();
});

app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
  cfg = readCfg();
  session.fromPartition(PARTITION).setPermissionRequestHandler((wc, permission, cb) => cb(["notifications", "clipboard-sanitized-write", "media"].includes(permission)));
  app.on("web-contents-created", (_e, wc) => wc.on("will-attach-webview", (ev) => ev.preventDefault()));
  createWindow();
  if (!cfg.serverUrl) {
    // first run after installing: connect to the firm's server
    setupView = new WebContentsView({ webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, devTools: false } });
    win.contentView.addChildView(setupView);
    setupView.webContents.loadFile(path.join(__dirname, "setup.html"));
    layout();
  } else addTab("/");
});
app.on("window-all-closed", () => app.quit());
