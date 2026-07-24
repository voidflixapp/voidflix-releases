// ==================== EMULATION ELECTRON PATCH ====================
// Appended to emulation.html in the packaged app build.
// Adds: ROM folder picker UI, local file loading via IPC data URLs.
// ==================================================================

(function () {
    if (!window.electronAPI) return; // browser — no-op



    // ── Patch playGame to use local data URLs ─────────────────────────────────
    // The original playGame sets EJS_gameUrl to 'roms/<console>/<file>'.
    // That relative URL works on the Pi web server but not from file:// or localhost.
    // We replace it with a data URL loaded via IPC.

    const _origPlayGame = window.playGame;

    window.playGame = async function (consoleName, file, name) {
        // Show a loading state in the player bar if it exists
        const titleEl = document.getElementById('playerTitle');
        const overlay = document.getElementById('playerOverlay');
        if (titleEl) titleEl.textContent = `Loading ${name}…`;
        if (overlay) overlay.classList.add('show');

        let dataUrl;
        try {
            // file may already be encodeURIComponent'd from gameCardHTML
            const decodedFile = decodeURIComponent(file);
            dataUrl = await window.electronLoadRom(consoleName, decodedFile);
        } catch (e) {
            if (titleEl) titleEl.textContent = `Failed to load ${name}`;
            console.error('[roms] Failed to read ROM:', e);
            return;
        }

        // Now call the original but with EJS_gameUrl overridden
        // We set it before calling so the original's script injection picks it up
        window._pendingRomDataUrl   = dataUrl;
        window._pendingRomOverride  = true;

        // Call original — it sets EJS_gameUrl to 'roms/...'; we'll override below
        if (_origPlayGame) _origPlayGame.call(this, consoleName, file, name);
    };

    // After the original playGame sets EJS_gameUrl, override it with the data URL
    // We use a MutationObserver watching for the ejsLoader script being added.
    const _origAppendChild = document.body.appendChild.bind(document.body);
    document.body.appendChild = function (el) {
        const result = _origAppendChild(el);
        if (el.id === 'ejsLoader' && window._pendingRomOverride) {
            window.EJS_gameUrl           = window._pendingRomDataUrl;
            window._pendingRomDataUrl    = null;
            window._pendingRomOverride   = false;
        }
        return result;
    };



})();
