const { app, BrowserWindow, ipcMain, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');

// --- Paths ---
const BACKUP_DIR = path.join(app.getPath('userData'), 'note-backups');
const AUTOSAVE_FILE = path.join(BACKUP_DIR, 'autosave.json');

// Ensure backup directory exists
function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

let mainWindow;

function createWindow() {
  ensureBackupDir();

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    title: 'ConnectWise Backup',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });

  // Remove default menu for a cleaner look (optional: comment out to keep dev tools easily accessible)
  // mainWindow.setMenu(null);

  mainWindow.loadFile('index.html');

  // Open external links in the default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ===================== IPC Handlers =====================

// Save a single note entry (autosave or manual)
ipcMain.handle('save-note', async (event, { ticketId, noteContent, isManual }) => {
  ensureBackupDir();

  const timestamp = new Date().toISOString();
  const safeTicketId = (ticketId || 'no-ticket').replace(/[^a-zA-Z0-9_-]/g, '_');

  // --- Always update the autosave file (latest state of all drafts) ---
  let autosaveData = {};
  if (fs.existsSync(AUTOSAVE_FILE)) {
    try {
      autosaveData = JSON.parse(fs.readFileSync(AUTOSAVE_FILE, 'utf-8'));
    } catch (e) {
      autosaveData = {};
    }
  }
  autosaveData[safeTicketId] = {
    content: noteContent,
    updatedAt: timestamp
  };
  fs.writeFileSync(AUTOSAVE_FILE, JSON.stringify(autosaveData, null, 2), 'utf-8');

  // --- On manual save, also write a timestamped history file ---
  if (isManual) {
    const historyDir = path.join(BACKUP_DIR, safeTicketId);
    if (!fs.existsSync(historyDir)) {
      fs.mkdirSync(historyDir, { recursive: true });
    }
    const safeTimestamp = timestamp.replace(/[:.]/g, '-');
    const historyFile = path.join(historyDir, `${safeTimestamp}.txt`);
    const fileContent = `Ticket: ${ticketId}\nSaved: ${timestamp}\n${'='.repeat(50)}\n\n${noteContent}`;
    fs.writeFileSync(historyFile, fileContent, 'utf-8');
  }

  return { success: true, timestamp };
});

// Load autosaved drafts
ipcMain.handle('load-autosave', async () => {
  ensureBackupDir();
  if (fs.existsSync(AUTOSAVE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(AUTOSAVE_FILE, 'utf-8'));
    } catch (e) {
      return {};
    }
  }
  return {};
});

// Get history for a specific ticket
ipcMain.handle('get-history', async (event, ticketId) => {
  ensureBackupDir();
  const safeTicketId = (ticketId || 'no-ticket').replace(/[^a-zA-Z0-9_-]/g, '_');
  const historyDir = path.join(BACKUP_DIR, safeTicketId);

  if (!fs.existsSync(historyDir)) return [];

  const files = fs.readdirSync(historyDir)
    .filter(f => f.endsWith('.txt'))
    .sort()
    .reverse(); // newest first

  return files.map(f => {
    const content = fs.readFileSync(path.join(historyDir, f), 'utf-8');
    return { filename: f, content };
  });
});

// Get list of all tickets that have backups
ipcMain.handle('get-all-tickets', async () => {
  ensureBackupDir();

  const entries = [];
  // From autosave
  if (fs.existsSync(AUTOSAVE_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(AUTOSAVE_FILE, 'utf-8'));
      for (const [ticketId, info] of Object.entries(data)) {
        entries.push({ ticketId, updatedAt: info.updatedAt, source: 'autosave' });
      }
    } catch (e) { /* ignore */ }
  }
  // From history directories
  const dirs = fs.readdirSync(BACKUP_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const dir of dirs) {
    if (!entries.find(e => e.ticketId === dir)) {
      entries.push({ ticketId: dir, source: 'history' });
    }
  }

  return entries;
});

// Delete autosave entry for a ticket
ipcMain.handle('delete-autosave', async (event, ticketId) => {
  const safeTicketId = (ticketId || 'no-ticket').replace(/[^a-zA-Z0-9_-]/g, '_');
  if (fs.existsSync(AUTOSAVE_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(AUTOSAVE_FILE, 'utf-8'));
      delete data[safeTicketId];
      fs.writeFileSync(AUTOSAVE_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) { /* ignore */ }
  }
  return { success: true };
});

// Open backup folder in file explorer
ipcMain.handle('open-backup-folder', async () => {
  ensureBackupDir();
  shell.openPath(BACKUP_DIR);
  return { success: true };
});

// ===================== App Lifecycle =====================

app.whenReady().then(() => {
  // Set a realistic user agent so ConnectWise doesn't block Electron
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    callback({ requestHeaders: details.requestHeaders });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
