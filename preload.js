const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("backupAPI", {
  saveNote: (data) => ipcRenderer.invoke("save-note", data),
  loadAutosave: () => ipcRenderer.invoke("load-autosave"),
  getHistory: (ticketId) => ipcRenderer.invoke("get-history", ticketId),
  getAllTickets: () => ipcRenderer.invoke("get-all-tickets"),
  deleteAutosave: (ticketId) => ipcRenderer.invoke("delete-autosave", ticketId),
  deleteTicket: (ticketId) => ipcRenderer.invoke("delete-ticket", ticketId),
  openBackupFolder: () => ipcRenderer.invoke("open-backup-folder"),
  saveTabs: (tabUrls) => ipcRenderer.invoke("save-tabs", tabUrls),
  loadTabs: () => ipcRenderer.invoke("load-tabs"),
  onOpenInNewTab: (callback) =>
    ipcRenderer.on("open-in-new-tab", (event, url) => callback(url)),
  onWebviewClose: (callback) =>
    ipcRenderer.on("webview-close", (event, webContentsId) =>
      callback(webContentsId),
    ),
  openInBrowser: (url) => ipcRenderer.invoke("open-in-browser", url),
  loadSettings: () => ipcRenderer.invoke("load-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),
  onOpenSettings: (callback) =>
    ipcRenderer.on("open-settings", () => callback()),
  onSettingsChanged: (callback) =>
    ipcRenderer.on("settings-changed", (event, settings) => callback(settings)),
});
