(function () {
    "use strict";

    const MESSAGE_SOURCE = "vdh-tiktok-untrusted";
    const MAX_JSON_CHARS = 5 * 1024 * 1024;

    function isAuthOrSecSdkTiktokUrl(s) {
        if (!s) return false;
        const u = s.toString();
        const l = u.toLowerCase();
        if (/passport|sec_sdk|sec-sdk|captcha|bind_phone|device_register|fraud\?|oauth|logout&|2fa=|m\/login|pns\./.test(l)) return true;
        if (/\/(passport|oauth|sec\/)(\/|\?|_)/.test(l)) return true;
        if (/^https?:\/\/passport\./.test(l)) return true;
        try {
            const o = u.startsWith("http") ? new URL(u) : new URL(u, location.origin);
            if (/^passport\.|^mssdk[.-]/.test(o.hostname) || o.hostname === "mssdk-sg.tiktok.com" || o.hostname === "mssdk-va.tiktok.com") return true
        } catch {}
        return false
    }

    function post(type, data) {
        window.postMessage({ source: MESSAGE_SOURCE, type, data }, window.location.origin);
    }

    function extractIdFromRequestUrl(s) {
        if (!s) return "";
        const t = String(s);
        const a = t.match(/[?&]aweme_id=(\d{8,})/) || t.match(/[?&]itemId=(\d{8,})/) || t.match(/[?&]awemeId=(\d{8,})/);
        if (a) return a[1];
        const b = t.match(/[?&]item_ids=([^&]+)/);
        if (b) {
            const n = b[1].split(/%2C|,/).map((q) => decodeURIComponent(q).replace(/[^\d]/g, "")).find((x) => /^\d{8,}/.test(x));
            if (n) return n;
        }
        return "";
    }

    function isPlayableMediaUrl(url) {
        const s = String(url || "");
        return /tiktokv\.com|byteoversea|muscdn|mime_type=video|mime_type=.*mpegURL|\.m3u8([?#]|$)|\.mp4([?#]|$)/i.test(s);
    }

    function postMediaUrl(url, id = "") {
        if (!isPlayableMediaUrl(url)) return;
        try {
            post("media_url", { url: String(url), id });
        } catch {}
    }

    function getId(item) {
        const id = item && (item.id || item.aweme_id || item.awemeId || item.itemId);
        return typeof id === "string" || typeof id === "number" ? String(id) : "";
    }

    function getUrlList(value) {
        const urls = [];
        const seen = new Set();

        function add(url) {
            if (typeof url !== "string") return;
            if (!/^https?:\/\//i.test(url) && !url.startsWith("//")) return;
            const normalized = url.startsWith("//") ? `${location.protocol}${url}` : url;
            if (!seen.has(normalized)) {
                seen.add(normalized);
                urls.push(normalized);
            }
        }

        function walk(node, depth) {
            if (!node || depth > 5) return;
            if (typeof node === "string") {
                add(node);
                return;
            }
            if (Array.isArray(node)) {
                node.forEach((entry) => walk(entry, depth + 1));
                return;
            }
            if (typeof node === "object") {
                add(node.url);
                add(node.src);
                add(node.Url);
                add(node.uri);
                add(node.href);
                walk(node.urlList || node.UrlList || node.url_list, depth + 1);
                walk(node.urls, depth + 1);
            }
        }

        walk(value, 0);
        return urls;
    }

    function sanitizeItem(item) {
        const id = getId(item);
        const video = item && item.video;
        if (!id || !video || typeof video !== "object") return null;

        const bitrateInfo = Array.isArray(video.bitrateInfo) ? video.bitrateInfo : [];
        return {
            id,
            desc: typeof item.desc === "string" ? item.desc : "",
            author: item.author || item.authorInfo || null,
            video: {
                duration: Number(video.duration || video.durationSecond || 0) || 0,
                width: Number(video.width || 0) || 0,
                height: Number(video.height || 0) || 0,
                cover: getUrlList(video.cover || video.originCover || video.dynamicCover)[0] || "",
                playAddr: getUrlList(video.playAddr || video.PlayAddr || video.play_addr),
                downloadAddr: getUrlList(video.downloadAddr || video.download || video.DownloadAddr),
                bitrateInfo: bitrateInfo.map((entry) => ({
                    bitrate: Number(entry.bitrate || entry.BitRate || 0) || 0,
                    quality: entry.qualityType || entry.QualityType || entry.gearName || entry.GearName || "",
                    codec: entry.CodecType || entry.codecType || entry.codec || "",
                    width: Number(entry.PlayAddr?.Width || entry.width || 0) || 0,
                    height: Number(entry.PlayAddr?.Height || entry.height || 0) || 0,
                    urls: getUrlList(entry.hls || entry.Hls || entry.hlsUrl || entry.PlayAddr || entry.playAddr || entry.UrlList || entry.urlList)
                })).filter((entry) => entry.urls.length > 0)
            }
        };
    }

    function collectItems(payload) {
        const items = [];
        const seen = new Set();

        function add(item) {
            const sanitized = sanitizeItem(item);
            if (sanitized && !seen.has(sanitized.id)) {
                seen.add(sanitized.id);
                items.push(sanitized);
            }
        }

        function walk(node, depth) {
            if (!node || depth > 8) return;
            if (Array.isArray(node)) {
                node.forEach((entry) => walk(entry, depth + 1));
                return;
            }
            if (typeof node !== "object") return;

            add(node);
            const likelyKeys = [
                "itemStruct",
                "itemInfo",
                "itemList",
                "items",
                "aweme_list",
                "aweme_detail",
                "awemeDetail",
                "videoData",
                "data",
                "itemModule",
                "ItemList",
                "recommendList",
                "relatedList",
                "aweme",
                "__DEFAULT_SCOPE__"
            ];
            for (const key of likelyKeys) walk(node[key], depth + 1);
        }

        walk(payload, 0);
        return items;
    }

    function handleJsonCandidate(url, text) {
        if (isAuthOrSecSdkTiktokUrl(String(url || ""))) return;
        if (!text || text.length > MAX_JSON_CHARS) return;
        if (!/tiktok|aweme|item|video|webapp|t\.tiktok|byte|musical/i.test(url + text.slice(0, 500))) return;
        try {
            const items = collectItems(JSON.parse(text));
            if (items.length) {
                post("items", { url, items });
                const isDetail = /detail|one\/item|one_item|aweme_v[12]\/aweme|item_list\/item|aweme%2Fitem%2Fdetail/i.test(String(url).toLowerCase());
                const id0 = getId(items[0]);
                const u = String(url).toLowerCase();
                const isFeedish = /\/recommend|\/feed|\/browse|foryou|fyp|following|\/explore|item_list|aweme_v|item\/list|aweme%2F|one\/(i\/)?item|web\/project/.test(u);
                if (id0) {
                    if (items.length === 1 || (isDetail && id0) || (items.length > 1 && isFeedish)) {
                        try {
                            post("aweme_hint", { id: id0 });
                        } catch {}
                    }
                }
            }
        } catch {}
    }

    function hookFetch() {
        const originalFetch = window.fetch;
        if (typeof originalFetch !== "function" || originalFetch.__vdhTikTokHooked) return;

        function wrappedFetch(input, init) {
            const requestUrl = typeof input === "string" ? input : (input && input.url) || "";
            if (isAuthOrSecSdkTiktokUrl(String(requestUrl))) {
                return originalFetch.apply(this, arguments)
            }
            const fromReq = !isAuthOrSecSdkTiktokUrl(String(requestUrl)) && (extractIdFromRequestUrl(requestUrl) || (input && input.url && extractIdFromRequestUrl(String(input.url))));
            if (fromReq) {
                try {
                    post("aweme_hint", { id: fromReq });
                } catch {}
            }
            postMediaUrl(requestUrl, fromReq);
            return originalFetch.apply(this, arguments).then((response) => {
                try {
                    const url = response.url || requestUrl;
                    if (isAuthOrSecSdkTiktokUrl(String(url))) {
                        return response
                    }
                    postMediaUrl(url, fromReq || extractIdFromRequestUrl(String(url)));
                    if (/\/api\/|aweme|item_list|item\/detail|detail\?|recommend|related|aweme\/|repost|v1\/|v2\/|webapp|feed|browse|t\.tiktok|byte|mssdk|tiktok/i.test(url)) {
                        const fromFin = !fromReq && !isAuthOrSecSdkTiktokUrl(String(url)) && extractIdFromRequestUrl(String(url));
                        if (fromFin) {
                            try {
                                post("aweme_hint", { id: fromFin });
                            } catch {}
                        }
                        if (!isAuthOrSecSdkTiktokUrl(String(url)) && (/\/(api|web)\/|aweme|item_list|recommend|feed|related|one\//i.test(String(url)) || /tiktokv\./i.test(String(url)) || /\.(m3u8|mp4)([?#]|$)/i.test(String(url)))) {
                            response.clone().text().then((text) => handleJsonCandidate(url, text)).catch(() => {});
                        }
                    }
                } catch {}
                return response;
            });
        }

        wrappedFetch.__vdhTikTokHooked = true;
        window.fetch = wrappedFetch;
    }

    function hookXhr() {
        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;
        if (originalOpen.__vdhTikTokHooked) return;

        XMLHttpRequest.prototype.open = function (method, url) {
            this.__vdhTikTokUrl = typeof url === "string" ? url : "";
            return originalOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.open.__vdhTikTokHooked = true;

        XMLHttpRequest.prototype.send = function () {
            this.addEventListener("load", () => {
                try {
                    const url = this.responseURL || this.__vdhTikTokUrl || "";
                    if (isAuthOrSecSdkTiktokUrl(String(url))) return;
                    const hid = !isAuthOrSecSdkTiktokUrl(String(url)) && extractIdFromRequestUrl(url);
                    if (hid) {
                        try {
                            post("aweme_hint", { id: hid });
                        } catch {}
                    }
                    postMediaUrl(url, hid);
                    if (!/\/api\/|aweme|item_list|item\/detail|detail\?|recommend|related|aweme\/|v1\/|v2\/|webapp|feed|browse|t\.tiktok|mssdk|repost|tiktok/i.test(url)) return;
                    if (typeof this.responseText === "string") handleJsonCandidate(url, this.responseText);
                } catch {}
            });
            return originalSend.apply(this, arguments);
        };
    }

    function scanHydrationScripts() {
        for (const script of document.querySelectorAll("script#__UNIVERSAL_DATA_FOR_REHYDRATION__, script#SIGI_STATE, script#sigi-persisted-data")) {
            handleJsonCandidate(location.href, script.textContent || "");
        }
    }

    hookFetch();
    hookXhr();
    scanHydrationScripts();
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", scanHydrationScripts, { once: true });
    } else {
        requestAnimationFrame(scanHydrationScripts);
    }
    setTimeout(scanHydrationScripts, 220);
    setTimeout(scanHydrationScripts, 650);
})();
