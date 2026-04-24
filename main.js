const electron = require("electron");
const path = require("path");
const fs = require("fs");

let mainWindow;
let BACKUP_DIR;
let AUTOSAVE_FILE;
let TABS_FILE;
let SETTINGS_FILE;

// Default settings — new settings get added here with their defaults
const DEFAULT_SETTINGS = {
  notePanelEnabled: true,
  backupRetentionDays: 7, // 0 = keep forever
  signatureHtml: "", // Rich text signature block
  ticketSortField: "lastUpdated", // 'lastUpdated' or 'ticketNumber'
  ticketSortDirection: "desc", // 'asc' or 'desc'
};

// ===================== Settings Persistence =====================

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
      // Merge with defaults so new settings always have a value
      return Object.assign({}, DEFAULT_SETTINGS, data);
    }
  } catch (e) {
    console.error("[Settings] Error loading settings:", e);
  }
  return Object.assign({}, DEFAULT_SETTINGS);
}

function saveSettings(settings) {
  try {
    ensureBackupDir();
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
  } catch (e) {
    console.error("[Settings] Error saving settings:", e);
  }
}

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

// Shared ticket ID sanitization — must be used consistently everywhere
function sanitizeTicketId(raw) {
  return (raw || "no-ticket").replace(/[^a-zA-Z0-9_-]/g, "_");
}

// ===================== Auto-Cleanup Old Backups =====================

function cleanupOldBackups() {
  try {
    ensureBackupDir();
    const settings = loadSettings();
    const retentionDays = settings.backupRetentionDays;

    // 0 = keep forever, skip cleanup entirely
    if (retentionDays === 0) {
      console.log(
        "[Cleanup] Retention set to 0 (keep forever) — skipping cleanup",
      );
      return;
    }

    const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;
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
        if (!file.endsWith(".html") && !file.endsWith(".txt")) continue;

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
        const data = JSON.parse(fs.readFileSync(AUTOSAVE_FILE, "utf-8"));
        let changed = false;

        for (const [ticketId, info] of Object.entries(data)) {
          const updatedAt = new Date(info.updatedAt || 0).getTime();
          if (updatedAt >= cutoff) continue; // Still fresh, keep it

          const historyDir = path.join(BACKUP_DIR, ticketId);
          const hasHistory =
            fs.existsSync(historyDir) &&
            fs
              .readdirSync(historyDir)
              .some((f) => f.endsWith(".html") || f.endsWith(".txt"));

          if (!hasHistory) {
            delete data[ticketId];
            prunedAutosaves++;
            changed = true;
          }
        }

        if (changed) {
          fs.writeFileSync(
            AUTOSAVE_FILE,
            JSON.stringify(data, null, 2),
            "utf-8",
          );
        }
      } catch (e) {
        // Ignore autosave parse errors during cleanup
      }
    }

    if (deletedFiles > 0 || deletedDirs > 0 || prunedAutosaves > 0) {
      console.log(
        `[Cleanup] Removed ${deletedFiles} old snapshot(s), ${deletedDirs} empty folder(s), ${prunedAutosaves} stale autosave(s) (older than ${retentionDays} days)`,
      );
    } else {
      console.log(
        `[Cleanup] Nothing to clean up (all backups are within ${retentionDays} days)`,
      );
    }
  } catch (err) {
    console.error("[Cleanup] Error during auto-cleanup:", err);
  }
}

