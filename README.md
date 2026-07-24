# Voidflix Desktop

Electron wrapper for Voidflix. Produces a single `.exe` installer for Windows.

---

## What's included

| Feature | How it works |
|---|---|
| Custom titlebar | 32px drag region with minimize / maximize / close buttons. No OS chrome. |
| DevTools disabled | All keyboard shortcuts and context menu access blocked at the `webContents` level. |
| Embedded TMDB proxy | The `proxy.js` Express server is replaced by a lightweight `http.createServer` running in the Electron main process on `127.0.0.1:3579`. TMDB key stays server-side. |
| Discord Rich Presence | Shows title + "Watching" / "Playing" + elapsed time in Discord. Updates on play/pause/close. |
| Local ROM library | ROMs are read from a user-chosen folder. The Arcade page gets a folder picker. EmulatorJS receives a `data:` URL instead of a server path. |
| NSIS installer | One-click `.exe` with desktop shortcut, Start Menu entry, and watch history preserved on uninstall. |

---

## Setup

### 1. Prerequisites

- **Node.js** 18+ and **npm**
- **Windows Build Tools** (for native modules): `npm install -g windows-build-tools`
- Discord app running on the machine for Rich Presence to show

### 2. Clone / create the project folder

```
voidflix-electron/
  src/           ← Electron source (already here)
  web/           ← YOUR VOIDFLIX WEB FILES GO HERE
  assets/        ← favicon.ico, favicon.icns, favicon.png
  roms/          ← optional: bundled ROMs (nes/, snes/, gba/, etc.)
  app-patches/   ← already here
  build.js       ← already here
  package.json   ← already here
```

### 3. Copy your web files

Copy all your existing Voidflix files into the `web/` folder:

```
web/
  index.html
  movies.html
  tv.html
  decades.html
  emulation.html
  detail.html
  person.html
  settings.html
  admin.html
  stream-unavailable.html
  404.html
  voidflix.js
  style.css
  favicon.png
  tmdb-logo.svg
```

### 4. Add icons

Place these in `assets/`:

- `favicon.png`  — 256×256 PNG (copy from your web files)
- `favicon.ico`  — Windows icon (convert your PNG at https://convertio.co)
- `favicon.icns` — macOS icon (only needed for Mac builds)

### 5. Discord app setup

1. Go to https://discord.com/developers/applications
2. Click **New Application** → name it **Voidflix**
3. Copy the **Application ID** from the General Information page
4. Open `src/main.js` and replace `'YOUR_DISCORD_CLIENT_ID'` with your ID
5. Under **Rich Presence → Art Assets**, upload:
   - `voidflix_logo` — your Voidflix logo image
   - `arcade_icon` — a game controller image (for the Arcade section)
   - `play` — a small play button icon (shown as the small image)

### 6. Install dependencies

```bash
cd voidflix-electron
npm install
```

### 7. Test in dev mode

```bash
npm start
```

This runs the build script first (copies `web/` → `app/`, injects scripts), then launches Electron.

### 8. Build the installer

```bash
npm run build
```

Output: `dist/Voidflix-Setup-1.0.0.exe`

---

## ROM setup

ROMs are **not** bundled in the installer by default (they're large and potentially legally grey).

**Option A — Choose folder at runtime (recommended)**
1. Launch Voidflix
2. Go to Arcade
3. Click **Choose ROMs Folder**
4. Select a folder organised as:
   ```
   your-roms-folder/
     nes/    ← .nes files
     snes/   ← .sfc / .smc files
     n64/    ← .n64 / .z64 files
     gba/    ← .gba files
     gbc/    ← .gbc files
     gb/     ← .gb files
     genesis/ ← .md / .gen files
     psx/    ← .iso / .bin / .pbp files
   ```
5. The library loads instantly. The path is remembered across restarts.

**Option B — Bundle ROMs into the installer**
Drop files into `roms/<console>/` before running `npm run build`.
They'll be copied into the installer under `resources/roms/`.

---

## Architecture notes

- `src/main.js` — main process: window, proxy server, Discord RPC, ROM IPC handlers
- `src/preload.js` — context bridge: exposes `window.electronAPI` to renderer
- `src/titlebar.js` — injected into every HTML page; draws the custom drag bar
- `src/electron-adapter.js` — monkey-patches `startActivityHeartbeat`, `fetch('/api/roms')`, and `playGame` for the desktop context
- `app-patches/emulation-electron-patch.js` — adds the ROM folder picker UI and `data:` URL loader to the Arcade page
- `build.js` — copies `web/` → `app/`, patches `TMDB_BASE`, injects script tags

The web source files in `web/` are **never modified**. All patching happens in `app/` at build time.
