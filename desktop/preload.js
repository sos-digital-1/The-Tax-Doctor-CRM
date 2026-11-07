const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("td", {
  onTabs: (cb) => ipcRenderer.on("tabs", (_e, s) => cb(s)),
  newTab: (p) => ipcRenderer.send("new-tab", p),
  popupModules: () => ipcRenderer.send("popup-modules"),
  activate: (id) => ipcRenderer.send("activate", id),
  close: (id) => ipcRenderer.send("close", id),
  reorder: (from, to) => ipcRenderer.send("reorder", from, to),
  tabMenu: (id) => ipcRenderer.send("tab-menu", id),
  setLayout: (mode) => ipcRenderer.send("set-layout", mode),
  lock: () => ipcRenderer.send("lock"),
  unlock: () => ipcRenderer.send("unlock"),
  changeServer: () => ipcRenderer.send("change-server"),
  saveServer: (url) => ipcRenderer.invoke("save-server", url),
  setupDone: () => ipcRenderer.send("setup-done"),
});
