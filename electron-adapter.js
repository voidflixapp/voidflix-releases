// ==================== VOIDFLIX ELECTRON ADAPTER ====================
'use strict';

(function () {
    if (!window.electronAPI) return;

    // ── 1. DISCORD RICH PRESENCE ─────────────────────────────────────────────
    const _origStart = window.startActivityHeartbeat;
    const _origStop  = window.stopActivityHeartbeat;
    let _sessionStart = null;

    window.startActivityHeartbeat = function (title, subtitle, kind) {
        if (_origStart) _origStart.call(this, title, subtitle, kind);
        _sessionStart = Date.now();
        const isGame = kind === '🕹' || kind === '??';
        window.electronAPI.discord.watching({
            title, subtitle,
            type:           isGame ? 'game' : 'movie',
            startTimestamp: _sessionStart,
        });
    };

    window.stopActivityHeartbeat = function () {
        if (_origStop) _origStop.call(this);
        _sessionStart = null;
        window.electronAPI.discord.idle();
    };

    window.electronAPI.discord.idle();

    // ── 2. FIX location.origin FOR STREAMING IFRAMES ─────────────────────────
    // Provider URLs use location.origin to build fallback_url param.
    // When loaded from file:// this is "null" — broken. Override with proxy base.
    const PROXY_ORIGIN = 'http://127.0.0.1:3579';

    // Patch each provider's movie/tv functions to use the correct origin
    // We wait for voidflix.js to define PROVIDERS then patch it
    function patchProviders() {
        if (typeof PROVIDERS === 'undefined') {
            setTimeout(patchProviders, 50);
            return;
        }
        Object.values(PROVIDERS).forEach(p => {
            if (p.movie) {
                const _m = p.movie;
                p.movie = (id) => _m(id).replace(/fallback_url=[^&]*/g,
                    `fallback_url=${encodeURIComponent(PROXY_ORIGIN + '/stream-unavailable.html')}`);
            }
            if (p.tv) {
                const _t = p.tv;
                p.tv = (id, s, e) => _t(id, s, e).replace(/fallback_url=[^&]*/g,
                    `fallback_url=${encodeURIComponent(PROXY_ORIGIN + '/stream-unavailable.html')}`);
            }
        });
    }
    patchProviders();

    // ── 3. ROM LIBRARY AUTO-LOAD VIA IPC ─────────────────────────────────────
    // Auto-detect the default roms root and store it — no manual folder pick needed
    async function initRomsRoot() {
        let root = localStorage.getItem('vf_roms_root');
        if (!root) {
            root = await window.electronAPI.roms.getDefaultRoot();
            if (root) localStorage.setItem('vf_roms_root', root);
        }
        return root;
    }

    // Intercept /api/roms fetch and route to IPC
    const _origFetch = window.fetch.bind(window);
    window.fetch = async function (input, init) {
        const url = typeof input === 'string' ? input : (input?.url || '');
        const isRomsCall = url === '/api/roms' || url.includes('/api/roms');
        if (isRomsCall) {
            try {
                // Prefer rom_path from query string (set by the folder selector),
                // then localStorage, then the Electron default root.
                let root = null;
                try {
                    const u = new URL(url, location.href);
                    root = u.searchParams.get('rom_path') || null;
                } catch (_) {}
                if (root) localStorage.setItem('vf_roms_root', root);
                root = root || localStorage.getItem('vf_roms_root') || await window.electronAPI.roms.getDefaultRoot();
                const library = await window.electronAPI.roms.getLibrary(root);
                return new Response(JSON.stringify(library), {
                    status: 200, headers: { 'Content-Type': 'application/json' },
                });
            } catch (e) {
                return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
        }
        return _origFetch(input, init);
    };

    // ── 4. ROM FILE SERVING ───────────────────────────────────────────────────
    window.electronLoadRom = async function (consoleName, filename) {
        const root = localStorage.getItem('vf_roms_root') || await window.electronAPI.roms.getDefaultRoot();
        return window.electronAPI.roms.readFile(root, consoleName, filename);
    };

    window.electronChooseRomsFolder = async function () {
        const chosen = await window.electronAPI.roms.chooseFolder();
        if (chosen) {
            localStorage.setItem('vf_roms_root', chosen);
            return chosen;
        }
        return null;
    };

    // Set ROM root then trigger library load regardless — loadLibrary handles empty root
window.electronAPI.roms.getDefaultRoot().then(root => {
    if (root) localStorage.setItem('vf_roms_root', root);
    if (typeof loadLibrary === 'function') loadLibrary();
});

})();