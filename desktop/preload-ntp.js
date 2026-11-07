// Only what the New Tab page needs. Every handler in main.js also checks the sender is newtab.html.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("ntp", {
  init: () => ipcRenderer.invoke("ntp-init"),
  search: (q) => ipcRenderer.invoke("ntp-search", q),
  go: (p) => ipcRenderer.send("ntp-go", p),
});
