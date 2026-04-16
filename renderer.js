// ===================================================
// ConnectWise Backup – Renderer (UI Logic)
// ===================================================

document.addEventListener('DOMContentLoaded', () => {

  // --- Element References ---
  const webview = document.getElementById('cw-webview');
  const sidePanel = document.getElementById('side-panel');
  const resizeHandle = document.getElementById('resize-handle');
  const btnToggle = document.getElementById('btn-toggle-panel');
  const btnExpand = document.getElementById('btn-expand-panel');
  const ticketIdInput = document.getElementById('ticket-id');
  const noteContent = document.getElementById('note-content');
  const autosaveStatus = document.getElementById('autosave-status');
  const btnSave = document.getElementById('btn-save');
  const btnClear = document.getElementById('btn-clear');
  const btnCopy = document.getElementById('btn-copy');
  const btnOpenFolder = document.getElementById('btn-open-folder');
  const ticketSelect = document.getElementById('ticket-select');
  const btnLoadHistory = document.getElementById('btn-load-history');
  const historyList = document.getElementById('history-list');

  // ==================== Panel Toggle ====================
  let panelCollapsed = false;

  function togglePanel() {
    panelCollapsed = !panelCollapsed;
    if (panelCollapsed) {
      sidePanel.classList.add('collapsed');
      resizeHandle.style.display = 'none';
      btnExpand.classList.add('visible');
    } else {
      sidePanel.classList.remove('collapsed');
      resizeHandle.style.display = '';
      btnExpand.classList.remove('visible');
    }
  }

  btnToggle.addEventListener('click', togglePanel);
  btnExpand.addEventListener('click', togglePanel);

  // ==================== Panel Resize ====================
  let isResizing = false;

  resizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    document.body.style.cursor = 'col-resize';
    // Disable pointer events on webview while resizing so it doesn't capture mouse
    webview.style.pointerEvents = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const containerRect = document.getElementById('app-container').getBoundingClientRect();
    const newWidth = containerRect.right - e.clientX;
    if (newWidth >= 280 && newWidth <= 700) {
      sidePanel.style.width = newWidth + 'px';
    }
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.cursor = '';
      webview.style.pointerEvents = '';
    }
  });

  // ==================== Autosave (Debounced) ====================
  let autosaveTimer = null;
  const AUTOSAVE_DELAY = 1500; // ms after last keystroke

  function triggerAutosave() {
    // Update status
    autosaveStatus.textContent = 'Typing...';
    autosaveStatus.className = 'saving';

    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(async () => {
      const ticketId = ticketIdInput.value.trim() || 'general';
      const content = noteContent.value;
      
      if (!content && !ticketIdInput.value.trim()) {
        autosaveStatus.textContent = 'Nothing to save';
        autosaveStatus.className = '';
        return;
      }

      try {
        const result = await window.backupAPI.saveNote({
          ticketId,
          noteContent: content,
          isManual: false
        });
        autosaveStatus.textContent = `Auto-saved at ${new Date(result.timestamp).toLocaleTimeString()}`;
        autosaveStatus.className = 'saved';
      } catch (err) {
        autosaveStatus.textContent = 'Auto-save error!';
        autosaveStatus.className = '';
        console.error('Autosave error:', err);
      }
    }, AUTOSAVE_DELAY);
  }

  noteContent.addEventListener('input', triggerAutosave);
  ticketIdInput.addEventListener('input', triggerAutosave);

  // ==================== Manual Save ====================
  btnSave.addEventListener('click', async () => {
    const ticketId = ticketIdInput.value.trim() || 'general';
    const content = noteContent.value;

    if (!content.trim()) {
      autosaveStatus.textContent = 'Nothing to save!';
      autosaveStatus.className = '';
      return;
    }

    try {
      const result = await window.backupAPI.saveNote({
        ticketId,
        noteContent: content,
        isManual: true
      });
      autosaveStatus.textContent = `💾 Snapshot saved at ${new Date(result.timestamp).toLocaleTimeString()}`;
      autosaveStatus.className = 'saved';

      // Refresh history if viewing same ticket
      if (ticketSelect.value === ticketId) {
        loadHistory(ticketId);
      }
      refreshTicketList();
    } catch (err) {
      autosaveStatus.textContent = 'Save error!';
      console.error('Save error:', err);
    }
  });

  // ==================== Clear ====================
  btnClear.addEventListener('click', () => {
    if (noteContent.value.trim() && !confirm('Clear the current note? (Autosaved data is still on disk)')) {
      return;
    }
    noteContent.value = '';
    autosaveStatus.textContent = 'Cleared';
    autosaveStatus.className = '';
  });

  // ==================== Copy to Clipboard ====================
  btnCopy.addEventListener('click', () => {
    if (!noteContent.value.trim()) {
      autosaveStatus.textContent = 'Nothing to copy';
      return;
    }
    navigator.clipboard.writeText(noteContent.value).then(() => {
      autosaveStatus.textContent = '📋 Copied to clipboard!';
      autosaveStatus.className = 'saved';
    });
  });

  // ==================== Open Backup Folder ====================
  btnOpenFolder.addEventListener('click', () => {
    window.backupAPI.openBackupFolder();
  });

  // ==================== History ====================
  async function refreshTicketList() {
    try {
      const tickets = await window.backupAPI.getAllTickets();
      ticketSelect.innerHTML = '<option value="">-- Select a ticket --</option>';
      tickets.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.ticketId;
        opt.textContent = t.ticketId + (t.updatedAt ? ` (${new Date(t.updatedAt).toLocaleDateString()})` : '');
        ticketSelect.appendChild(opt);
      });
    } catch (err) {
      console.error('Error refreshing ticket list:', err);
    }
  }

  async function loadHistory(ticketId) {
    historyList.innerHTML = '';
    if (!ticketId) return;

    try {
      const items = await window.backupAPI.getHistory(ticketId);
      if (items.length === 0) {
        historyList.innerHTML = '<div style="font-size:11px; color:var(--text-muted); padding:8px;">No snapshots yet. Use "Save Snapshot" to create one.</div>';
        return;
      }

      items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'history-item';

        // Parse the timestamp from filename
        const timeStr = item.filename.replace('.txt', '').replace(/-/g, (m, offset) => {
          // Reconstruct ISO-like timestamp for display
          return offset <= 9 ? '-' : ':';
        });

        // Extract preview text (skip header lines)
        const lines = item.content.split('\n');
        const bodyLines = lines.slice(4); // skip Ticket:, Saved:, ===, empty line
        const preview = bodyLines.join(' ').substring(0, 100);

        div.innerHTML = `
          <div class="history-time">📄 ${item.filename.replace('.txt', '')}</div>
          <div class="history-preview">${preview || '(empty)'}</div>
        `;

        // Click to restore
        div.addEventListener('click', () => {
          const bodyText = bodyLines.join('\n').trim();
          noteContent.value = bodyText;
          ticketIdInput.value = ticketId;
          autosaveStatus.textContent = '♻️ Restored from snapshot';
          autosaveStatus.className = 'saved';
        });

        historyList.appendChild(div);
      });
    } catch (err) {
      console.error('Error loading history:', err);
    }
  }

  btnLoadHistory.addEventListener('click', () => {
    loadHistory(ticketSelect.value);
  });

  ticketSelect.addEventListener('change', () => {
    loadHistory(ticketSelect.value);
  });

  // ==================== Load Autosaved Data on Start ====================
  async function loadAutosaved() {
    try {
      const data = await window.backupAPI.loadAutosave();
      const keys = Object.keys(data);
      if (keys.length > 0) {
        // Load the most recently updated entry
        let latestKey = keys[0];
        let latestTime = data[keys[0]].updatedAt || '';
        keys.forEach(k => {
          if ((data[k].updatedAt || '') > latestTime) {
            latestTime = data[k].updatedAt;
            latestKey = k;
          }
        });

        ticketIdInput.value = latestKey === 'general' ? '' : latestKey;
        noteContent.value = data[latestKey].content || '';
        autosaveStatus.textContent = `Restored draft from ${new Date(latestTime).toLocaleString()}`;
        autosaveStatus.className = 'saved';
      }
    } catch (err) {
      console.error('Error loading autosave:', err);
    }
  }

  // ==================== Init ====================
  loadAutosaved();
  refreshTicketList();

  // Refresh the ticket list when the webview navigates (user may have changed tickets)
  webview.addEventListener('did-navigate', () => {
    refreshTicketList();
  });

  webview.addEventListener('did-navigate-in-page', () => {
    refreshTicketList();
  });

  // ==================== Keyboard Shortcuts ====================
  document.addEventListener('keydown', (e) => {
    // Ctrl+Shift+S = Manual save snapshot
    if (e.ctrlKey && e.shiftKey && e.key === 'S') {
      e.preventDefault();
      btnSave.click();
    }
    // Ctrl+Shift+B = Toggle panel
    if (e.ctrlKey && e.shiftKey && e.key === 'B') {
      e.preventDefault();
      togglePanel();
    }
  });
});