function createWindow() {
  ensureBackupDir();

  mainWindow = new electron.BrowserWindow({
    width: 1600,
    height: 1000,
    title: "ConnectWise Manage++",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      spellcheck: true,
    },
  });

  mainWindow.loadFile("index.html");

  // ===================== Application Menu =====================
  const menuTemplate = [
    {
      label: "File",
      submenu: [{ role: "quit" }],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
        { type: "separator" },
        {
          label: "Settings",
          accelerator: "CmdOrCtrl+,",
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send("open-settings");
            }
          },
        },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "close" }],
    },
  ];

  const menu = electron.Menu.buildFromTemplate(menuTemplate);
  electron.Menu.setApplicationMenu(menu);

  // ===================== Renderer Context Menu (notes editor, inputs) =====================
  mainWindow.webContents.on("context-menu", (event, params) => {
    const menuItems = [];

    // Spellcheck suggestions (if any)
    if (params.misspelledWord && params.dictionarySuggestions.length > 0) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        menuItems.push(
          new electron.MenuItem({
            label: suggestion,
            click: () => mainWindow.webContents.replaceMisspelling(suggestion),
          }),
        );
      }
      menuItems.push(new electron.MenuItem({ type: "separator" }));
    }

    // Add misspelled word to dictionary
    if (params.misspelledWord) {
      menuItems.push(
        new electron.MenuItem({
          label: `Add "${params.misspelledWord}" to Dictionary`,
          click: () =>
            mainWindow.webContents.session.addWordToSpellCheckerDictionary(
              params.misspelledWord,
            ),
        }),
      );
      menuItems.push(new electron.MenuItem({ type: "separator" }));
    }

    // Standard editing actions
    if (params.isEditable) {
      menuItems.push(new electron.MenuItem({ role: "undo" }));
      menuItems.push(new electron.MenuItem({ role: "redo" }));
      menuItems.push(new electron.MenuItem({ type: "separator" }));
      menuItems.push(new electron.MenuItem({ role: "cut" }));
      menuItems.push(new electron.MenuItem({ role: "copy" }));
      menuItems.push(new electron.MenuItem({ role: "paste" }));
      menuItems.push(new electron.MenuItem({ type: "separator" }));
      menuItems.push(new electron.MenuItem({ role: "selectAll" }));
    } else if (params.selectionText) {
      // Non-editable area but text is selected — offer copy
      menuItems.push(new electron.MenuItem({ role: "copy" }));
    }

    if (menuItems.length > 0) {
      const contextMenu = electron.Menu.buildFromTemplate(menuItems);
      contextMenu.popup();
    }
  });

  // Open external links in the default browser (only http/https)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        electron.shell.openExternal(url);
      }
    } catch (e) {
      // Ignore invalid URLs
    }
    return { action: "deny" };
  });

  // Intercept new-window requests from webview guest pages and redirect to tabs
  mainWindow.webContents.on("did-attach-webview", (event, webviewContents) => {
    webviewContents.setWindowOpenHandler(({ url }) => {
      // Send the URL to the renderer so it can open a new tab
      mainWindow.webContents.send("open-in-new-tab", url);
      return { action: "deny" };
    });

    // Right-click context menu inside webviews (links, text selection, etc.)
    webviewContents.on("context-menu", (event, params) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;

      // Build context data for the renderer
      const contextData = {
        x: params.x,
        y: params.y,
        linkURL: params.linkURL || "",
        selectionText: params.selectionText || "",
        mediaType: params.mediaType || "",
        srcURL: params.srcURL || "",
      };

      // Only send if there's something actionable to show
      if (contextData.linkURL || contextData.selectionText) {
        mainWindow.webContents.send("webview-context-menu", contextData);
      }
    });

    // Handle guest page beforeunload dialogs (e.g. unsaved form changes)
    webviewContents.on("will-prevent-unload", (e) => {
      // Show a confirmation dialog instead of silently suppressing
      const choice = electron.dialog.showMessageBoxSync(mainWindow, {
        type: "question",
        buttons: ["Leave Page", "Stay"],
        title: "Leave this page?",
        message: "Changes you made may not be saved.",
        defaultId: 1,
        cancelId: 1,
      });
      if (choice === 0) {
        e.preventDefault(); // Allow the navigation/close to proceed
      }
      // If choice === 1 (Stay), do nothing — the unload is already prevented
    });

    webviewContents.on("destroyed", () => {
      // When guest webContents is destroyed, notify renderer to close the tab
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("webview-close", webviewContents.id);
      }
    });
  });
}

