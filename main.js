// ==================== VOIDFLIX ELECTRON MAIN PROCESS ====================
'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path    = require('path');
const fs      = require('fs');
const https   = require('https');
const http    = require('http');
const { URL } = require('url');

// ── Discord RPC ───────────────────────────────────────────────────────────────
let DiscordRPC = null;
let rpcClient  = null;
let rpcReady   = false;

const DISCORD_CLIENT_ID = process.env.VOIDFLIX_DISCORD_ID || '1529438728836218960';

async function initDiscord() {
    try {
        DiscordRPC = require('discord-rpc');
        DiscordRPC.register(DISCORD_CLIENT_ID);
        rpcClient = new DiscordRPC.Client({ transport: 'ipc' });
        rpcClient.on('ready', () => {
            rpcReady = true;
            console.log('[discord] RPC ready —', rpcClient.user?.username);
            setDiscordIdle();
        });
        await rpcClient.login({ clientId: DISCORD_CLIENT_ID });
    } catch (e) {
        console.warn('[discord] RPC unavailable:', e.message);
        rpcClient = null;
        rpcReady  = false;
    }
}

function setDiscordActivity(details, state, startTimestamp, largeImageKey = 'voidflix_logo') {
    if (!rpcClient || !rpcReady) return;
    try {
        rpcClient.setActivity({
            details, state, startTimestamp,
            largeImageKey, largeImageText: 'Voidflix',
            smallImageKey: 'play', smallImageText: 'Watching',
            instance: false,
        });
    } catch (e) { console.warn('[discord] setActivity failed:', e.message); }
}

function setDiscordIdle() {
    if (!rpcClient || !rpcReady) return;
    try {
        rpcClient.setActivity({
            details: 'Browsing', state: 'Looking for something to watch',
            largeImageKey: 'voidflix_logo', largeImageText: 'Voidflix',
            instance: false,
        });
    } catch (e) {}
}

function clearDiscordActivity() {
    if (!rpcClient || !rpcReady) return;
    try { rpcClient.clearActivity(); } catch (e) {}
}

ipcMain.on('discord:watching', (_e, payload) => {
    const { title, subtitle, type, startTimestamp } = payload;
    setDiscordActivity(
        title,
        subtitle || (type === 'game' ? 'Playing' : 'Watching'),
        startTimestamp ? new Date(startTimestamp) : new Date(),
        type === 'game' ? 'arcade_icon' : 'voidflix_logo'
    );
});
ipcMain.on('discord:idle',  () => setDiscordIdle());
ipcMain.on('discord:clear', () => clearDiscordActivity());

// ── ROM library ───────────────────────────────────────────────────────────────
const SUPPORTED_CONSOLES = ['nes','snes','n64','gba','gbc','gb','genesis','psx'];

function getRomExtensions(con) {
    return {
        nes: ['.nes'], snes: ['.sfc','.smc'], n64: ['.n64','.z64','.v64'],
        gba: ['.gba'], gbc: ['.gbc'], gb: ['.gb'],
        genesis: ['.md','.gen','.bin'], psx: ['.iso','.bin','.cue','.pbp'],
    }[con] || [];
}

function cleanGameName(f) {
    return f.replace(/\.[^/.]+$/, '').replace(/\s*\(.*?\)/g, '')
             .replace(/\s*\[.*?\]/g, '').replace(/_/g, ' ').trim();
}

function getRomsRoot() {
    const candidate = app.isPackaged
        ? path.join(process.resourcesPath, 'roms')
        : path.join(__dirname, '..', 'roms');
    return fs.existsSync(candidate) ? candidate : null;
}

ipcMain.handle('roms:getDefaultRoot', () => getRomsRoot());

ipcMain.handle('roms:getLibrary', async (_e, romsRoot) => {
    const root    = romsRoot || getRomsRoot();
    const library = {};
    for (const con of SUPPORTED_CONSOLES) {
        const dir = path.join(root, con);
        if (!fs.existsSync(dir)) continue;
        try {
            const exts  = getRomExtensions(con);
            const games = fs.readdirSync(dir)
                .filter(f => exts.includes(path.extname(f).toLowerCase()))
                .map(f => ({ name: cleanGameName(f), file: f }))
                .sort((a, b) => a.name.localeCompare(b.name));
            if (games.length) library[con] = games;
        } catch (e) { console.warn(`[roms] ${dir}:`, e.message); }
    }
    return library;
});

ipcMain.handle('roms:chooseFolder', async () => {
    const result = await dialog.showOpenDialog({
        title: 'Select ROMs Folder', buttonLabel: 'Use This Folder',
        properties: ['openDirectory'],
    });
    return result.canceled || !result.filePaths.length ? null : result.filePaths[0];
});

