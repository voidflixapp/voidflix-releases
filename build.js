// ==================== VOIDFLIX BUILD SCRIPT ====================
// Run via: node build.js  (automatically called by npm run build)
//
// What it does:
//   1. Copies all web source files (*.html, *.css, *.js, assets)
//      from the SOURCE_DIR into the app/ directory.
//   2. Injects <script> tags for titlebar.js and electron-adapter.js
//      into every HTML page — just before </body>.
//   3. For emulation.html only, also injects emulation-electron-patch.js.
//   4. Patches TMDB_BASE in voidflix.js from '/tmdb/3' to
//      'http://127.0.0.1:3579/tmdb/3' so fetch calls hit the embedded proxy.
//   5. Copies src/titlebar.js and src/electron-adapter.js into app/
//      so the injected <script> tags resolve correctly.
// ===============================================================

'use strict';

const fs   = require('fs');
const path = require('path');

// ── CONFIG ────────────────────────────────────────────────────────────────────
// Point SOURCE_DIR at the folder containing your Voidflix web files.
// Default assumes they live in a sibling 'web' folder:
//   voidflix-electron/
//     web/              ← your existing HTML/CSS/JS files go here
//     src/              ← electron source (main.js, preload.js, etc.)
//     app/              ← built output (created by this script)
const SOURCE_DIR = path.join(__dirname, 'web');
const APP_DIR    = path.join(__dirname, 'app');
const SRC_DIR    = path.join(__dirname, 'src');
const PATCHES_DIR = path.join(__dirname, 'app-patches');

// HTML files that get the emulation patch as well
const EMULATION_PAGES = ['emulation.html'];

// ── HELPERS ───────────────────────────────────────────────────────────────────
function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
    fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
    ensureDir(dest);
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath  = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            copyFile(srcPath, destPath);
        }
    }
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
function build() {
    console.log('[build] Starting Voidflix desktop build...');

    if (!fs.existsSync(SOURCE_DIR)) {
        console.error(`[build] ERROR: Source directory not found: ${SOURCE_DIR}`);
        console.error('[build] Create a "web" folder next to this script and copy your Voidflix');
        console.error('[build] HTML/CSS/JS files into it, then run npm run build again.');
        process.exit(1);
    }

    // 1. Clean and recreate app/
    if (fs.existsSync(APP_DIR)) fs.rmSync(APP_DIR, { recursive: true });
    ensureDir(APP_DIR);

    // 2. Copy entire web source tree into app/
    copyDir(SOURCE_DIR, APP_DIR);
    console.log('[build] Web source copied to app/');

    // 3. Copy electron-specific scripts into app/
    for (const scriptName of ['titlebar.js', 'electron-adapter.js']) {
        const src  = path.join(SRC_DIR, scriptName);
        const dest = path.join(APP_DIR, scriptName);
        if (fs.existsSync(src)) {
            copyFile(src, dest);
            console.log(`[build] Copied ${scriptName} → app/`);
        } else {
            console.warn(`[build] WARNING: ${src} not found — skipping`);
        }
    }

    // 4. Copy emulation patch into app/
    const emPatch = path.join(PATCHES_DIR, 'emulation-electron-patch.js');
    if (fs.existsSync(emPatch)) {
        copyFile(emPatch, path.join(APP_DIR, 'emulation-electron-patch.js'));
        console.log('[build] Copied emulation-electron-patch.js → app/');
    }

    // 5. Patch voidflix.js — change TMDB_BASE to absolute localhost URL
    const vjsPath = path.join(APP_DIR, 'voidflix.js');
    if (fs.existsSync(vjsPath)) {
        let vjs = fs.readFileSync(vjsPath, 'utf8');

        // Patch TMDB base URL
        vjs = vjs.replace(
            /const TMDB_BASE\s*=\s*['"][^'"]+['"]/,
            "const TMDB_BASE = 'http://127.0.0.1:3579/tmdb/3'"
        );

        // Patch ACTIVITY_API so Pi-backend calls go to the embedded proxy stub
        vjs = vjs.replace(
            /const ACTIVITY_API\s*=\s*['"][^'"]*['"]/,
            "const ACTIVITY_API = 'http://127.0.0.1:3579'"
        );

        fs.writeFileSync(vjsPath, vjs, 'utf8');
        console.log('[build] Patched voidflix.js (TMDB_BASE + ACTIVITY_API)');
    } else {
        console.warn('[build] WARNING: voidflix.js not found in source — TMDB will not work');
    }

    // 6. Inject script tags into every HTML file
    const htmlFiles = fs.readdirSync(APP_DIR).filter(f => f.endsWith('.html'));

    const TITLEBAR_TAG  = `<script src="titlebar.js"></script>`;
    const ADAPTER_TAG   = `<script src="electron-adapter.js"></script>`;
    const EM_PATCH_TAG  = `<script src="emulation-electron-patch.js"></script>`;

    for (const htmlFile of htmlFiles) {
        const filePath = path.join(APP_DIR, htmlFile);
        let html = fs.readFileSync(filePath, 'utf8');

        // Build the injection block for this file
        let injection = `\n    <!-- Electron desktop additions -->\n    ${TITLEBAR_TAG}\n    ${ADAPTER_TAG}\n`;
        if (EMULATION_PAGES.includes(htmlFile)) {
            injection += `    ${EM_PATCH_TAG}\n`;
        }

        // Inject just before </body>
        if (html.includes('</body>')) {
            html = html.replace('</body>', injection + '</body>');
            fs.writeFileSync(filePath, html, 'utf8');
            console.log(`[build] Injected scripts into ${htmlFile}`);
        } else {
            console.warn(`[build] WARNING: No </body> tag in ${htmlFile} — skipped injection`);
        }
    }

    console.log('\n[build] ✓ Build complete. Output in app/');
    console.log('[build] Run "npm run build" to package into a .exe installer.');
    console.log('[build] Run "npm start" to launch in dev mode.\n');
}

build();
