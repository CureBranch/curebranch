import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildTree } from "../../app/js/tree.js";
import { livingTreeSvg, mulberry32, pathKey, parsePathKey } from "../../app/js/living-tree.js";

const examples = JSON.parse(readFileSync("app/data/example-summaries.json", "utf8")).summaries;
const draw = (o) => livingTreeSvg(buildTree(examples), { interactive: true, label: "The tree", ...o });

test("seeded random numbers repeat", () => {
  const a = mulberry32(42), b = mulberry32(42);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
});

test("the same data always draws the same tree", () => {
  assert.equal(draw({ mine: ["Lung", "KRAS", "G12C"] }), draw({ mine: ["Lung", "KRAS", "G12C"] }));
});

test("every patient branch and every cancer type is a labelled, focusable button", () => {
  const svg = draw({});
  const tips = new Set(examples.map((s) => s.branch.path.join("/")));
  for (const t of tips) {
    const key = pathKey(t.split("/"));
    const m = svg.match(new RegExp(`<g class="lt-hit lt-tip[^"]*" role="button" tabindex="0" aria-pressed="false" aria-label="([^"]+)" data-lt-path="${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    assert.ok(m, `tip ${t} is a button`);
    assert.match(m[1], /shown, \d+ counted/);
  }
  for (const top of new Set(examples.map((s) => s.branch.path[0]))) assert.ok(svg.includes(`data-lt-path="${pathKey([top])}"`), `limb ${top}`);
  assert.ok(svg.includes('role="group"') && !svg.includes("NaN") && !svg.includes("undefined"));
});

test("your branch is outlined in gold with a flower; picked branch is pressed", () => {
  const svg = draw({ mine: ["Lung", "KRAS", "G12C"], selected: ["Melanoma", "BRAF", "V600E"] });
  assert.ok(svg.includes("lt-mine-glow") && svg.includes("lt-blossom") && svg.includes("This is your branch."));
  assert.match(svg, /aria-pressed="true" aria-label="Melanoma, then BRAF, then V600E/);
  assert.ok(!draw({}).includes("lt-blossom"));
});

test("a branch that is not on the tree yet still gets drawn", () => {
  const svg = draw({ mine: ["Kidney", "VHL"] });
  assert.ok(svg.includes(`data-lt-path="${pathKey(["Kidney", "VHL"])}"`) && svg.includes("lt-blossom"));
});

test("picture-only mode has no buttons", () => {
  const svg = livingTreeSvg(buildTree(examples), { mine: ["Lung"], label: "x" });
  assert.ok(svg.includes('role="img"') && !svg.includes('role="button"') && !svg.includes("tabindex"));
});

test("path keys round-trip", () => {
  const p = ["Lung", "EGFR", "Exon 19 deletion/ins"];
  assert.deepEqual(parsePathKey(pathKey(p)), p);
});
