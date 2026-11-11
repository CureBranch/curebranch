# Deploying

Main domain: **https://curebranch.ai**. Profile pages: **https://my.curebranch.ai/&lt;code&gt;**.

Nothing here has been set up yet. These are the steps when the owner is ready.

## Cloudflare Pages (static hosting)

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

The public **website** (not the patient app) has a personal tip link to Buy Me a Coffee in its footer, with a note that tips go to the creator personally and not to the project or servers. It is separate from the Open Collective donation link. The patient app has no tip link.

## Before going live: checklist

- [ ] `npm test` and `npm run test:browser` pass
- [ ] `app/js/config.js`: `SMART_CLIENT_ID`, `DONATE_URL`, and later `PUBLIC_INDEX_URL` / `VAPID_PUBLIC_KEY`
- [ ] Real trusted-issuer list in `app/data/trusted-issuers.json` (remove the EXAMPLE issuer)
- [ ] Legal review of DISCLAIMER.md
- [ ] Domain redirects tested
