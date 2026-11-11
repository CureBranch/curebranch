import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  STEPS, STEP_IDS, needsOnboarding, resumeIndex, setStep, completeStep, recordConsent, hasConsent,
  chooseAfterDeath, finishOnboarding, restartOnboarding, choicesSummary, AFTER_WORDS,
  attachmentMeta, canAttach, isOfficial, removeSource, PORTALS,
} from "../../app/js/onboarding.js";
import { stubPortalSource } from "../../app/js/portal-stub.js";
import { checkClaims, checkAttachment, cleanClaims, attachmentsForAi, matchWords } from "../../app/js/consistency.js";
import { extractFacts } from "../../app/js/fhir.js";
import { buildSummary, newOwnerKeyPair } from "../../app/js/summary.js";
import { randomCode } from "../../app/js/codes.js";

const J = (p) => JSON.parse(readFileSync(p, "utf8"));
const publicSchema = J("schema/public-summary.schema.json");
const localSchema = J("schema/local-record.schema.json");
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(publicSchema);
const validPublic = ajv.getSchema(publicSchema.$id);
const validLocal = ajv.compile(localSchema);

// Same shape as store.js newRecord() (store.js imports IndexedDB, so it isn't loaded in Node).
function freshRecord() {
  const now = new Date().toISOString();
  return { schemaVersion: "0.1", code: randomCode(6), created: now, updated: now, privacy: { public: false },
    afterDeath: { choice: "keep-public" }, sources: [], share: {}, editLog: [{ at: now, what: "Created on this device" }] };
}

test("setup guide has the 7 steps in order", () => {
  assert.deepEqual(STEP_IDS, ["welcome", "profile", "records", "privacy", "after", "ai", "done"]);
  assert.equal(STEPS.length, 7);
  // the schema lists exactly the same step ids
  assert.deepEqual(localSchema.properties.onboarding.properties.step.enum, STEP_IDS);
});

test("a new record needs the guide; progress is saved and resumes at the same step", () => {
  const r = freshRecord();
  assert.equal(needsOnboarding(r), true);
  assert.equal(resumeIndex(r), 0);
  recordConsent(r, { videoVersion: "placeholder" });
  completeStep(r, "welcome");
  completeStep(r, "profile");
  completeStep(r, "records", { skipped: true });
  assert.equal(r.onboarding.step, "privacy");
  assert.equal(resumeIndex(r), 3);
  assert.deepEqual(r.onboarding.skipped, ["records"]);
  // simulate closing the app: a JSON round trip (what IndexedDB stores) keeps the place
  const back = JSON.parse(JSON.stringify(r));
  assert.equal(resumeIndex(back), 3);
  assert.ok(validLocal(back), JSON.stringify(validLocal.errors));
  // an unknown step (older/newer version) falls back to step 1 instead of breaking
  assert.equal(resumeIndex({ onboarding: { step: "nope" } }), 0);
  assert.throws(() => setStep(r, "nope"));
});

test("consent: tied to the video version, so a new video asks again", () => {
  const r = freshRecord();
  assert.equal(hasConsent(r), false);
  recordConsent(r, { videoVersion: "placeholder", on: new Date("2026-11-11T10:00:00Z") });
  assert.equal(hasConsent(r, "placeholder"), true);
  assert.equal(hasConsent(r, "v2"), false);
  assert.equal(r.onboarding.consent.at, "2026-11-11T10:00:00.000Z");
});

test("after-death: only the patient's own pick counts as chosen; all 4 choices are valid in both schemas", async () => {
  const r = freshRecord();
  assert.equal(choicesSummary(r).find((x) => x.label === "After you're gone").value, "Not chosen yet");
  const kp = await newOwnerKeyPair();
  const pub = await crypto.subtle.exportKey("jwk", kp.publicKey);
  for (const c of Object.keys(AFTER_WORDS)) {
    chooseAfterDeath(r, c);
    assert.equal(r.afterDeath.choice, c);
    assert.ok(validLocal(r), c + JSON.stringify(validLocal.errors));
    for (const pubOn of [false, true]) {
      const s = buildSummary({ ...r, privacy: { public: pubOn } }, pub);
      assert.ok(validPublic(s), c + JSON.stringify(validPublic.errors));
      assert.equal(s.afterDeath.choice, c);
    }
  }
  assert.equal(r.onboarding.afterDeathChosen, true);
  assert.throws(() => chooseAfterDeath(r, "sell-it"));
});

test("trusted person's name is saved locally but never in the public summary", async () => {
  const r = freshRecord();
  chooseAfterDeath(r, "person-decides");
  r.afterDeath.person = { name: "EXAMPLE Trusted Person", howToReach: "555-0100" };
  const kp = await newOwnerKeyPair();
  const pub = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const text = JSON.stringify(buildSummary({ ...r, privacy: { public: true } }, pub));
  assert.ok(!text.includes("EXAMPLE Trusted Person") && !text.includes("555-0100"));
  assert.equal(choicesSummary(r).find((x) => x.label === "Your trusted person").value, "EXAMPLE Trusted Person");
});

