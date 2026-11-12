// Deploy step: copy app/ -> dist/, stamp one build id everywhere, and write one real page per address.
//   node tools/stamp-build.mjs            (id = CB_BUILD_ID, else CF_PAGES_COMMIT_SHA, else git HEAD)
// Writes dist/version.json {v, built, manifestKey} and replaces "__BUILD_ID__" in sw.js (cache name)
// and every HTML page (<meta name="cb-build">).
// Every page has a clean address (no "#" routes): for each address in app/js/routes.js the build writes
// dist/<address>/index.html with its own <title>, meta description and canonical link, so a direct
// visit or a refresh on /cancers/breast/her2-positive/ works on any static host.
// The shared header and footer live in app/partials/ and are included here (<!--@header-->, <!--@footer-->).
// GitHub Pages: .github/workflows/pages.yml runs this and publishes dist/. GitHub Pages has no
// _redirects, so dist/404.html is the profile page: /p/<code> loads it and profile.js reads the code
// from the address; any other unknown address shows "Page not found". .nojekyll keeps _headers as-is.
import { cpSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { SITE, STATIC_PAGES, allRoutes } from "../app/js/routes.js";

let id = process.env.CB_BUILD_ID || process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA;
if (!id) { try { id = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { id = "local-" + Date.now(); } }
id = id.slice(0, 12).replace(/[^A-Za-z0-9._-]/g, "");
const out = process.env.CB_OUT || "dist";

rmSync(out, { recursive: true, force: true });
cpSync("app", out, { recursive: true });
rmSync(`${out}/partials`, { recursive: true, force: true });

const attr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const header = readFileSync("app/partials/header.html", "utf8");
const footer = readFileSync("app/partials/footer.html", "utf8");
const page = (f) => readFileSync(`app/${f}`, "utf8").replace("<!--@header-->", header).replace("<!--@footer-->", footer).replaceAll("__BUILD_ID__", id);
const fill = (html, r) => html
  .replace("__TITLE__", attr(r.path === "/" ? r.title : `${r.title} | CureBranch`))
  .replace("__DESC__", attr(r.desc))
  .replace("__CANONICAL__", attr(SITE + r.path));
const write = (path, html) => { const f = `${out}${path}${path.endsWith("/") ? "index.html" : ""}`; mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, html); };

// The app shell, once per address.
const data = JSON.parse(readFileSync("app/data/public-cancer-data.json", "utf8"));
const shell = page("index.html");
const routes = allRoutes(data);
// Show the right screen before any script runs, so a direct visit never flashes the home page.
const shellFor = (r) => shell.replace('<section class="screen active" id="s-home"', '<section class="screen" id="s-home"')
  .replace(`<section class="screen" id="s-${r.page ? r.page.screen : "cancer"}"`, `<section class="screen active" id="s-${r.page ? r.page.screen : "cancer"}"`);
for (const r of routes) write(r.path, fill(shellFor(r), r));

// Separate pages: their own address, and the old .html address forwards to it.
for (const s of STATIC_PAGES) {
  write(s.path, fill(page(s.file), s));
  writeFileSync(`${out}/${s.file}`, `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>Moved: ${attr(s.title)}</title>` +
    `<meta http-equiv="refresh" content="0; url=${s.path}"><link rel="canonical" href="${SITE}${s.path}"><meta name="robots" content="noindex"></head>` +
    `<body><p>This page moved to <a href="${s.path}">${SITE}${s.path}</a>.</p></body></html>\n`);
}

// Profiles and "Page not found".
const profile = page("profile.html");
writeFileSync(`${out}/profile.html`, profile);
writeFileSync(`${out}/404.html`, profile);
writeFileSync(`${out}/sw.js`, readFileSync(`${out}/sw.js`, "utf8").replaceAll("__BUILD_ID__", id));

// Search engines.
const all = [...routes.map((r) => r.path), ...STATIC_PAGES.map((s) => s.path)];
const day = (data.generated || new Date().toISOString()).slice(0, 10);
writeFileSync(`${out}/sitemap.xml`, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  all.map((p) => `  <url><loc>${SITE}${p}</loc><lastmod>${day}</lastmod></url>`).join("\n") + `\n</urlset>\n`);
writeFileSync(`${out}/robots.txt`, `User-agent: *\nAllow: /\nDisallow: /p/\nSitemap: ${SITE}/sitemap.xml\n`);
writeFileSync(`${out}/.nojekyll`, "");

// Reinstall nudge fires only when these manifest fields change.
const m = JSON.parse(readFileSync(`${out}/manifest.webmanifest`, "utf8"));
const manifestKey = createHash("sha256").update(JSON.stringify([m.name, m.short_name, m.theme_color, m.icons, m.start_url])).digest("hex").slice(0, 16);
writeFileSync(`${out}/version.json`, JSON.stringify({ v: id, built: new Date().toISOString(), manifestKey }, null, 2) + "\n");
console.log(`Stamped build ${id} into ${out}/ (${all.length} pages)`);
