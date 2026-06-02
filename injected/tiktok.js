(function () {
    "use strict";

    if (!/(\.|^)tiktok\.com$/i.test(location.hostname)) return;
    try {
        if (window.top !== window) return;
    } catch {
        return;
    }

    const CHANNEL_FROM_INJECTED_TO_SERVICE = 0;
    const MESSAGE_SOURCE = "vdh-tiktok-untrusted";
    const itemById = new Map;
    const observedVideos = new WeakSet;
    const visibleVideos = new Map;
    const videoPostIdByFrame = new WeakMap;
    const sentHashes = new Map;
    const performanceMediaSeen = new Set;
    let networkAweme = { id: "", t: 0 };
    let activePostId = "";
    let activeVideo = null;
    let lastHref = location.href;
    let scanTimer = 0;
    let publishTimer = 0;

    function some(value) {
        return { __vdhOption: "some", value };
    }

    function none() {
        return { __vdhOption: "none" };
    }

    function serde(value) {
        if (value && value.__vdhOption === "some") {
            return { __serde_tag: "some", __serde_val: serde(value.value) };
        }
        if (value && value.__vdhOption === "none") {
            return { __serde_tag: "none" };
        }
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || typeof value === "undefined" || value === null) {
            return { __serde_tag: "primitive", __serde_val: value };
        }
        if (value instanceof URL) return { __serde_tag: "url", __serde_val: value.href };
        if (value instanceof Headers) {
            const entries = [];
            value.forEach((headerValue, headerName) => entries.push([headerName, headerValue]));
            return { __serde_tag: "headers", __serde_val: entries };
        }
        if (Array.isArray(value)) return { __serde_tag: "array", __serde_val: value.map(serde) };
        if (value && typeof value === "object") {
            const out = {};
            for (const [key, entry] of Object.entries(value)) out[key] = serde(entry);
            return { __serde_tag: "object", __serde_val: out };
        }
        return { __serde_tag: "primitive", __serde_val: null };
    }

    function hash(input, seed = 0) {
        let h1 = 0xdeadbeef ^ seed;
        let h2 = 0x41c6ce57 ^ seed;
        for (let i = 0, ch; i < input.length; i++) {
            ch = input.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 2654435761);
            h2 = Math.imul(h2 ^ ch, 1597334677);
        }
        h1 = Math.imul(h1 ^ h1 >>> 16, 2246822507) ^ Math.imul(h2 ^ h2 >>> 13, 3266489909);
        h2 = Math.imul(h2 ^ h2 >>> 16, 2246822507) ^ Math.imul(h1 ^ h1 >>> 13, 3266489909);
        return 4294967296 * (2097151 & h2) + (h1 >>> 0);
    }

    function asUrl(value) {
        if (!value || typeof value !== "string") return null;
        try {
            return new URL(value.startsWith("//") ? `${location.protocol}${value}` : value, location.href);
        } catch {
            return null;
        }
    }

    function optionUrl(value) {
        const url = asUrl(value);
        return url ? some(url) : none();
    }

    function extractPostIdFromUrl(value) {
        if (!value) return "";
        const s = String(value);
        const m1 = s.match(/\/video\/(\d{8,})/);
        if (m1) return m1[1];
        return "";
    }

    function extractIdFromString(str) {
        if (!str || typeof str !== "string") return "";
        const m = str.match(/(\d{8,})/g);
        if (!m) return "";
        for (let i = m.length - 1; i >= 0; i--) {
            if (m[i].length >= 8) return m[i];
        }
        return m[0] || "";
    }

    function getPostIdFromDataAttributes(video) {
        if (!video) return "";
        for (const el of [video, video.parentElement, video.parentElement && video.parentElement.parentElement, video.parentElement && video.parentElement.parentElement && video.parentElement.parentElement.parentElement].filter(Boolean)) {
            for (const at of [el, video.closest && video.closest("[data-aweme-id]"), video.closest && video.closest("[id*='video-']")].filter(Boolean)) {
                if (!at || !at.getAttribute) continue;
                for (const name of ["data-aweme-id", "data-id", "id", "data-item-id"]) {
                    const v = at.getAttribute(name);
                    if (v) {
                        const ex = extractIdFromString(v);
                        if (ex) return ex;
                    }
                }
            }
        }
        if (typeof video.id === "string" && /^\d{8,}$/.test(video.id)) return video.id;
        return "";
    }

    function expandUrlList(value) {
        const urls = [];
        const urlSeen = new Set;

        function add(url) {
            if (typeof url !== "string") return;
            if (!/^https?:\/\//i.test(url) && !url.startsWith("//")) return;
            const normalized = url.startsWith("//") ? `${location.protocol}${url}` : url;
            if (!urlSeen.has(normalized)) {
                urlSeen.add(normalized);
                urls.push(normalized);
            }
        }
        (function walk(node, depth) {
            if (!node || depth > 6) return;
            if (typeof node === "string") return add(node);
            if (Array.isArray(node)) return node.forEach((entry) => walk(entry, depth + 1));
            if (typeof node === "object") {
                add(node.url);
                add(node.src);
                add(node.href);
                add(node.playAddr);
                walk(node.urlList || node.UrlList || node.url_list || node.urls, depth + 1);
            }
        })(value, 0);
        return urls;
    }

    function findNearestPostLink(element) {
        let node = element;
        for (let depth = 0; node && depth < 14; depth++, node = node.parentElement) {
            const direct = node.matches && node.matches('a[href*="/video/"]') ? node : null;
            const link = direct || node.querySelector && node.querySelector('a[href*="/video/"]');
            if (link) return link.href || link.getAttribute("href") || "";
        }
        return "";
    }

    function findPostIdByAnchorProximity(video) {
        if (!video) return "";
        const vrect = video.getBoundingClientRect();
        if (vrect.width < 1 || vrect.height < 1) return "";
        const vcy = (vrect.top + vrect.bottom) / 2;
        let best = null;
        for (const a of document.querySelectorAll('a[href*="/video/"]')) {
            const href = a.href || a.getAttribute("href");
            if (!href) continue;
            const id = extractPostIdFromUrl(href);
            if (!id) continue;
            if (a.contains && a.contains(video)) return id;
            const r = a.getBoundingClientRect();
            if (r.bottom < vrect.top - 80 || r.top > vrect.bottom + 80) continue;
            if (r.left > vrect.right + 200 || r.right < vrect.left - 200) continue;
            const d = Math.abs((r.top + r.bottom) / 2 - vcy);
            if (best == null || d < best.d) best = { id, d };
        }
        return best && best.id ? best.id : "";
    }

    function findPostIdTightToVideo(video) {
        if (!video) return "";
        const cached = videoPostIdByFrame.get(video);
        if (cached) return cached;
        if (video.closest) {
            const wrap = video.closest('a[href*="/video/"]');
            if (wrap) {
                const fromWrap = extractPostIdFromUrl(wrap.href || wrap.getAttribute("href") || "");
                if (fromWrap) {
                    videoPostIdByFrame.set(video, fromWrap);
                    return fromWrap;
                }
            }
        }
        const vr = video.getBoundingClientRect();
        if (vr.width < 1 || vr.height < 1) return "";
        const vcy = (vr.top + vr.bottom) / 2;
        for (let el = video; el && el !== document.body; el = el.parentElement) {
            const links = el.querySelectorAll ? el.querySelectorAll('a[href*="/video/"]') : [];
            const cands = [];
            for (let i = 0; i < links.length; i++) {
                const a = links[i];
                const id = extractPostIdFromUrl(a.href || a.getAttribute("href") || "");
                if (!id) continue;
                if (a.contains && a.contains(video)) cands.push({ id, s: 3, dy: 0 });
                else {
                    const r = a.getBoundingClientRect();
                    if (r.width < 2 || r.height < 2) continue;
                    const yOverlap = r.bottom > vr.top - 20 && r.top < vr.bottom + 20;
                    if (!yOverlap) continue;
                    const xNear = r.left < vr.right + 200 && r.right > vr.left - 200;
                    if (!xNear) continue;
                    cands.push({ id, s: 1, dy: Math.abs((r.top + r.bottom) / 2 - vcy) });
                }
            }
            if (cands.length === 1) {
                videoPostIdByFrame.set(video, cands[0].id);
                return cands[0].id;
            }
            if (cands.length > 1) {
                cands.sort((a, b) => b.s - a.s || a.dy - b.dy);
                if (cands[0].s > cands[1].s) {
                    videoPostIdByFrame.set(video, cands[0].id);
                    return cands[0].id;
                }
                cands.sort((a, b) => a.dy - b.dy);
                const top = cands[0].id;
                videoPostIdByFrame.set(video, top);
                return top;
            }
        }
        return "";
    }

    function getPostIdForVideo(video) {
        const onVideoPage = extractPostIdFromUrl(location.href);
        if (onVideoPage) return onVideoPage;
        if (!video) return "";

        let id = getPostIdFromDataAttributes(video);
        if (id) return id;
        id = findPostIdTightToVideo(video);
        if (id) return id;
        id = extractPostIdFromUrl(findNearestPostLink(video));
        if (id) return id;
        id = findPostIdByAnchorProximity(video);
        if (id) return id;
        if (itemById.size === 1) return itemById.keys().next().value;
        if (itemById.size > 0) {
            const keys = [...itemById.keys()];
            const looseVis = (v) => {
                if (!v) return false;
                const r = v.getBoundingClientRect();
                if (r.width < 1 || r.height < 1) return false;
                return r.bottom > -200 && r.right > 0 && r.top < innerHeight + 200 && r.left < innerWidth;
            };
            const vlist = [].filter.call(document.querySelectorAll("video"), looseVis);
            vlist.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
            if (vlist.length === 1 && networkAweme.id && itemById.has(networkAweme.id) && Date.now() - networkAweme.t < 2e4) {
                return networkAweme.id;
            }
            let vi = vlist.indexOf(video);
            if (vi < 0 && vlist.length) {
                const y = (video.getBoundingClientRect().top + video.getBoundingClientRect().bottom) / 2;
                let bestI = 0, bestD = 1e9;
                for (let i = 0; i < vlist.length; i++) {
                    const r = vlist[i].getBoundingClientRect();
                    const d = Math.abs((r.top + r.bottom) / 2 - y);
                    if (d < bestD) bestD = d, bestI = i
                }
                vi = bestI
            }
            if (vi >= 0) {
                const j = Math.min(vi, keys.length - 1);
                if (j >= 0) return keys[j]
            }
            if (vlist.length) {
                const cy = innerHeight * 0.5;
                let bestI = 0, bestD = 1e9;
                for (let i = 0; i < vlist.length; i++) {
                    const r = vlist[i].getBoundingClientRect();
                    const d = Math.abs((r.top + r.bottom) / 2 - cy);
                    if (d < bestD) bestD = d, bestI = i
                }
                const j = Math.min(bestI, keys.length - 1);
                if (j >= 0) return keys[j]
            }
            if (networkAweme.id && itemById.has(networkAweme.id) && Date.now() - networkAweme.t < 2e4) return networkAweme.id;
            return keys[0]
        }
        if (itemById.size === 0 && networkAweme.id && Date.now() - networkAweme.t < 2e4) return networkAweme.id;
        return "";
    }

    function getCanonicalUrl(id, item, video) {
        const link = video ? findNearestPostLink(video) : "";
        const linkedUrl = asUrl(link);
        if (linkedUrl && extractPostIdFromUrl(linkedUrl.href) === id) return linkedUrl;
        const currentId = extractPostIdFromUrl(location.href);
        if (currentId === id) return new URL(location.href);
        const author = item && item.author && (item.author.uniqueId || item.author.author || item.author.nickname);
        return new URL(`https://www.tiktok.com/@${encodeURIComponent(author || "_")}/video/${id}`);
    }

    function isMeaningfullyVisible(video) {
        if (!video) return false;
        const rect = video.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return false;
        return rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
    }

    function chooseBestVisibleVideo() {
        let best = null;
        for (const [video, ratio] of visibleVideos.entries()) {
            if (!isMeaningfullyVisible(video)) continue;
            const rect = video.getBoundingClientRect();
            const centeredness = 1 - Math.min(1, Math.abs(rect.top + rect.height / 2 - innerHeight / 2) / Math.max(1, innerHeight / 2));
            const score = ratio * 2 + centeredness;
            if (!best || score > best.score) best = { video, score };
        }
        return best && best.video;
    }

    function getVideoAtViewportFocus() {
        const cx = Math.floor(window.innerWidth / 2);
        const yRatios = [0.30, 0.38, 0.42, 0.50, 0.55];
        const xOffsets = [0, -80, 80, -140, 140];
        for (const yRatio of yRatios) {
            for (const xo of xOffsets) {
                const x = Math.max(0, Math.min(window.innerWidth - 1, cx + xo));
                const y = Math.max(0, Math.floor(window.innerHeight * yRatio));
                let el = null;
                try {
                    el = document.elementFromPoint(x, y);
                } catch {
                    el = null;
                }
                for (let n = 0, cur = el; cur && n < 24; n++, cur = cur.parentElement) {
                    if (cur instanceof HTMLVideoElement && isMeaningfullyVisible(cur)) return cur;
                }
                try {
                    const stack = document.elementsFromPoint(x, y);
                    for (const p of stack) {
                        if (p instanceof HTMLVideoElement && isMeaningfullyVisible(p)) return p;
                        if (p && p.querySelector) {
                            const v = p.querySelector("video");
                            if (v && isMeaningfullyVisible(v)) return v;
                        }
                    }
                } catch {}
            }
        }
        return null;
    }

    const videoObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (entry.isIntersecting) visibleVideos.set(entry.target, entry.intersectionRatio);
            else visibleVideos.delete(entry.target);
        }
        schedulePublish();
    }, {
        root: null,
        rootMargin: "200px 0px 200px 0px",
        threshold: [0, 0.02, 0.1, 0.25, 0.5, 0.75, 0.95]
    });

    function observeVideos() {
        for (const video of document.querySelectorAll("video")) {
            if (observedVideos.has(video)) continue;
            observedVideos.add(video);
            videoObserver.observe(video);
            const invalidateId = () => {
                try {
                    videoPostIdByFrame.delete(video);
                } catch {}
            };
            video.addEventListener("loadstart", invalidateId, { passive: true });
            video.addEventListener("emptied", invalidateId, { passive: true });
            video.addEventListener("loadedmetadata", () => {
                invalidateId();
                schedulePublish();
            }, { passive: true });
            video.addEventListener("canplay", schedulePublish, { passive: true });
            video.addEventListener("play", schedulePublish, { passive: true });
            video.addEventListener("playing", schedulePublish, { passive: true });
        }
        schedulePublish();
    }

    function isM3u8Url(parsed) {
        const s = parsed instanceof URL ? parsed.href : String(parsed);
        return /\.m3u8($|[?#])/i.test(s) || /mime_type=.*m3u8/i.test(s) || s.includes("mime_type=application%2Fx-mpegURL");
    }

    function toUrlStringList(v) {
        if (!v) return [];
        if (Array.isArray(v)) {
            return v
                .map((x) => typeof x === "string" ? x : (x && (x.url || x.src || x.href || x.uri) || null))
                .filter((s) => typeof s === "string" && s.length);
        }
        if (typeof v === "string") return [v];
        if (typeof v === "object") return expandUrlList(v);
        return [];
    }

    function getUrlsFromItem(item) {
        const urls = [];
        const video = item && item.video || {};
        const push = (url, source, meta = {}) => {
            const parsed = asUrl(url);
            if (!parsed || parsed.protocol === "blob:") return;
            if (urls.some((entry) => entry.url.href === parsed.href)) return;
            urls.push({ url: parsed, source, ...meta, isHls: isM3u8Url(parsed) });
        };

        const bitrates = Array.isArray(video.bitrateInfo) ? video.bitrateInfo : [];
        bitrates
            .slice()
            .sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0))
            .forEach((entry, index) => {
                toUrlStringList(entry.urls).forEach((url) => push(url, "bitrate", {
                    bitrate: Number(entry.bitrate) || 0,
                    quality: entry.quality || "",
                    codec: entry.codec || "",
                    width: Number(entry.width) || Number(video.width) || 0,
                    height: Number(entry.height) || Number(video.height) || 0,
                    rank: index
                }));
            });

        toUrlStringList(video.playAddr).forEach((url) => push(url, "play", {
            width: Number(video.width) || 0,
            height: Number(video.height) || 0
        }));
        toUrlStringList(video.downloadAddr).forEach((url) => push(url, "download", {
            width: Number(video.width) || 0,
            height: Number(video.height) || 0
        }));

        if (item && item.music && item.music.playUrl) push(item.music.playUrl, "music", { width: 0, height: 0 });
        return urls;
    }

    function firstItemIdWithPlayableUrls() {
        for (const k of itemById.keys()) {
            if (getUrlsFromItem(itemById.get(k)).length) return k;
        }
        return "";
    }

    function readTiktokWindowCaches() {
        try {
            for (const k of ["__UNIVERSAL_DATA_FOR_REHYDRATION__", "SIGI_STATE", "__SSG_LOADABLE__"]) {
                if (!(k in window)) continue;
                const v = window[k];
                if (v == null) continue;
                if (typeof v === "string") {
                    if (v.length < 30 || v.length > 5e6) continue;
                    try {
                        storeItems(collectItemsFromJson(JSON.parse(v)));
                    } catch {}
                } else if (typeof v === "object") {
                    try {
                        storeItems(collectItemsFromJson(v));
                    } catch {}
                }
            }
        } catch {}
    }

    function pickOneVideoCandidate(candidates) {
        if (!candidates || !candidates.length) return [];
        const isMusic = (c) => c.source === "music";
        const hls = candidates.filter((c) => !isMusic(c) && (c.isHls || isM3u8Url(c.url)));
        const direct = candidates.filter((c) => !isMusic(c) && !c.isHls && !isM3u8Url(c.url));
        if (hls.length) {
            hls.sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0));
            return [hls[0]];
        }
        if (direct.length) {
            direct.sort((a, b) => {
                const br = (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0);
                if (br) return br;
                const pa = (Number(a.width) || 0) * (Number(a.height) || 0);
                const pb = (Number(b.width) || 0) * (Number(b.height) || 0);
                return pb - pa;
            });
            return [direct[0]];
        }
        const noMusic = candidates.filter((c) => !isMusic(c));
        return noMusic.length ? [noMusic[0]] : [candidates[0]];
    }

    function buildMedia(id, item, video, candidate) {
        const canonicalUrl = getCanonicalUrl(id, item, video);
        const headers = new Headers;
        headers.set("referer", canonicalUrl.href);

        const title = item.desc || `TikTok video ${id}`;
        const size = candidate.width && candidate.height ? some({ width: candidate.width, height: candidate.height }) : none();
        const bitrate = candidate.bitrate ? some(candidate.bitrate) : none();

        return {
            is_youtube: false,
            initiator: some(canonicalUrl),
            duration: item.video && item.video.duration ? item.video.duration : "unknown",
            hash: `media_hash_${hash(`tiktok:${id}:${candidate.url.href}`)}`,
            sent_headers: headers,
            thumbnail_url: optionUrl(item.video && item.video.cover),
            title: some(title),
            filename: some(`tiktok-${id}`),
            type: "http_playlist",
            libav_demuxer: none(),
            extension: "mp4",
            discovery_timestamp_ms: Date.now(),
            supports_byte_ranges: false,
            has_drm: false,
            cache: "default",
            prefered_entry: none(),
            playlist: [{
                quality: { size, bitrate },
                demuxer: "mp4",
                size: none(),
                av: {
                    video: candidate.url,
                    audio: false
                }
            }]
        };
    }

    function buildM3u8Media(id, item, video, candidate) {
        const canonicalUrl = getCanonicalUrl(id, item, video);
        const headers = new Headers;
        headers.set("referer", canonicalUrl.href);
        const title = item.desc || `TikTok video ${id}`;
        const g = candidate.source === "music";
        return {
            is_youtube: false,
            has_drm: false,
            duration: item.video && item.video.duration ? item.video.duration : "unknown",
            initiator: some(canonicalUrl),
            hash: `media_hash_${hash(`tiktokm3u8:${id}:${candidate.url.href}`)}`,
            sent_headers: headers,
            thumbnail_url: optionUrl(item.video && item.video.cover),
            title: some(title),
            filename: some(`tiktok-${id}`),
            type: "m3u8",
            url: candidate.url,
            demuxer: g ? "mp3" : "mp4",
            discovery_timestamp_ms: Date.now(),
            cache: "default"
        };
    }

    function sendInjectedMessage(name, data) {
        try {
            chrome.runtime.sendMessage({
                channel: CHANNEL_FROM_INJECTED_TO_SERVICE,
                msg: { name, data }
            });
        } catch {}
    }

    function publishMedia(media) {
        sendInjectedMessage("on_media", { media: serde(media) });
    }

    function removeMedia(hashValue) {
        sendInjectedMessage("remove_media", { hash: hashValue });
    }

    function removeStaleMedia(currentId) {
        for (const [id, hashes] of sentHashes.entries()) {
            if (id === currentId) continue;
            for (const hashValue of hashes) removeMedia(hashValue);
            sentHashes.delete(id);
        }
    }

    function isPlayableNetworkUrl(url) {
        const s = String(url || "");
        return /tiktokv\.com|byteoversea|muscdn|mime_type=video|mime_type=.*mpegURL|\.m3u8([?#]|$)|\.mp4([?#]|$)/i.test(s);
    }

    function storeDirectMediaUrl(id, url, meta = {}) {
        const parsed = asUrl(url);
        if (!parsed || parsed.protocol === "blob:" || !isPlayableNetworkUrl(parsed.href)) return;
        let currentId = id || extractPostIdFromUrl(location.href) || activePostId || networkAweme.id || getPostIdForVideo(getVideoAtViewportFocus() || chooseBestVisibleVideo() || document.querySelector("video"));
        if (!currentId) currentId = `direct-${hash(parsed.href)}`;
        const existing = itemById.get(currentId);
        const directItem = existing || {
            id: currentId,
            desc: document.title || `TikTok video ${currentId}`,
            author: null,
            music: null,
            video: {
                duration: 0,
                width: Number(meta.width) || 0,
                height: Number(meta.height) || 0,
                cover: "",
                playAddr: [],
                downloadAddr: [],
                bitrateInfo: []
            }
        };
        if (!directItem.video) directItem.video = {};
        if (!Array.isArray(directItem.video.playAddr)) directItem.video.playAddr = [];
        if (!Array.isArray(directItem.video.bitrateInfo)) directItem.video.bitrateInfo = [];
        if (!directItem.video.playAddr.includes(parsed.href)) directItem.video.playAddr.unshift(parsed.href);
        if (meta.bitrate || meta.quality || meta.width || meta.height) {
            directItem.video.bitrateInfo.unshift({
                bitrate: Number(meta.bitrate) || 0,
                quality: meta.quality || "Auto",
                codec: meta.codec || "",
                width: Number(meta.width) || Number(directItem.video.width) || 0,
                height: Number(meta.height) || Number(directItem.video.height) || 0,
                urls: [parsed.href]
            });
        }
        itemById.set(currentId, directItem);
        networkAweme = { id: currentId, t: Date.now() };
        schedulePublish();
    }

    function publishActive() {
        readHydrationScripts();
        const focused = getVideoAtViewportFocus();
        let bestVideo = (focused && isMeaningfullyVisible(focused) ? focused : null) || chooseBestVisibleVideo() || activeVideo || document.querySelector("video");
        let id = bestVideo ? getPostIdForVideo(bestVideo) : extractPostIdFromUrl(location.href);
        if (!id) {
            id = firstItemIdWithPlayableUrls() || (itemById.size ? itemById.keys().next().value : "");
        } else {
            const tryItem = itemById.get(id);
            if (tryItem && !getUrlsFromItem(tryItem).length) {
                const w = firstItemIdWithPlayableUrls();
                if (w) id = w
            }
        }
        if (!id) return;
        if (!bestVideo) bestVideo = document.querySelector("video");

        activePostId = id;
        activeVideo = bestVideo;
        let item = itemById.get(id);
        if (!item) {
            readHydrationScripts();
            item = itemById.get(id);
        }
        if (item && !getUrlsFromItem(item).length) {
            const alt = firstItemIdWithPlayableUrls();
            if (alt) {
                id = alt, activePostId = id, item = itemById.get(alt);
            }
        }
        if (!item) {
            publishDomFallback(id, bestVideo);
            return;
        }

        const candidates = getUrlsFromItem(item);
        if (!candidates.length) {
            const alt2 = firstItemIdWithPlayableUrls();
            if (alt2) {
                id = alt2, activePostId = id, item = itemById.get(alt2);
            }
        }
        const candidatesFinal = getUrlsFromItem(item);
        if (!candidatesFinal.length) {
            publishDomFallback(id, bestVideo, item);
            return;
        }

        removeStaleMedia(id);
        const picked = pickOneVideoCandidate(candidatesFinal);
        const hashes = new Set;
        for (const candidate of picked) {
            const media = (candidate.isHls || isM3u8Url(candidate.url)) ? buildM3u8Media(id, item, bestVideo, candidate) : buildMedia(id, item, bestVideo, candidate);
            hashes.add(media.hash);
            publishMedia(media);
        }
        sentHashes.set(id, hashes);
    }

    function publishDomFallback(id, video, item = null) {
        const fromItem = item && getUrlsFromItem(item);
        if (fromItem && fromItem.length) {
            removeStaleMedia(id);
            const hashes = new Set;
            for (const c of pickOneVideoCandidate(fromItem)) {
                const vref = (video && isMeaningfullyVisible(video)) ? video : null;
                const media = (c.isHls || isM3u8Url(c.url)) ? buildM3u8Media(id, item, vref, c) : buildMedia(id, item, vref, c);
                hashes.add(media.hash);
                publishMedia(media);
            }
            sentHashes.set(id, hashes);
            return;
        }

        if (!video) return;
        {
            const r = video.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) return;
            if (r.top > innerHeight + 400 || r.bottom < -300) return;
        }

        const src = video.currentSrc || video.src;
        const parsed = asUrl(src);
        if (!parsed || parsed.protocol === "blob:" || parsed.hostname === "www.tiktok.com") return;

        const fallbackItem = item || {
            id,
            desc: document.title || `TikTok video ${id}`,
            author: null,
            video: {
                duration: Number(video.duration) || 0,
                width: Number(video.videoWidth) || 0,
                height: Number(video.videoHeight) || 0,
                cover: video.poster || "",
                playAddr: [parsed.href],
                downloadAddr: [],
                bitrateInfo: []
            }
        };

        removeStaleMedia(id);
        const media = buildMedia(id, fallbackItem, video, {
            url: parsed,
            source: "dom-video",
            width: Number(video.videoWidth) || 0,
            height: Number(video.videoHeight) || 0
        });
        publishMedia(media);
        sentHashes.set(id, new Set([media.hash]));
    }

    function schedulePublish() {
        clearTimeout(publishTimer);
        publishTimer = setTimeout(publishActive, 40);
    }

    function scheduleScan() {
        clearTimeout(scanTimer);
        scanTimer = setTimeout(() => {
            readHydrationScripts();
            observeVideos();
        }, 32);
    }

    function normalizeIncomingItem(item) {
        if (!item) return null;
        if (item.aweme && typeof item.aweme === "object") {
            const a = item.aweme;
            return normalizeIncomingItem({
                id: a.id || a.aweme_id,
                desc: a.desc,
                author: a.author,
                video: a.video,
                music: a.music
            });
        }
        if (!item.id || !item.video) return null;
        const v = item.video;
        const playList = expandUrlList(v.playAddr || v.PlayAddr || v.play_addr || v.play || v.Play);
        const downList = expandUrlList(v.downloadAddr || v.download || v.DownloadAddr);
        const bi = Array.isArray(v.bitrateInfo) ? v.bitrateInfo : (Array.isArray(v.BitrateInfo) ? v.BitrateInfo : []);
        return {
            id: String(item.id),
            desc: typeof item.desc === "string" ? item.desc : "",
            author: item.author,
            music: item.music && typeof item.music === "object" ? {
                playUrl: item.music.playUrl
            } : null,
            video: {
                duration: Number(v.duration || v.durationSecond) || 0,
                width: Number(v.width) || 0,
                height: Number(v.height) || 0,
                cover: (typeof v.cover === "string" && v.cover) || (v.originCover && String(v.originCover)) || "",
                playAddr: playList,
                downloadAddr: downList,
                bitrateInfo: bi.map((entry) => {
                    const urls = expandUrlList(entry.hls || entry.Hls || entry.hlsUrl || entry.PlayAddr || entry.playAddr || entry.UrlList || entry.urlList);
                    return {
                        bitrate: Number(entry.bitrate || entry.BitRate) || 0,
                        quality: entry.qualityType || entry.QualityType || entry.gearName || entry.GearName || "",
                        codec: entry.CodecType || entry.codecType || entry.codec || "",
                        width: Number(entry.width || entry.Width) || 0,
                        height: Number(entry.height || entry.Height) || 0,
                        urls: urls
                    };
                }).filter((entry) => entry.urls && entry.urls.length)
            }
        };
    }

    function storeItems(items) {
        let changed = false;
        const list = items || [];
        let firstId = "";
        for (const rawItem of list) {
            let item = normalizeIncomingItem(rawItem);
            if (!item) {
                for (const extracted of collectItemsFromJson(rawItem)) {
                    item = normalizeIncomingItem(extracted);
                    if (item) break;
                }
            }
            if (!item) continue;
            if (!firstId) firstId = item.id;
            itemById.set(item.id, item);
            changed = true;
        }
        if (list.length && firstId) networkAweme = { id: firstId, t: Date.now() };
        if (changed) schedulePublish();
    }

    function collectItemsFromJson(payload) {
        const items = [];
        const seen = new Set;

        function getUrlList(value) {
            const urls = [];
            const urlSeen = new Set;
            const add = (url) => {
                if (typeof url !== "string") return;
                if (!/^https?:\/\//i.test(url) && !url.startsWith("//")) return;
                const normalized = url.startsWith("//") ? `${location.protocol}${url}` : url;
                if (!urlSeen.has(normalized)) {
                    urlSeen.add(normalized);
                    urls.push(normalized);
                }
            };
            const walk = (node, depth) => {
                if (!node || depth > 5) return;
                if (typeof node === "string") return add(node);
                if (Array.isArray(node)) return node.forEach((entry) => walk(entry, depth + 1));
                if (typeof node === "object") {
                    add(node.url);
                    add(node.src);
                    add(node.href);
                    walk(node.urlList || node.UrlList || node.url_list || node.urls, depth + 1);
                }
            };
            walk(value, 0);
            return urls;
        }

        function sanitize(node) {
            const id = node && (node.id || node.aweme_id || node.awemeId || node.itemId);
            const video = node && node.video;
            if (!id || !video || typeof video !== "object") return null;
            return {
                id: String(id),
                desc: typeof node.desc === "string" ? node.desc : "",
                author: node.author || node.authorInfo || null,
                video: {
                    duration: Number(video.duration || video.durationSecond || 0) || 0,
                    width: Number(video.width || 0) || 0,
                    height: Number(video.height || 0) || 0,
                    cover: getUrlList(video.cover || video.originCover || video.dynamicCover)[0] || "",
                    playAddr: getUrlList(video.playAddr || video.PlayAddr || video.play_addr),
                    downloadAddr: getUrlList(video.downloadAddr || video.download || video.DownloadAddr),
                    bitrateInfo: (Array.isArray(video.bitrateInfo) ? video.bitrateInfo : []).map((entry) => ({
                        bitrate: Number(entry.bitrate || entry.BitRate || 0) || 0,
                        quality: entry.qualityType || entry.QualityType || entry.gearName || entry.GearName || "",
                        codec: entry.CodecType || entry.codecType || entry.codec || "",
                        width: Number(entry.PlayAddr && entry.PlayAddr.Width || entry.width || 0) || 0,
                        height: Number(entry.PlayAddr && entry.PlayAddr.Height || entry.height || 0) || 0,
                        urls: getUrlList(entry.PlayAddr || entry.playAddr || entry.UrlList || entry.urlList)
                    })).filter((entry) => entry.urls.length > 0)
                }
            };
        }

        function walk(node, depth) {
            if (!node || depth > 8) return;
            if (Array.isArray(node)) return node.forEach((entry) => walk(entry, depth + 1));
            if (typeof node !== "object") return;

            const item = sanitize(node);
            if (item && !seen.has(item.id)) {
                seen.add(item.id);
                items.push(item);
            }
            for (const key of ["itemStruct", "itemInfo", "itemList", "items", "aweme_list", "aweme_detail", "awemeDetail", "videoData", "data", "__DEFAULT_SCOPE__", "itemModule", "ItemList", "recommendList", "relatedList", "aweme", "repostList", "repost"]) {
                walk(node[key], depth + 1);
            }
        }

        walk(payload, 0);
        return items;
    }

    let vdhHydroAllScriptsBudget = 12;
    function readHydrationScripts() {
        readTiktokWindowCaches();
        for (const script of document.querySelectorAll("script#__UNIVERSAL_DATA_FOR_REHYDRATION__, script#SIGI_STATE, script#sigi-persisted-data, script#webapp-initial-payload, script#webapp_script, script[id*='__DATA']")) {
            const text = script.textContent || "";
            if (!text || text.length < 20) continue;
            if (!/aweme|video|item|feed/i.test(text.slice(0, 400))) continue;
            try {
                storeItems(collectItemsFromJson(JSON.parse(text)));
            } catch {}
        }
        if (vdhHydroAllScriptsBudget > 0) {
            vdhHydroAllScriptsBudget--;
            let n = 0;
            for (const script of document.querySelectorAll("script")) {
                if (n++ > 35) break;
                const t = script.textContent || "";
                if (t.length < 200 || t.length > 2e6) continue;
                if (!/aweme|itemList|aweme_id|awemeId|playAddr|\/video\//i.test(t.slice(0, 3e3))) continue;
                try {
                    storeItems(collectItemsFromJson(JSON.parse(t)));
                } catch {}
            }
        }
    }

    window.addEventListener("message", (event) => {
        if (event.source !== window || !event.data || event.data.source !== MESSAGE_SOURCE) return;
        if (event.data.type === "items") {
            const payload = event.data.data;
            const items = payload && payload.items;
            if (Array.isArray(items) && items.length) storeItems(items);
        } else if (event.data.type === "aweme_hint") {
            const p = event.data.data;
            const raw = p && (p.id != null ? p.id : p.awemeId);
            const id = raw != null ? String(raw) : "";
            if (id && /^\d{8,}/.test(id)) {
                networkAweme = { id, t: Date.now() };
                schedulePublish();
            }
        } else if (event.data.type === "media_url") {
            const p = event.data.data || {};
            const id = p.id != null ? String(p.id) : "";
            storeDirectMediaUrl(id, p.url, p);
        }
    });

    (function patchHistory() {
        const push = history.pushState;
        const rep = history.replaceState;
        const emit = () => {
            lastHref = location.href;
            scheduleScan();
        };
        history.pushState = function statePush() {
            const r = push.apply(this, arguments);
            emit();
            return r;
        };
        history.replaceState = function stateReplace() {
            const r = rep.apply(this, arguments);
            emit();
            return r;
        };
    })();

    const mutationObserver = new MutationObserver(scheduleScan);
    mutationObserver.observe(document.documentElement || document, { childList: true, subtree: true });

    function scanPerformanceMedia() {
        try {
            for (const entry of performance.getEntriesByType("resource")) {
                const url = entry && entry.name;
                if (!isPlayableNetworkUrl(url) || performanceMediaSeen.has(url)) continue;
                performanceMediaSeen.add(url);
                storeDirectMediaUrl("", url);
            }
        } catch {}
    }

    window.addEventListener("popstate", scheduleScan, { passive: true });
    setInterval(() => {
        if (location.href !== lastHref) {
            lastHref = location.href;
            scheduleScan();
        }
        scanPerformanceMedia();
    }, 350);

    readHydrationScripts();
    observeVideos();
    scheduleScan();
    schedulePublish();
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
            readHydrationScripts();
            schedulePublish();
        }, { once: true });
    }
    const bootPublish = (n) => {
        if (n > 0) {
            readHydrationScripts();
            schedulePublish();
            return void setTimeout(() => {
                bootPublish(n - 1)
            }, 110)
        }
    };
    requestAnimationFrame(() => {
        readHydrationScripts();
        schedulePublish();
    });
    requestAnimationFrame(() => {
        readHydrationScripts();
        schedulePublish();
    });
    setTimeout(() => {
        readHydrationScripts();
        scanPerformanceMedia();
        schedulePublish();
    }, 80);
    setTimeout(() => {
        readHydrationScripts();
        scanPerformanceMedia();
        schedulePublish();
    }, 200);
    setTimeout(scheduleScan, 280);
    bootPublish(18);
})();
