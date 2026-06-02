(function() {
  if (globalThis.__vdhProMaxThemeApplied) return;
  globalThis.__vdhProMaxThemeApplied = true;

  const rubikArabicUrl = chrome.runtime.getURL("assets/fonts/rubik-arabic.woff2");
  const rubikLatinUrl = chrome.runtime.getURL("assets/fonts/rubik-latin.woff2");

  const tokens = `
  --pm-font: "Rubik Pro Max", "Segoe UI", Tahoma, system-ui, sans-serif;
  --pm-bg: hsl(240 16% 7%);
  --pm-bg-soft: hsl(240 14% 10%);
  --pm-panel: hsl(240 13% 12%);
  --pm-panel-strong: hsl(240 12% 15%);
  --pm-border: hsl(330 85% 58% / 0.30);
  --pm-border-soft: hsl(0 0% 100% / 0.08);
  --pm-text: hsl(330 35% 96%);
  --pm-muted: hsl(330 10% 72%);
  --pm-accent: hsl(331 100% 52%);
  --pm-accent-2: hsl(20 100% 56%);
  --pm-success: hsl(145 65% 45%);
  --pm-danger: hsl(0 78% 58%);
  --pm-warning: hsl(38 92% 56%);
  --pm-radius-sm: 9px;
  --pm-radius-md: 14px;
  --pm-radius-lg: 18px;
  --pm-shadow: 0 18px 48px hsl(0 0% 0% / 0.35), 0 1px 0 hsl(0 0% 100% / 0.06) inset;
  --theme-control-bg: hsl(240 12% 15%);
  --theme-control-bg-hover: hsl(240 11% 20%);
  --theme-control-border: hsl(330 85% 58% / 0.30);
  --theme-control-border-focus: hsl(331 100% 68%);
  --theme-colored-fg: hsl(330 35% 98%);
  --theme-box-bg: hsl(240 13% 12%);
  --theme-box-border: hsl(330 85% 58% / 0.24);
  --theme-box-shadow: hsl(0 0% 0% / 0.28);
`;

  const css = `
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

:root {
${tokens}
}

:host {
${tokens}
}

html,
body,
:host {
  font-family: var(--pm-font) !important;
}

html,
body {
  color-scheme: dark;
  color: var(--pm-text) !important;
  background:
    radial-gradient(circle at 12% -10%, hsl(331 100% 52% / 0.18), transparent 34rem),
    radial-gradient(circle at 100% 0%, hsl(20 100% 56% / 0.16), transparent 26rem),
    linear-gradient(180deg, hsl(240 16% 8%), var(--pm-bg)) !important;
}

body {
  scrollbar-color: hsl(331 100% 52% / 0.65) hsl(240 14% 11%) !important;
}

body::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: -1;
  background-image:
    linear-gradient(hsl(0 0% 100% / 0.035) 1px, transparent 1px),
    linear-gradient(90deg, hsl(0 0% 100% / 0.025) 1px, transparent 1px);
  background-size: 28px 28px;
  mask-image: linear-gradient(to bottom, black, transparent 72%);
}

::selection {
  background: hsl(331 100% 52% / 0.35);
}

.roundedbox,
.container,
box.roundedbox,
vbox.roundedbox,
hbox.roundedbox,
section,
fieldset,
dialog,
table,
pre {
  background: linear-gradient(180deg, hsl(240 13% 13% / 0.98), hsl(240 14% 10% / 0.98)) !important;
  border: 1px solid var(--pm-border) !important;
  border-radius: var(--pm-radius-lg) !important;
  box-shadow: var(--pm-shadow) !important;
}

button,
.btn,
select,
input,
textarea,
com-native-menu {
  font-family: var(--pm-font) !important;
  border-radius: var(--pm-radius-sm) !important;
  border-color: var(--pm-border) !important;
  color: var(--pm-text) !important;
  background-color: hsl(240 12% 15%) !important;
  transition: background-color 160ms ease-out, border-color 160ms ease-out, box-shadow 160ms ease-out, transform 160ms ease-out;
}

input,
textarea,
select {
  background: hsl(240 13% 9% / 0.92) !important;
  box-shadow: 0 1px 0 hsl(0 0% 100% / 0.06) inset !important;
}

button:hover,
.btn:hover,
select:hover,
com-native-menu:hover {
  background-color: hsl(240 12% 20%) !important;
  border-color: hsl(331 100% 62% / 0.55) !important;
}

button:not([disabled]):active {
  transform: translateY(1px);
}

button:focus-visible,
select:focus-visible,
input:focus-visible,
textarea:focus-visible,
com-native-menu:focus-within {
  outline: 3px solid hsl(331 100% 62% / 0.28) !important;
  outline-offset: 2px !important;
  border-color: hsl(331 100% 65%) !important;
}

button.primary,
.btn,
button#button_get_premium,
button#button_download,
button#download,
button[id*="download"],
button[id*="button_download"] {
  color: hsl(330 35% 98%) !important;
  border-color: hsl(0 0% 100% / 0.18) !important;
  background: linear-gradient(135deg, var(--pm-accent), var(--pm-accent-2)) !important;
  box-shadow: 0 14px 34px hsl(331 100% 52% / 0.28), 0 10px 24px hsl(0 0% 0% / 0.38) !important;
}

button[disabled],
select[disabled],
input[disabled] {
  opacity: 0.45 !important;
  filter: grayscale(0.4);
}

a {
  color: hsl(331 100% 76%) !important;
}

h1,
h2,
h3,
strong,
.p_key {
  color: var(--pm-text) !important;
  font-weight: 700 !important;
}

p,
span,
label,
td,
th,
li {
  color: inherit;
}

hr,
tr,
td,
th {
  border-color: var(--pm-border-soft) !important;
}

tbody > tr:nth-of-type(even) {
  background-color: hsl(240 12% 14% / 0.82) !important;
}

tbody > tr:hover,
.media:hover,
.entry:hover,
.item:hover {
  background-color: hsl(331 100% 52% / 0.10) !important;
}

[tooltip]::after {
  color: var(--pm-text) !important;
  background: hsl(240 14% 9% / 0.96) !important;
  border: 1px solid var(--pm-border) !important;
  box-shadow: 0 10px 30px hsl(0 0% 0% / 0.42) !important;
}

#toolbar,
#controls,
#strings_container,
#main,
#nomedia {
  gap: var(--spacing-large, 12px);
}

#status,
.span_status::before {
  border-radius: 999px !important;
  font-weight: 700 !important;
}

#status.valid,
.span_status[status="translated"]::before {
  color: hsl(145 80% 92%) !important;
  background: hsl(145 65% 34%) !important;
}

#status.error,
.span_status[status="not_translated"]::before {
  color: hsl(0 90% 96%) !important;
  background: hsl(0 72% 42%) !important;
}

.span_status[status="changed"]::before {
  color: hsl(38 95% 10%) !important;
  background: var(--pm-warning) !important;
}

code-input,
pre,
code,
td {
  font-family: "Cascadia Code", "Consolas", monospace !important;
}

code-input {
  border: 1px solid var(--pm-border) !important;
  border-radius: var(--pm-radius-lg) !important;
  box-shadow: var(--pm-shadow) !important;
  background: hsl(240 14% 8%) !important;
}

input[type="checkbox"],
input[type="radio"] {
  accent-color: var(--pm-accent);
}

svg {
  color: inherit;
}

img {
  filter: drop-shadow(0 8px 18px hsl(0 0% 0% / 0.24));
}

#main-template,
#toolbar-template,
#media-template,
#media-discovered-template,
#media-downloading-template,
#media-downloaded-template,
#settings-template {
  color: var(--pm-text);
}

#button_pro_max_clear_medias {
  color: hsl(330 35% 98%) !important;
  border-color: hsl(331 100% 62% / 0.45) !important;
  background: linear-gradient(135deg, hsl(331 100% 35% / 0.92), hsl(20 92% 38% / 0.92)) !important;
}

.pro-max-media-capture-setting {
  display: grid !important;
  grid-template-columns: auto 1fr;
  column-gap: var(--spacing-medium, 6px);
  row-gap: 2px;
  align-items: center;
  margin-top: var(--spacing-large, 12px);
  padding-top: var(--spacing-large, 12px);
  border-top: 1px solid var(--pm-border-soft);
}

.pro-max-media-capture-setting small {
  grid-column: 2;
  color: var(--pm-muted);
  font-size: 0.9em;
}

.pro-max-developer-credit {
  display: block !important;
  margin: 12px 0 4px 0 !important;
  padding: 12px 16px !important;
  font-size: 1.05rem !important;
  font-weight: 800 !important;
  line-height: 1.35 !important;
  letter-spacing: 0.08em !important;
  text-align: center !important;
  text-transform: none !important;
  color: hsl(330 35% 98%) !important;
  border-radius: var(--pm-radius-md) !important;
  background: linear-gradient(
    135deg,
    hsl(331 100% 52% / 0.28),
    hsl(20 100% 56% / 0.16)
  ) !important;
  border: 1px solid hsl(331 100% 62% / 0.45) !important;
  box-shadow: 0 0 0 1px hsl(0 0% 100% / 0.05) inset, 0 8px 28px hsl(331 100% 40% / 0.2) !important;
  text-shadow: 0 1px 2px hsl(0 0% 0% / 0.35) !important;
}

.pro-max-signature {
  position: fixed;
  right: 12px;
  bottom: 10px;
  z-index: 2147483647;
  pointer-events: none;
  color: hsl(331 100% 72%) !important;
  font-family: var(--pm-font);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: none;
  text-shadow: 0 0 20px hsl(331 100% 50% / 0.55), 0 1px 10px hsl(0 0% 0% / 0.5);
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
`;

  function injectStyle(root) {
    if (!root || root.querySelector?.("style[data-pro-max-theme]")) return;
    const style = document.createElement("style");
    style.dataset.proMaxTheme = "true";
    style.textContent = css;
    root.appendChild(style);
  }

  function applyTheme() {
    injectStyle(document.head || document.documentElement);

    for (const template of document.querySelectorAll("template")) {
      injectStyle(template.content);
    }

    if (!document.querySelector(".pro-max-signature") && document.body) {
      const signature = document.createElement("div");
      signature.className = "pro-max-signature";
      signature.setAttribute("aria-label", "yehia");
      signature.textContent = "yehia";
      document.body.appendChild(signature);
    }
  }

  applyTheme();

  new MutationObserver(applyTheme).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
