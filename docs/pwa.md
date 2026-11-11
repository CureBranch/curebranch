# Installable app, offline, and updates

## Install
- **iPhone/iPad:** a dismissible banner (not a pop-up) shows the steps: Share, then **Add to Home Screen**, then **Add**. On iOS/iPadOS, web push only works for apps added to the Home Screen (iOS 16.4 and later; general knowledge).
- **Android / Chrome / Edge:** the banner's **Install app** button uses the browser's `beforeinstallprompt`.
- Dismissing hides it on that device. It never shows inside the installed app.

## Offline
`sw.js` precaches the app files into a per-version cache `cb-app-<build id>`. Page loads try the network first; each successful load refreshes an offline copy in `cb-pages`. With no network (or a server error), the offline copy loads. Requests to other sites (hospitals, card issuers) are never touched by the service worker.

## Updates (`app/js/update.js`, swappable)
1. **One build id everywhere.** `tools/stamp-build.mjs` writes `/version.json` `{v, built, manifestKey}` and puts the same id into `sw.js` (cache name) and the pages' `<meta name="cb-build">`.
2. **No stale control files.** `_headers` serves `sw.js`, `version.json`, `index.html` and the manifest with `Cache-Control: no-cache`; registration uses `updateViaCache: "none"`.
3. **No surprise takeovers.** A new service worker never calls `skipWaiting` on install. It waits until the page posts `SKIP_WAITING`.
4. **Detection.** `reg.update()` on load, on focus or when the tab becomes visible, and every hour. `version.json` is also fetched with `no-store` on load and focus, at most once a minute, so updates are noticed even where service workers don't run.
5. **Applying.**
   - In the first ~8 seconds after opening, if the person hasn't started using the page and no text field is focused, the update is applied silently.
   - Otherwise an accessible banner appears: "New version available" with **Refresh**, **Later** and **Listen**. It uses `role="status"`, sits in the page flow (not a modal), and is never auto-applied while a form field is focused.
   - **Refresh** posts `SKIP_WAITING`, waits for `controllerchange`, then reloads once. If nothing takes over within 2 seconds, it unregisters the service worker, clears `cb-` caches, and reloads with a cache-busting URL.
6. **Loop guard.** The target build id is remembered in `sessionStorage`, with an in-memory fallback, plus a `?cb_v=<id>` marker on the reload URL. If a page reloaded for a build and still isn't on it, it won't auto-reload for that build again; it shows the banner instead. This holds even when storage is blocked.
7. **Reinstall nudge.** Shown only to installed apps, and only if the manifest's name, theme color, icons or start URL changed (tracked through `manifestKey`).

Tested in `tests/browser/update_flow.py` with two real builds, including blocked storage and a stuck update.

## Push (stub)
Settings has an opt-in switch. Without `VAPID_PUBLIC_KEY` and a push server, it explains that notifications aren't set up and turns nothing on. The `push` and `notificationclick` handlers are in `sw.js`.
