const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('backupAPI', {
  saveNote: (data) => ipcRenderer.invoke('save-note', data),
  loadAutosave: () => ipcRenderer.invoke('load-autosave'),
  getHistory: (ticketId) => ipcRenderer.invoke('get-history', ticketId),
  getAllTickets: () => ipcRenderer.invoke('get-all-tickets'),
  deleteAutosave: (ticketId) => ipcRenderer.invoke('delete-autosave', ticketId),
  openBackupFolder: () => ipcRenderer.invoke('open-backup-folder')
});
