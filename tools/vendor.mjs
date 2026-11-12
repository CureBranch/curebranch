// Copies the runtime libraries and fonts the static app needs from node_modules
// into app/vendor and app/fonts, so the app has no build step and loads nothing
// from third-party CDNs. Run after `npm install`:  npm run vendor
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const NM = "node_modules";
const VENDOR = "app/vendor";
const FONTS = "app/fonts";
const LIC = join(VENDOR, "LICENSES");
for (const d of [VENDOR, FONTS, LIC]) mkdirSync(d, { recursive: true });

function pkgVersion(name) {
  return JSON.parse(readFileSync(join(NM, name, "package.json"), "utf8")).version;
}
function copyLicense(name, outName) {
  for (const f of ["LICENSE", "LICENSE.md", "LICENSE.txt", "license", "LICENCE"]) {
    const p = join(NM, name, f);
    if (existsSync(p)) { copyFileSync(p, join(LIC, outName)); return; }
  }
  console.warn("No license file found for", name);
}

// idb-keyval (Apache-2.0): tiny promise wrapper around IndexedDB. Already ESM.
copyFileSync(join(NM, "idb-keyval/dist/index.js"), join(VENDOR, "idb-keyval.js"));
copyLicense("idb-keyval", "idb-keyval-LICENSE.txt");

// canonicalize (Apache-2.0): RFC 8785 JSON canonicalization. Ships as CommonJS,
// so wrap it as an ES module without changing its code.
const canon = readFileSync(join(NM, "canonicalize/lib/canonicalize.js"), "utf8");
writeFileSync(join(VENDOR, "canonicalize.js"),
  `// canonicalize ${pkgVersion("canonicalize")} (Apache-2.0), wrapped as ESM by tools/vendor.mjs\n` +
  `const module = { exports: {} };\n${canon}\nexport default module.exports;\n`);
copyLicense("canonicalize", "canonicalize-LICENSE.txt");

// fhirclient (Apache-2.0): SMART on FHIR client from SMART Health IT. Browser bundle,
// which also contains jose (MIT) and js-base64 (BSD-3-Clause).
copyFileSync(join(NM, "fhirclient/bundle/fhir-client.min.js"), join(VENDOR, "fhir-client.min.js"));
copyLicense("fhirclient", "fhirclient-LICENSE.txt");
copyLicense("jose", "jose-LICENSE.txt");
copyLicense("js-base64", "js-base64-LICENSE.txt");

// Fonts (all SIL Open Font License 1.1) from Fontsource. Latin subset only.
const fonts = [
  ["atkinson-hyperlegible", ["latin-400-normal", "latin-700-normal", "latin-400-italic"]],
  ["source-serif-4", ["latin-400-normal", "latin-600-normal"]],
  ["opendyslexic", ["latin-400-normal", "latin-700-normal"]],
];
for (const [fam, variants] of fonts) {
  for (const v of variants) {
    const file = `${fam}-${v}.woff2`;
    copyFileSync(join(NM, "@fontsource", fam, "files", file), join(FONTS, file));
  }
  copyLicense(`@fontsource/${fam}`, `font-${fam}-OFL.txt`);
}


// Mona Sans (SIL OFL 1.1, from Fontsource): the Primer typeface. Latin subset only.
for (const w of ["400", "500", "600", "700", "800"]) {
  const file = `mona-sans-latin-${w}-normal.woff2`;
  copyFileSync(join(NM, "@fontsource/mona-sans/files", file), join(FONTS, file));
}
copyLicense("@fontsource/mona-sans", "font-mona-sans-OFL.txt");

// Primer Primitives (MIT): GitHub's design tokens. The light theme's functional tokens,
// with the comments stripped. The app maps its own tokens to these in css/app.css.
mkdirSync(join(VENDOR, "primer"), { recursive: true });
const primerSrc = readFileSync(join(NM, "@primer/primitives/dist/css/functional/themes/light.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const lightBlock = primerSrc.slice(primerSrc.indexOf("{") + 1, primerSrc.indexOf("}"));
const KEEP = /^--(fgColor|bgColor|borderColor|shadow|focus|button-(primary|default|danger)|control-(bgColor|borderColor|checked)|underlineNav|overlay|counter)-/;
const decls = lightBlock.split(";").map((d) => d.trim()).filter((d) => KEEP.test(d));
writeFileSync(join(VENDOR, "primer/primer-light.css"),
  `/* @primer/primitives ${pkgVersion("@primer/primitives")} light theme, functional color tokens (MIT, see vendor/LICENSES/primer-primitives-LICENSE.txt).\n   Subset made by tools/vendor.mjs: only the token groups CureBranch uses, applied at :root. */\n` +
  `:root{\n${decls.map((d) => "  " + d + ";").join("\n")}\n}\n`);
copyLicense("@primer/primitives", "primer-primitives-LICENSE.txt");

// Octicons (MIT): GitHub's icons. Only the ones the app uses, as an ES module of SVG paths.
// The GitHub logo (mark-github) and the Octocat are trademarks, not part of the license, and are not used.
const ICONS = ["home", "download", "file", "git-branch", "gear", "people", "shield-lock", "key", "file-added", "heart", "code",
  "device-mobile", "law", "check-circle-fill", "alert-fill", "unmute", "play", "sync", "copy", "arrow-right", "arrow-left",
  "chevron-right", "info", "pulse", "lock", "globe", "book", "accessibility", "repo", "person", "history", "x", "trash",
  "upload", "link-external", "eye", "milestone", "check", "repo-forked", "search", "beaker", "graph", "three-bars", "chevron-down", "filter", "table", "organization", "note", "question", "light-bulb", "list-ordered", "comment-discussion", "sparkle", "chevron-left"];
const odata = JSON.parse(readFileSync(join(NM, "@primer/octicons/build/data.json"), "utf8"));
const paths = {};
for (const n of ICONS) {
  if (n === "mark-github") throw new Error("The GitHub logo is not allowed");
  const h = odata[n] && odata[n].heights;
  if (!h) throw new Error("No octicon " + n);
  paths[n] = { 16: h["16"] && h["16"].path, 24: h["24"] && h["24"].path };
}
writeFileSync("app/js/octicons.js",
  `// Octicons ${pkgVersion("@primer/octicons")} (MIT, see vendor/LICENSES/octicons-LICENSE.txt). Generated by tools/vendor.mjs.\n` +
  `export const PATHS = ${JSON.stringify(paths)};\n` +
  `/** Inline SVG markup for an icon. Decorative (aria-hidden) unless a label is given. */\n` +
  `export function icon(name, size = 16, cls = "oct") {\n  const p = PATHS[name]; if (!p) return "";\n  const s = size > 16 && p[24] ? 24 : 16;\n` +
  `  return \`<svg class="\${cls}" width="\${size}" height="\${size}" viewBox="0 0 \${s} \${s}" fill="currentColor" aria-hidden="true" focusable="false">\${p[s] || p[16]}</svg>\`;\n}\n`);
copyLicense("@primer/octicons", "octicons-LICENSE.txt");

const versions = {
  "idb-keyval": pkgVersion("idb-keyval"),
  canonicalize: pkgVersion("canonicalize"),
  fhirclient: pkgVersion("fhirclient"),
  "@primer/primitives": pkgVersion("@primer/primitives"),
  "@primer/octicons": pkgVersion("@primer/octicons"),
  "@fontsource/mona-sans": pkgVersion("@fontsource/mona-sans"),
};
writeFileSync(join(VENDOR, "VERSIONS.json"), JSON.stringify(versions, null, 2) + "\n");
console.log("Vendored:", versions);