function registerIpcHandlers() {
  // Save a single note entry (autosave or manual)
  electron.ipcMain.handle(
    "save-note",
    async (event, { ticketId, noteContent, isManual }) => {
      ensureBackupDir();

      const timestamp = new Date().toISOString();
      const safeTicketId = sanitizeTicketId(ticketId);

      // Always update the autosave file (latest state of all drafts)
      let autosaveData = {};
      if (fs.existsSync(AUTOSAVE_FILE)) {
        try {
          autosaveData = JSON.parse(fs.readFileSync(AUTOSAVE_FILE, "utf-8"));
        } catch (e) {
          autosaveData = {};
        }
      }
      autosaveData[safeTicketId] = {
        content: noteContent,
        updatedAt: timestamp,
      };
      fs.writeFileSync(
        AUTOSAVE_FILE,
        JSON.stringify(autosaveData, null, 2),
        "utf-8",
      );

      // On manual save, also write a timestamped history file (HTML format)
      if (isManual) {
        const historyDir = path.join(BACKUP_DIR, safeTicketId);
        if (!fs.existsSync(historyDir)) {
          fs.mkdirSync(historyDir, { recursive: true });
        }
        const safeTimestamp = timestamp.replace(/[:.]/g, "-");
        const historyFile = path.join(historyDir, `${safeTimestamp}.html`);
        fs.writeFileSync(historyFile, noteContent, "utf-8");
      }

      return { success: true, timestamp };
    },
  );

  // Load autosaved drafts
  electron.ipcMain.handle("load-autosave", async () => {
    ensureBackupDir();
    if (fs.existsSync(AUTOSAVE_FILE)) {
      try {
        return JSON.parse(fs.readFileSync(AUTOSAVE_FILE, "utf-8"));
      } catch (e) {
        return {};
      }
    }
    return {};
  });

  // Get history for a specific ticket
  electron.ipcMain.handle("get-history", async (event, ticketId) => {
    ensureBackupDir();
    const safeTicketId = sanitizeTicketId(ticketId);
    const historyDir = path.join(BACKUP_DIR, safeTicketId);

    if (!fs.existsSync(historyDir)) return [];

    const files = fs
      .readdirSync(historyDir)
      .filter((f) => f.endsWith(".html") || f.endsWith(".txt"))
      .sort()
      .reverse();

    return files.map((f) => {
      const content = fs.readFileSync(path.join(historyDir, f), "utf-8");
      return { filename: f, content };
    });
  });

  // Get list of all tickets that have backups
  electron.ipcMain.handle("get-all-tickets", async () => {
    ensureBackupDir();

    const entries = [];
    const seen = new Set();
    if (fs.existsSync(AUTOSAVE_FILE)) {
      try {
        const data = JSON.parse(fs.readFileSync(AUTOSAVE_FILE, "utf-8"));
        for (const [ticketId, info] of Object.entries(data)) {
          // Sanitize to match the IDs used by save/load/delete handlers
          const safeId = sanitizeTicketId(ticketId);
          if (seen.has(safeId)) continue;
          seen.add(safeId);
          entries.push({
            ticketId: safeId,
            updatedAt: info.updatedAt,
            source: "autosave",
          });
        }
      } catch (e) {
        /* ignore */
      }
    }
    const dirs = fs
      .readdirSync(BACKUP_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const dir of dirs) {
      const safeDir = sanitizeTicketId(dir);
      if (!seen.has(safeDir)) {
        seen.add(safeDir);
        entries.push({ ticketId: safeDir, source: "history" });
      }
    }

    return entries;
  });

  // Delete autosave entry for a ticket
  electron.ipcMain.handle("delete-autosave", async (event, ticketId) => {
    const safeTicketId = sanitizeTicketId(ticketId);
    if (fs.existsSync(AUTOSAVE_FILE)) {
      try {
        const data = JSON.parse(fs.readFileSync(AUTOSAVE_FILE, "utf-8"));
        delete data[safeTicketId];
        fs.writeFileSync(AUTOSAVE_FILE, JSON.stringify(data, null, 2), "utf-8");
      } catch (e) {
        /* ignore */
      }
    }
    return { success: true };
  });

  // Delete ALL data for a ticket (autosave entry + history folder)
  electron.ipcMain.handle("delete-ticket", async (event, ticketId) => {
    const safeTicketId = sanitizeTicketId(ticketId);

    // Remove from autosave.json
    if (fs.existsSync(AUTOSAVE_FILE)) {
      try {
        const data = JSON.parse(fs.readFileSync(AUTOSAVE_FILE, "utf-8"));
        delete data[safeTicketId];
        fs.writeFileSync(AUTOSAVE_FILE, JSON.stringify(data, null, 2), "utf-8");
      } catch (e) {
        /* ignore */
      }
    }

    // Remove the history folder
    const historyDir = path.join(BACKUP_DIR, safeTicketId);
    if (fs.existsSync(historyDir)) {
      fs.rmSync(historyDir, { recursive: true, force: true });
    }

    return { success: true };
  });

  // Open backup folder in file explorer
  electron.ipcMain.handle("open-backup-folder", async () => {
    ensureBackupDir();
    electron.shell.openPath(BACKUP_DIR);
    return { success: true };
  });

  // Save open tab URLs to disk (async, returns result)
  electron.ipcMain.handle("save-tabs", async (event, tabUrls) => {
    ensureBackupDir();
    try {
      fs.writeFileSync(TABS_FILE, JSON.stringify(tabUrls, null, 2), "utf-8");
      return { success: true };
    } catch (e) {
      console.error("[Tabs] Error saving tabs:", e);
      return { success: false };
    }
  });

  // Save open tab URLs to disk (fire-and-forget, for beforeunload)
  electron.ipcMain.on("save-tabs-sync", (event, tabUrls) => {
    ensureBackupDir();
    try {
      fs.writeFileSync(TABS_FILE, JSON.stringify(tabUrls, null, 2), "utf-8");
    } catch (e) {
      console.error("[Tabs] Error saving tabs (sync):", e);
    }
  });

  // Open a URL in the user's default browser
  electron.ipcMain.handle("open-in-browser", async (event, url) => {
    if (url && typeof url === "string") {
      // Only allow http/https URLs to prevent opening file:// or other schemes
      try {
        const parsed = new URL(url);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
          electron.shell.openExternal(url);
        } else {
          console.warn("[Browser] Blocked non-http URL:", parsed.protocol);
        }
      } catch (e) {
        console.warn("[Browser] Invalid URL:", url);
      }
    }
    return { success: true };
  });

  // Load settings from disk
  electron.ipcMain.handle("load-settings", async () => {
    return loadSettings();
  });

  // Save settings to disk and notify the renderer
  electron.ipcMain.handle("save-settings", async (event, settings) => {
    // Merge with defaults to ensure completeness
    const merged = Object.assign({}, DEFAULT_SETTINGS, settings);
    saveSettings(merged);
    // Push the updated settings back to the renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("settings-changed", merged);
    }
    return { success: true };
  });

  // Load saved tab URLs from disk
  electron.ipcMain.handle("load-tabs", async () => {
    if (fs.existsSync(TABS_FILE)) {
      try {
        return JSON.parse(fs.readFileSync(TABS_FILE, "utf-8"));
      } catch (e) {
        return [];
      }
    }
    return [];
  });
}

