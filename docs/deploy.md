# Deploying

Main domain: **https://curebranch.ai**. Profile pages: **https://my.curebranch.ai/&lt;code&gt;**.

Nothing here has been set up yet. These are the steps when the owner is ready.

## GitHub Pages (chosen host)

The site is published by `.github/workflows/pages.yml` on every push to `main`: it runs the unit tests, runs `node tools/stamp-build.mjs` (copies `app/` to `dist/` and stamps the commit id), and publishes `dist/` with the official `actions/upload-pages-artifact` and `actions/deploy-pages`.

One-time setup (repo admin):

1. Create the repo under the **CureBranch** GitHub organization and push `main`.
2. Repo **Settings > Pages > Source: GitHub Actions**.
3. Verify the domain first (org **Settings > Pages > Add a domain**, a TXT record at GoDaddy) so nobody else can claim it.
4. Repo **Settings > Pages > Custom domain: `curebranch.ai`**, then **Enforce HTTPS** once the certificate is ready (can take up to 24 hours). With an Actions workflow GitHub ignores `app/CNAME`; it is kept as a record of the domain and for branch-based publishing.
5. DNS at GoDaddy for `curebranch.ai` (from GitHub's docs): remove the parked/forwarding records, then
   - `A @` → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - `AAAA @` → `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`
   - `CNAME www` → `curebranch.github.io` (the org's default domain, no repo name). No wildcard records.

What is different from Cloudflare Pages:

- **No `_redirects`:** `dist/404.html` is a copy of the profile page, so `/p/<code>` loads the profile (with HTTP status 404, which browsers still show normally). `profile.js` reads the code from the address.
- **No `_headers`:** GitHub Pages can't set custom headers. The CSP and referrer policy are also set with `<meta>` tags in each HTML page, so they still apply. `frame-ancestors` / `X-Frame-Options` (anti-framing) and `Permissions-Policy` can't be set by a meta tag, so those are not enforced on GitHub Pages. `_headers` and `_redirects` are still copied (harmless plain files) in case the site moves to Cloudflare later.
- **Caching:** GitHub Pages caches files for about 10 minutes *(general knowledge)*. The app's update check fetches `/version.json` with `no-store` and registers the service worker with `updateViaCache: "none"`, so updates still arrive; a new page shell can take up to ~10 minutes to show.
- `my.curebranch.ai/<code>` needs a redirect that keeps the path, to `https://curebranch.ai/p/<code>`. GitHub Pages can't do that by itself, and registrar forwarding may drop the path (check before relying on it). Until then, `curebranch.ai/p/<code>` works as the public address.

## Cloudflare Pages (alternative)

1. Put this repo on a Git host and connect it to a Cloudflare Pages project (or upload `dist/` with `npx wrangler pages deploy dist`).
2. Build settings:
   - **Build command:** `npm ci && node tools/stamp-build.mjs`
   - **Build output directory:** `dist`
   - The build stamps the commit id (`CF_PAGES_COMMIT_SHA`, which Pages provides) into `sw.js`, `index.html`, `profile.html` and `version.json`.
3. Add the custom domain `curebranch.ai` to the project.
4. `app/_headers` sets the security headers (CSP and others) and `Cache-Control: no-cache` for `sw.js`, `version.json`, `/`, `index.html`, `profile.html` and the manifest. `app/_redirects` maps `/p/<code>` to the profile page.

Cloudflare's free plan for Pages has generous static hosting limits *(general knowledge; check current limits and build quotas before launch)*.

## Profile addresses: my.curebranch.ai/&lt;code&gt;

The app serves profiles at `curebranch.ai/p/<code>`. To make `my.curebranch.ai/<code>` work, pick one:

- **Simplest:** a Cloudflare *Redirect Rule* on `my.curebranch.ai` that sends `/<code>` to `https://curebranch.ai/p/<code>` (302). The visible address changes after the click.
- **Cleaner:** add `my.curebranch.ai` as a second custom domain on the same Pages project, plus a *URL Rewrite* (Transform Rule) on that hostname that rewrites `/<code>` to `/p/<code>`. The address stays `my.curebranch.ai/<code>`. *(Confirm that rewrite rules apply to Pages custom domains in the current Cloudflare docs before relying on it.)*

`profile.js` already understands `/p/<code>`, `/<code>` and `?c=<code>`.

## The other 24 domains

All other CureBranch domains will **301 redirect to https://curebranch.ai**, keeping the path. With Cloudflare:

1. Add each domain to Cloudflare (free plan) and point its nameservers at Cloudflare.
2. Add a proxied placeholder DNS record (for example `A @ 192.0.2.1`, proxied, and the same for `www`) so requests reach Cloudflare.
3. Add a Redirect Rule (or one Bulk Redirect list for all of them): match all requests to the domain; target `concat("https://curebranch.ai", http.request.uri.path)`; status **301**; preserve the query string.
4. Test each one with `curl -I https://<domain>/some/path`.

Use 301 only once you're sure; browsers cache 301s for a long time. You can start with 302 while testing.

## Website footer tip link

The public **website** (not the patient app) has a personal tip link to Buy Me a Coffee in its footer, with a note that tips go to the creator personally and not to the project or servers. The project takes no donations and no money of any kind. The patient app has no tip link.

## Before going live: checklist

- [ ] `npm test` and `npm run test:browser` pass
- [ ] `app/js/config.js`: `SMART_CLIENT_ID`, and later `PUBLIC_INDEX_URL` / `VAPID_PUBLIC_KEY`
- [ ] Real trusted-issuer list in `app/data/trusted-issuers.json` (remove the EXAMPLE issuer)
- [ ] Legal review of DISCLAIMER.md
- [ ] Domain redirects tested
