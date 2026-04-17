// ===================================================
// ConnectWise Backup - Renderer (UI Logic)
// ===================================================

document.addEventListener('DOMContentLoaded', function() {

  // --- Element References ---
  var sidePanel = document.getElementById('side-panel');
  var resizeHandle = document.getElementById('resize-handle');
  var btnToggle = document.getElementById('btn-toggle-panel');
  var btnExpand = document.getElementById('btn-expand-panel');
  var ticketIdInput = document.getElementById('ticket-id');
  var noteContent = document.getElementById('note-content');
  var autosaveStatus = document.getElementById('autosave-status');
  var btnSave = document.getElementById('btn-save');
  var btnClear = document.getElementById('btn-clear');
  var btnCopy = document.getElementById('btn-copy');
  var btnOpenFolder = document.getElementById('btn-open-folder');
  var ticketSelect = document.getElementById('ticket-select');
  var btnLoadHistory = document.getElementById('btn-load-history');
  var historyList = document.getElementById('history-list');
  var btnGrabTicket = document.getElementById('btn-grab-ticket');
  var btnDeleteTicket = document.getElementById('btn-delete-ticket');

  // --- Tab Management Elements ---
  var tabList = document.getElementById('tab-list');
  var webviewContainer = document.getElementById('webview-container');
  var btnNewTab = document.getElementById('btn-new-tab');

  // ==================== Tab Management ====================
  var DEFAULT_URL = 'https://na.myconnectwise.net/';
    var tabs = [];       // Array of { id, webview, tabEl, titleSpan, title }
  var activeTabId = null;
  var tabIdCounter = 0;
  var tabHistory = [];  // Stack of previously active tab IDs (most recent last)

  // --- Title cleanup: strip common prefixes ---
  function cleanTitle(raw) {
    if (!raw) return 'Untitled';
    var cleaned = raw;
    // Strip leading "Manage: " or "Manage:" (case-insensitive)
    cleaned = cleaned.replace(/^Manage:\s*/i, '');
    return cleaned || 'Untitled';
  }

  function generateTabId() {
    return 'tab-' + (++tabIdCounter);
  }

  function getActiveWebview() {
    var tab = tabs.find(function(t) { return t.id === activeTabId; });
    return tab ? tab.webview : null;
  }

  // --- Persist open tabs (debounced) ---
  var saveTabsTimer = null;
  function saveTabSession() {
    clearTimeout(saveTabsTimer);
    saveTabsTimer = setTimeout(function() {
      var urls = [];
      for (var i = 0; i < tabs.length; i++) {
        try {
          var url = tabs[i].webview.getURL();
          if (url && url !== '' && url !== 'about:blank') {
            urls.push(url);
          }
        } catch (e) {
          // webview may not be ready yet
        }
      }
      if (urls.length > 0) {
        window.backupAPI.saveTabs(urls);
      }
    }, 1000);
  }

  function createTab(url, opts) {
    opts = opts || {};
    var id = generateTabId();
    var activate = opts.activate !== false; // default: activate

    // Create webview element
    var webview = document.createElement('webview');
    webview.setAttribute('src', url || DEFAULT_URL);
    webview.setAttribute('allowpopups', '');
    webview.style.width = '100%';
    webview.style.height = '100%';
    webviewContainer.appendChild(webview);

    // Create tab button
    var tabEl = document.createElement('div');
    tabEl.className = 'tab-item';
    tabEl.dataset.tabId = id;

    var titleSpan = document.createElement('span');
    titleSpan.className = 'tab-title';
    titleSpan.textContent = 'Loading...';

    var closeBtn = document.createElement('button');
    closeBtn.className = 'tab-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = 'Close tab';

    tabEl.appendChild(titleSpan);
    tabEl.appendChild(closeBtn);
    tabList.appendChild(tabEl);

    var tabData = { id: id, webview: webview, tabEl: tabEl, titleSpan: titleSpan, title: 'Loading...' };
    tabs.push(tabData);

    // --- Tab click to activate ---
    tabEl.addEventListener('mousedown', function(e) {
      if (e.target.closest('.tab-close')) return;
      activateTab(id);
    });

    // --- Middle-click on TAB to close ---
    tabEl.addEventListener('auxclick', function(e) {
      if (e.button === 1) {
        e.preventDefault();
        closeTab(id);
      }
    });

        // --- Close button ---
    closeBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      closeTab(id);
    });

    // --- Right-click context menu ---
    tabEl.addEventListener('contextmenu', function(e) {
      showTabContextMenu(e, id);
    });

    // --- Helper to set title on the tab ---
    function updateTabTitle() {
      try {
        var raw = webview.getTitle();
        if (raw && raw !== '') {
          var display = cleanTitle(raw);
          tabData.title = display;
          titleSpan.textContent = display;
        }
      } catch (err) {
        // webview may have been removed
      }
    }

    // --- Webview events ---
    webview.addEventListener('did-stop-loading', function() {
      updateTabTitle();
      saveTabSession();
    });

    webview.addEventListener('page-title-updated', function(e) {
      if (e.title && e.title !== '') {
        var display = cleanTitle(e.title);
        tabData.title = display;
        titleSpan.textContent = display;
      }
    });

    webview.addEventListener('did-start-loading', function() {
      titleSpan.textContent = 'Loading...';
    });

    webview.addEventListener('did-navigate', function() {
      refreshTicketList();
      updateTabTitle();
      saveTabSession();
    });

    webview.addEventListener('did-navigate-in-page', function() {
      refreshTicketList();
      updateTabTitle();
      saveTabSession();
    });

    // --- Handle webview requesting to close itself (e.g. ConnectWise "Save and Close" button) ---
    webview.addEventListener('close', function() {
      console.log('[Tab] Webview requested close for tab:', id);
      closeTab(id);
    });

    // Activate the tab
    if (activate) {
      activateTab(id);
    }

    return tabData;
  }

    function activateTab(id) {
    // Push the previous tab onto the history stack
    if (activeTabId && activeTabId !== id) {
      tabHistory.push(activeTabId);
    }
    activeTabId = id;

    tabs.forEach(function(t) {
      if (t.id === id) {
        t.webview.classList.add('active-webview');
        t.tabEl.classList.add('active');
      } else {
        t.webview.classList.remove('active-webview');
        t.tabEl.classList.remove('active');
      }
    });
  }

  function closeTab(id) {
    var idx = tabs.findIndex(function(t) { return t.id === id; });
    if (idx === -1) return;

    // Don't close the last tab - navigate it home instead
    if (tabs.length === 1) {
      tabs[0].webview.setAttribute('src', DEFAULT_URL);
      return;
    }

    var tab = tabs[idx];

        // If closing the active tab, activate the most recent tab from history
    if (activeTabId === id) {
      var nextId = null;
      // Pop from history until we find a tab that still exists and isn't the one being closed
      while (tabHistory.length > 0) {
        var candidate = tabHistory.pop();
        if (candidate !== id && tabs.some(function(t) { return t.id === candidate; })) {
          nextId = candidate;
          break;
        }
      }
      // Fallback to adjacent tab if no valid history
      if (!nextId) {
        var newIdx = idx > 0 ? idx - 1 : idx + 1;
        nextId = tabs[newIdx].id;
      }
      activateTab(nextId);
    }

    // Remove all references to this tab from history
    tabHistory = tabHistory.filter(function(hId) { return hId !== id; });

    // Remove DOM elements
    tab.webview.remove();
    tab.tabEl.remove();
    tabs.splice(idx, 1);

    // Save session after closing
    saveTabSession();
  }

    // ==================== Tab Context Menu ====================
  var tabContextMenu = document.getElementById('tab-context-menu');
  var contextMenuTabId = null; // which tab was right-clicked

  function getTabUrl(tabId) {
    var tab = tabs.find(function(t) { return t.id === tabId; });
    if (!tab) return null;
    try {
      return tab.webview.getURL();
    } catch (e) {
      return null;
    }
  }

  function showTabContextMenu(e, tabId) {
    e.preventDefault();
    contextMenuTabId = tabId;

    // Position the menu at the cursor
    tabContextMenu.style.left = e.clientX + 'px';
    tabContextMenu.style.top = e.clientY + 'px';
    tabContextMenu.classList.add('visible');

    // Ensure the menu doesn't overflow the window
    var rect = tabContextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      tabContextMenu.style.left = (window.innerWidth - rect.width - 4) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
      tabContextMenu.style.top = (window.innerHeight - rect.height - 4) + 'px';
    }
  }

  function hideTabContextMenu() {
    tabContextMenu.classList.remove('visible');
    contextMenuTabId = null;
  }

  // Hide context menu on any click or Escape
  document.addEventListener('click', function() {
    hideTabContextMenu();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') hideTabContextMenu();
  });

  // Handle context menu actions
  tabContextMenu.addEventListener('click', function(e) {
    var item = e.target.closest('.context-menu-item');
    if (!item || !contextMenuTabId) return;

    var action = item.dataset.action;
    var targetTabId = contextMenuTabId;
    hideTabContextMenu();

    switch (action) {
      case 'open-browser':
        var url = getTabUrl(targetTabId);
        if (url) {
          window.backupAPI.openInBrowser(url);
        }
        break;

      case 'duplicate':
        var dupUrl = getTabUrl(targetTabId);
        if (dupUrl) {
          createTab(dupUrl, { activate: true });
        }
        break;

      case 'close':
        closeTab(targetTabId);
        break;

      case 'close-others':
        var otherIds = tabs
          .filter(function(t) { return t.id !== targetTabId; })
          .map(function(t) { return t.id; });
        for (var i = 0; i < otherIds.length; i++) {
          closeTab(otherIds[i]);
        }
        break;

      case 'close-right':
        var targetIdx = tabs.findIndex(function(t) { return t.id === targetTabId; });
        if (targetIdx !== -1) {
          var rightIds = tabs
            .slice(targetIdx + 1)
            .map(function(t) { return t.id; });
          for (var j = 0; j < rightIds.length; j++) {
            closeTab(rightIds[j]);
          }
        }
        break;
    }
  });

  // --- New Tab button ---
  btnNewTab.addEventListener('click', function() {
    createTab(DEFAULT_URL, { activate: true });
  });

    // --- Listen for new-tab requests from the main process ---
  window.backupAPI.onOpenInNewTab(function(url) {
    console.log('[Tab] Opening in new tab:', url);
    createTab(url, { activate: true });
  });

  // --- Listen for webview self-close requests from the main process ---
  // (e.g. ConnectWise "Save and Close" button calls window.close())
  window.backupAPI.onWebviewClose(function(webContentsId) {
    console.log('[Tab] Webview close request for webContentsId:', webContentsId);
    for (var i = 0; i < tabs.length; i++) {
      try {
        if (tabs[i].webview.getWebContentsId() === webContentsId) {
          console.log('[Tab] Closing tab:', tabs[i].id);
          closeTab(tabs[i].id);
          return;
        }
      } catch (e) { /* webview may not be ready */ }
    }
  });

  // --- Restore tabs from previous session, or create a default tab ---
  async function initTabs() {
    try {
      var savedUrls = await window.backupAPI.loadTabs();
      if (savedUrls && savedUrls.length > 0) {
        for (var i = 0; i < savedUrls.length; i++) {
          // First tab is active, rest are background
          createTab(savedUrls[i], { activate: i === 0 });
        }
        console.log('[Tab] Restored ' + savedUrls.length + ' tab(s) from previous session');
        return;
      }
    } catch (err) {
      console.error('[Tab] Error loading saved tabs:', err);
    }
    // Fallback: create a single default tab
    createTab(DEFAULT_URL);
  }

  initTabs();

  // ==================== Rich Text Editor Helpers ====================

  function getEditorContent() {
    return noteContent.innerHTML;
  }

  function setEditorContent(html) {
    noteContent.innerHTML = html;
  }

  function isEditorEmpty() {
    var text = noteContent.innerText.trim();
    return text.length === 0 && !noteContent.querySelector('img');
  }

  function getEditorPlainText() {
    return noteContent.innerText.trim();
  }

  // ==================== Formatting Toolbar ====================

  document.getElementById('editor-toolbar').addEventListener('click', function(e) {
    var btn = e.target.closest('.toolbar-btn');
    if (!btn) return;

    var command = btn.dataset.command;
    var value = btn.dataset.value || null;

    noteContent.focus();
    document.execCommand(command, false, value);
    updateToolbarState();
  });

  function updateToolbarState() {
    document.querySelectorAll('.toolbar-btn[data-command]').forEach(function(btn) {
      var command = btn.dataset.command;
      if (['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList'].indexOf(command) !== -1) {
        btn.classList.toggle('active', document.queryCommandState(command));
      }
    });
  }

  document.addEventListener('selectionchange', function() {
    if (document.activeElement === noteContent) {
      updateToolbarState();
    }
  });

  // ==================== Image Paste Handler ====================

  noteContent.addEventListener('paste', function(e) {
    var items = (e.clipboardData || {}).items;
    if (!items) return;

    for (var i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image/') === 0) {
        e.preventDefault();

        var blob = items[i].getAsFile();
        var reader = new FileReader();
        reader.onload = function(event) {
          var img = document.createElement('img');
          img.src = event.target.result;
          img.style.maxWidth = '100%';

          var selection = window.getSelection();
          if (selection.rangeCount > 0) {
            var range = selection.getRangeAt(0);
            range.deleteContents();
            range.insertNode(img);
            range.setStartAfter(img);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
          } else {
            noteContent.appendChild(img);
          }

          noteContent.dispatchEvent(new Event('input'));
        };
        reader.readAsDataURL(blob);
        return;
      }
    }
  });

  // Drag-and-drop images
  noteContent.addEventListener('dragover', function(e) {
    e.preventDefault();
  });

  noteContent.addEventListener('drop', function(e) {
    var files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    for (var i = 0; i < files.length; i++) {
      if (files[i].type.indexOf('image/') === 0) {
        e.preventDefault();

        var reader = new FileReader();
        reader.onload = function(event) {
          var img = document.createElement('img');
          img.src = event.target.result;
          img.style.maxWidth = '100%';
          noteContent.appendChild(img);
          noteContent.dispatchEvent(new Event('input'));
        };
        reader.readAsDataURL(files[i]);
        return;
      }
    }
  });

  // ==================== Panel Toggle ====================
  var panelCollapsed = false;

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
  var isResizing = false;

  resizeHandle.addEventListener('mousedown', function(e) {
    isResizing = true;
    document.body.style.cursor = 'col-resize';
    tabs.forEach(function(t) { t.webview.style.pointerEvents = 'none'; });
    e.preventDefault();
  });

  document.addEventListener('mousemove', function(e) {
    if (!isResizing) return;
    var containerRect = document.getElementById('app-container').getBoundingClientRect();
    var newWidth = containerRect.right - e.clientX;
    if (newWidth >= 280 && newWidth <= 700) {
      sidePanel.style.width = newWidth + 'px';
    }
  });

  document.addEventListener('mouseup', function() {
    if (isResizing) {
      isResizing = false;
      document.body.style.cursor = '';
      tabs.forEach(function(t) { t.webview.style.pointerEvents = ''; });
    }
  });

  // ==================== Auto-Grab on First Typing ====================
  var hasAttemptedAutoGrab = false;

  noteContent.addEventListener('focus', async function() {
    // If the user focuses the editor with no ticket ID, try to grab one
    if (!ticketIdInput.value.trim() && !hasAttemptedAutoGrab) {
      hasAttemptedAutoGrab = true;
      // Simulate clicking the grab button
      var webview = getActiveWebview();
      if (!webview) return;

      try {
        var result = await webview.executeJavaScript(
          '(function() {' +
          '  var selectors = [' +
          '    ".cw-header-ticket-number",' +
          '    ".ticket-number",' +
          '    "[class*=ticketNumber]",' +
          '    "[class*=ticket-number]",' +
          '    "[class*=TicketNumber]",' +
          '    "[data-testid*=ticket]",' +
          '    ".sr-number",' +
          '    "[class*=srNumber]",' +
          '    "[class*=recordId]",' +
          '    "[class*=record-id]",' +
          '    ".cw-breadcrumb",' +
          '    ".breadcrumb",' +
          '    ".tab-label.active",' +
          '    ".cw-tab.active",' +
          '    "[class*=activeTab]",' +
          '    ".selected-tab",' +
          '    ".panel-title",' +
          '    ".card-header",' +
          '    "h1", "h2", "h3"' +
          '  ];' +
          '  for (var i = 0; i < selectors.length; i++) {' +
          '    var els = document.querySelectorAll(selectors[i]);' +
          '    for (var j = 0; j < els.length; j++) {' +
          '      var text = els[j].innerText || els[j].textContent || "";' +
          '      var match = text.match(/#\\s*([0-9]{4,})/);' +
          '      if (match) return { ticket: match[1] };' +
          '    }' +
          '  }' +
          '  var body = document.body.innerText || "";' +
          '  var patterns = [' +
          '    /(?:Service\\s*Ticket|Ticket|SR)\\s*#\\s*([0-9]{4,})/i,' +
          '    /#([0-9]{5,})/' +
          '  ];' +
          '  for (var p = 0; p < patterns.length; p++) {' +
          '    var m = body.match(patterns[p]);' +
          '    if (m) return { ticket: m[1] };' +
          '  }' +
          '  return { ticket: null };' +
          '})()'
        );

        if (result && result.ticket) {
          ticketIdInput.value = result.ticket;
          autosaveStatus.textContent = 'Auto-grabbed ticket #' + result.ticket;
          autosaveStatus.className = 'saved';
        } else {
          alert('Could not detect a ticket number from the current page.\n\nPlease enter a Ticket / Reference ID before typing your note.');
          ticketIdInput.focus();
        }
      } catch (err) {
        alert('Could not detect a ticket number from the current page.\n\nPlease enter a Ticket / Reference ID before typing your note.');
        ticketIdInput.focus();
      }
    }
  });

  // Reset auto-grab flag when ticket ID is manually cleared
  ticketIdInput.addEventListener('input', function() {
    if (!ticketIdInput.value.trim()) {
      hasAttemptedAutoGrab = false;
    }
  });

  // ==================== Autosave (Debounced) ====================
  var autosaveTimer = null;
  var AUTOSAVE_DELAY = 1500;
  var lastSavedTicketId = null;

  async function performAutosave() {
    var ticketId = ticketIdInput.value.trim() || 'general';
    var content = getEditorContent();

    if (isEditorEmpty() && !ticketIdInput.value.trim()) {
      autosaveStatus.textContent = 'Nothing to save';
      autosaveStatus.className = '';
      return;
    }

    try {
      if (lastSavedTicketId && lastSavedTicketId !== ticketId) {
        await window.backupAPI.deleteAutosave(lastSavedTicketId);
      }

      var result = await window.backupAPI.saveNote({
        ticketId: ticketId,
        noteContent: content,
        isManual: false
      });
      lastSavedTicketId = ticketId;
      autosaveStatus.textContent = 'Auto-saved at ' + new Date(result.timestamp).toLocaleTimeString();
      autosaveStatus.className = 'saved';
    } catch (err) {
      autosaveStatus.textContent = 'Auto-save error!';
      autosaveStatus.className = '';
      console.error('Autosave error:', err);
    }
  }

  noteContent.addEventListener('input', function() {
    autosaveStatus.textContent = 'Typing...';
    autosaveStatus.className = 'saving';
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(performAutosave, AUTOSAVE_DELAY);
  });

  ticketIdInput.addEventListener('blur', function() {
    if (!isEditorEmpty()) {
      clearTimeout(autosaveTimer);
      performAutosave();
    }
  });

  // ==================== Grab Ticket from ConnectWise ====================

  btnGrabTicket.addEventListener('click', async function() {
    var webview = getActiveWebview();
    if (!webview) {
      autosaveStatus.textContent = 'No active tab';
      return;
    }

    try {
      var result = await webview.executeJavaScript(
        '(function() {' +
        '  var selectors = [' +
        '    ".cw-header-ticket-number",' +
        '    ".ticket-number",' +
        '    "[class*=ticketNumber]",' +
        '    "[class*=ticket-number]",' +
        '    "[class*=TicketNumber]",' +
        '    "[data-testid*=ticket]",' +
        '    ".sr-number",' +
        '    "[class*=srNumber]",' +
        '    "[class*=recordId]",' +
        '    "[class*=record-id]",' +
        '    ".cw-breadcrumb",' +
        '    ".breadcrumb",' +
        '    ".tab-label.active",' +
        '    ".cw-tab.active",' +
        '    "[class*=activeTab]",' +
        '    ".selected-tab",' +
        '    ".panel-title",' +
        '    ".card-header",' +
        '    "h1", "h2", "h3"' +
        '  ];' +
        '  for (var i = 0; i < selectors.length; i++) {' +
        '    var els = document.querySelectorAll(selectors[i]);' +
        '    for (var j = 0; j < els.length; j++) {' +
        '      var text = els[j].innerText || els[j].textContent || "";' +
        '      var match = text.match(/#\\s*([0-9]{4,})/);' +
        '      if (match) return { ticket: match[1], source: selectors[i], text: text.substring(0, 100) };' +
        '    }' +
        '  }' +
        '  var body = document.body.innerText || "";' +
        '  var patterns = [' +
        '    /(?:Service\\s*Ticket|Ticket|SR)\\s*#\\s*([0-9]{4,})/i,' +
        '    /#([0-9]{5,})/' +
        '  ];' +
        '  for (var p = 0; p < patterns.length; p++) {' +
        '    var m = body.match(patterns[p]);' +
        '    if (m) return { ticket: m[1], source: "body-scan", text: "" };' +
        '  }' +
        '  var inputs = document.querySelectorAll("input, [contenteditable], span, div");' +
        '  for (var k = 0; k < inputs.length; k++) {' +
        '    var el = inputs[k];' +
        '    var val = el.value || el.innerText || el.textContent || "";' +
        '    var label = (el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("placeholder") || "").toLowerCase();' +
        '    if (label.match(/ticket|sr\\s*#|record\\s*id|ticket\\s*number/)) {' +
        '      var numMatch = val.match(/([0-9]{4,})/);' +
        '      if (numMatch) return { ticket: numMatch[1], source: "input-label:" + label, text: val.substring(0, 100) };' +
        '    }' +
        '  }' +
        '  var allEls = document.querySelectorAll("*");' +
        '  for (var a = 0; a < Math.min(allEls.length, 5000); a++) {' +
        '    var cls = allEls[a].className || "";' +
        '    if (typeof cls === "string" && cls.match(/tab.*active|active.*tab|selected/i)) {' +
        '      var tabText = allEls[a].innerText || "";' +
        '      var tabMatch = tabText.match(/#\\s*([0-9]{4,})/);' +
        '      if (tabMatch) return { ticket: tabMatch[1], source: "active-tab-class", text: tabText.substring(0, 100) };' +
        '    }' +
        '  }' +
        '  return {' +
        '    ticket: null,' +
        '    source: "not-found",' +
        '    debug: {' +
        '      title: document.title,' +
        '      url: window.location.href,' +
        '      h1: (document.querySelector("h1") || {}).innerText || "",' +
        '      h2: (document.querySelector("h2") || {}).innerText || "",' +
        '      bodySnippet: body.substring(0, 500)' +
        '    }' +
        '  };' +
        '})()'
      );

      if (result && result.ticket) {
        ticketIdInput.value = result.ticket;
        autosaveStatus.textContent = 'Grabbed ticket #' + result.ticket;
        autosaveStatus.className = 'saved';
        console.log('Grab success - source:', result.source, 'text:', result.text);
        if (!isEditorEmpty()) {
          performAutosave();
        }
      } else {
        autosaveStatus.textContent = 'Could not detect ticket # - open a ticket first';
        autosaveStatus.className = '';
        console.log('Grab debug:', JSON.stringify(result, null, 2));
      }
    } catch (err) {
      autosaveStatus.textContent = 'Error grabbing ticket';
      console.error('Grab error:', err);
    }
  });

  // ==================== Manual Save ====================
  btnSave.addEventListener('click', async function() {
    var ticketId = ticketIdInput.value.trim() || 'general';
    var content = getEditorContent();

    if (isEditorEmpty()) {
      autosaveStatus.textContent = 'Nothing to save!';
      autosaveStatus.className = '';
      return;
    }

    try {
      var result = await window.backupAPI.saveNote({
        ticketId: ticketId,
        noteContent: content,
        isManual: true
      });
      autosaveStatus.textContent = 'Snapshot saved at ' + new Date(result.timestamp).toLocaleTimeString();
      autosaveStatus.className = 'saved';

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
  btnClear.addEventListener('click', function() {
    if (!isEditorEmpty() && !confirm('Clear the current note? (Autosaved data is still on disk)')) {
      return;
    }
    setEditorContent('');
    ticketIdInput.value = '';
    hasAttemptedAutoGrab = false;
    autosaveStatus.textContent = 'Cleared';
    autosaveStatus.className = '';
  });

  // ==================== Copy to Clipboard ====================
  btnCopy.addEventListener('click', function() {
    if (isEditorEmpty()) {
      autosaveStatus.textContent = 'Nothing to copy';
      return;
    }

    var htmlContent = getEditorContent();
    var plainText = getEditorPlainText();

    var htmlBlob = new Blob([htmlContent], { type: 'text/html' });
    var textBlob = new Blob([plainText], { type: 'text/plain' });
    var clipItem = new ClipboardItem({
      'text/html': htmlBlob,
      'text/plain': textBlob
    });
    navigator.clipboard.write([clipItem]).then(function() {
      autosaveStatus.textContent = 'Copied to clipboard (with formatting)';
      autosaveStatus.className = 'saved';
    }).catch(function() {
      navigator.clipboard.writeText(plainText).then(function() {
        autosaveStatus.textContent = 'Copied to clipboard (plain text)';
        autosaveStatus.className = 'saved';
      });
    });
  });

  // ==================== Open Backup Folder ====================
  btnOpenFolder.addEventListener('click', function() {
    window.backupAPI.openBackupFolder();
  });

  // ==================== History ====================
  async function refreshTicketList() {
    try {
      var tickets = await window.backupAPI.getAllTickets();
      ticketSelect.innerHTML = '<option value="">-- Select a ticket --</option>';
      tickets.forEach(function(t) {
        var opt = document.createElement('option');
        opt.value = t.ticketId;
        opt.textContent = t.ticketId + (t.updatedAt ? ' (' + new Date(t.updatedAt).toLocaleDateString() + ')' : '');
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
      var items = await window.backupAPI.getHistory(ticketId);
      if (items.length === 0) {
        historyList.innerHTML = '<div style="font-size:11px; color:var(--text-muted); padding:8px;">No snapshots yet. Use "Save Snapshot" to create one.</div>';
        return;
      }

      items.forEach(function(item) {
        var div = document.createElement('div');
        div.className = 'history-item';

        var tempDiv = document.createElement('div');
        tempDiv.innerHTML = item.content;
        var preview = tempDiv.innerText.substring(0, 100);

        var displayName = item.filename.replace('.html', '').replace('.txt', '');
        div.innerHTML =
          '<div class="history-time">' + displayName + '</div>' +
          '<div class="history-preview">' + (preview || '(empty)') + '</div>';

        div.addEventListener('click', function() {
          setEditorContent(item.content);
          ticketIdInput.value = ticketId;
          autosaveStatus.textContent = 'Restored from snapshot';
          autosaveStatus.className = 'saved';
        });

        historyList.appendChild(div);
      });
    } catch (err) {
      console.error('Error loading history:', err);
    }
  }

  btnLoadHistory.addEventListener('click', function() {
    loadHistory(ticketSelect.value);
  });

  ticketSelect.addEventListener('change', function() {
    loadHistory(ticketSelect.value);
  });

  // ==================== Delete Saved Ticket ====================
  btnDeleteTicket.addEventListener('click', async function() {
    var selectedTicket = ticketSelect.value;
    if (!selectedTicket) {
      autosaveStatus.textContent = 'Select a ticket to delete first';
      autosaveStatus.className = '';
      return;
    }

    if (!confirm('Delete ALL saved data for ticket "' + selectedTicket + '"?\n\nThis will remove the autosave entry and all snapshot history. This cannot be undone.')) {
      return;
    }

    try {
      await window.backupAPI.deleteTicket(selectedTicket);
      autosaveStatus.textContent = 'Deleted ticket ' + selectedTicket;
      autosaveStatus.className = 'saved';
      historyList.innerHTML = '';
      await refreshTicketList();
    } catch (err) {
      autosaveStatus.textContent = 'Error deleting ticket';
      console.error('Delete error:', err);
    }
  });

  // ==================== Load Autosaved Data on Start ====================
  async function loadAutosaved() {
    try {
      var data = await window.backupAPI.loadAutosave();
      var keys = Object.keys(data);
      if (keys.length > 0) {
        var latestKey = keys[0];
        var latestTime = data[keys[0]].updatedAt || '';
        keys.forEach(function(k) {
          if ((data[k].updatedAt || '') > latestTime) {
            latestTime = data[k].updatedAt;
            latestKey = k;
          }
        });

        ticketIdInput.value = latestKey === 'general' ? '' : latestKey;
        setEditorContent(data[latestKey].content || '');
        autosaveStatus.textContent = 'Restored draft from ' + new Date(latestTime).toLocaleString();
        autosaveStatus.className = 'saved';
      }
    } catch (err) {
      console.error('Error loading autosave:', err);
    }
  }

  // ==================== Init ====================
  loadAutosaved();
  refreshTicketList();

  // ==================== Keyboard Shortcuts ====================
  document.addEventListener('keydown', function(e) {
    // Ctrl+Shift+S - Save snapshot
    if (e.ctrlKey && e.shiftKey && e.key === 'S') {
      e.preventDefault();
      btnSave.click();
    }
    // Ctrl+Shift+B - Toggle side panel
    if (e.ctrlKey && e.shiftKey && e.key === 'B') {
      e.preventDefault();
      togglePanel();
    }
    // Ctrl+T - New tab
    if (e.ctrlKey && !e.shiftKey && e.key === 't') {
      e.preventDefault();
      createTab(DEFAULT_URL, { activate: true });
    }
    // Ctrl+W - Close current tab (only when not typing in notes)
    if (e.ctrlKey && !e.shiftKey && e.key === 'w') {
      if (document.activeElement !== noteContent && document.activeElement !== ticketIdInput) {
        e.preventDefault();
        if (activeTabId) closeTab(activeTabId);
      }
    }
    // Ctrl+Tab - Next tab
    if (e.ctrlKey && !e.shiftKey && e.key === 'Tab') {
      e.preventDefault();
      var idx = tabs.findIndex(function(t) { return t.id === activeTabId; });
      if (idx !== -1 && tabs.length > 1) {
        var nextIdx = (idx + 1) % tabs.length;
        activateTab(tabs[nextIdx].id);
      }
    }
    // Ctrl+Shift+Tab - Previous tab
    if (e.ctrlKey && e.shiftKey && e.key === 'Tab') {
      e.preventDefault();
      var idx2 = tabs.findIndex(function(t) { return t.id === activeTabId; });
      if (idx2 !== -1 && tabs.length > 1) {
        var prevIdx = (idx2 - 1 + tabs.length) % tabs.length;
        activateTab(tabs[prevIdx].id);
      }
    }
  });

  // ==================== Save tabs before window closes ====================
  window.addEventListener('beforeunload', function() {
    var urls = [];
    for (var i = 0; i < tabs.length; i++) {
      try {
        var url = tabs[i].webview.getURL();
        if (url && url !== '' && url !== 'about:blank') {
          urls.push(url);
        }
      } catch (e) { /* ignore */ }
    }
    if (urls.length > 0) {
      window.backupAPI.saveTabs(urls);
    }
  });
});
