# ConnectWise Backup Wrapper

An Electron-based wrapper for ConnectWise that automatically backs up your ticket notes to prevent data loss when the website crashes.

## Features

- **Full ConnectWise access** – The site loads in an embedded browser, just like using Chrome
- **Side panel note editor** – Draft your notes in the side panel before (or while) entering them in ConnectWise
- **Auto-save** – Notes are automatically saved to disk ~1.5 seconds after you stop typing
- **Manual snapshots** – Click "Save Snapshot" to create a timestamped backup you can restore later
- **History & restore** – Browse past snapshots per ticket and click to restore any of them
- **Copy to clipboard** – One-click copy so you can paste directly into ConnectWise
- **Resizable panel** – Drag the border to adjust panel width
- **Collapsible** – Hide the panel entirely when you don't need it
- **Keyboard shortcuts**:
  - `Ctrl+Shift+S` – Save snapshot
  - `Ctrl+Shift+B` – Toggle side panel

## Where Are Backups Stored?

All backup files are saved to your Electron `userData` directory:

```
%APPDATA%/connectwise-backup/note-backups/
```

Inside you'll find:
- `autosave.json` – The latest auto-saved draft for each ticket
- A folder per ticket ID containing timestamped `.txt` snapshot files

You can click the **📁 Open Folder** button in the app to jump directly there.

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or later recommended)

### Install & Run

```bash
cd connectwise-backup
npm install
npm start
```

### Build a Distributable .exe

```bash
npm run build
```

The output will be in the `dist/` folder.

## Workflow Tips

1. **Before entering notes in ConnectWise**, type them in the side panel first
2. Give each note a **Ticket ID** (e.g., `SR-123456`) so backups are organized
3. When you're happy with the note, click **📋 Copy** and paste into ConnectWise
4. Click **💾 Save Snapshot** before submitting in ConnectWise for an extra safety net
5. If ConnectWise crashes, your notes are safe – just reopen the app and they'll be right where you left them

## Troubleshooting

- **ConnectWise doesn't load**: The app sets a Chrome user-agent string. If you encounter issues, make sure you're connected to the internet and `na.myconnectwise.net` is accessible.
- **Login issues**: The embedded browser maintains its own session/cookies. You'll need to log in once; after that, your session should persist between app launches.
- **Blank screen**: Try `Ctrl+Shift+I` to open DevTools and check for errors in the console.