const bundle = J("schema/examples/example-fhir-bundle.json");
const official = (id = "src-1") => stubPortalSource(bundle, "mychart", { id, on: new Date("2026-11-11T10:00:00Z") });

test("portal stub: same shape as a real SMART on FHIR import, verified, flagged EXAMPLE, origin recorded", () => {
  const src = official();
  assert.equal(src.kind, "smart-on-fhir");
  assert.equal(src.verification.status, "verified");
  assert.equal(src.verification.method, "smart-on-fhir");
  assert.equal(src.example, true);
  assert.deepEqual(src.origin, { connectedVia: "demo-stub", portal: "mychart", portalName: "MyChart (Epic)" });
  assert.ok(isOfficial(src));
  const r = freshRecord(); r.sources.push(src);
  assert.ok(validLocal(r), JSON.stringify(validLocal.errors));
  assert.equal(extractFacts([src.bundle]).cancerType.label, "Lung");
  assert.throws(() => stubPortalSource({ resourceType: "Patient" }, "mychart"));
  for (const p of PORTALS) assert.ok(validLocal({ ...freshRecord(), sources: [stubPortalSource(bundle, p.id)] }), p.id);
});

test("only official records count as official; plain files are not", () => {
  assert.equal(isOfficial({ verification: { status: "unverified", method: "file-upload" } }), false);
  assert.equal(isOfficial({ verification: { status: "verified", method: "smart-health-card" } }), true);
  assert.equal(isOfficial({ verification: { status: "verified", method: "self-reported" } }), false);
});

test("photos/files: only as supporting attachments linked to an official record", async () => {
  const r = freshRecord();
  // nothing official yet -> no standalone photos
  assert.throws(() => attachmentMeta(r, { id: "f0", sourceId: "nope", name: "x.jpg", mediaType: "image/jpeg", size: 1 }), /hospital/);
  r.sources.push({ id: "plain", kind: "fhir-bundle-file", importedAt: new Date().toISOString(), verification: { status: "unverified", method: "file-upload" }, bundle });
  assert.equal(canAttach(r, "plain"), false, "unverified file can't take attachments");
  r.sources.push(official());
  const f = attachmentMeta(r, { id: "f1", sourceId: "src-1", name: "IMG_0001.jpg", mediaType: "image/jpeg", size: 1234.7 });
  assert.equal(f.role, "supporting-from-patient");
  assert.equal(f.linkedSourceId, "src-1");
  assert.equal(f.kind, "photo");
  assert.equal(f.size, 1234);
  assert.equal(f.matchStatus, "unchecked");
  r.files = [f, attachmentMeta(r, { id: "f2", sourceId: "src-1", name: "", mediaType: "application/pdf", size: -5 })];
  assert.equal(r.files[1].kind, "document");
  assert.ok(validLocal(r), JSON.stringify(validLocal.errors));
  // schema: a file without a linked official record is rejected
  const { linkedSourceId, ...loose } = f;
  assert.equal(validLocal({ ...r, files: [loose] }), false);
  assert.equal(validLocal({ ...r, files: [{ ...f, role: "standalone" }] }), false);
  // never in the public summary
  const kp = await newOwnerKeyPair();
  const pub = await crypto.subtle.exportKey("jwk", kp.publicKey);
  assert.ok(!JSON.stringify(buildSummary({ ...r, privacy: { public: true } }, pub)).includes("IMG_0001"));
  assert.equal(choicesSummary(r).find((x) => x.label === "Records on this device").value, "4 items");
  // removing the official record removes its supporting files too
  assert.deepEqual(removeSource(r, "src-1").sort(), ["f1", "f2"]);
  assert.equal(r.files, undefined);
  assert.ok(validLocal(r), JSON.stringify(validLocal.errors));
});

test("consistency: matching date, test type and key values -> matches", () => {
  for (const c of [
    { testType: "PD-L1", date: "2026-03-20", keyValues: ["70%"] },
    { testType: "Tumor DNA variant", date: "2026-04-01", keyValues: ["KRAS G12C", "TP53"] },
    { testType: "tumor dna", keyValues: ["kras p.Gly12Cys"] },
    { date: "2026-04-02" },                    // one day off is allowed (time zones)
    { keyValues: ["70 %"] },
  ]) {
    const res = checkClaims(cleanClaims(c), bundle);
    assert.equal(res.matchStatus, "matches", JSON.stringify(c) + " " + JSON.stringify(res));
    assert.equal(res.ignoreForAiMatching, false);
  }
});

