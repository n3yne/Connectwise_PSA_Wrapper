const electron = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let BACKUP_DIR;
let AUTOSAVE_FILE;
let TABS_FILE;

const CLEANUP_MAX_AGE_DAYS = 7;

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

// ===================== Auto-Cleanup Old Backups =====================

function cleanupOldBackups() {
  try {
    ensureBackupDir();
    const maxAgeMs = CLEANUP_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - maxAgeMs;
    let deletedFiles = 0;
    let deletedDirs = 0;
    let prunedAutosaves = 0;

    // 1. Scan all ticket history folders and delete old snapshot files
    const entries = fs.readdirSync(BACKUP_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const ticketDir = path.join(BACKUP_DIR, entry.name);
      const files = fs.readdirSync(ticketDir);

      for (const file of files) {
        if (!file.endsWith('.html') && !file.endsWith('.txt')) continue;

        const filePath = path.join(ticketDir, file);
        try {
          const stat = fs.statSync(filePath);
          if (stat.mtimeMs < cutoff) {
            fs.unlinkSync(filePath);
            deletedFiles++;
          }
        } catch (e) {
          // Skip files we can't stat/delete
        }
      }

      // 2. Remove the ticket folder if it's now empty
      const remaining = fs.readdirSync(ticketDir);
      if (remaining.length === 0) {
        fs.rmdirSync(ticketDir);
        deletedDirs++;
      }
    }

    // 3. Prune stale autosave entries (old + no remaining history folder)
    if (fs.existsSync(AUTOSAVE_FILE)) {
      try {
        const data = JSON.parse(fs.readFileSync(AUTOSAVE_FILE, 'utf-8'));
        let changed = false;

        for (const [ticketId, info] of Object.entries(data)) {
          const updatedAt = new Date(info.updatedAt || 0).getTime();
          if (updatedAt >= cutoff) continue; // Still fresh, keep it

          const historyDir = path.join(BACKUP_DIR, ticketId);
          const hasHistory = fs.existsSync(historyDir) &&
            fs.readdirSync(historyDir).some(f => f.endsWith('.html') || f.endsWith('.txt'));

          if (!hasHistory) {
            delete data[ticketId];
            prunedAutosaves++;
            changed = true;
          }
        }

        if (changed) {
          fs.writeFileSync(AUTOSAVE_FILE, JSON.stringify(data, null, 2), 'utf-8');
        }
      } catch (e) {
        // Ignore autosave parse errors during cleanup
      }
    }

    if (deletedFiles > 0 || deletedDirs > 0 || prunedAutosaves > 0) {
      console.log(`[Cleanup] Removed ${deletedFiles} old snapshot(s), ${deletedDirs} empty folder(s), ${prunedAutosaves} stale autosave(s) (older than ${CLEANUP_MAX_AGE_DAYS} days)`);
    } else {
      console.log(`[Cleanup] Nothing to clean up (all backups are within ${CLEANUP_MAX_AGE_DAYS} days)`);
    }
  } catch (err) {
    console.error('[Cleanup] Error during auto-cleanup:', err);
  }
}

function createWindow() {
  ensureBackupDir();

    mainWindow = new electron.BrowserWindow({
    width: 1600,
    height: 1000,
    title: 'ConnectWise Manage++',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });

  mainWindow.loadFile('index.html');

    // Open external links in the default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    electron.shell.openExternal(url);
    return { action: 'deny' };
  });

  // Intercept new-window requests from webview guest pages and redirect to tabs
  mainWindow.webContents.on('did-attach-webview', (event, webviewContents) => {
    webviewContents.setWindowOpenHandler(({ url }) => {
      // Send the URL to the renderer so it can open a new tab
      mainWindow.webContents.send('open-in-new-tab', url);
      return { action: 'deny' };
    });
  });
}

