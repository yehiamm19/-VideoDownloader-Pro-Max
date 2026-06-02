(function() {
    if (window._proMaxOverlayInjected) return;
    window._proMaxOverlayInjected = true;

    const FROM_CONTENT_TO_SERVICE = 1;
    const HIGH_MBPM_WARN = 12;
    let activeVideo = null;

    function isExtensionContextValid() {
        try {
            return Boolean(chrome.runtime && chrome.runtime.id);
        } catch (e) {
            return false;
        }
    }

    function isInvalidatedMessage(err) {
        if (!err) return false;
        const m = typeof err === 'string' ? err : (err.message || String(err));
        return /Extension context invalidated|message port closed|Receiving end does not exist/i.test(m);
    }

    function showReloadHintBtn() {
        btn.innerHTML = 'Reload page (extension was updated)';
    }

    function vdhApi() {
        return window.__vdhYoutubeDataSize;
    }

    function isYoutubeWatchPage() {
        try {
            const h = location.hostname || '';
            if (!h.includes('youtube.com') && h !== 'youtu.be') return false;
            return (
                location.pathname.indexOf('/watch') === 0 ||
                location.pathname.indexOf('/shorts/') === 0
            );
        } catch (e) {
            return false;
        }
    }

    /**
     * Quality sizes uses __vdhYoutubeDataSize (YouTube only today). Hide the menu item elsewhere.
     * Extend when another host ships a compatible window.*DataSize API + content script.
     */
    function isQualitySizesSupportedPage() {
        return isYoutubeWatchPage();
    }

    /** For copy in modal: 3725s → "1h 2m" (hours + minutes, no seconds). */
    function formatDurationHoursMinutes(durSec) {
        const s = Math.max(0, Math.floor(durSec || 0));
        const m = Math.floor(s / 60);
        const h = Math.floor(m / 60);
        if (h > 0) {
            return h + 'h ' + (m % 60) + 'm';
        }
        if (m > 0) {
            return m + 'm';
        }
        return s + 's';
    }

    function formatBytesFromExtension(media) {
        if (!media) return '';
        if (media.size_bytes && media.size_bytes > 0) {
            return (media.size_bytes / 1024 / 1024).toFixed(1) + ' MB';
        }
        const len = media.details && media.details.length;
        if (len && len > 0) {
            return (len / 1024 / 1024).toFixed(1) + ' MB';
        }
        return media._displaySize || '';
    }

    function ensureVdhThen(fn) {
        const api = vdhApi();
        if (!isYoutubeWatchPage() || !api || typeof api.refresh !== 'function') {
            fn();
            return;
        }
        Promise.resolve(api.refresh()).then(fn).catch(fn);
    }

    /**
     * Download menu: show total file size for that quality only (no per-min / per-hour here).
     */
    function formatDownloadSizeText(media) {
        const base = formatBytesFromExtension(media);
        if (!isYoutubeWatchPage()) {
            return base || '—';
        }
        const api = vdhApi();
        if (api && typeof api.sizeHintForMedia === 'function') {
            const hint = api.sizeHintForMedia(media);
            if (hint && hint.line) {
                return hint.line;
            }
        }
        return base || '—';
    }

    let hideTimeout;
    const rubikArabicUrl = chrome.runtime.getURL('assets/fonts/rubik-arabic.woff2');
    const rubikLatinUrl = chrome.runtime.getURL('assets/fonts/rubik-latin.woff2');
    const uiFont = '"Rubik Pro Max", "Segoe UI", Tahoma, Arial, sans-serif';

    const style = document.createElement('style');
    style.textContent = `
        @font-face {
            font-family: "Rubik Pro Max";
            font-style: normal;
            font-weight: 400 700;
            font-display: swap;
            src: url("${rubikArabicUrl}") format("woff2");
            unicode-range: U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891, U+0897-08E1, U+08E3-08FF, U+FB50-FDFF, U+FE70-FEFC;
        }
        @font-face {
            font-family: "Rubik Pro Max";
            font-style: normal;
            font-weight: 400 700;
            font-display: swap;
            src: url("${rubikLatinUrl}") format("woff2");
            unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122;
        }
        .vdh-qs-modal-overlay {
            position: fixed; inset: 0; z-index: 2147483646;
            background: rgba(6, 4, 12, 0.72);
            backdrop-filter: blur(8px);
            display: none; align-items: center; justify-content: center;
            padding: 20px;
            font-family: ${uiFont};
            direction: ltr;
            text-align: left;
        }
        .vdh-qs-modal {
            width: min(520px, 96vw);
            max-height: min(86vh, 720px);
            overflow: hidden;
            display: flex;
            flex-direction: column;
            border-radius: 18px;
            border: 1px solid rgba(255, 45, 130, 0.45);
            background: linear-gradient(165deg, rgba(28, 26, 38, 0.98), rgba(14, 12, 22, 0.99));
            box-shadow: 0 28px 80px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.06);
        }
        .vdh-qs-modal-hd {
            padding: 18px 20px 12px;
            border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        .vdh-qs-modal-hd h2 {
            margin: 0 0 6px;
            font-size: 1.15rem;
            font-weight: 800;
            color: #fff;
            letter-spacing: 0.02em;
        }
        .vdh-qs-modal-hd .sub {
            font-size: 12px;
            color: rgba(255,248,251,0.65);
            line-height: 1.45;
        }
        .vdh-qs-warn {
            margin: 12px 20px 0;
            padding: 12px 14px;
            border-radius: 12px;
            background: linear-gradient(135deg, rgba(255, 80, 0, 0.2), rgba(255, 20, 120, 0.15));
            border: 1px solid rgba(255, 140, 80, 0.45);
            color: #ffe8e0;
            font-size: 12px;
            line-height: 1.5;
            font-weight: 600;
        }
        .vdh-qs-body { overflow-y: auto; padding: 12px 16px 16px; flex: 1; }
        .vdh-qs-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
            color: #f4f0f5;
        }
        .vdh-qs-table th {
            text-align: left;
            padding: 8px 10px;
            color: rgba(255,200,220,0.85);
            font-weight: 700;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        .vdh-qs-table td {
            padding: 10px;
            border-bottom: 1px solid rgba(255,255,255,0.06);
            vertical-align: top;
        }
        .vdh-qs-table tr:last-child td { border-bottom: 0; }
        .vdh-qs-p { font-size: 11px; color: rgba(255,248,251,0.55); line-height: 1.5; margin-top: 12px; }
        .vdh-qs-x {
            position: absolute; top: 12px; right: 14px;
            width: 32px; height: 32px;
            border: none; border-radius: 10px;
            background: rgba(255,255,255,0.08);
            color: #fff; cursor: pointer; font-size: 18px; line-height: 1;
        }
        .vdh-qs-hd-wrap { position: relative; }
        .vdh-dl-hud-root {
            position: fixed;
            z-index: 2147483645;
            font-family: ${uiFont};
            direction: ltr;
            text-align: left;
            pointer-events: auto;
            --vdh-hud-ring: 113.1;
        }
        .vdh-dl-hud-root.vdh-dl-hud-pos-tr {
            top: 12px;
            bottom: auto;
            left: auto;
            right: 12px;
        }
        .vdh-dl-hud-root.vdh-dl-hud-pos-tl {
            top: 12px;
            bottom: auto;
            left: 12px;
            right: auto;
        }
        .vdh-dl-hud-root.vdh-dl-hud-pos-br {
            top: auto;
            bottom: 12px;
            left: auto;
            right: 12px;
        }
        .vdh-dl-hud-root.vdh-dl-hud-pos-bl {
            top: auto;
            bottom: 12px;
            left: 12px;
            right: auto;
        }
        .vdh-dl-hud-root.vdh-dl-hud-hidden { display: none !important; }
        .vdh-dl-hud-panel {
            width: min(360px, calc(100vw - 24px));
            max-height: min(560px, 72vh);
            border-radius: 14px;
            border: 1px solid rgba(255, 45, 130, 0.45);
            background: linear-gradient(165deg, rgba(28, 26, 38, 0.97), rgba(14, 12, 22, 0.98));
            box-shadow: 0 18px 48px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06);
            padding: 10px 10px 10px;
            color: #fff8fb;
            display: flex;
            flex-direction: column;
            min-height: 0;
        }
        .vdh-dl-hud-list {
            flex: 1 1 auto;
            min-height: 0;
            overflow-x: hidden;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 10px;
            margin-top: 2px;
            padding-right: 3px;
        }
        .vdh-dl-hud-card {
            border-radius: 12px;
            background: rgba(0,0,0,0.24);
            border: 1px solid rgba(255,255,255,0.09);
            padding: 8px 10px 10px;
            flex-shrink: 0;
        }
        .vdh-dl-hud-card-head {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 8px;
            margin-bottom: 6px;
        }
        .vdh-dl-hud-card-title {
            font-size: 11px;
            font-weight: 800;
            color: #fff;
            line-height: 1.35;
            word-break: break-word;
            flex: 1 1 auto;
            min-width: 0;
        }
        .vdh-dl-hud-card-actions {
            display: flex;
            gap: 4px;
            flex-shrink: 0;
        }
        .vdh-dl-hud-card-actions .vdh-dl-hud-ic {
            width: 26px;
            height: 26px;
        }
        .vdh-dl-hud-card-meta {
            font-size: 10px;
            color: rgba(255,248,251,0.68);
            margin-top: 4px;
            line-height: 1.35;
        }
        .vdh-dl-hud-mini-count {
            position: absolute;
            bottom: 2px;
            right: 2px;
            min-width: 17px;
            height: 17px;
            padding: 0 4px;
            border-radius: 9px;
            background: #ff0a7a;
            color: #fff;
            font-size: 10px;
            font-weight: 800;
            display: none;
            align-items: center;
            justify-content: center;
            line-height: 17px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.45);
        }
        .vdh-dl-hud-mini.vdh-dl-hud-multi .vdh-dl-hud-mini-count { display: flex; }
        .vdh-dl-hud-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            margin-bottom: 8px;
        }
        .vdh-dl-hud-title {
            font-size: 12px;
            font-weight: 800;
            letter-spacing: 0.04em;
            text-transform: uppercase;
            color: rgba(255, 200, 220, 0.9);
            flex: 1 1 auto;
            min-width: 0;
        }
        .vdh-dl-hud-actions {
            display: flex;
            gap: 4px;
            align-items: center;
            flex-shrink: 0;
        }
        .vdh-dl-hud-ic {
            width: 28px;
            height: 28px;
            border: none;
            border-radius: 8px;
            background: rgba(255,255,255,0.08);
            color: #fff;
            cursor: pointer;
            font-size: 16px;
            line-height: 1;
            padding: 0;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .vdh-dl-hud-ic:hover:not(:disabled) { background: rgba(255, 10, 122, 0.35); }
        .vdh-dl-hud-ic:disabled { opacity: 0.38; cursor: not-allowed; }
        .vdh-dl-hud-ic.vdh-dl-hud-ic-done {
            background: rgba(40, 180, 100, 0.35);
            color: #d4ffe8;
        }
        .vdh-dl-hud-ic.vdh-dl-hud-ic-done:hover:not(:disabled) {
            background: rgba(50, 200, 120, 0.5);
        }
        .vdh-dl-hud-ic svg {
            display: block;
            width: 14px;
            height: 14px;
        }
        .vdh-dl-hud-bar-bg {
            height: 6px;
            border-radius: 999px;
            background: rgba(255,255,255,0.12);
            overflow: hidden;
        }
        .vdh-dl-hud-bar-fg {
            height: 100%;
            width: 0%;
            border-radius: 999px;
            background: linear-gradient(90deg, #ff0a7a, #ff5a1f);
            transition: width 0.25s ease-out;
        }
        .vdh-dl-hud-bar-bg.vdh-dl-hud-indet {
            background: rgba(255,255,255,0.1);
        }
        .vdh-dl-hud-bar-bg.vdh-dl-hud-indet .vdh-dl-hud-bar-fg {
            width: 38% !important;
            animation: vdh-dl-hud-indet-slide 0.95s ease-in-out infinite alternate;
        }
        @keyframes vdh-dl-hud-indet-slide {
            0% { margin-left: 0; }
            100% { margin-left: 62%; }
        }
        .vdh-dl-hud-meta {
            margin-top: 8px;
            font-size: 11px;
            line-height: 1.35;
            color: rgba(255,248,251,0.72);
        }
        .vdh-dl-hud-name {
            font-weight: 700;
            color: #fff;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 100%;
        }
        .vdh-dl-hud-mini {
            display: none;
            width: 48px;
            height: 48px;
            align-items: center;
            justify-content: center;
            position: relative;
            cursor: pointer;
            border-radius: 50%;
            background: linear-gradient(165deg, rgba(28, 26, 38, 0.95), rgba(14, 12, 22, 0.98));
            border: 1px solid rgba(255, 45, 130, 0.5);
            box-shadow: 0 12px 32px rgba(0,0,0,0.5);
        }
        .vdh-dl-hud-mini svg { display: block; }
        .vdh-dl-hud-ring-prog {
            transition: stroke-dashoffset 0.25s ease-out;
        }
        .vdh-dl-hud-mini-dot {
            position: absolute;
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: #ff0a7a;
            box-shadow: 0 0 0 2px rgba(255,255,255,0.15);
        }
        .vdh-dl-hud-mini.vdh-dl-hud-spin .vdh-dl-hud-mini-dot {
            animation: vdh-dl-hud-pulse 0.9s ease-in-out infinite;
        }
        @keyframes vdh-dl-hud-pulse {
            0%, 100% { transform: scale(0.85); opacity: 0.85; }
            50% { transform: scale(1.05); opacity: 1; }
        }
        .vdh-dl-hud-root.vdh-dl-hud-collapsed .vdh-dl-hud-panel { display: none; }
        .vdh-dl-hud-root.vdh-dl-hud-collapsed .vdh-dl-hud-mini { display: flex; }
    `;
    document.documentElement.appendChild(style);

    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.zIndex = '2147483647';
    container.style.display = 'none';
    container.style.fontFamily = uiFont;
    container.style.flexDirection = 'row-reverse';
    container.style.alignItems = 'flex-start';
    container.style.gap = '8px';
    container.style.opacity = '0';
    container.style.transition = 'opacity 0.18s ease-out, transform 0.18s ease-out';
    container.style.transform = 'translateY(-2px)';

    const toolsWrapper = document.createElement('div');
    toolsWrapper.style.position = 'relative';

    const toolsBtn = document.createElement('button');
    toolsBtn.type = 'button';
    toolsBtn.textContent = 'Tools';
    toolsBtn.style.background = 'rgba(15, 15, 22, 0.88)';
    toolsBtn.style.color = '#fff8fb';
    toolsBtn.style.border = '1px solid rgba(255, 10, 122, 0.6)';
    toolsBtn.style.padding = '10px 14px';
    toolsBtn.style.borderRadius = '12px';
    toolsBtn.style.cursor = 'pointer';
    toolsBtn.style.fontFamily = uiFont;
    toolsBtn.style.fontWeight = '700';
    toolsBtn.style.fontSize = '13px';
    toolsBtn.style.boxShadow = '0 10px 28px rgba(0,0,0,0.4)';

    const toolsMenu = document.createElement('div');
    toolsMenu.style.display = 'none';
    toolsMenu.style.position = 'absolute';
    toolsMenu.style.top = '100%';
    toolsMenu.style.right = '0';
    toolsMenu.style.left = 'auto';
    toolsMenu.style.marginTop = '8px';
    toolsMenu.style.minWidth = '200px';
    toolsMenu.style.background = 'linear-gradient(180deg, rgba(24, 23, 31, 0.98), rgba(13, 13, 19, 0.98))';
    toolsMenu.style.border = '1px solid rgba(255, 10, 122, 0.6)';
    toolsMenu.style.borderRadius = '14px';
    toolsMenu.style.padding = '6px';
    toolsMenu.style.boxShadow = '0 22px 50px rgba(0,0,0,0.55)';
    toolsMenu.style.zIndex = '2';

    const toolItemQs = document.createElement('button');
    toolItemQs.type = 'button';
    toolItemQs.textContent = 'Quality sizes';
    toolItemQs.style.width = '100%';
    toolItemQs.style.textAlign = 'left';
    toolItemQs.style.padding = '11px 12px';
    toolItemQs.style.border = 'none';
    toolItemQs.style.borderRadius = '10px';
    toolItemQs.style.background = 'transparent';
    toolItemQs.style.color = '#fff8fb';
    toolItemQs.style.cursor = 'pointer';
    toolItemQs.style.fontFamily = uiFont;
    toolItemQs.style.fontSize = '13px';
    toolItemQs.style.fontWeight = '600';

    const toolItemSoon = document.createElement('div');
    toolItemSoon.textContent = 'More tools — soon';
    toolItemSoon.style.padding = '8px 12px';
    toolItemSoon.style.fontSize = '11px';
    toolItemSoon.style.color = 'rgba(255,248,251,0.45)';
    toolItemSoon.style.borderTop = '1px solid rgba(255,255,255,0.06)';

    toolsMenu.appendChild(toolItemQs);
    toolsMenu.appendChild(toolItemSoon);
    toolsWrapper.appendChild(toolsBtn);
    toolsWrapper.appendChild(toolsMenu);

    function updateQualitySizesItemVisibility() {
        const on = isQualitySizesSupportedPage();
        toolItemQs.style.display = on ? '' : 'none';
        toolItemQs.setAttribute('aria-hidden', on ? 'false' : 'true');
        toolItemSoon.style.borderTop = on ? '1px solid rgba(255,255,255,0.06)' : 'none';
    }
    updateQualitySizesItemVisibility();
    try {
        let lastQsHref = location.href;
        window.addEventListener('popstate', updateQualitySizesItemVisibility);
        if ((location.hostname || '').indexOf('youtube.com') !== -1) {
            setInterval(function () {
                if (location.href !== lastQsHref) {
                    lastQsHref = location.href;
                    updateQualitySizesItemVisibility();
                }
            }, 400);
        }
    } catch (e) { /* ignore */ }

    const menuWrapper = document.createElement('div');
    menuWrapper.style.position = 'relative';

    const btn = document.createElement('button');
    btn.innerHTML = '⚡ download video';
    btn.style.background = 'linear-gradient(135deg, #ff0a7a 0%, #ff5a1f 100%)';
    btn.style.color = '#fff8fb';
    btn.style.border = '1px solid rgba(255,255,255,0.18)';
    btn.style.padding = '10px 15px';
    btn.style.borderRadius = '12px';
    btn.style.cursor = 'pointer';
    btn.style.fontFamily = uiFont;
    btn.style.fontWeight = '700';
    btn.style.boxShadow = '0 14px 34px rgba(255, 0, 127, 0.30), 0 10px 24px rgba(0,0,0,0.45)';
    btn.style.fontSize = '13px';
    btn.style.lineHeight = '1';
    btn.style.letterSpacing = '0.01em';
    btn.style.textShadow = '0 1px 2px rgba(0,0,0,0.35)';
    btn.style.transition = 'transform 0.16s ease-out, filter 0.16s ease-out, box-shadow 0.16s ease-out';

    btn.addEventListener('mouseenter', () => {
        btn.style.transform = 'translateY(-1px)';
        btn.style.filter = 'brightness(1.06)';
        btn.style.boxShadow = '0 16px 38px rgba(255, 0, 127, 0.38), 0 12px 26px rgba(0,0,0,0.50)';
    });
    btn.addEventListener('mouseleave', () => {
        btn.style.transform = 'translateY(0)';
        btn.style.filter = 'none';
        btn.style.boxShadow = '0 14px 34px rgba(255, 0, 127, 0.30), 0 10px 24px rgba(0,0,0,0.45)';
    });

    const flipBtn = document.createElement('button');
    flipBtn.innerHTML = '⇆';
    flipBtn.title = 'Change button position (right/left)';
    flipBtn.style.background = 'rgba(15, 15, 22, 0.78)';
    flipBtn.style.color = '#fff8fb';
    flipBtn.style.border = '1px solid rgba(255, 10, 122, 0.72)';
    flipBtn.style.padding = '7px';
    flipBtn.style.borderRadius = '50%';
    flipBtn.style.cursor = 'pointer';
    flipBtn.style.fontFamily = uiFont;
    flipBtn.style.fontSize = '12px';
    flipBtn.style.boxShadow = '0 10px 24px rgba(0,0,0,0.38)';
    flipBtn.style.backdropFilter = 'blur(5px)';
    flipBtn.style.transition = 'transform 0.16s ease-out, background 0.16s ease-out';

    flipBtn.addEventListener('mouseenter', () => {
        flipBtn.style.transform = 'rotate(12deg) scale(1.04)';
        flipBtn.style.background = 'rgba(255, 10, 122, 0.18)';
    });
    flipBtn.addEventListener('mouseleave', () => {
        flipBtn.style.transform = 'none';
        flipBtn.style.background = 'rgba(15, 15, 22, 0.78)';
    });

    const menu = document.createElement('div');
    menu.style.display = 'none';
    menu.style.position = 'absolute';
    menu.style.top = '100%';
    menu.style.background = 'linear-gradient(180deg, rgba(24, 23, 31, 0.98), rgba(13, 13, 19, 0.98))';
    menu.style.border = '1px solid rgba(255, 10, 122, 0.78)';
    menu.style.borderRadius = '16px';
    menu.style.marginTop = '10px';
    menu.style.minWidth = '300px';
    menu.style.maxWidth = 'min(420px, 92vw)';
    menu.style.maxHeight = '62vh';
    menu.style.overflowY = 'auto';
    menu.style.boxShadow = '0 22px 60px rgba(0,0,0,0.62), 0 0 0 1px rgba(255,255,255,0.06) inset';
    menu.style.padding = '7px';
    menu.style.backdropFilter = 'blur(12px)';
    menu.style.overflowX = 'hidden';

    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'vdh-qs-modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'vdh-qs-modal';
    modalOverlay.appendChild(modal);
    document.body.appendChild(modalOverlay);

    const HUD_LS_COLLAPSED = 'vdh_pm_hud_collapsed';
    const dlHudMap = new Map();

    function vdhSendAbortDownload(downloadId) {
        if (!downloadId || !isExtensionContextValid()) {
            return;
        }
        chrome.runtime.sendMessage({
            channel: FROM_CONTENT_TO_SERVICE,
            msg: {
                name: 'abort_download',
                data: { download_id: downloadId }
            }
        }, () => {
            const le = chrome.runtime.lastError;
            if (le && isInvalidatedMessage(le)) {
                showReloadHintBtn();
            }
        });
    }

    const overlayDlBar = document.createElement('div');
    overlayDlBar.style.display = 'none';
    overlayDlBar.style.flexDirection = 'row';
    overlayDlBar.style.alignItems = 'center';
    overlayDlBar.style.gap = '6px';

    function styleOvlDlBtn(b) {
        b.type = 'button';
        b.style.width = '34px';
        b.style.height = '34px';
        b.style.borderRadius = '10px';
        b.style.border = '1px solid rgba(255, 10, 122, 0.72)';
        b.style.background = 'rgba(15, 15, 22, 0.88)';
        b.style.color = '#fff8fb';
        b.style.cursor = 'pointer';
        b.style.display = 'flex';
        b.style.alignItems = 'center';
        b.style.justifyContent = 'center';
        b.style.padding = '0';
        b.style.boxShadow = '0 10px 24px rgba(0,0,0,0.38)';
        b.style.fontFamily = uiFont;
        b.style.transition = 'transform 0.16s ease-out, background 0.16s ease-out';
    }

    const SVG_OVL_STOP = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor"/></svg>';
    const SVG_OVL_CANCEL = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none"><path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    const overlayBtnStop = document.createElement('button');
    styleOvlDlBtn(overlayBtnStop);
    overlayBtnStop.title = 'Stop download';
    overlayBtnStop.setAttribute('aria-label', 'Stop download');
    overlayBtnStop.innerHTML = SVG_OVL_STOP;
    overlayBtnStop.addEventListener('click', function vdhOvlStopClick(ev) {
        ev.stopPropagation();
        if (typeof overlayBtnStop._vdhHandler === 'function') overlayBtnStop._vdhHandler(ev);
    });
    const overlayBtnCancel = document.createElement('button');
    styleOvlDlBtn(overlayBtnCancel);
    overlayBtnCancel.title = 'Remove from list';
    overlayBtnCancel.setAttribute('aria-label', 'Remove from list');
    overlayBtnCancel.innerHTML = SVG_OVL_CANCEL;
    overlayBtnCancel.addEventListener('click', function vdhOvlCancelClick(ev) {
        ev.stopPropagation();
        if (typeof overlayBtnCancel._vdhHandler === 'function') overlayBtnCancel._vdhHandler(ev);
    });
    overlayDlBar.appendChild(overlayBtnStop);
    overlayDlBar.appendChild(overlayBtnCancel);

    menuWrapper.appendChild(btn);
    menuWrapper.appendChild(menu);
    container.appendChild(menuWrapper);
    container.appendChild(toolsWrapper);
    container.appendChild(overlayDlBar);
    container.appendChild(flipBtn);
    document.body.appendChild(container);

    const hudRoot = document.createElement('div');
    hudRoot.className = 'vdh-dl-hud-root vdh-dl-hud-hidden vdh-dl-hud-pos-br';
    try {
        if (localStorage.getItem(HUD_LS_COLLAPSED) === '1') {
            hudRoot.classList.add('vdh-dl-hud-collapsed');
        }
    } catch (err) {
        /* ignore */
    }

    const hudDismissedIds = new Set();
    const hudCardEls = new Map();

    function vdhHudRemoveCardEl(id) {
        const el = hudCardEls.get(id);
        if (el) {
            el.remove();
            hudCardEls.delete(id);
        }
    }

    function vdhHudDismissRow(id, opts) {
        opts = opts || {};
        if (!id) {
            return;
        }
        const st = dlHudMap.get(id);
        const active = st && !st.terminal;
        if (opts.abortActive !== false && active) {
            vdhSendAbortDownload(id);
        }
        hudDismissedIds.add(id);
        dlHudMap.delete(id);
        vdhHudRemoveCardEl(id);
        renderDownloadHud();
    }

    function vdhHudStopRow(id) {
        if (!id) {
            return;
        }
        vdhSendAbortDownload(id);
    }

    function vdhHudSortIds() {
        const ids = [...dlHudMap.keys()];
        const rows = ids.map((id) => {
            const v = dlHudMap.get(id);
            return {
                id,
                term: v && v.terminal ? 1 : 0,
                ord: (v && v.sortOrder) || 0
            };
        });
        rows.sort((a, b) => a.term - b.term || a.ord - b.ord);
        return rows.map((r) => r.id);
    }

    const hudPanel = document.createElement('div');
    hudPanel.className = 'vdh-dl-hud-panel';

    const hudHead = document.createElement('div');
    hudHead.className = 'vdh-dl-hud-head';
    const hudTitle = document.createElement('div');
    hudTitle.className = 'vdh-dl-hud-title';
    hudTitle.textContent = 'Downloads';
    const SVG_DL_STOP = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor"/></svg>';
    const SVG_DL_CANCEL = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none"><path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    const SVG_DL_RESUME = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';

    const btnHudMin = document.createElement('button');
    btnHudMin.type = 'button';
    btnHudMin.className = 'vdh-dl-hud-ic';
    btnHudMin.title = 'Minimize';
    btnHudMin.setAttribute('aria-label', 'Minimize download indicator');
    btnHudMin.textContent = '\u2212';
    btnHudMin.addEventListener('click', (e) => {
        e.stopPropagation();
        hudRoot.classList.add('vdh-dl-hud-collapsed');
        try {
            localStorage.setItem(HUD_LS_COLLAPSED, '1');
        } catch (err) { /* ignore */ }
    });
    const hudHeadActions = document.createElement('div');
    hudHeadActions.className = 'vdh-dl-hud-actions';
    hudHeadActions.appendChild(btnHudMin);
    hudHead.appendChild(hudTitle);
    hudHead.appendChild(hudHeadActions);

    const hudList = document.createElement('div');
    hudList.className = 'vdh-dl-hud-list';

    hudPanel.appendChild(hudHead);
    hudPanel.appendChild(hudList);

    const hudMini = document.createElement('div');
    hudMini.className = 'vdh-dl-hud-mini';
    hudMini.title = 'Downloads — click to expand';
    hudMini.setAttribute('role', 'button');
    hudMini.setAttribute('tabindex', '0');
    hudMini.innerHTML = '<svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">' +
        '<circle cx="22" cy="22" r="18" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="3"/>' +
        '<circle class="vdh-dl-hud-ring-prog" cx="22" cy="22" r="18" fill="none" stroke="#ff0a7a" stroke-width="3" ' +
        'stroke-linecap="round" transform="rotate(-90 22 22)" stroke-dasharray="113.1" stroke-dashoffset="113.1"/>' +
        '</svg><span class="vdh-dl-hud-mini-dot"></span><span class="vdh-dl-hud-mini-count"></span>';
    const ringEl = hudMini.querySelector('.vdh-dl-hud-ring-prog');
    const miniCountEl = hudMini.querySelector('.vdh-dl-hud-mini-count');
    hudMini.addEventListener('click', () => {
        hudRoot.classList.remove('vdh-dl-hud-collapsed');
        try {
            localStorage.setItem(HUD_LS_COLLAPSED, '0');
        } catch (err) { /* ignore */ }
    });
    hudMini.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            hudMini.click();
        }
    });

    hudRoot.appendChild(hudPanel);
    hudRoot.appendChild(hudMini);
    document.body.appendChild(hudRoot);

    function syncOverlayDlBar() {
        const act = [];
        dlHudMap.forEach((v, id) => {
            if (!v.terminal) {
                act.push({ id: id, v: v });
            }
        });
        if (act.length === 0) {
            overlayDlBar.style.display = 'none';
            overlayBtnStop._vdhHandler = null;
            overlayBtnCancel._vdhHandler = null;
            return;
        }
        overlayDlBar.style.display = 'flex';
        overlayBtnStop.disabled = false;
        overlayBtnCancel.disabled = false;
        overlayBtnStop.style.opacity = '1';
        overlayBtnCancel.style.opacity = '1';
        overlayBtnStop.style.cursor = 'pointer';
        overlayBtnCancel.style.cursor = 'pointer';
        if (act.length === 1) {
            const only = act[0].id;
            overlayBtnStop.title = 'Stop this download';
            overlayBtnStop.setAttribute('aria-label', 'Stop this download');
            overlayBtnCancel.title = 'Remove from list (stops if still running)';
            overlayBtnCancel.setAttribute('aria-label', 'Remove from list');
            overlayBtnStop._vdhHandler = function(ev) {
                ev.stopPropagation();
                vdhHudStopRow(only);
            };
            overlayBtnCancel._vdhHandler = function(ev) {
                ev.stopPropagation();
                vdhHudDismissRow(only, { abortActive: true });
            };
        } else {
            overlayBtnStop.title = 'Open download list (' + act.length + ' active)';
            overlayBtnStop.setAttribute('aria-label', overlayBtnStop.title);
            overlayBtnCancel.title = 'Open download list';
            overlayBtnCancel.setAttribute('aria-label', overlayBtnCancel.title);
            const expand = function(ev) {
                ev.stopPropagation();
                hudRoot.classList.remove('vdh-dl-hud-collapsed');
                try {
                    localStorage.setItem(HUD_LS_COLLAPSED, '0');
                } catch (e) { /* ignore */ }
            };
            overlayBtnStop._vdhHandler = expand;
            overlayBtnCancel._vdhHandler = expand;
        }
    }

    function vdhSendResumeDownload(bundle) {
        if (!bundle || !bundle.download_args || !isExtensionContextValid()) {
            return;
        }
        chrome.runtime.sendMessage({
            channel: FROM_CONTENT_TO_SERVICE,
            msg: {
                name: 'do_download',
                data: {
                    download_args: bundle.download_args,
                    meta: bundle.meta,
                    media: bundle.media,
                    vdh_fresh_download_id: true
                }
            }
        }, () => {
            const le = chrome.runtime.lastError;
            if (le && isInvalidatedMessage(le)) {
                showReloadHintBtn();
            }
        });
    }

    function ensureHudCard(id) {
        let wrap = hudCardEls.get(id);
        if (wrap) {
            return wrap;
        }
        wrap = document.createElement('div');
        wrap.className = 'vdh-dl-hud-card';
        wrap.dataset.dlId = id;
        const head = document.createElement('div');
        head.className = 'vdh-dl-hud-card-head';
        const tEl = document.createElement('div');
        tEl.className = 'vdh-dl-hud-card-title';
        const actions = document.createElement('div');
        actions.className = 'vdh-dl-hud-card-actions';
        const btnStop = document.createElement('button');
        btnStop.type = 'button';
        btnStop.className = 'vdh-dl-hud-ic';
        btnStop.title = 'Stop download';
        btnStop.setAttribute('aria-label', 'Stop download');
        btnStop.innerHTML = SVG_DL_STOP;
        const btnRm = document.createElement('button');
        btnRm.type = 'button';
        btnRm.className = 'vdh-dl-hud-ic';
        btnRm.title = 'Remove from list';
        btnRm.setAttribute('aria-label', 'Remove from list');
        btnRm.innerHTML = SVG_DL_CANCEL;
        const btnResume = document.createElement('button');
        btnResume.type = 'button';
        btnResume.className = 'vdh-dl-hud-ic vdh-dl-hud-ic-done';
        btnResume.title = 'Resume download';
        btnResume.setAttribute('aria-label', 'Resume download');
        btnResume.innerHTML = SVG_DL_RESUME;
        btnResume.style.display = 'none';
        const cBarBg = document.createElement('div');
        cBarBg.className = 'vdh-dl-hud-bar-bg';
        const cBarFg = document.createElement('div');
        cBarFg.className = 'vdh-dl-hud-bar-fg';
        cBarBg.appendChild(cBarFg);
        const meta = document.createElement('div');
        meta.className = 'vdh-dl-hud-card-meta';
        const cid = id;
        btnStop.addEventListener('click', (e) => {
            e.stopPropagation();
            vdhHudStopRow(cid);
        });
        btnRm.addEventListener('click', (e) => {
            e.stopPropagation();
            const st = dlHudMap.get(cid);
            const running = st && !st.terminal;
            vdhHudDismissRow(cid, { abortActive: running });
        });
        btnResume.addEventListener('click', (e) => {
            e.stopPropagation();
            const st = dlHudMap.get(cid);
            if (!st || !st.resume_bundle) {
                return;
            }
            vdhSendResumeDownload(st.resume_bundle);
            hudDismissedIds.delete(cid);
            dlHudMap.delete(cid);
            vdhHudRemoveCardEl(cid);
            renderDownloadHud();
        });
        actions.appendChild(btnStop);
        actions.appendChild(btnResume);
        actions.appendChild(btnRm);
        head.appendChild(tEl);
        head.appendChild(actions);
        wrap.appendChild(head);
        wrap.appendChild(cBarBg);
        wrap.appendChild(meta);
        wrap._vdhUi = {
            title: tEl,
            barBg: cBarBg,
            barFg: cBarFg,
            meta: meta,
            btnStop: btnStop,
            btnResume: btnResume,
            btnRm: btnRm
        };
        hudList.appendChild(wrap);
        hudCardEls.set(id, wrap);
        return wrap;
    }

    const VDH_PERSIST = 'global_persistent_state';
    const HUD_POS_CLASSES = ['vdh-dl-hud-pos-tr', 'vdh-dl-hud-pos-tl', 'vdh-dl-hud-pos-br', 'vdh-dl-hud-pos-bl'];

    function applyDownloadHudPosition(pos) {
        const allowed = {
            top_right: 'vdh-dl-hud-pos-tr',
            top_left: 'vdh-dl-hud-pos-tl',
            bottom_right: 'vdh-dl-hud-pos-br',
            bottom_left: 'vdh-dl-hud-pos-bl'
        };
        const cls = allowed[pos] || allowed.bottom_right;
        HUD_POS_CLASSES.forEach((c) => hudRoot.classList.remove(c));
        hudRoot.classList.add(cls);
    }

    function readDownloadHudPositionFromStorage(cb) {
        try {
            chrome.storage.local.get(VDH_PERSIST, (o) => {
                const raw = o && o[VDH_PERSIST];
                if (raw && typeof raw === 'object' && raw.download_hud_position) {
                    cb(raw.download_hud_position);
                } else {
                    cb('bottom_right');
                }
            });
        } catch (err) {
            cb('bottom_right');
        }
    }

    readDownloadHudPositionFromStorage(applyDownloadHudPosition);
    try {
        chrome.storage.onChanged.addListener(function vdhHudStorage(changes, area) {
            if (area !== 'local' || !changes[VDH_PERSIST]) {
                return;
            }
            const nv = changes[VDH_PERSIST].newValue;
            if (nv && typeof nv === 'object' && nv.download_hud_position) {
                applyDownloadHudPosition(nv.download_hud_position);
            }
        });
    } catch (err) { /* ignore */ }

    function statusLine(st, pct, pctKnown) {
        if (st === 'finalizing') {
            return 'Finishing\u2026';
        }
        if (st === 'queuing') {
            return 'Queued\u2026';
        }
        if (st === 'downloading' && pctKnown === false) {
            return 'Downloading\u2026';
        }
        return Math.round(Math.min(100, Math.max(0, pct))) + '%';
    }

    function renderDownloadHud() {
        if (dlHudMap.size === 0) {
            hudRoot.classList.add('vdh-dl-hud-hidden');
            hudTitle.textContent = 'Downloads';
            hudCardEls.forEach((el) => el.remove());
            hudCardEls.clear();
            if (ringEl) {
                ringEl.setAttribute('stroke-dasharray', '113.1');
                ringEl.setAttribute('stroke-dashoffset', '113.1');
            }
            hudMini.classList.remove('vdh-dl-hud-spin', 'vdh-dl-hud-multi');
            if (miniCountEl) {
                miniCountEl.textContent = '';
            }
            syncOverlayDlBar();
            return;
        }
        hudRoot.classList.remove('vdh-dl-hud-hidden');
        const ids = vdhHudSortIds();
        const seen = new Set(ids);
        hudCardEls.forEach((el, oid) => {
            if (!seen.has(oid)) {
                el.remove();
                hudCardEls.delete(oid);
            }
        });
        let nAct = 0;
        let anyIndet = false;
        let anySpin = false;
        let maxPct = 0;
        ids.forEach((id) => {
            const v = dlHudMap.get(id);
            const wrap = ensureHudCard(id);
            const ui = wrap._vdhUi;
            const isTerm = !!v.terminal;
            if (!isTerm) {
                nAct++;
            }
            ui.title.textContent = v.label || 'Download';
            if (isTerm) {
                ui.meta.textContent = v.outcome === 'failed' ? 'Could not finish' : 'Stopped';
                ui.barBg.classList.remove('vdh-dl-hud-indet');
                ui.barFg.style.animation = '';
                ui.barFg.style.marginLeft = '';
                ui.barFg.style.width = '0%';
                ui.barFg.style.opacity = '0.45';
                ui.btnStop.style.display = 'none';
                ui.btnRm.style.display = '';
                ui.btnRm.title = 'Dismiss';
                ui.btnRm.setAttribute('aria-label', 'Dismiss');
                if (ui.btnResume) {
                    const showRes = !!(v.resume_bundle && v.resume_bundle.download_args);
                    ui.btnResume.style.display = showRes ? 'flex' : 'none';
                }
            } else {
                if (ui.btnResume) {
                    ui.btnResume.style.display = 'none';
                }
                ui.btnStop.style.display = '';
                ui.btnRm.style.display = '';
                ui.btnRm.title = 'Remove from list (stops if still running)';
                ui.btnRm.setAttribute('aria-label', ui.btnRm.title);
                ui.barFg.style.opacity = '1';
                const fin = v.status === 'finalizing';
                ui.btnStop.disabled = fin;
                ui.btnStop.style.opacity = fin ? '0.4' : '1';
                ui.btnStop.style.cursor = fin ? 'not-allowed' : 'pointer';
                ui.meta.textContent = statusLine(v.status, v.percent, v.percent_known);
                if (v.status === 'downloading' && v.percent_known === false) {
                    anyIndet = true;
                    ui.barBg.classList.add('vdh-dl-hud-indet');
                    ui.barFg.style.width = '';
                } else {
                    ui.barBg.classList.remove('vdh-dl-hud-indet');
                    ui.barFg.style.animation = '';
                    ui.barFg.style.marginLeft = '';
                    let eff = 0;
                    if (v.status === 'finalizing') {
                        eff = 100;
                    } else if (v.status === 'downloading' && v.percent_known !== false) {
                        eff = typeof v.percent === 'number' ? v.percent : 0;
                    }
                    ui.barFg.style.width = Math.round(Math.min(100, Math.max(0, eff))) + '%';
                    if (v.percent_known !== false && typeof v.percent === 'number') {
                        maxPct = Math.max(maxPct, v.percent);
                    }
                }
                if (v.status === 'finalizing') {
                    maxPct = Math.max(maxPct, 100);
                }
                if (v.status === 'queuing' ||
                    (v.status === 'downloading' && v.percent_known !== false && (v.percent || 0) < 0.5) ||
                    (v.status === 'downloading' && v.percent_known === false)) {
                    anySpin = true;
                }
            }
        });
        const total = ids.length;
        hudTitle.textContent = total === 1 ? 'Download' : 'Downloads (\u00a0' + total + '\u00a0)';
        hudMini.classList.toggle('vdh-dl-hud-multi', total > 1);
        if (miniCountEl) {
            miniCountEl.textContent = total > 1 ? String(total) : '';
        }
        const circumference = 113.1;
        if (ringEl) {
            ringEl.setAttribute('stroke-dasharray', String(circumference));
            if (anyIndet) {
                ringEl.setAttribute('stroke-dashoffset', String(circumference * 0.72));
            } else {
                const ref = nAct > 0 ? maxPct : 0;
                ringEl.setAttribute('stroke-dashoffset', String(circumference * (1 - Math.min(1, Math.max(0, ref / 100)))));
            }
        }
        if (anySpin) {
            hudMini.classList.add('vdh-dl-hud-spin');
        } else {
            hudMini.classList.remove('vdh-dl-hud-spin');
        }
        hudMini.title = total === 1 ? 'Download — click to expand' : total + ' downloads — click to expand';
        syncOverlayDlBar();
    }

    chrome.runtime.onMessage.addListener(function vdhHudMsg(msg) {
        if (msg && msg.vdh_hud_layout && msg.vdh_hud_layout.position) {
            applyDownloadHudPosition(msg.vdh_hud_layout.position);
        }
        if (!msg || !msg.vdh_pro_max_hud) {
            return;
        }
        const p = msg.vdh_pro_max_hud;
        if (p.type === 'start') {
            if (hudDismissedIds.has(p.id)) {
                return;
            }
            dlHudMap.set(p.id, {
                label: p.label || 'Download',
                percent: 0,
                status: 'queuing',
                percent_known: true,
                sortOrder: Date.now() + Math.random()
            });
        } else if (p.type === 'progress') {
            if (hudDismissedIds.has(p.id)) {
                return;
            }
            const exist = dlHudMap.get(p.id);
            if (exist && exist.terminal) {
                renderDownloadHud();
                return;
            }
            const cur = exist || { label: p.label || 'Download', percent: 0, status: '', percent_known: true };
            if (!cur.sortOrder) {
                cur.sortOrder = Date.now() + Math.random();
            }
            if (typeof p.percent === 'number') {
                cur.percent = p.percent;
            }
            if (typeof p.percent_known === 'boolean') {
                cur.percent_known = p.percent_known;
            } else {
                cur.percent_known = true;
            }
            if (p.status) {
                cur.status = p.status;
            }
            if (p.label) {
                cur.label = p.label;
            }
            dlHudMap.set(p.id, cur);
        } else if (p.type === 'end') {
            hudDismissedIds.delete(p.id);
            const oc = p.outcome || 'complete';
            const prev = dlHudMap.get(p.id);
            const lab = p.label || (prev && prev.label) || 'Download';
            const ord = (prev && prev.sortOrder) || Date.now();
            if (oc === 'stopped' || oc === 'failed') {
                dlHudMap.set(p.id, {
                    label: lab,
                    terminal: true,
                    outcome: oc,
                    status: 'done',
                    percent: 0,
                    percent_known: true,
                    sortOrder: ord,
                    resume_bundle: p.resume || null
                });
            } else {
                dlHudMap.delete(p.id);
                vdhHudRemoveCardEl(p.id);
            }
        }
        renderDownloadHud();
    });

    function closeModal() {
        modalOverlay.style.display = 'none';
        modal.innerHTML = '';
    }

    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeModal();
    });

    function openQualitySizesModal() {
        if (!isQualitySizesSupportedPage()) {
            return;
        }
        const api = vdhApi();
        toolsMenu.style.display = 'none';
        modal.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.className = 'vdh-qs-hd-wrap';
        const closeX = document.createElement('button');
        closeX.type = 'button';
        closeX.className = 'vdh-qs-x';
        closeX.innerHTML = '×';
        closeX.addEventListener('click', (e) => { e.stopPropagation(); closeModal(); });
        const hd = document.createElement('div');
        hd.className = 'vdh-qs-modal-hd';
        const h2 = document.createElement('h2');
        h2.textContent = 'Estimated data usage';
        const sub = document.createElement('div');
        sub.className = 'sub';
        sub.textContent = 'Loading…';
        hd.appendChild(h2);
        hd.appendChild(sub);
        wrap.appendChild(closeX);
        wrap.appendChild(hd);
        modal.appendChild(wrap);
        const body = document.createElement('div');
        body.className = 'vdh-qs-body';
        body.innerHTML = '<p class="vdh-qs-p" style="margin:0">Fetching player data…</p>';
        modal.appendChild(body);
        modalOverlay.style.display = 'flex';

        ensureVdhThen(() => {
            if (!api) {
                body.innerHTML = '<p class="vdh-qs-p">Data module unavailable. Reload the page.</p>';
                return;
            }
            const snap = api.getSnapshot();
            if (snap.loading) {
                sub.textContent = 'Still loading…';
            }
            if (snap.error && !snap.data) {
                sub.textContent = snap.error;
                body.innerHTML = '<p class="vdh-qs-p">Could not read player metadata. Open a watch URL and try again.</p>';
                return;
            }
            const d = snap.data;
            if (!d || !d.detailRows || !d.detailRows.length) {
                sub.textContent = 'No quality size data yet.';
                body.innerHTML = '<p class="vdh-qs-p">Wait a moment for the player to load, reload the page, or open a /watch or /shorts URL.</p>';
                return;
            }
            sub.textContent = (d.title || '') + ' · Duration ' + d.durationLabel + (d.isLive ? ' · LIVE' : '');

            const vh = api.getPlayingVideoHeight && api.getPlayingVideoHeight();
            const current = vh && api.findClosestRow ? api.findClosestRow(d.detailRows, vh) : null;
            const warn = document.createElement('div');
            let showWarn = false;
            let warnText = '';
            if (d.isLive) {
                const row = current || d.detailRows[0];
                if (row) {
                    showWarn = true;
                    warnText = 'Live stream: rough bitrate estimates. Playback around ' + row.height + 'p uses ~' + row.perHourMB + ' MB/h (video+audio, est.).';
                }
            } else if (current && (current.height >= 1080 || current.perMinuteMB >= HIGH_MBPM_WARN)) {
                showWarn = true;
                const estFull = filesizeFromApi(current.sizeBytes, api);
                const durSec = d.durationSeconds || 0;
                const hm = durSec >= 3600 ? ' · length ' + formatDurationHoursMinutes(durSec) : '';
                warnText = 'You appear to be watching at ' + current.height + 'p. Full file ~' + estFull + ' (~' + current.perMinuteMB + ' MB/min)' + hm + '. High quality uses more data.';
            }
            if (showWarn) {
                warn.className = 'vdh-qs-warn';
                warn.textContent = warnText;
                modal.insertBefore(warn, body);
            }

            const durSec = d.durationSeconds || 0;
            const showVodMinuteColumn = !d.isLive;
            const showVodHourNextToMinute = !d.isLive && durSec >= 3600;

            const tbl = document.createElement('table');
            tbl.className = 'vdh-qs-table';
            const headTr = document.createElement('tr');
            headTr.appendChild(Object.assign(document.createElement('th'), { textContent: 'Quality' }));
            headTr.appendChild(Object.assign(document.createElement('th'), { textContent: 'video full size' }));
            if (d.isLive) {
                headTr.appendChild(Object.assign(document.createElement('th'), { textContent: 'Per hour' }));
            } else if (showVodMinuteColumn) {
                headTr.appendChild(Object.assign(document.createElement('th'), { textContent: 'Per minute' }));
                if (showVodHourNextToMinute) {
                    headTr.appendChild(Object.assign(document.createElement('th'), { textContent: 'Per hour' }));
                }
            }
            const thead = document.createElement('thead');
            thead.appendChild(headTr);
            tbl.appendChild(thead);
            const tb = document.createElement('tbody');
            for (const r of d.detailRows) {
                const tr = document.createElement('tr');
                if (current && r.height === current.height) {
                    tr.style.background = 'rgba(255, 20, 120, 0.12)';
                }
                const td1 = document.createElement('td');
                td1.innerHTML = '<strong>' + r.height + 'p</strong>';
                const td2 = document.createElement('td');
                td2.textContent = r.totalLabel;
                tr.appendChild(td1);
                tr.appendChild(td2);
                if (d.isLive) {
                    const tdH = document.createElement('td');
                    tdH.textContent = '~' + r.perHourMB + ' MB';
                    tr.appendChild(tdH);
                } else if (showVodMinuteColumn) {
                    const tdM = document.createElement('td');
                    tdM.textContent = '~' + r.perMinuteMB + ' MB';
                    tr.appendChild(tdM);
                    if (showVodHourNextToMinute) {
                        const tdHv = document.createElement('td');
                        tdHv.textContent = '~' + r.perHourMB + ' MB';
                        tr.appendChild(tdHv);
                    }
                }
                tb.appendChild(tr);
            }
            tbl.appendChild(tb);
            body.innerHTML = '';
            body.appendChild(tbl);
        });
    }

    function filesizeFromApi(bytes, api) {
        if (api && api.filesize) return api.filesize(bytes);
        if (bytes < 1e6) return (bytes / 1e3).toFixed(0) + ' KB';
        return (bytes / 1e6).toFixed(1) + ' MB';
    }

    toolItemQs.addEventListener('mouseenter', () => { toolItemQs.style.background = 'rgba(255, 10, 122, 0.2)'; });
    toolItemQs.addEventListener('mouseleave', () => { toolItemQs.style.background = 'transparent'; });
    toolItemQs.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        openQualitySizesModal();
    });

    toolsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const open = toolsMenu.style.display !== 'block';
        toolsMenu.style.display = open ? 'block' : 'none';
        if (open) menu.style.display = 'none';
    });

    let positionMode = 'right';
    try { positionMode = localStorage.getItem('proMaxPos') || 'right'; } catch(e) {}

    function appendSignature() {
        const footer = document.createElement('div');
        footer.innerText = 'Modified by yehia';
        footer.style.marginTop = '4px';
        footer.style.padding = '9px 12px 7px';
        footer.style.textAlign = 'center';
        footer.style.color = 'rgba(255, 248, 251, 0.56)';
        footer.style.fontSize = '11px';
        footer.style.fontWeight = '600';
        footer.style.letterSpacing = '0.04em';
        footer.style.borderTop = '1px solid rgba(255,255,255,0.08)';
        footer.style.fontFamily = uiFont;
        menu.appendChild(footer);
    }

    function updatePosition(videoElement) {
        if (!videoElement) return;
        const rect = videoElement.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        container.style.top = (rect.top + 15) + 'px';
        const cWidth = container.offsetWidth || 200;
        if (positionMode === 'right') {
            container.style.left = (rect.right - cWidth - 15) + 'px';
            menu.style.right = '0';
            menu.style.left = 'auto';
            toolsMenu.style.right = '0';
            toolsMenu.style.left = 'auto';
        } else {
            container.style.left = (rect.left + 15) + 'px';
            menu.style.left = '0';
            menu.style.right = 'auto';
            toolsMenu.style.left = '0';
            toolsMenu.style.right = 'auto';
        }
    }

    flipBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        positionMode = positionMode === 'right' ? 'left' : 'right';
        localStorage.setItem('proMaxPos', positionMode);
        updatePosition(activeVideo);
    });

    document.addEventListener('click', () => {
        toolsMenu.style.display = 'none';
    });
    toolsWrapper.addEventListener('click', (e) => e.stopPropagation());

    window.addEventListener('mousemove', (e) => {
        let foundVideo = null;
        const videos = document.querySelectorAll('video');
        for (let v of videos) {
            const rect = v.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            if (e.clientX >= rect.left - 10 && e.clientX <= rect.right + 10 &&
                e.clientY >= rect.top - 10 && e.clientY <= rect.bottom + 10) {
                foundVideo = v;
                break;
            }
        }
        let overContainer = false;
        if (container.style.display !== 'none') {
            const crect = container.getBoundingClientRect();
            if (e.clientX >= crect.left - 10 && e.clientX <= crect.right + 10 &&
                e.clientY >= crect.top - 10 && e.clientY <= crect.bottom + 10) {
                overContainer = true;
            }
        }
        const overModal = modalOverlay.style.display === 'flex' && e.target && modalOverlay.contains(e.target);
        if (foundVideo || overContainer || overModal) {
            if (foundVideo && foundVideo !== activeVideo) {
                activeVideo = foundVideo;
                updatePosition(activeVideo);
            }
            if (hideTimeout) {
                clearTimeout(hideTimeout);
                hideTimeout = null;
            }
            if (container.style.display !== 'flex') {
                container.style.display = 'flex';
                setTimeout(() => {
                    container.style.opacity = '1';
                    container.style.transform = 'translateY(0)';
                    updatePosition(activeVideo);
                }, 10);
            }
        } else {
            if (container.style.display !== 'none' && !hideTimeout) {
                hideTimeout = setTimeout(() => {
                    container.style.opacity = '0';
                    container.style.transform = 'translateY(-2px)';
                    setTimeout(() => {
                        if (container.style.opacity === '0') {
                            container.style.display = 'none';
                            menu.style.display = 'none';
                            toolsMenu.style.display = 'none';
                            activeVideo = null;
                        }
                    }, 200);
                }, 1000);
            }
        }
    }, true);

    window.addEventListener('resize', () => updatePosition(activeVideo));
    window.addEventListener('scroll', () => updatePosition(activeVideo), true);

    function buildDownloadMenuFromResponse(response) {
        btn.innerHTML = '⚡ download video';
        menu.innerHTML = '';
        const medias = Array.isArray(response) ? response : (response && response.medias) || [];

        if (!medias || medias.length === 0) {
            const noMedia = document.createElement('div');
            noMedia.innerText = 'Quality settings have not yet been determined. New video recording is permitted.';
            noMedia.style.padding = '14px 15px';
            noMedia.style.color = '#fff8fb';
            noMedia.style.fontSize = '13px';
            noMedia.style.textAlign = 'right';
            noMedia.style.lineHeight = '1.6';
            noMedia.dir = 'rtl';
            menu.appendChild(noMedia);
        } else {
            let uniqueMedias = [];
            let seen = new Set();
            for (let m of medias) {
                let quality = m.quality || (m.details && m.details.quality) || (m.details && m.details.height ? m.details.height + 'p' : 'auto');
                let ext = m.extension || 'mp4';
                let size = m.size_bytes ? (m.size_bytes / 1024 / 1024).toFixed(1) + ' MB' : ((m.details && m.details.length) ? (m.details.length / 1024 / 1024).toFixed(1) + ' MB' : '');
                let key = m.key || (m.kind || 'video') + '_' + quality + '_' + ext;
                if (!seen.has(key)) {
                    seen.add(key);
                    m._displayQuality = quality;
                    m._displaySize = size;
                    uniqueMedias.push(m);
                }
            }
            uniqueMedias.sort((a, b) => {
                if (a.kind === 'audio' && b.kind !== 'audio') return 1;
                if (b.kind === 'audio' && a.kind !== 'audio') return -1;
                return (parseInt(b._displayQuality, 10) || 0) - (parseInt(a._displayQuality, 10) || 0);
            });
            const labelCounts = uniqueMedias.reduce((acc, media) => {
                const label = media.label || `${media._displayQuality} (${media.extension || 'mp4'})`;
                acc[label] = (acc[label] || 0) + 1;
                return acc;
            }, {});
            const labelIndexes = {};

            for (let media of uniqueMedias) {
                const item = document.createElement('div');
                item.style.padding = '11px 13px';
                item.style.color = '#fff8fb';
                item.style.cursor = 'pointer';
                item.style.fontSize = '14px';
                item.style.borderRadius = '11px';
                item.style.border = '1px solid transparent';
                item.style.margin = '2px 0';
                item.style.display = 'flex';
                item.style.justifyContent = 'space-between';
                item.style.alignItems = 'center';
                item.style.gap = '10px';
                item.style.transition = 'background 0.14s ease-out, border-color 0.14s ease-out, transform 0.14s ease-out';
                item.dir = 'rtl';
                const baseLabel = media.label || `${media._displayQuality} (${media.extension || 'mp4'})`;
                labelIndexes[baseLabel] = (labelIndexes[baseLabel] || 0) + 1;
                const nameSpan = document.createElement('span');
                nameSpan.style.flex = '1';
                nameSpan.style.minWidth = '0';
                nameSpan.innerText = labelCounts[baseLabel] > 1 ? `${baseLabel} - source ${labelIndexes[baseLabel]}` : baseLabel;
                nameSpan.style.fontWeight = '700';
                nameSpan.style.fontFamily = uiFont;
                const sizeSpan = document.createElement('span');
                const mergedSize = formatDownloadSizeText(media);
                sizeSpan.innerText = mergedSize || '—';
                sizeSpan.style.color = '#ff8abc';
                sizeSpan.style.fontSize = '11px';
                sizeSpan.style.fontWeight = '600';
                sizeSpan.style.fontFamily = uiFont;
                sizeSpan.style.textAlign = 'left';
                sizeSpan.style.maxWidth = '55%';
                sizeSpan.style.lineHeight = '1.35';
                item.appendChild(nameSpan);
                item.appendChild(sizeSpan);
                item.addEventListener('mouseenter', () => {
                    item.style.background = 'rgba(255, 10, 122, 0.16)';
                    item.style.borderColor = 'rgba(255, 10, 122, 0.35)';
                    item.style.transform = 'translateX(-1px)';
                });
                item.addEventListener('mouseleave', () => {
                    item.style.background = 'transparent';
                    item.style.borderColor = 'transparent';
                    item.style.transform = 'translateX(0)';
                });
                item.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    btn.innerHTML = 'Downloading...';
                    if (!media.download_args || !media.meta || !media.media) {
                        btn.innerHTML = 'Failed to prepare download';
                        setTimeout(() => { btn.innerHTML = '⚡ download video'; }, 2000);
                        return;
                    }
                    if (!isExtensionContextValid()) {
                        showReloadHintBtn();
                        return;
                    }
                    chrome.runtime.sendMessage({
                        channel: FROM_CONTENT_TO_SERVICE,
                        msg: {
                            name: 'do_download',
                            data: {
                                download_args: media.download_args,
                                meta: media.meta,
                                media: media.media
                            }
                        }
                    }, () => {
                        if (chrome.runtime.lastError) {
                            const le = chrome.runtime.lastError.message || chrome.runtime.lastError;
                            if (isInvalidatedMessage(le)) {
                                showReloadHintBtn();
                            } else {
                                btn.innerHTML = '⚡ download video';
                            }
                            return;
                        }
                        btn.innerHTML = 'Download started! ✓';
                        setTimeout(() => { btn.innerHTML = '⚡ download video'; menu.style.display = 'none'; }, 2000);
                    });
                });
                menu.appendChild(item);
            }
        }
        appendSignature();
        menu.style.display = 'block';
        updatePosition(activeVideo);
    }

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        toolsMenu.style.display = 'none';
        if (menu.style.display === 'block') {
            menu.style.display = 'none';
            return;
        }
        if (!isExtensionContextValid()) {
            showReloadHintBtn();
            return;
        }
        btn.innerHTML = 'Downloading qualities...';
        try {
            ensureVdhThen(() => {
                chrome.runtime.sendMessage({ action: 'get_pro_max_medias' }, (response) => {
                    if (chrome.runtime.lastError) {
                        const le = chrome.runtime.lastError.message || chrome.runtime.lastError;
                        if (isInvalidatedMessage(le)) {
                            showReloadHintBtn();
                        } else {
                            btn.innerHTML = '⚡ download video';
                        }
                        return;
                    }
                    buildDownloadMenuFromResponse(response);
                });
            });
        } catch (err) {
            if (isInvalidatedMessage(err)) {
                showReloadHintBtn();
            } else {
                console.error(err);
                btn.innerHTML = 'An error occurred!';
            }
        }
    });
})();
