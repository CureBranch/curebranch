import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AI_CHOICES } from "../../app/js/onboarding.js";
import { cancerTypeOf } from "../../app/js/fhir.js";

const data = JSON.parse(readFileSync(new URL("../../app/data/public-cancer-data.json", import.meta.url), "utf8"));

test("published data: every figure names its source, URL and retrieval date", () => {
  for (const c of data.cancers) {
    for (const f of Object.values((c.seer && c.seer.figures) || {})) {
      assert.ok(f.source === "seer" && /^https:\/\/seer\.cancer\.gov\//.test(f.url) && /^\d{4}-\d{2}-\d{2}$/.test(f.retrieved), c.id);
    }
    for (const g of c.genomics) {
      assert.ok(g.source === "cbioportal" && g.studyId.includes("tcga_pan_can_atlas") && g.retrieved, c.id);
      for (const x of g.genes) assert.ok(x.altered <= x.profiled && Math.abs(x.pct - (100 * x.altered) / x.profiled) < 0.06, `${c.id} ${x.gene}`);
    }
    for (const t of c.therapies) for (const d of t.drugs) assert.ok(d.source === "openfda" && d.setId && d.labelDate && d.excerpt, `${c.id} ${d.brand}`);
    if (c.trials) assert.ok(c.trials.source === "ctgov" && Number.isInteger(c.trials.value) && c.trials.url.startsWith("https://clinicaltrials.gov/"));
  }
});

test("published data: four sources, each with a licence; patient branches start at zero", () => {
  assert.deepEqual(Object.keys(data.sources).sort(), ["cbioportal", "ctgov", "openfda", "seer"]);
  for (const s of Object.values(data.sources)) assert.ok(s.license && s.licenseUrl.startsWith("https://"));
  assert.ok(data.cancers.length >= 30);
  for (const c of data.cancers) assert.equal(c.patientBranches.shared, 0);
  assert.ok(!JSON.stringify(data).includes("EXAMPLE"));
});

test("every cancer tree has a group, and tree labels are unique", () => {
  const groups = new Set(data.groups.map((g) => g.id));
  for (const c of data.cancers) assert.ok(groups.has(c.group), c.id);
  assert.equal(new Set(data.cancers.map((c) => c.treeLabel)).size, data.cancers.length);
});

test("cancer types read from records match a cancer tree", () => {
  const labels = new Set(data.cancers.map((c) => c.treeLabel));
  for (const code of ["C34.1", "C50.9", "C18.7", "C92.0", "C91.1", "C73", "C53.9", "C81.9", "C90.0", "C71.9"]) {
    const t = cancerTypeOf({ code: { coding: [{ system: "http://hl7.org/fhir/sid/icd-10-cm", code }] } });
    assert.ok(t && labels.has(t.label), `${code} -> ${t && t.label}`);
  }
});

test("AI choices include the common assistants, Grok among them", () => {
  for (const n of ["ChatGPT", "Claude", "Gemini", "Grok", "Copilot", "Another AI", "I don't use an AI"]) assert.ok(AI_CHOICES.includes(n), n);
});
