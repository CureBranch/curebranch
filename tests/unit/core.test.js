import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { extractFacts, suggestBranch, shortProteinChange, ageBand } from "../../app/js/fhir.js";
import { extractJwsList, verifyHealthCard } from "../../app/js/shc.js";
import { buildSummary, signSummary, verifySummarySignature, newOwnerKeyPair } from "../../app/js/summary.js";
import { buildTree, collect, treatmentStats, countable } from "../../app/js/tree.js";
import { randomCode, stewardKeyHash, newStewardKey } from "../../app/js/codes.js";

const J = (p) => JSON.parse(readFileSync(p, "utf8"));
const publicSchema = J("schema/public-summary.schema.json");
const localSchema = J("schema/local-record.schema.json");
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(publicSchema);
const validPublic = ajv.getSchema(publicSchema.$id);
const validLocal = ajv.compile(localSchema);
const bundle = J("schema/examples/example-fhir-bundle.json");
const trust = J("app/data/trusted-issuers.json").issuers;

test("example public summary and local record match their schemas", () => {
  assert.ok(validPublic(J("schema/examples/example-public-summary.json")), JSON.stringify(validPublic.errors));
  assert.ok(validLocal(J("schema/examples/example-local-record.json")), JSON.stringify(validLocal.errors));
});

test("every example tree summary matches the schema and is marked EXAMPLE", async () => {
  const { summaries } = J("app/data/example-summaries.json");
  assert.ok(summaries.length >= 30);
  for (const s of summaries) {
    assert.ok(validPublic(s), JSON.stringify(validPublic.errors));
    assert.equal(s.example, true);
    assert.equal(await verifySummarySignature(s), true, "signature " + s.code);
  }
});

test("FHIR extraction pulls coarse facts only", () => {
  const f = extractFacts(bundle, { on: new Date("2026-11-01") });
  assert.equal(f.cancerType.label, "Lung");
  assert.equal(f.stageGroup, "III");
  assert.equal(f.ageBand, "60-69");
  const genes = f.markers.map((m) => `${m.gene}:${m.change}`);
  for (const g of ["KRAS:G12C", "TP53:R273H", "CD274:high", "PD-L1:high", "TMB:high"]) assert.ok(genes.includes(g), g + " in " + genes);
  assert.equal(f.markers.find((m) => m.gene === "CD274").kind, "rna-expression");
  assert.deepEqual(f.treatments.map((t) => t.name), ["carboplatin", "pembrolizumab", "sotorasib"]);
  assert.deepEqual(f.outcomes.map((o) => o.status), ["improving", "stable"]);
  assert.equal(f.outcomes[1].afterTreatment, 2);
  assert.deepEqual(suggestBranch(f), ["Lung", "KRAS", "G12C"]);
});

test("helpers", () => {
  assert.equal(shortProteinChange("p.(Gly12Cys)"), "G12C");
  assert.equal(ageBand("1930-01-01", new Date("2026-01-02")), "90+");
  assert.match(randomCode(6), /^[0-9a-hjkmnp-tv-z]{6}$/);
  assert.match(newStewardKey(), /^([0-9a-hjkmnp-tv-z]{4}-){4}[0-9a-hjkmnp-tv-z]{4}$/);
});

test("SMART Health Card: example card verifies against the trust list", async () => {
  const [jws] = extractJwsList(readFileSync("app/data/examples/example-health-card.smart-health-card", "utf8"));
  const r = await verifyHealthCard(jws, { trustList: trust });
  assert.equal(r.verification.status, "verified");
  assert.equal(r.example, true);
  assert.equal(r.bundle.resourceType, "Bundle");
});

test("SMART Health Card: unknown issuer or tampered card is NOT verified", async () => {
  const [jws] = extractJwsList(readFileSync("app/data/examples/example-health-card.smart-health-card", "utf8"));
  assert.equal((await verifyHealthCard(jws, { trustList: [] })).verification.status, "unverified");
  const parts = jws.split(".");
  const sig = parts[2];
  const flipped = (sig[5] === "A" ? "B" : "A");
  const tampered = [parts[0], parts[1], sig.slice(0, 5) + flipped + sig.slice(6)].join(".");
  assert.equal((await verifyHealthCard(tampered, { trustList: trust })).verification.status, "unverified");
});

test("public summary: minimal, no identifying details, signed, respects share switches", async () => {
  const record = J("schema/examples/example-local-record.json");
  const kp = await newOwnerKeyPair();
  const pub = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const s = await signSummary(buildSummary(record, pub), kp.privateKey);
  assert.ok(validPublic(s), JSON.stringify(validPublic.errors));
  assert.equal(await verifySummarySignature(s), true);
  const text = JSON.stringify(s);
  for (const secret of ["EXAMPLE Person", "1961", "EXAMPLE-0000", "example@example.invalid", "Patient\"", "family"]) {
    assert.ok(!text.includes(secret), "leaked " + secret);
  }
  // change after signing -> signature fails
  assert.equal(await verifySummarySignature({ ...s, stageGroup: "I" }), false);
  // patient turns markers off
  const s2 = buildSummary({ ...record, share: { ...record.share, markers: false, profile: true }, profile: { displayName: "Sam" } }, pub);
  assert.equal(s2.markers, undefined);
  assert.equal(s2.profile.displayName, "Sam");
  // default: profile off -> anonymous
  assert.equal(buildSummary({ ...record, profile: { displayName: "Sam" } }, pub).profile, undefined);
  // private switch -> nothing medical at all
  const p = buildSummary({ ...record, privacy: { public: false } }, pub);
  assert.equal(p.visibility, "private");
  assert.equal(p.markers, undefined);
  assert.equal(p.treatments, undefined);
  assert.deepEqual(p.branch.path, ["Not shared"]);
  assert.ok(validPublic(p), JSON.stringify(validPublic.errors));
});

test("tree counting: verified only, one person one vote, private hidden", () => {
  const base = (code, extra) => ({ schemaVersion: "0.1", code, example: true, visibility: "public", afterDeath: { choice: "keep-public" },
    branch: { path: ["Lung", "KRAS"] }, owner: { publicKeyJwk: {} }, updated: "2026-01-01",
    verification: { status: "verified", method: "smart-health-card" }, treatments: [{ name: "x" }], outcomes: [{ status: "stable", afterTreatment: 0 }], ...extra });
  const list = [
    base("aaaaaa"), base("bbbbbb", { verification: { status: "unverified", method: "file-upload" } }),
    base("cccccc", { personKey: "p1", updated: "2026-01-01" }), base("dddddd", { personKey: "p1", updated: "2026-02-01" }),
    base("eeeeee", { visibility: "private" }),
  ];
  const c = countable(list);
  assert.deepEqual([...c].map((s) => s.code).sort(), ["aaaaaa", "dddddd"]);
  const root = buildTree(list);
  assert.equal(root.shown, 4);
  assert.equal(root.counted, 2);
  const st = treatmentStats(collect(root));
  assert.equal(st[0].people, 2);
  assert.equal(st[0].status.stable, 2);
});

test("steward key hash is stable and normalised", async () => {
  assert.equal(await stewardKeyHash(" ABCD-efgh "), await stewardKeyHash("abcd-efgh"));
});
