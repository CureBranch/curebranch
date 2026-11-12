// Translate: a header panel with two ways to read CureBranch in another language.
// 1) On this device: browsers with the built-in Translator API (Chrome and Edge on computers today)
//    translate the page right here. The language pack runs locally; the words are not sent anywhere.
// 2) Any browser: step-by-step help for the browser's own "Translate page" feature (100+ languages).
// Works on static hosting with a strict Content Security Policy (no third-party scripts).

export const LANGS = [
  ["es", "Español", "Spanish"], ["zh", "中文（简体）", "Chinese, simplified"], ["zh-Hant", "中文（繁體）", "Chinese, traditional"],
  ["vi", "Tiếng Việt", "Vietnamese"], ["ar", "العربية", "Arabic"], ["fr", "Français", "French"], ["ko", "한국어", "Korean"],
  ["ru", "Русский", "Russian"], ["pt", "Português", "Portuguese"], ["hi", "हिन्दी", "Hindi"], ["de", "Deutsch", "German"],
  ["ja", "日本語", "Japanese"], ["it", "Italiano", "Italian"], ["pl", "Polski", "Polish"], ["uk", "Українська", "Ukrainian"],
  ["tr", "Türkçe", "Turkish"], ["bn", "বাংলা", "Bengali"], ["id", "Bahasa Indonesia", "Indonesian"], ["th", "ไทย", "Thai"],
  ["he", "עברית", "Hebrew"], ["nl", "Nederlands", "Dutch"], ["el", "Ελληνικά", "Greek"], ["ro", "Română", "Romanian"],
  ["cs", "Čeština", "Czech"], ["hu", "Magyar", "Hungarian"], ["sv", "Svenska", "Swedish"], ["da", "Dansk", "Danish"],
  ["fi", "Suomi", "Finnish"], ["no", "Norsk", "Norwegian"], ["ta", "தமிழ்", "Tamil"], ["te", "తెలుగు", "Telugu"],
  ["mr", "मराठी", "Marathi"], ["kn", "ಕನ್ನಡ", "Kannada"], ["bg", "Български", "Bulgarian"], ["hr", "Hrvatski", "Croatian"],
  ["sk", "Slovenčina", "Slovak"], ["sl", "Slovenščina", "Slovenian"], ["lt", "Lietuvių", "Lithuanian"],
];
const RTL = new Set(["ar", "he"]);
const KEY = "cb-translate";

