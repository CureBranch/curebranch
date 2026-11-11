// CureBranch service worker.
// BUILD_ID is replaced at deploy time by tools/stamp-build.mjs (same id as /version.json).
// Rules (see docs/pwa.md):
//  * app files are precached into a per-version cache "cb-app-<BUILD_ID>";
//  * page navigations are network-first; each successful visit refreshes the
//    offline copy in "cb-pages"; offline falls back to that copy, then to the precache;
//  * NO skipWaiting on install: a new worker waits until the page posts SKIP_WAITING;
//  * old "cb-app-*" caches are deleted on activate;
//  * push + notificationclick handlers live here.
const BUILD_ID = "__BUILD_ID__";
const APP_CACHE = `cb-app-${BUILD_ID}`;
const PAGES_CACHE = "cb-pages";
const PRECACHE = [
  "/", "/index.html", "/profile.html", "/manifest.webmanifest",
  "/css/a11y.css", "/css/app.css",
  "/js/a11y.js", "/js/app.js", "/js/config.js", "/js/codes.js", "/js/fhir.js", "/js/shc.js", "/js/summary.js",
  "/js/tree.js", "/js/store.js", "/js/smart.js", "/js/pwa.js", "/js/update.js", "/js/profile.js",
  "/js/onboarding.js", "/js/wizard.js", "/js/portal-stub.js", "/js/consistency.js",
  "/vendor/idb-keyval.js", "/vendor/canonicalize.js",
  "/data/example-summaries.json", "/data/trusted-issuers.json",
  "/data/examples/example-fhir-bundle.json", "/data/examples/example-health-card.smart-health-card",
  "/icons/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png",
  "/fonts/inter-latin-400-normal.woff2", "/fonts/inter-latin-600-normal.woff2", "/fonts/inter-latin-700-normal.woff2",
  "/fonts/fraunces-latin-600-normal.woff2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: "reload" })))));
  // Deliberately no self.skipWaiting() here.
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("cb-app-") && k !== APP_CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  const msg = event.data || {};
  if (msg.type === "SKIP_WAITING") self.skipWaiting();
  if (msg.type === "GET_BUILD" && event.ports && event.ports[0]) event.ports[0].postMessage({ build: BUILD_ID });
});

function isProfilePath(url) { return url.pathname.startsWith("/p/") || url.pathname === "/profile.html"; }

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch hospital, issuer or other sites
  if (url.pathname === "/version.json" || url.pathname === "/sw.js") return; // always network

  if (req.mode === "navigate") {
    event.respondWith((async () => {
      const shellKey = isProfilePath(url) ? "/profile.html" : "/index.html";
      try {
        const res = await fetch(req); // index.html is served with Cache-Control: no-cache (see _headers)
        if (res.ok) { const copy = res.clone(); caches.open(PAGES_CACHE).then((c) => c.put(shellKey, copy)); return res; }
        if (res.status < 500) return res; // e.g. a real 404
        throw new Error("server error"); // 5xx: treat like offline
      } catch {
        return (await caches.match(shellKey, { cacheName: PAGES_CACHE })) ||
               (await caches.match(shellKey, { cacheName: APP_CACHE })) ||
               new Response("<h1>Offline</h1><p>CureBranch could not load. Check your connection.</p>", { headers: { "Content-Type": "text/html" } });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const hit = await caches.match(req, { cacheName: APP_CACHE, ignoreSearch: true });
    if (hit) return hit;
    try { return await fetch(req); }
    catch { return Response.error(); }
  })());
});

// ---- Web push (opt-in). The payload format is a stub until a push server exists. ----
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || "CureBranch", {
    body: data.body || "There is news on your branch.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: data.url || "/#tree" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) if (new URL(w.url).origin === self.location.origin) { await w.focus(); return w.navigate ? w.navigate(target) : null; }
    return self.clients.openWindow(target);
  })());
});