ipcMain.handle('roms:readFile', async (_e, romsRoot, consoleName, filename) => {
    const root     = romsRoot || getRomsRoot();
    const filePath = path.join(root, consoleName, filename);
    if (!fs.existsSync(filePath)) throw new Error('ROM not found: ' + filePath);
    const buf = fs.readFileSync(filePath);
    return `data:application/octet-stream;base64,${buf.toString('base64')}`;
});

// ── Window controls ───────────────────────────────────────────────────────────
ipcMain.on('window:minimize', () => BrowserWindow.getFocusedWindow()?.minimize());
ipcMain.on('window:maximize', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) win.isMaximized() ? win.unmaximize() : win.maximize();
});
ipcMain.on('window:close', () => BrowserWindow.getFocusedWindow()?.close());

// ── Proxy ─────────────────────────────────────────────────────────────────────
const TMDB_KEY   = process.env.TMDB_KEY || '';
const TMDB_HOST  = 'api.themoviedb.org';
const ANIKOTO    = 'anikotoapi.site';
const PROXY_PORT = 3579;
let   proxyServer = null;

// ── Server-side response cache ────────────────────────────────────────────────
// Absorbs repeated requests so the page never hammers Anikoto directly.
// Anikoto docs warn: 60 req / 120s per IP; hitting it from the renderer on
// every render cycle triggers 429s within seconds on a full 20-card grid load.
const proxyCache       = new Map();
const CACHE_TTL_LIST   = 5  * 60 * 1000;   // recent-anime listings: 5 min
const CACHE_TTL_SERIES = 30 * 60 * 1000;   // series detail: 30 min (episodes don't change mid-session)
const CACHE_TTL_IMG    = 60 * 60 * 1000;   // poster images: 1 hour

function getCacheTTL(cacheKey) {
    if (cacheKey.includes('/series/'))      return CACHE_TTL_SERIES;
    if (cacheKey.startsWith('img:'))        return CACHE_TTL_IMG;
    return CACHE_TTL_LIST;
}

function getCached(key) {
    const entry = proxyCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > getCacheTTL(key)) { proxyCache.delete(key); return null; }
    return entry;
}

function setCached(key, body, contentType) {
    // Evict oldest entries if cache grows past 200 items (memory guard)
    if (proxyCache.size >= 200) {
        const oldest = [...proxyCache.entries()].sort((a,b) => a[1].ts - b[1].ts)[0];
        proxyCache.delete(oldest[0]);
    }
    proxyCache.set(key, { body, contentType, ts: Date.now() });
}

// Forward a GET with server-side cache + one 429 retry
function forwardGet(res, hostname, urlPath, attempt) {
    if (attempt === undefined) attempt = 0;
    const cacheKey = hostname + urlPath;
    const cached   = getCached(cacheKey);
    if (cached) {
        res.writeHead(200, {
            'Content-Type':                cached.contentType,
            'Access-Control-Allow-Origin': '*',
            'X-Cache':                     'HIT',
        });
        res.end(cached.body);
        return;
    }

    const req = https.request(
        {
            hostname, port: 443, path: urlPath, method: 'GET',
            headers: {
                'Accept':     'application/json',
                'User-Agent': 'Voidflix-Desktop/1.0',
            },
        },
        function(upstream) {
            // Rate limited — back off Retry-After seconds and retry once
            if (upstream.statusCode === 429 && attempt === 0) {
                const wait = Math.max(2, parseInt(upstream.headers['retry-after'] || '2', 10)) * 1000;
                upstream.resume();
                setTimeout(function() { forwardGet(res, hostname, urlPath, 1); }, wait);
                return;
            }

            const chunks = [];
            upstream.on('data', function(c) { chunks.push(c); });
            upstream.on('end', function() {
                const body        = Buffer.concat(chunks);
                const contentType = upstream.headers['content-type'] || 'application/json';
                if (upstream.statusCode === 200) setCached(cacheKey, body, contentType);
                if (!res.headersSent) {
                    res.writeHead(upstream.statusCode, {
                        'Content-Type':                contentType,
                        'Access-Control-Allow-Origin': '*',
                        'X-Cache':                     'MISS',
                    });
                    res.end(body);
                }
            });
            upstream.on('error', function(err) {
                if (!res.headersSent) { res.writeHead(502); res.end(JSON.stringify({ error: err.message })); }
            });
        }
    );
    req.on('error', function(err) {
        if (!res.headersSent) { res.writeHead(502); res.end(JSON.stringify({ error: err.message })); }
    });
    req.setTimeout(10000, function() { req.destroy(); });
    req.end();
}

