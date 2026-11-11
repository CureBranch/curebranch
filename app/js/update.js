// =====================================================================
// PWA UPDATE FLOW  (self-contained; swap this file to change the design)
// ---------------------------------------------------------------------
// * Build id: <meta name="cb-build"> in index.html, BUILD_ID in sw.js and
//   /version.json are all stamped with the same id by tools/stamp-build.mjs.
// * Detection: reg.update() on load, focus, visibilitychange and hourly;
//   plus GET /version.json (no-store) on load/focus, at most once a minute.
//   The version.json check also works when service workers are unavailable.
// * A new service worker never takes over by itself (no skipWaiting on install).
//   It waits until this page posts {type:"SKIP_WAITING"}.
// * In the first ~8 s after opening, the update is applied silently, unless a
//   form field is focused. Otherwise an accessible, dismissible banner offers
//   "Refresh" / "Later" (role=status, with a Listen button).
// * Refresh: SKIP_WAITING -> wait for controllerchange -> reload once. If no
//   takeover within 2 s: unregister SW, clear caches, reload with a cache-busting URL.
// * Loop guard: keyed to the target version id, in sessionStorage with an
//   in-memory fallback, plus a ?cb_v=<target> URL marker so a page that reloaded
//   for a target and still is not on it never auto-reloads for it again.
// * Reinstall nudge: only if version.json's manifestKey (name/theme/icons/start_url)
//   changed while running as an installed app.
// =====================================================================
const BUILD = (document.querySelector('meta[name="cb-build"]') || {}).content || "dev";
const STAMPED = !BUILD.includes("__BUILD_ID__") && BUILD !== "dev";
const OPENED_AT = Date.now();
const SILENT_WINDOW_MS = 8000;
const TAKEOVER_TIMEOUT_MS = 2000;
const VERSION_CHECK_MIN_GAP_MS = 60_000;
const HOURLY = 3_600_000;
const GUARD_KEY = "cb-update-guard";
const URL_MARK = "cb_v";

const mem = { guard: null, dismissed: null };
// RUNNING = build of the service worker that controls this page (falls back to the page's own build).
// Comparing against it catches the case where fresh HTML arrived but older cached files are in use.
let RUNNING = BUILD;
let host = null, reg = null, applying = false, lastVersionCheck = 0, shownFor = null, userInteracted = false;

// ---------- small storage helpers that never throw ----------
function ssGet(k) { try { return window.sessionStorage.getItem(k); } catch { return null; } }
function ssSet(k, v) { try { window.sessionStorage.setItem(k, v); } catch { /* storage unavailable: memory only */ } }
function lsGet(k) { try { return window.localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch { /* ignore */ } }

function guardHit(target) { return ssGet(GUARD_KEY) === target || mem.guard === target; }
function setGuard(target) { mem.guard = target; ssSet(GUARD_KEY, target); }

function urlWith(params) {
  const u = new URL(location.href);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

// On load: read and remove the URL marker.
(function readUrlMark() {
  const u = new URL(location.href);
  const mark = u.searchParams.get(URL_MARK);
  if (!mark) return;
  if (mark !== BUILD) setGuard(mark); // we already reloaded for this target and did not get it
  u.searchParams.delete(URL_MARK); u.searchParams.delete("cb_bust");
  history.replaceState(history.state, "", u.pathname + (u.search === "?" ? "" : u.search) + u.hash);
})();

function formFieldFocused() {
  const a = document.activeElement;
  if (!a) return false;
  if (a.isContentEditable) return true;
  if (a.tagName === "TEXTAREA" || a.tagName === "SELECT") return true;
  if (a.tagName === "INPUT") return !["button", "submit", "reset", "checkbox", "radio", "range", "color"].includes(a.type);
  return false;
}

// ---------- applying ----------
let reloaded = false;
function reloadTo(target, bust) {
  if (reloaded) return;
  reloaded = true;
  const params = { [URL_MARK]: target };
  if (bust) params.cb_bust = String(Date.now());
  location.replace(urlWith(params));
}

async function hardReload(target) {
  try {
    if ("serviceWorker" in navigator) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    if (window.caches) for (const k of await caches.keys()) if (k.startsWith("cb-")) await caches.delete(k);
  } catch { /* best effort */ }
  reloadTo(target, true);
}

export async function applyUpdate(target) {
  if (applying) return;
  applying = true;
  setGuard(target);
  const waiting = reg && reg.waiting;
  if (!waiting) { await hardReload(target); return; }
  const timer = setTimeout(() => hardReload(target), TAKEOVER_TIMEOUT_MS);
  navigator.serviceWorker.addEventListener("controllerchange", () => { clearTimeout(timer); reloadTo(target, false); }, { once: true });
  waiting.postMessage({ type: "SKIP_WAITING" });
}

// ---------- banner ----------
function removeBanner() { const b = document.getElementById("update-banner"); if (b) b.remove(); }
function speak(text) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = window.CureBranchA11y && CureBranchA11y.bestVoice && CureBranchA11y.bestVoice(document.documentElement.lang || "en");
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}
function showBanner(target) {
  if (!host || document.getElementById("update-banner")) return;
  const el = document.createElement("div");
  el.className = "cb-banner";
  el.id = "update-banner";
  el.setAttribute("role", "status");
  el.innerHTML = `<p class="cb-banner-text"><strong>New version available</strong></p>
    <div class="cb-banner-actions">
      <button type="button" class="btn btn-primary" data-act="refresh">Refresh</button>
      <button type="button" class="btn btn-ghost" data-act="later">Later</button>
      <button type="button" class="btn btn-ghost" data-act="listen" aria-label="Listen to this message">Listen</button>
    </div>`;
  el.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]");
    if (!act) return;
    if (act.dataset.act === "refresh") { act.disabled = true; act.textContent = "Refreshing…"; applyUpdate(target); }
    if (act.dataset.act === "later") { mem.dismissed = target; ssSet("cb-update-later", target); removeBanner(); }
    if (act.dataset.act === "listen") speak("New version available. Choose Refresh to update now, or Later.");
  });
  host.prepend(el);
}

