// PWA extras: install instructions banner and opt-in web push (stub).
// The update flow lives in update.js.
import { CONFIG } from "./config.js";
import { initUpdates } from "./update.js";

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function installBanner(host, mode, onInstall) {
  if (document.getElementById("install-banner")) return;
  const el = document.createElement("section");
  el.className = "cb-banner";
  el.id = "install-banner";
  el.setAttribute("aria-labelledby", "install-title");
  el.innerHTML = mode === "ios"
    ? `<h2 id="install-title" class="cb-banner-title">Add CureBranch to your Home Screen</h2>
       <ol class="cb-steps">
         <li>Tap the <strong>Share</strong> button (a square with an arrow pointing up).</li>
         <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
         <li>Tap <strong>Add</strong>.</li>
       </ol>
       <p class="sub" style="margin:0 0 8px">On iPhone and iPad, notifications only work after you add the app to your Home Screen.</p>
       <div class="cb-banner-actions"><button type="button" class="btn btn-ghost" data-act="dismiss">Not now</button></div>`
    : `<h2 id="install-title" class="cb-banner-title">Install CureBranch</h2>
       <p class="sub" style="margin:0 0 8px">Opens like an app and works offline. Your records still stay on this device.</p>
       <div class="cb-banner-actions"><button type="button" class="btn btn-primary" data-act="install">Install app</button>
       <button type="button" class="btn btn-ghost" data-act="dismiss">Not now</button></div>`;
  el.addEventListener("click", (e) => {
    const a = e.target.closest("[data-act]");
    if (!a) return;
    if (a.dataset.act === "dismiss") { lsSet("cb-install-dismissed", "1"); el.remove(); }
    if (a.dataset.act === "install") onInstall().then(() => el.remove());
  });
  host.append(el);
}

function setupInstall(host) {
  if (isStandalone() || lsGet("cb-install-dismissed")) return;
  if (isIOS()) { installBanner(host, "ios"); return; }
  addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installBanner(host, "prompt", async () => { e.prompt(); await e.userChoice; });
  });
}

function b64ToBytes(b64) {
  const s = (b64 + "===".slice((b64.length + 3) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

/** Opt-in web push. STUB: needs CONFIG.VAPID_PUBLIC_KEY and a push server (none yet). */
export async function pushOptIn() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, message: isIOS() && !isStandalone()
      ? "On iPhone and iPad, add CureBranch to your Home Screen first, then turn this on from the app."
      : "This browser doesn't support notifications." };
  }
  if (!CONFIG.VAPID_PUBLIC_KEY) return { ok: false, message: "Notifications aren't set up yet (there's no push server). Nothing was turned on." };
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, message: "Notifications were not allowed. You can change this in your browser settings." };
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(CONFIG.VAPID_PUBLIC_KEY) });
  // TODO: send `sub` to the push server once one exists. Nothing is sent today.
  return { ok: true, message: "Notifications are on for this device.", subscription: sub.toJSON() };
}
export async function pushOptOut() {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && (await reg.pushManager.getSubscription());
    if (sub) await sub.unsubscribe();
  } catch { /* ignore */ }
  return { ok: true, message: "Notifications are off." };
}

export function initPwa({ bannerHost }) {
  initUpdates({ bannerHost });
  setupInstall(bannerHost);
}