function startProxy() {
    proxyServer = http.createServer(function(req, res) {
        res.setHeader('Access-Control-Allow-Origin',  '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

        if (req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ status: 'ok', mode: 'electron', cacheSize: proxyCache.size }));
        }

        if (req.url.startsWith('/api/')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            if (req.url === '/api/lock_status') return res.end(JSON.stringify({ locked: false }));
            if (req.url === '/api/broadcast')   return res.end(JSON.stringify({ id: 0, text: '' }));
            if (req.url === '/api/roms') {
                const root = getRomsRoot();
                const library = {};
                if (root) {
                    for (const con of SUPPORTED_CONSOLES) {
                        const dir = path.join(root, con);
                        if (!fs.existsSync(dir)) continue;
                        try {
                            const exts  = getRomExtensions(con);
                            const games = fs.readdirSync(dir)
                                .filter(f => exts.includes(path.extname(f).toLowerCase()))
                                .map(f => ({ name: cleanGameName(f), file: f }))
                                .sort((a, b) => a.name.localeCompare(b.name));
                            if (games.length) library[con] = games;
                        } catch (e) { console.warn('[roms] ' + dir + ':', e.message); }
                    }
                }
                return res.end(JSON.stringify(library));
            }
            return res.end(JSON.stringify({ ok: true }));
        }

        // ── Image proxy ───────────────────────────────────────────────────────
        // Renderer fetches /imgproxy?url=<encoded> — pipes CDN image back through
        // localhost so the renderer never makes direct requests to external image
        // hosts (kills CORS / mixed-content blocks in the Electron webview).
        // Whitelisted hostnames only — not an open relay.
        if (req.url.startsWith('/imgproxy?')) {
            const IMG_WHITELIST = [
                'cdn.anikoto.site', 'img.anikoto.site', 'anikotoapi.site',
                's4.anilist.co', 'img.anili.st', 'media.kitsu.io',
                'cdn.myanimelist.net', 'img1.ak.crunchyroll.com',
                'img.crunchyroll.com', 'image.tmdb.org',
                'static.zerochan.net', 'i.imgur.com',
                'cdn.anipixcdn.co', 'anipixcdn.co',
            ];
            let targetUrl;
            try {
                const qs = new URL('http://x' + req.url).searchParams;
                targetUrl = new URL(decodeURIComponent(qs.get('url') || ''));
            } catch(e) { res.writeHead(400); res.end(); return; }

            if (!IMG_WHITELIST.includes(targetUrl.hostname)) {
                res.writeHead(403);
                res.end(JSON.stringify({ error: 'hostname not whitelisted: ' + targetUrl.hostname }));
                return;
            }

            const imgCacheKey = 'img:' + targetUrl.href;
            const imgCached   = getCached(imgCacheKey);
            if (imgCached) {
                res.writeHead(200, {
                    'Content-Type':                imgCached.contentType,
                    'Cache-Control':               'public, max-age=3600',
                    'Access-Control-Allow-Origin': '*',
                    'X-Cache':                     'HIT',
                });
                res.end(imgCached.body);
                return;
            }

            const imgReq = https.request(
                {
                    hostname: targetUrl.hostname,
                    port: 443,
                    path: targetUrl.pathname + targetUrl.search,
                    method: 'GET',
                    headers: { 'User-Agent': 'Voidflix-Desktop/1.0', 'Accept': 'image/*,*/*' },
                },
                function(upstream) {
                    const chunks = [];
                    upstream.on('data', function(c) { chunks.push(c); });
                    upstream.on('end', function() {
                        const body        = Buffer.concat(chunks);
                        const contentType = upstream.headers['content-type'] || 'image/jpeg';
                        if (upstream.statusCode === 200) setCached(imgCacheKey, body, contentType);
                        if (!res.headersSent) {
                            res.writeHead(upstream.statusCode, {
                                'Content-Type':                contentType,
                                'Cache-Control':               'public, max-age=3600',
                                'Access-Control-Allow-Origin': '*',
                            });
                            res.end(body);
                        }
                    });
                    upstream.on('error', function(err) {
                        if (!res.headersSent) { res.writeHead(502); res.end(); }
                    });
                }
            );
            imgReq.on('error', function(err) {
                if (!res.headersSent) { res.writeHead(502); res.end(); }
            });
            imgReq.setTimeout(8000, function() { imgReq.destroy(); });
            imgReq.end();
            return;
        }

        // ── Anikoto proxy ─────────────────────────────────────────────────────
        // /anikoto/recent-anime?page=1&per_page=20
        // /anikoto/series/{id}
        // /anikoto/anime/{id}    ← alternate route Anikoto sometimes uses
        if (req.url.startsWith('/anikoto/')) {
            const anikotoPath = req.url.replace(/^\/anikoto/, '');
            forwardGet(res, ANIKOTO, anikotoPath);
            return;
        }

        // ── TMDB proxy ────────────────────────────────────────────────────────
        if (req.url.startsWith('/tmdb/')) {
            const tmdbPath = req.url.replace(/^\/tmdb/, '');
            let urlObj;
            try { urlObj = new URL('https://' + TMDB_HOST + tmdbPath); }
            catch (e) { res.writeHead(400); res.end(); return; }
            urlObj.searchParams.set('api_key', TMDB_KEY);
            forwardGet(res, TMDB_HOST, urlObj.pathname + '?' + urlObj.searchParams.toString());
            return;
        }

        res.writeHead(404); res.end();
    });

    proxyServer.listen(PROXY_PORT, '127.0.0.1', function() {
        console.log('[proxy] Running on http://127.0.0.1:' + PROXY_PORT);
    });
}

