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
  ["inter", ["latin-400-normal", "latin-600-normal", "latin-700-normal"]],
  ["fraunces", ["latin-600-normal"]],
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

const versions = {
  "idb-keyval": pkgVersion("idb-keyval"),
  canonicalize: pkgVersion("canonicalize"),
  fhirclient: pkgVersion("fhirclient"),
};
writeFileSync(join(VENDOR, "VERSIONS.json"), JSON.stringify(versions, null, 2) + "\n");
console.log("Vendored:", versions);
