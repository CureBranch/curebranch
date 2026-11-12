import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PAGES, STATIC_PAGES, SITE, allRoutes, resolvePath, legacyToPath, pageMeta, subPages, cancerPath } from "../../app/js/routes.js";

const data = JSON.parse(readFileSync(new URL("../../app/data/public-cancer-data.json", import.meta.url), "utf8"));
const routes = allRoutes(data);

test("routes: every page has one unique, clean address ending in a slash (no # routes)", () => {
  const paths = [...routes.map((r) => r.path), ...STATIC_PAGES.map((p) => p.path)];
  assert.equal(new Set(paths).size, paths.length);
  for (const p of paths) assert.match(p, /^\/([a-z0-9-]+\/)*$/, p);
  for (const want of ["/", "/cancers/", "/cancers/breast/", "/cancers/breast/her2-positive/", "/how-it-works/", "/how-it-started/", "/privacy/", "/sources/", "/my-branch/", "/help/"])
    assert.ok(paths.includes(want), want);
  assert.ok(routes.length > 100, String(routes.length));
});

test("routes: every page has a title and a plain description", () => {
  const titles = new Set();
  for (const r of routes) {
    assert.ok(r.title && r.desc.length > 40 && r.desc.length < 300, r.path);
    assert.ok(!titles.has(r.title), `duplicate title ${r.title}`); titles.add(r.title);
  }
  assert.equal(pageMeta({ cancer: data.cancers.find((c) => c.id === "breast"), sub: { kind: "biomarker", label: "HER2-positive", slug: "her2-positive" } }).title, "HER2-positive breast cancer");
  assert.equal(SITE, "https://curebranch.ai");
});

test("resolvePath: finds every address, with or without the last slash, and rejects unknown ones", () => {
  for (const r of routes) {
    const got = resolvePath(r.path, data);
    assert.ok(got, r.path);
    assert.equal(pageMeta(got).path, r.path);
    if (r.path !== "/") assert.ok(resolvePath(r.path.slice(0, -1), data), r.path);
  }
  assert.equal(resolvePath("/index.html", data).page.name, "home");
  for (const bad of ["/nope/", "/cancers/nope/", "/cancers/breast/nope/", "/cancers/breast/her2-positive/x/", "/p/abc/"]) assert.equal(resolvePath(bad, data), null, bad);
});

test("legacyToPath: old # links go to the new addresses", () => {
  const cases = { "": "/", "#": "/", "#/repo": "/my-branch/", "#repo": "/my-branch/", "start": "/how-it-works/", "#a11y": "/accessibility/", "#tree": "/tree/",
    "#explore": "/tree/", "#cancer/lung": "/cancers/lung/", "#/cancer/lung/g-lung-EGFR": "/cancers/lung/#g-lung-EGFR", "#cancers": "/cancers/",
    "#settings": "/settings/", "#home": "/", "#import": "/import/" };
  for (const [from, to] of Object.entries(cases)) assert.equal(legacyToPath(from), to, from);
  assert.equal(legacyToPath("#some-heading"), null);
});

test("subPages: no duplicate of the main page, every biomarker with an FDA drug has a page", () => {
  for (const c of data.cancers) {
    const subs = subPages(c);
    assert.equal(new Set(subs.map((s) => s.slug)).size, subs.length);
    for (const s of subs) assert.notEqual(cancerPath(c, s), cancerPath(c));
    for (const t of c.therapies || []) assert.ok(subs.some((s) => s.kind === "biomarker" && s.biomarker === t.biomarker), `${c.id} ${t.biomarker}`);
  }
  assert.ok(PAGES.every((p) => p.path.endsWith("/")));
});