// ── BrowserWindow ─────────────────────────────────────────────────────────────
let mainWindow = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280, height: 800, minWidth: 900, minHeight: 600,
        frame: false, titleBarStyle: 'hidden',
        backgroundColor: '#0a0a0f', show: false,
        icon: process.platform === 'win32'
            ? path.join(__dirname, '..', 'assets', 'favicon.ico')
            : path.join(__dirname, '..', 'assets', 'favicon.png'),
        webPreferences: {
            preload:          path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration:  false,
            devTools:         false,
            webSecurity:      false,
            allowRunningInsecureContent: false,
        },
    });

    mainWindow.webContents.on('before-input-event', function(_e, input) {
        if (input.key === 'F12' ||
            (input.control && input.shift && ['I','J','C'].includes(input.key)) ||
            (input.control && input.key === 'U')) {
            _e.preventDefault();
        }
    });
    mainWindow.webContents.on('devtools-opened', function() { mainWindow.webContents.closeDevTools(); });

    mainWindow.once('ready-to-show', function() { mainWindow.show(); });
    mainWindow.on('maximize',   function() { mainWindow.webContents.send('window:maximized', true); });
    mainWindow.on('unmaximize', function() { mainWindow.webContents.send('window:maximized', false); });

    const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    mainWindow.webContents.setUserAgent(CHROME_UA);

    mainWindow.webContents.session.setCertificateVerifyProc(function(request, callback) {
        const bypass = ['animeplay.cfd', 'megaplay.buzz', 'vidlink.pro', 'vixsrc.to', 'vidcore.org', 'vaplayer.ru'];
        if (bypass.some(h => request.hostname === h || request.hostname.endsWith('.' + h))) {
            callback(0); // 0 = verified OK, bypass SSL check
        } else {
            callback(-3); // -3 = use default Chromium verification
        }
    });

    mainWindow.webContents.session.webRequest.onBeforeSendHeaders(function(details, callback) {
        const headers = {
            ...details.requestHeaders,
            'User-Agent': CHROME_UA,
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        };
        if (details.url.includes('vidlink.pro') || details.url.includes('vixsrc.to') ||
            details.url.includes('vidcore.org')  || details.url.includes('vaplayer.ru') ||
            details.url.includes('animeplay.cfd') || details.url.includes('megaplay.buzz')) {
            headers['Referer'] = 'https://www.google.com/';
            headers['Origin']  = 'https://www.google.com';
        }
        callback({ requestHeaders: headers });
    });

    mainWindow.webContents.session.webRequest.onHeadersReceived(function(details, callback) {
        const headers = { ...details.responseHeaders };
        delete headers['x-frame-options'];
        delete headers['X-Frame-Options'];
        delete headers['content-security-policy'];
        delete headers['Content-Security-Policy'];
        delete headers['x-content-type-options'];
        callback({ responseHeaders: headers });
    });

    mainWindow.loadFile(path.join(__dirname, '..', 'app', 'index.html'));
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
// Must be set before the window is created — this is what Windows Volume Mixer
// and the taskbar use to identify the app and pull the correct icon.
app.setAppUserModelId('com.voidflix.app');

app.whenReady().then(async function() {
    startProxy();
    await initDiscord();
    createWindow();
    app.on('activate', function() { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', function() {
    if (proxyServer) proxyServer.close();
    if (rpcClient)   try { rpcClient.destroy(); } catch(e) {}
    if (process.platform !== 'darwin') app.quit();
});
