// Deploy step: copy app/ -> dist/ and stamp one build id everywhere.
//   node tools/stamp-build.mjs            (id = CB_BUILD_ID, else CF_PAGES_COMMIT_SHA, else git HEAD)
// Writes dist/version.json {v, built, manifestKey} and replaces "__BUILD_ID__" in
// sw.js (cache name), index.html and profile.html (<meta name="cb-build">).
// Cloudflare Pages: build command "node tools/stamp-build.mjs", output directory "dist".
// GitHub Pages: .github/workflows/pages.yml runs this and publishes dist/. GitHub Pages has no
// _redirects, so dist/404.html is a copy of the profile page: /p/<code> (any unknown path) loads it,
// and profile.js reads the code from the address. .nojekyll keeps files like _headers as-is.
import { cpSync, rmSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";

let id = process.env.CB_BUILD_ID || process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA;
if (!id) { try { id = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { id = "local-" + Date.now(); } }
id = id.slice(0, 12).replace(/[^A-Za-z0-9._-]/g, "");
const out = process.env.CB_OUT || "dist";

rmSync(out, { recursive: true, force: true });
cpSync("app", out, { recursive: true });
for (const f of ["sw.js", "index.html", "profile.html", "how-it-started.html"]) {
  const p = `${out}/${f}`;
  writeFileSync(p, readFileSync(p, "utf8").replaceAll("__BUILD_ID__", id));
}
copyFileSync(`${out}/profile.html`, `${out}/404.html`);
writeFileSync(`${out}/.nojekyll`, "");
// Reinstall nudge fires only when these manifest fields change.
const m = JSON.parse(readFileSync(`${out}/manifest.webmanifest`, "utf8"));
const manifestKey = createHash("sha256").update(JSON.stringify([m.name, m.short_name, m.theme_color, m.icons, m.start_url])).digest("hex").slice(0, 16);
writeFileSync(`${out}/version.json`, JSON.stringify({ v: id, built: new Date().toISOString(), manifestKey }, null, 2) + "\n");
console.log(`Stamped build ${id} into ${out}/`);