const HOWTO = [
  ["chrome", "Chrome on a computer", ["Right-click an empty part of the page.", "Choose <b>Translate to …</b>.", "To pick a language, click the translate icon in the address bar, then the three dots, then <b>Choose another language</b>."]],
  ["android", "Chrome on Android", ["Tap the three dots at the top right.", "Tap <b>Translate…</b>.", "Pick your language from the bar at the bottom."]],
  ["safari", "Safari on iPhone or iPad", ["Tap the <b>Aa</b> or page menu button in the address bar.", "Tap <b>Translate to …</b>.", "To add languages, go to Settings, then General, then Language &amp; Region."]],
  ["safari-mac", "Safari on a Mac", ["Click the translate icon in the address bar, or open the <b>View</b> menu.", "Choose <b>Translation</b>, then your language."]],
  ["edge", "Microsoft Edge", ["Right-click the page.", "Choose <b>Translate to …</b>.", "Or click the translate icon in the address bar and pick a language."]],
  ["firefox", "Firefox", ["Click the translate icon in the address bar, or open the menu (three lines).", "Choose <b>Translate page…</b>.", "Pick your language. Firefox translates on your own device."]],
  ["samsung", "Samsung Internet", ["Tap the menu (three lines) at the bottom.", "Tap <b>Translate</b>.", "Pick your language."]],
];
function detect() {
  const ua = navigator.userAgent || "";
  if (/SamsungBrowser/i.test(ua)) return "samsung";
  if (/Edg\//.test(ua)) return "edge";
  if (/Firefox|FxiOS/.test(ua)) return "firefox";
  if (/iPhone|iPad|iPod/.test(ua)) return "safari";
  if (/Android/.test(ua)) return "android";
  if (/Chrome|Chromium/.test(ua)) return "chrome";
  if (/Safari/.test(ua)) return "safari-mac";
  return "chrome";
}
function howtoHtml() {
  const mine = detect();
  const order = [...HOWTO.filter((h) => h[0] === mine), ...HOWTO.filter((h) => h[0] !== mine)];
  return order.map(([id, name, steps], i) => `<details class="tr-how"${i === 0 ? " open" : ""}><summary>${name}${i === 0 ? " (looks like yours)" : ""}</summary>` +
    `<ol>${steps.map((s) => `<li>${s}</li>`).join("")}</ol></details>`).join("");
}

const hasApi = () => typeof self !== "undefined" && "Translator" in self;
let translator = null, current = null, observer = null;
const originals = new Map();   // text node -> original English
const attrOrig = new Map();    // element -> {attr: original}
const cache = new Map();       // English -> translated
const SKIP = "script,style,textarea,code,pre,[translate=no],.notranslate,svg";
const ATTRS = ["aria-label", "placeholder", "title", "alt"];

const $ = (id) => document.getElementById(id);
function status(msg) { const s = $("tr-status"); if (s) s.textContent = msg; }
const langName = (code) => { const l = LANGS.find((x) => x[0] === code); return l ? l[2] : code; };

async function tx(text) {
  if (cache.has(text)) return cache.get(text);
  const p = translator.translate(text).catch(() => text);
  cache.set(text, p);
  return p;
}
function textNodes(root) {
  const out = [];
  if (root.nodeType === 3) { if (ok(root)) out.push(root); return out; }
  if (root.nodeType !== 1 || root.closest(SKIP)) return out;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => ok(n) ? 1 : 3 });
  let n; while ((n = w.nextNode())) out.push(n);
  return out;
}
function ok(n) {
  const v = originals.has(n) ? originals.get(n) : n.nodeValue;
  return /[A-Za-z]{2}/.test(v || "") && n.parentElement && !n.parentElement.closest(SKIP);
}
// MutationObserver callbacks run later (as microtasks), so a flag set around our own writes is not
// enough: remember what we wrote and ignore mutations that only show our own text.
const wroteText = new WeakMap();   // text node -> value we wrote
const wroteAttr = new WeakMap();   // element -> {attr: value we wrote}
let writing = false;
async function translateRoot(root) {
  if (!translator) return;
  const t = translator;
  const jobs = textNodes(root).map(async (n) => {
    const orig = originals.has(n) ? originals.get(n) : n.nodeValue;
    const m = orig.match(/^(\s*)([\s\S]*?)(\s*)$/);
    const out = await tx(m[2]);
    if (translator !== t) return;
    if (!originals.has(n)) originals.set(n, orig);
    writing = true; n.nodeValue = m[1] + out + m[3]; wroteText.set(n, n.nodeValue); writing = false;
  });
  const els = root.nodeType === 1 ? [root, ...root.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(","))] : [];
  for (const el of els) {
    if (el.closest(SKIP) && !el.matches("svg")) continue;
    for (const a of ATTRS) {
      if (!el.hasAttribute || !el.hasAttribute(a)) continue;
      const rec = attrOrig.get(el) || {};
      const orig = a in rec ? rec[a] : el.getAttribute(a);
      if (!/[A-Za-z]{2}/.test(orig)) continue;
      jobs.push(tx(orig).then((out) => { if (translator !== t) return; rec[a] = orig; attrOrig.set(el, rec); writing = true; el.setAttribute(a, out); const w = wroteAttr.get(el) || {}; w[a] = out; wroteAttr.set(el, w); writing = false; }));
    }
  }
  await Promise.all(jobs);
}
function translateAttr(el, a) {
  if (!translator || (el.closest(SKIP) && !el.matches("svg"))) return;
  const t = translator; const orig = el.getAttribute(a);
  if (!orig || !/[A-Za-z]{2}/.test(orig)) return;
  tx(orig).then((out) => { if (translator !== t) return; const rec = attrOrig.get(el) || {}; rec[a] = orig; attrOrig.set(el, rec);
    el.setAttribute(a, out); const w = wroteAttr.get(el) || {}; w[a] = out; wroteAttr.set(el, w); });
}
function observe() {
  if (observer) return;
  observer = new MutationObserver((muts) => {
    if (writing || !translator) return;
    for (const m of muts) {
      if (m.type === "characterData") {
        if (wroteText.get(m.target) === m.target.nodeValue) continue;
        originals.delete(m.target); translateRoot(m.target);
      } else if (m.type === "attributes") {
        const w = wroteAttr.get(m.target);
        if (w && w[m.attributeName] === m.target.getAttribute(m.attributeName)) continue;
        const r = attrOrig.get(m.target); if (r) delete r[m.attributeName]; translateAttr(m.target, m.attributeName);
      }
      else m.addedNodes.forEach((n) => translateRoot(n));
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

/** Translate the page on this device. Must start from a click the first time a language pack downloads. */
export async function translatePage(lang) {
  if (!hasApi()) { status("This browser can't translate here. Use your browser's translate steps below."); return false; }
  status(`Checking ${langName(lang)}…`);
  let avail;
  try { avail = await self.Translator.availability({ sourceLanguage: "en", targetLanguage: lang }); } catch { avail = "unavailable"; }
  if (avail === "unavailable") { status(`This browser can't translate to ${langName(lang)} on this device. Use your browser's translate steps below.`); return false; }
  let t;
  try {
    t = await self.Translator.create({ sourceLanguage: "en", targetLanguage: lang,
      monitor(m) { m.addEventListener("downloadprogress", (e) => status(`Getting the ${langName(lang)} language pack: ${Math.round((e.loaded || 0) * 100)}%`)); } });
  } catch { status("The translation could not start. Try again, or use your browser's translate steps below."); return false; }
  restore(false);
  translator = t; current = lang; cache.clear();
  document.documentElement.lang = lang;
  document.documentElement.dir = RTL.has(lang) ? "rtl" : "ltr";
  status(`Translating into ${langName(lang)}…`);
  await translateRoot(document.body);
  observe();
  try { sessionStorage.setItem(KEY, lang); } catch {}
  const u = $("tr-undo"); if (u) u.hidden = false;
  status(`This page is now in ${langName(lang)}. Machine translation can make mistakes.`);
  return true;
}
function restore(announce = true) {
  translator = null;
  writing = true;
  for (const [n, v] of originals) n.nodeValue = v;
  for (const [el, rec] of attrOrig) for (const a in rec) el.setAttribute(a, rec[a]);
  writing = false;
  if (observer) observer.takeRecords();   // drop the records for our own restore
  originals.clear(); attrOrig.clear();
  if (announce) {
    current = null;
    document.documentElement.lang = "en"; document.documentElement.dir = "ltr";
    try { sessionStorage.removeItem(KEY); } catch {}
    const u = $("tr-undo"); if (u) u.hidden = true;
    status("Showing the original English.");
  }
}
export const showOriginal = () => restore(true);
export const currentLang = () => current;

export function initTranslate() {
  const btn = $("tr-btn"), panel = $("tr-panel");
  if (!btn || !panel || btn.__cb) return; btn.__cb = true;
  const sel = $("tr-lang");
  sel.innerHTML = LANGS.map(([c, n, e]) => `<option value="${c}" lang="${c}">${n}${n === e ? "" : ` (${e})`}</option>`).join("") +
    `<option value="other">Another language (use your browser)</option>`;
  const pref = (navigator.language || "es").split("-")[0];
  if (pref !== "en" && LANGS.some((l) => l[0] === pref)) sel.value = pref;
  $("tr-howto").innerHTML = howtoHtml();
  const dev = $("tr-device");
  const sync = () => { dev.hidden = !hasApi() || sel.value === "other"; };
  sync(); sel.addEventListener("change", sync);
  const open = (v) => {
    btn.setAttribute("aria-expanded", String(v)); panel.hidden = !v;
    if (v) sel.focus();
  };
  btn.addEventListener("click", () => open(panel.hidden));
  $("tr-close").addEventListener("click", () => { open(false); btn.focus(); });
  panel.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); open(false); btn.focus(); } });
  document.addEventListener("click", (e) => { if (!panel.hidden && !e.target.closest(".tr-wrap")) open(false); });
  $("tr-go").addEventListener("click", () => translatePage(sel.value));
  $("tr-undo").addEventListener("click", () => showOriginal());
  // Keep the chosen language when moving to another page (only if its pack is already on the device).
  let saved = null; try { saved = sessionStorage.getItem(KEY); } catch {}
  if (saved && hasApi()) {
    self.Translator.availability({ sourceLanguage: "en", targetLanguage: saved }).then((a) => {
      if (a === "available") { sel.value = saved; sync(); translatePage(saved); }
    }).catch(() => {});
  }
}
