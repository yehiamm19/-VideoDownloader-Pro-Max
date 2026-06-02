/* YouTube per-quality data (TubeSize-style) — data layer for Tools / overlay. MIT: TubeSize_Extension */
(function () {
  "use strict";

  const STORAGE_KEY = "vdh_yt_datasize_enabled";
  const FETCH_TIMEOUT_MS = 8000;

  const AUDIO_ITAG = 251;
  const LIVE_AUDIO_ITAG = 140;
  const RANGE_RESOLUTION_THRESHOLD = 1080;
  const HIGH_QUALITY_WARN_PX = 1080;
  const HIGH_MBPM_WARN = 12;

  const VIDEO_ITAGS = new Map([
    [144, [394, 330, 278, 160]],
    [240, [395, 331, 242, 133]],
    [360, [396, 332, 243, 134]],
    [480, [397, 333, 244, 135]],
    [720, [398, 334, 302, 247, 298, 136]],
    [1080, [399, 335, 303, 248, 299, 137]],
    [1440, [400, 336, 308, 271, 304, 264]],
    [2160, [401, 337, 315, 313, 305, 266]],
    [4320, [402, 571, 272, 138]]
  ]);

  const ITAG_TO_HEIGHT = new Map();
  for (const [h, itags] of VIDEO_ITAGS) {
    for (const it of itags) {
      ITAG_TO_HEIGHT.set(it, h);
    }
  }

  if (window.top !== window.self) return;

  function heightFromItag(it) {
    if (it == null || it === "") return null;
    const n = Number(it);
    if (Number.isNaN(n)) return null;
    return ITAG_TO_HEIGHT.has(n) ? ITAG_TO_HEIGHT.get(n) : null;
  }

  function filesize(bytes) {
    if (bytes < 0 || !isFinite(bytes)) return "—";
    if (bytes < 1000) return `${Math.round(bytes)} B`;
    const u = ["KB", "MB", "GB", "TB"];
    let n = bytes;
    let i = -1;
    do {
      n /= 1000;
      i++;
    } while (n >= 1000 && i < u.length - 1);
    return `${i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
  }

  function humanizeDurationSec(sec) {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
  }

  function sizePerMinuteMB(sizeInBytes, durationInSeconds, isLive) {
    const durationInMinutes = durationInSeconds / 60;
    const sizeInMB = sizeInBytes / 1e6;
    if (isLive) return Number((sizeInMB / 60).toFixed(2));
    if (durationInSeconds === 0) return 0;
    return Number((sizeInMB / durationInMinutes).toFixed(2));
  }

  function sizePerHourMBFromTotal(sizeBytes, durationSeconds) {
    if (!durationSeconds || durationSeconds <= 0) return 0;
    const sizeMB = sizeBytes / 1e6;
    const hours = durationSeconds / 3600;
    return Number((sizeMB / hours).toFixed(2));
  }

  function getAverageAudioSize(audioFormatArray) {
    if (audioFormatArray.length === 0) return 0;
    if (audioFormatArray.length === 1) return Math.round(audioFormatArray[0].sizeBytes);
    return Math.round(
      audioFormatArray.reduce((acc, f) => acc + f.sizeBytes, 0) / audioFormatArray.length
    );
  }

  function mergeAudioWithVideo(videoFormats, audioSize) {
    return videoFormats.map((vf) => ({
      ...vf,
      sizeBytes: vf.sizeBytes + audioSize,
      maxSizeBytes: vf.maxSizeBytes != null ? vf.maxSizeBytes + audioSize : undefined
    }));
  }

  function humanizeVideoFormats(videoFormats, durationInSeconds, isLive) {
    return videoFormats.map((f) => ({
      height: f.height,
      sizeMB: f.maxSizeBytes
        ? `${filesize(f.sizeBytes)} – ${filesize(f.maxSizeBytes)}`
        : filesize(f.sizeBytes),
      sizePerMinuteMB: sizePerMinuteMB(f.sizeBytes, durationInSeconds, isLive)
    }));
  }

  function chooseVideoFormats(data) {
    const chosen = [];
    const adaptiveFormats = data.streamingData.adaptiveFormats;
    for (const [resolution, itags] of VIDEO_ITAGS) {
      const matchingFormats = itags
        .map((itag) => adaptiveFormats.find((f) => Number(f.itag) === itag))
        .filter((format) => {
          if (!format) return false;
          if (data.videoDetails.isLive) return Boolean(format.bitrate);
          return Number.parseInt(format.contentLength || "0", 10) > 0;
        });
      if (matchingFormats.length === 0) continue;
      const sizes = matchingFormats.map((format) => {
        if (data.videoDetails.isLive) {
          return format.bitrate ? (format.bitrate * 3600) / 8 : 0;
        }
        return Number.parseInt(format.contentLength || "0", 10);
      });
      const shouldShowRange = resolution >= RANGE_RESOLUTION_THRESHOLD;
      const minSize = Math.min(...sizes);
      const maxSize = Math.max(...sizes);
      chosen.push({
        height: resolution,
        sizeBytes: shouldShowRange ? minSize : sizes[0],
        maxSizeBytes: shouldShowRange && maxSize > minSize ? maxSize : undefined
      });
    }
    return chosen;
  }

  function chooseAudioFormats(data) {
    if (data.videoDetails.isLive) {
      const audioFormat = data.streamingData.adaptiveFormats.find(
        (f) => Number(f.itag) === LIVE_AUDIO_ITAG
      );
      if (!audioFormat) return [];
      return [
        {
          itag: audioFormat.itag,
          sizeBytes: audioFormat.bitrate ? (audioFormat.bitrate * 3600) / 8 : 0
        }
      ];
    }
    return data.streamingData.adaptiveFormats
      .filter((f) => Number(f.itag) === AUDIO_ITAG)
      .map((f) => ({
        itag: f.itag,
        sizeBytes: Number.parseInt(f.contentLength || "0", 10)
      }));
  }

  function parseDataFromYtInitial(data) {
    if (!data?.videoDetails || !data.streamingData?.adaptiveFormats) {
      throw new Error("incomplete");
    }
    return {
      id: data.videoDetails.videoId,
      title: data.videoDetails.title,
      durationSeconds: Number.parseInt(data.videoDetails.lengthSeconds || "0", 10),
      formats: chooseVideoFormats(data),
      audioFormats: chooseAudioFormats(data),
      isLive: Boolean(data.videoDetails.isLive)
    };
  }

  function buildDetailRows(merged, durationSeconds, isLive) {
    return merged.map((f) => {
      const sizeBytes = f.sizeBytes;
      const maxB = f.maxSizeBytes;
      const mbpm = sizePerMinuteMB(sizeBytes, durationSeconds, isLive);
      const mbph = isLive
        ? Number((mbpm * 60).toFixed(2))
        : sizePerHourMBFromTotal(sizeBytes, durationSeconds);
      const totalLabel = maxB ? `${filesize(sizeBytes)} – ${filesize(maxB)}` : filesize(sizeBytes);
      return {
        height: f.height,
        sizeBytes,
        maxSizeBytes: maxB,
        totalLabel,
        perMinuteMB: mbpm,
        perHourMB: mbph,
        highTier: f.height >= HIGH_QUALITY_WARN_PX
      };
    });
  }

  function humanizeData(raw) {
    const audioSize = getAverageAudioSize(raw.audioFormats);
    const merged = mergeAudioWithVideo(raw.formats, audioSize);
    return {
      title: raw.title,
      durationSeconds: raw.durationSeconds,
      durationLabel: humanizeDurationSec(raw.durationSeconds),
      isLive: raw.isLive,
      videoFormats: humanizeVideoFormats(merged, raw.durationSeconds, raw.isLive),
      detailRows: buildDetailRows(merged, raw.durationSeconds, raw.isLive)
    };
  }

  function extractJsonAfterMarker(text, marker) {
    const idx = text.indexOf(marker);
    if (idx === -1) throw new Error("no marker");
    const brace = text.indexOf("{", idx);
    if (brace === -1) throw new Error("no object");
    let i = brace;
    let depth = 0;
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) return JSON.parse(text.slice(brace, i + 1));
      }
    }
    throw new Error("unclosed");
  }

  function getInlinePlayerHtml() {
    for (const s of document.scripts) {
      const t = s.textContent || "";
      if (t.includes("ytInitialPlayerResponse")) return t;
    }
    return null;
  }

  async function fetchWatchHtml(videoId) {
    const u = new URL("https://www.youtube.com/watch");
    u.searchParams.set("v", videoId);
    const res = await fetch(u.toString(), {
      credentials: "include",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    return res.text();
  }

  function extractPlayerFromAny(html) {
    return extractJsonAfterMarker(html, "ytInitialPlayerResponse");
  }

  function extractVideoId() {
    try {
      const u = new URL(location.href);
      if (u.pathname === "/watch") return u.searchParams.get("v") || null;
      if (u.pathname.startsWith("/shorts/")) {
        const id = u.pathname.split("/")[2] || null;
        return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
      }
    } catch {
    }
    return null;
  }

  function getPlayingVideoHeight() {
    const v = document.querySelector("video");
    if (!v || v.videoHeight <= 0) return null;
    return v.videoHeight;
  }

  function findClosestRow(rows, vh) {
    if (vh == null || !rows.length) return null;
    let best = rows[0];
    let d = Math.abs(rows[0].height - vh);
    for (const r of rows) {
      const x = Math.abs(r.height - vh);
      if (x < d) {
        d = x;
        best = r;
      }
    }
    return best;
  }

  let memCache = { vid: null, data: null, error: null, loading: false };
  let loadTimer = null;

  function getSnapshot() {
    return {
      videoId: memCache.vid,
      error: memCache.error,
      loading: memCache.loading,
      data: memCache.data,
      enabled: true
    };
  }

  function heightToSizeLabel(heightPx) {
    const s = getSnapshot();
    if (!s.data || !s.data.detailRows) return "";
    const row =
      s.data.detailRows.find((r) => r.height === heightPx) || findClosestRow(s.data.detailRows, heightPx);
    if (!row) return "";
    return row.totalLabel;
  }

  function sizeHintForQualityLabel(qualityStr) {
    return sizeHintForMedia({ _displayQuality: qualityStr, quality: qualityStr });
  }

  /**
   * Match extension media object to a detail row (TubeSize-style: itag → height, or 720p label).
   */
  function walkFindVideoItag(o, depth) {
    if (!o || depth > 6) return null;
    if (typeof o === "object" && o !== null) {
      if (o.itag != null && o.itag !== "") {
        const h = heightFromItag(o.itag);
        if (h) return h;
      }
      for (const v of Object.values(o)) {
        if (v && typeof v === "object") {
          const r = walkFindVideoItag(v, depth + 1);
          if (r) return r;
        }
      }
    }
    return null;
  }

  function resolveHeightFromMedia(media) {
    if (!media || typeof media !== "object") return null;
    const d = media.details || {};
    const inner = media.media || {};
    const da = media.download_args || {};
    if (typeof d.height === "number" && d.height > 0) {
      return d.height;
    }
    if (typeof inner.height === "number" && inner.height > 0) {
      return inner.height;
    }
    const itagCandidates = [
      inner.itag,
      media.itag,
      d.itag,
      da.itag,
      d.format_id,
      inner.format_id,
      media.format_id,
      d.raw && d.raw.itag
    ];
    for (const it of itagCandidates) {
      if (it != null && it !== "") {
        const byItag = heightFromItag(it);
        if (byItag) return byItag;
      }
    }
    const wItag = walkFindVideoItag(da, 0) || walkFindVideoItag(inner, 0) || walkFindVideoItag(media, 0);
    if (wItag) {
      return wItag;
    }
    const q = String(
      media.quality || media._displayQuality || media.label || d.quality || ""
    );
    const mp = q.match(/(\d{3,4})\s*p/i);
    if (mp) {
      return parseInt(mp[1], 10);
    }
    const m2 = q.match(/\b(\d{3,4})\b/);
    if (m2) {
      const n = parseInt(m2[1], 10);
      const asItag = heightFromItag(n);
      if (asItag) return asItag;
      if (n >= 144 && n <= 4320) {
        return n;
      }
    }
    const digits = q.replace(/\D/g, "");
    if (digits.length >= 2 && digits.length <= 4) {
      const n = parseInt(digits, 10);
      if (n > 0 && n < 500) {
        const h = heightFromItag(n);
        if (h) return h;
      }
    }
    return null;
  }

  function sizeHintForMedia(media) {
    const s = getSnapshot();
    if (!s.data || !s.data.detailRows || !s.data.detailRows.length) {
      return null;
    }
    const h = resolveHeightFromMedia(media);
    if (h == null) {
      return null;
    }
    let row = s.data.detailRows.find((r) => r.height === h);
    if (!row) {
      row = findClosestRow(s.data.detailRows, h);
    }
    if (!row) {
      return null;
    }
    return {
      /** Full-file estimate only (for download list — no /min or /h here). */
      line: row.totalLabel,
      perMinuteMB: row.perMinuteMB,
      perHourMB: row.perHourMB,
      height: row.height
    };
  }

  window.__vdhYoutubeDataSize = {
    getSnapshot,
    filesize,
    sizeHintForQualityLabel,
    sizeHintForMedia,
    resolveHeightFromMedia,
    heightToSizeLabel,
    getPlayingVideoHeight,
    findClosestRow,
    async refresh() {
      await runAsync();
    }
  };

  async function runAsync() {
    const vid = extractVideoId();
    if (!vid) {
      memCache = { vid: null, data: null, error: "not a watch page", loading: false };
      return;
    }
    if (memCache.vid === vid && memCache.data) {
      memCache = { ...memCache, error: null, loading: false };
      return;
    }
    memCache = { vid, data: null, error: null, loading: true };
    let rawData;
    try {
      const inline = getInlinePlayerHtml();
      if (inline) {
        try {
          rawData = extractPlayerFromAny(inline);
          if (rawData?.videoDetails?.videoId && rawData.videoDetails.videoId !== vid) {
            throw new Error("id mismatch");
          }
        } catch {
          rawData = null;
        }
      }
      if (!rawData) {
        const html = await fetchWatchHtml(vid);
        rawData = extractPlayerFromAny(html);
        if (rawData?.videoDetails?.videoId !== vid) {
          throw new Error("mismatch");
        }
      }
      const raw = parseDataFromYtInitial(rawData);
      const data = humanizeData(raw);
      if (!data.detailRows.length) {
        memCache = { vid, data: null, error: "no formats", loading: false };
        return;
      }
      memCache = { vid, data, error: null, loading: false };
    } catch (e) {
      memCache = { vid, data: null, error: String(e && e.message ? e.message : e), loading: false };
    }
  }

  function run() {
    if (loadTimer) clearTimeout(loadTimer);
    loadTimer = setTimeout(() => {
      void runAsync();
    }, 150);
  }

  async function onStorageChanged(ch, area) {
    if (area !== "local" || !Object.prototype.hasOwnProperty.call(ch, STORAGE_KEY)) return;
    memCache = { vid: null, data: null, error: null, loading: false };
    void runAsync();
  }

  chrome.storage.onChanged.addListener(onStorageChanged);
  addEventListener("yt-navigate-finish", run, true);
  run();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  }
})();