function registerIpcHandlers() {
  // Save a single note entry (autosave or manual)
  electron.ipcMain.handle('save-note', async (event, { ticketId, noteContent, isManual }) => {
    ensureBackupDir();

    const timestamp = new Date().toISOString();
    const safeTicketId = (ticketId || 'no-ticket').replace(/[^a-zA-Z0-9_-]/g, '_');

    // Always update the autosave file (latest state of all drafts)
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

        // On manual save, also write a timestamped history file (HTML format)
    if (isManual) {
      const historyDir = path.join(BACKUP_DIR, safeTicketId);
      if (!fs.existsSync(historyDir)) {
        fs.mkdirSync(historyDir, { recursive: true });
      }
      const safeTimestamp = timestamp.replace(/[:.]/g, '-');
      const historyFile = path.join(historyDir, `${safeTimestamp}.html`);
      fs.writeFileSync(historyFile, noteContent, 'utf-8');
    }

    return { success: true, timestamp };
  });

  // Load autosaved drafts
  electron.ipcMain.handle('load-autosave', async () => {
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
  electron.ipcMain.handle('get-history', async (event, ticketId) => {
    ensureBackupDir();
    const safeTicketId = (ticketId || 'no-ticket').replace(/[^a-zA-Z0-9_-]/g, '_');
    const historyDir = path.join(BACKUP_DIR, safeTicketId);

    if (!fs.existsSync(historyDir)) return [];

        const files = fs.readdirSync(historyDir)
      .filter(f => f.endsWith('.html') || f.endsWith('.txt'))
      .sort()
      .reverse();

    return files.map(f => {
      const content = fs.readFileSync(path.join(historyDir, f), 'utf-8');
      return { filename: f, content };
    });
  });

  // Get list of all tickets that have backups
  electron.ipcMain.handle('get-all-tickets', async () => {
    ensureBackupDir();

    const entries = [];
    if (fs.existsSync(AUTOSAVE_FILE)) {
      try {
        const data = JSON.parse(fs.readFileSync(AUTOSAVE_FILE, 'utf-8'));
        for (const [ticketId, info] of Object.entries(data)) {
          entries.push({ ticketId, updatedAt: info.updatedAt, source: 'autosave' });
        }
      } catch (e) { /* ignore */ }
    }
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
  electron.ipcMain.handle('delete-autosave', async (event, ticketId) => {
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

  // Delete ALL data for a ticket (autosave entry + history folder)
  electron.ipcMain.handle('delete-ticket', async (event, ticketId) => {
    const safeTicketId = (ticketId || 'no-ticket').replace(/[^a-zA-Z0-9_-]/g, '_');

    // Remove from autosave.json
    if (fs.existsSync(AUTOSAVE_FILE)) {
      try {
        const data = JSON.parse(fs.readFileSync(AUTOSAVE_FILE, 'utf-8'));
        delete data[safeTicketId];
        fs.writeFileSync(AUTOSAVE_FILE, JSON.stringify(data, null, 2), 'utf-8');
      } catch (e) { /* ignore */ }
    }

    // Remove the history folder
    const historyDir = path.join(BACKUP_DIR, safeTicketId);
    if (fs.existsSync(historyDir)) {
      fs.rmSync(historyDir, { recursive: true, force: true });
    }

    return { success: true };
  });

    // Open backup folder in file explorer
  electron.ipcMain.handle('open-backup-folder', async () => {
    ensureBackupDir();
    electron.shell.openPath(BACKUP_DIR);
    return { success: true };
  });

  // Save open tab URLs to disk
  electron.ipcMain.handle('save-tabs', async (event, tabUrls) => {
    ensureBackupDir();
    try {
      fs.writeFileSync(TABS_FILE, JSON.stringify(tabUrls, null, 2), 'utf-8');
      return { success: true };
    } catch (e) {
      console.error('[Tabs] Error saving tabs:', e);
      return { success: false };
    }
  });

  // Load saved tab URLs from disk
  electron.ipcMain.handle('load-tabs', async () => {
    if (fs.existsSync(TABS_FILE)) {
      try {
        return JSON.parse(fs.readFileSync(TABS_FILE, 'utf-8'));
      } catch (e) {
        return [];
      }
    }
    return [];
  });
}

// ===================== App Lifecycle =====================

electron.app.whenReady().then(() => {
  // Initialize paths now that app is ready
    BACKUP_DIR = path.join(electron.app.getPath('userData'), 'note-backups');
  AUTOSAVE_FILE = path.join(BACKUP_DIR, 'autosave.json');
  TABS_FILE = path.join(BACKUP_DIR, 'open-tabs.json');

  // Set a realistic user agent so ConnectWise doesn't block Electron
  electron.session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    callback({ requestHeaders: details.requestHeaders });
  });

    // Clean up old backups on startup
  cleanupOldBackups();

  // Register all IPC handlers
  registerIpcHandlers();

  // Create the window
  createWindow();

  electron.app.on('activate', () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

electron.app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') electron.app.quit();
});
