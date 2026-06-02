(function() {
  if (globalThis.__vdhProMaxControlsApplied) return;
  globalThis.__vdhProMaxControlsApplied = true;

  const CLEAR_ID = "button_pro_max_clear_medias";
  const TOGGLE_ID = "checkbox_pro_max_media_capture";
  const STATUS_ID = "pro_max_media_capture_status";

  function send(action, data = {}) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ action, ...data }, response => resolve(response || {}));
    });
  }

  function findInTree(root, selector, results = []) {
    if (!root) return results;
    if (root.querySelectorAll) results.push(...root.querySelectorAll(selector));
    const nodes = root.querySelectorAll ? root.querySelectorAll("*") : [];
    for (const node of nodes) {
      if (node.shadowRoot) findInTree(node.shadowRoot, selector, results);
    }
    return results;
  }

  function nodeFromEvent(event, id) {
    return event.composedPath().find(node => node && node.id === id);
  }

  function injectTemplates() {
    const toolbar = document.getElementById("toolbar-template");
    if (toolbar && !toolbar.content.getElementById(CLEAR_ID)) {
      const spacer = toolbar.content.querySelector("spacer[flex='1']");
      const clearButton = document.createElement("button");
      clearButton.id = CLEAR_ID;
      clearButton.className = "tooltip-prevent-right-and-bottom-edge";
      clearButton.setAttribute("tooltip", "Clear discovered videos list");
      clearButton.setAttribute("aria-label", "Clear discovered videos list");
      clearButton.title = "Clear discovered videos list";
      clearButton.innerHTML = `
        <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 3a.5.5 0 0 1 .5-.5h1.4l.34-.68A1.5 1.5 0 0 1 6.08 1h3.84a1.5 1.5 0 0 1 1.34.82l.34.68H13a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5Zm3.13-.5h4.74l-.01-.02a.5.5 0 0 0-.44-.28H6.08a.5.5 0 0 0-.44.28l-.01.02ZM4.5 5a.5.5 0 0 1 .5.5v7a.5.5 0 0 0 .5.5h5a.5.5 0 0 0 .5-.5v-7a.5.5 0 0 1 1 0v7A1.5 1.5 0 0 1 10.5 14h-5A1.5 1.5 0 0 1 4 12.5v-7a.5.5 0 0 1 .5-.5Z"/>
          <path d="M6.5 6a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-1 0v-5a.5.5 0 0 1 .5-.5Zm3 0a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-1 0v-5a.5.5 0 0 1 .5-.5Z"/>
        </svg>
      `;
      spacer ? spacer.after(clearButton) : toolbar.content.querySelector("hbox")?.appendChild(clearButton);
    }

    const settings = document.getElementById("settings-template");
    if (settings && !settings.content.getElementById(TOGGLE_ID)) {
      const historyBox = settings.content.querySelector("#checkbox_history")?.closest("vbox.roundedbox");
      const targetBox = historyBox || settings.content.querySelector("#box_main");
      const row = document.createElement("label");
      row.className = "pro-max-media-capture-setting";
      row.innerHTML = `
        <input type="checkbox" id="${TOGGLE_ID}"/>
        <span>Automatically save the discovered videos list</span>
        <small id="${STATUS_ID}">When off, site videos will not accumulate in the list.</small>
      `;
      targetBox?.appendChild(row);
    }
  }

  async function syncToggle() {
    const checkboxes = findInTree(document, `#${TOGGLE_ID}`);
    if (checkboxes.length === 0) return;
    const response = await send("pro_max_get_media_capture_enabled");
    const enabled = response.enabled !== false;
    for (const checkbox of checkboxes) {
      checkbox.checked = enabled;
    }
  }

  let syncTimer = null;
  function scheduleSyncToggle() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncToggle, 120);
  }

  function flashButton(button, text) {
    if (!button) return;
    const original = button.innerHTML;
    button.textContent = text;
    setTimeout(() => {
      button.innerHTML = original;
    }, 1400);
  }

  document.addEventListener("click", async event => {
    const checkbox = nodeFromEvent(event, TOGGLE_ID);
    if (checkbox) {
      setTimeout(async () => {
        const response = await send("pro_max_set_media_capture_enabled", {
          enabled: checkbox.checked
        });
        for (const item of findInTree(document, `#${TOGGLE_ID}`)) {
          item.checked = response.enabled !== false;
        }
      }, 0);
      return;
    }

    const button = nodeFromEvent(event, CLEAR_ID);
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const response = await send("pro_max_clear_discovered_medias");
    flashButton(button, response.ok ? "Cleared" : "Clear failed");
  }, true);

  document.addEventListener("change", async event => {
    const checkbox = nodeFromEvent(event, TOGGLE_ID);
    if (!checkbox) return;
    const response = await send("pro_max_set_media_capture_enabled", {
      enabled: checkbox.checked
    });
    for (const item of findInTree(document, `#${TOGGLE_ID}`)) {
      item.checked = response.enabled !== false;
    }
  }, true);

  injectTemplates();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleSyncToggle, { once: true });
  } else {
    scheduleSyncToggle();
  }
  new MutationObserver(scheduleSyncToggle).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