test("consistency: wrong date, test or value -> mismatch with plain-English reasons, ignored by AI", () => {
  const cases = [
    [{ testType: "PD-L1", date: "2026-05-01" }, /date 2026-05-01 doesn't match .*record says 2026-03-20/],
    [{ testType: "PD-L1", keyValues: ["10%"] }, /"10%" isn't in your hospital record for that test/],
    [{ keyValues: ["EGFR L858R"] }, /"EGFR L858R" isn't in your hospital record/],
    [{ testType: "Brain MRI" }, /couldn't find a test called "Brain MRI"/],
    [{ testType: "Tumor DNA variant", keyValues: ["KRAS G12D"] }, /G12D/],
  ];
  for (const [c, re] of cases) {
    const res = checkClaims(cleanClaims(c), bundle);
    assert.equal(res.matchStatus, "mismatch", JSON.stringify(c));
    assert.equal(res.ignoreForAiMatching, true);
    assert.match(res.mismatchReasons.join(" "), re);
    for (const reason of res.mismatchReasons) assert.ok(reason.length < 200 && !/[{}<>]/.test(reason), reason);
  }
});

test("consistency: nothing entered -> unchecked; input is cleaned", () => {
  assert.equal(checkClaims(undefined, bundle).matchStatus, "unchecked");
  assert.equal(cleanClaims({ date: "", testType: "  ", keyValues: " , " }), undefined);
  assert.equal(cleanClaims({ date: "03/20/2026" }), undefined, "only YYYY-MM-DD dates (what <input type=date> gives)");
  assert.deepEqual(cleanClaims({ keyValues: "KRAS G12C, PD-L1 70%;TMB 14" }).keyValues, ["KRAS G12C", "PD-L1 70%", "TMB 14"]);
});

test("consistency: stored on the attachment, valid schema, mismatches excluded from AI matching", () => {
  const r = freshRecord();
  r.sources.push(official());
  r.files = [attachmentMeta(r, { id: "good", sourceId: "src-1", name: "pdl1.jpg", mediaType: "image/jpeg", size: 10 }),
    attachmentMeta(r, { id: "bad", sourceId: "src-1", name: "other.jpg", mediaType: "image/jpeg", size: 10 }),
    attachmentMeta(r, { id: "none", sourceId: "src-1", name: "blank.jpg", mediaType: "image/jpeg", size: 10 })];
  const g = checkAttachment(r, "good", { date: "2026-03-20", testType: "PD-L1", keyValues: "70%" }, { on: new Date("2026-11-11T10:00:00Z") });
  const b = checkAttachment(r, "bad", { date: "2026-01-01", testType: "PD-L1", keyValues: "5%" });
  checkAttachment(r, "none", {});
  assert.equal(g.matchStatus, "matches");
  assert.equal(g.checkedAt, "2026-11-11T10:00:00.000Z");
  assert.equal(b.matchStatus, "mismatch");
  assert.equal(b.ignoreForAiMatching, true);
  assert.equal(b.mismatchReasons.length, 2);
  assert.equal(r.files[2].matchStatus, "unchecked");
  assert.match(matchWords(b), /doesn't match your hospital record.*AI matching will ignore it/);
  assert.equal(matchWords(g), "Matches your hospital record.");
  assert.ok(validLocal(r), JSON.stringify(validLocal.errors));
  assert.deepEqual(attachmentsForAi(r).map((f) => f.id), ["good", "none"]);
  // fixing the claim clears the flag
  checkAttachment(r, "bad", { date: "2026-03-20", testType: "PD-L1", keyValues: "70%" });
  assert.equal(r.files[1].matchStatus, "matches");
  assert.equal(r.files[1].mismatchReasons, undefined);
  assert.deepEqual(attachmentsForAi(r).map((f) => f.id), ["good", "bad", "none"]);
  assert.equal(validLocal({ ...r, files: [{ ...r.files[0], matchStatus: "maybe" }] }), false);
  assert.throws(() => checkAttachment(r, "gone", {}));
});

test("finish, then re-run from Settings keeps every answer", () => {
  const r = freshRecord();
  recordConsent(r);
  for (const id of STEP_IDS.slice(0, -1)) completeStep(r, id);
  chooseAfterDeath(r, "keep-private");
  r.ai = { name: "Grok" };
  finishOnboarding(r, new Date("2026-11-11T11:00:00Z"));
  assert.equal(needsOnboarding(r), false);
  assert.ok(validLocal(r), JSON.stringify(validLocal.errors));
  restartOnboarding(r);
  assert.equal(needsOnboarding(r), true);
  assert.equal(resumeIndex(r), 0);
  assert.equal(r.afterDeath.choice, "keep-private");
  assert.equal(r.ai.name, "Grok");
  assert.equal(hasConsent(r), true);
  assert.ok(validLocal(r), JSON.stringify(validLocal.errors));
  const sum = Object.fromEntries(choicesSummary(r).map((x) => [x.label, x.value]));
  assert.equal(sum["Sharing"], "Private (nothing is shared)");
  assert.equal(sum["After you're gone"], "Keep it private");
  assert.equal(sum["Your AI"], "Grok");
});

test("schema rejects made-up onboarding fields and AI keys in the record", () => {
  const r = freshRecord();
  r.onboarding = { version: 1, step: "welcome", apiKey: "sk-123" };
  assert.equal(validLocal(r), false);
  const r2 = freshRecord();
  r2.ai = { name: "Grok", apiKey: "xai-123" };
  assert.equal(validLocal(r2), false, "the record format has no place for AI keys");
});