function onNewVersion(target) {
  if (!target || target === RUNNING || shownFor === target || applying) return;
  if (mem.dismissed === target || ssGet("cb-update-later") === target) return;
  shownFor = target;
  const early = Date.now() - OPENED_AT < SILENT_WINDOW_MS;
  if (early && !userInteracted && !formFieldFocused() && !guardHit(target)) { applyUpdate(target); return; }
  showBanner(target);
}

// ---------- detection ----------
function askWorkerVersion(worker) {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const t = setTimeout(() => resolve(null), 1000);
    ch.port1.onmessage = (e) => { clearTimeout(t); resolve(e.data && e.data.build); };
    try { worker.postMessage({ type: "GET_BUILD" }, [ch.port2]); } catch { clearTimeout(t); resolve(null); }
  });
}
async function onWaiting(worker) {
  const v = (await askWorkerVersion(worker)) || "sw-" + Date.now();
  onNewVersion(v);
}

async function checkVersionFile(force) {
  if (!STAMPED) return;
  if (!force && Date.now() - lastVersionCheck < VERSION_CHECK_MIN_GAP_MS) return;
  lastVersionCheck = Date.now();
  let info;
  try { info = await (await fetch("/version.json", { cache: "no-store" })).json(); } catch { return; }
  checkManifest(info);
  if (!info.v || (info.v === BUILD && info.v === RUNNING)) return;
  if (reg) {
    try { await reg.update(); } catch { /* offline */ }
    // Give a found worker a moment to install; the 'installed' handler shows the banner.
    await new Promise((r) => setTimeout(r, 1500));
    if (reg.waiting || reg.installing) return; // handled by the worker path
  }
  onNewVersion(info.v);
}

function checkManifest(info) {
  if (!info.manifestKey) return;
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const prev = lsGet("cb-manifest-key");
  lsSet("cb-manifest-key", info.manifestKey);
  if (!standalone || !prev || prev === info.manifestKey || !host || document.getElementById("reinstall-nudge")) return;
  const el = document.createElement("div");
  el.className = "cb-banner"; el.id = "reinstall-nudge"; el.setAttribute("role", "status");
  el.innerHTML = `<p class="cb-banner-text">The app's name or icon changed. To see it, remove CureBranch from your home screen and add it again. On some phones that also removes data saved in the app, so download your backup first (Settings, Your data).</p>
    <div class="cb-banner-actions"><button type="button" class="btn btn-ghost">Dismiss</button></div>`;
  el.querySelector("button").addEventListener("click", () => el.remove());
  host.prepend(el);
}

function checkAll(force) {
  if (reg) reg.update().catch(() => {});
  checkVersionFile(force);
}

export async function initUpdates({ bannerHost }) {
  host = bannerHost;
  ["keydown", "pointerdown"].forEach((t) => addEventListener(t, () => { userInteracted = true; }, { once: true, capture: true }));
  if ("serviceWorker" in navigator) {
    try {
      reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      if (navigator.serviceWorker.controller) RUNNING = (await askWorkerVersion(navigator.serviceWorker.controller)) || BUILD;
      if (reg.waiting && navigator.serviceWorker.controller) onWaiting(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => {
          if (nw.state === "installed" && navigator.serviceWorker.controller) onWaiting(nw);
        });
      });
    } catch { reg = null; }
  }
  checkAll(true);
  addEventListener("focus", () => checkAll(false));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkAll(false); });
  setInterval(() => checkAll(true), HOURLY);
  window.CureBranchUpdate = { build: BUILD, check: () => checkAll(true), applyUpdate, _state: () => ({ applying, shownFor, guard: mem.guard, running: RUNNING }) };
}
