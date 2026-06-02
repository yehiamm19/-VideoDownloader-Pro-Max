const STORAGE_KEY = "vdh_yt_datasize_enabled";

function initCheckbox(cb) {
  if (cb.dataset.vdhBound === "1") return;
  cb.dataset.vdhBound = "1";
  chrome.storage.local.get(STORAGE_KEY, (r) => {
    if (chrome.runtime?.lastError) return;
    cb.checked = r[STORAGE_KEY] !== false;
  });
  cb.addEventListener("change", () => {
    chrome.storage.local.set({ [STORAGE_KEY]: cb.checked });
  });
}

function findAndBind() {
  const cb = document.getElementById("checkbox_youtube_datasize");
  if (cb) initCheckbox(cb);
  else {
    if (findAndBind.tries < 200) {
      findAndBind.tries++;
      setTimeout(findAndBind, 40);
    }
  }
}
findAndBind.tries = 0;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", findAndBind);
} else {
  findAndBind();
}