// ===================== App Lifecycle =====================

// Prevent multiple instances - if already running, focus the existing window
const gotTheLock = electron.app.requestSingleInstanceLock();

if (!gotTheLock) {
  electron.app.quit();
} else {
  electron.app.on("second-instance", () => {
    // Someone tried to open a second instance - focus our existing window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

electron.app.whenReady().then(() => {
  // Initialize paths now that app is ready
  BACKUP_DIR = path.join(electron.app.getPath("userData"), "note-backups");
  AUTOSAVE_FILE = path.join(BACKUP_DIR, "autosave.json");
  TABS_FILE = path.join(BACKUP_DIR, "open-tabs.json");
  SETTINGS_FILE = path.join(BACKUP_DIR, "settings.json");

  // Set a realistic user agent for ConnectWise requests only
  // (scoped to myconnectwise.net to avoid affecting other services)
  const CW_URL_FILTER = { urls: ["*://*.myconnectwise.net/*"] };
  electron.session.defaultSession.webRequest.onBeforeSendHeaders(
    CW_URL_FILTER,
    (details, callback) => {
      details.requestHeaders["User-Agent"] =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
      callback({ requestHeaders: details.requestHeaders });
    },
  );

  // Register all IPC handlers
  registerIpcHandlers();

  // Create the window
  createWindow();

  // Clean up old backups after window is created (non-blocking)
  setTimeout(cleanupOldBackups, 0);

  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
