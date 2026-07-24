// ==================== VOIDFLIX TITLEBAR ====================
(function () {
    if (typeof window === 'undefined') return;
    if (!window.electronAPI) return;

    const style = document.createElement('style');
    style.textContent = `
        nav {
            -webkit-app-region: drag;
            top: 0 !important;
        }

        nav a,
        nav button,
        nav input,
        nav svg,
        .nav-search,
        .nav-browse-wrap,
        .browse-dropdown,
        .burger-btn {
            -webkit-app-region: no-drag;
        }

        #vf-wbtns {
            display: flex;
            align-items: center;
            gap: 2px;
            -webkit-app-region: no-drag;
            flex-shrink: 0;
            margin-left: 12px;
        }

        .vf-wbtn {
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(255,255,255,0.06);
            border: 0.5px solid rgba(255,255,255,0.1);
            border-radius: 6px;
            cursor: pointer;
            color: rgba(255,255,255,0.7);
            transition: background 0.15s, color 0.15s, border-color 0.15s;
            -webkit-app-region: no-drag;
            padding: 0;
            flex-shrink: 0;
        }

        .vf-wbtn:hover {
            background: rgba(255,255,255,0.15);
            border-color: rgba(255,255,255,0.25);
            color: #fff;
        }

        .vf-wbtn.close:hover {
            background: rgba(229,62,62,0.8);
            border-color: rgba(229,62,62,0.9);
            color: #fff;
        }

        .player-overlay { top: 0 !important; }
        .player-overlay.show { top: 0 !important; }
    `;
    document.head.appendChild(style);

    function injectButtons() {
        // Inject into nav-right, after the gear — stays inside nav-inner's max-width
        const navRight = document.querySelector('.nav-right');
        if (!navRight) { setTimeout(injectButtons, 50); return; }
        if (document.getElementById('vf-wbtns')) return;

        const btns = document.createElement('div');
        btns.id = 'vf-wbtns';
        btns.innerHTML = `
            <button class="vf-wbtn minimize" id="vfBtnMin" title="Minimize">
                <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
            </button>
            <button class="vf-wbtn maximize" id="vfBtnMax" title="Maximize">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <rect x="0.5" y="0.5" width="9" height="9" rx="0.5" stroke="currentColor"/>
                </svg>
            </button>
            <button class="vf-wbtn close" id="vfBtnClose" title="Close">
                <svg width="10" height="10" viewBox="0 0 10 10">
                    <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                    <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                </svg>
            </button>
        `;

        navRight.appendChild(btns);

        document.getElementById('vfBtnMin').addEventListener('click', () => window.electronAPI.minimize());
        document.getElementById('vfBtnMax').addEventListener('click', () => window.electronAPI.maximize());
        document.getElementById('vfBtnClose').addEventListener('click', () => window.electronAPI.close());

        const maxBtn = document.getElementById('vfBtnMax');
        const ICON_MAX     = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="0.5" y="0.5" width="9" height="9" rx="0.5" stroke="currentColor"/></svg>`;
        const ICON_RESTORE = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <rect x="2.5" y="0.5" width="7" height="7" rx="0.5" stroke="currentColor"/>
            <path d="M0.5 3v6.5H7" stroke="currentColor" stroke-width="1"/>
        </svg>`;

        const removeListener = window.electronAPI.onMaximized((isMax) => {
            maxBtn.innerHTML = isMax ? ICON_RESTORE : ICON_MAX;
            maxBtn.title     = isMax ? 'Restore' : 'Maximize';
        });

        window.addEventListener('unload', removeListener);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectButtons);
    } else {
        injectButtons();
    }
})();
