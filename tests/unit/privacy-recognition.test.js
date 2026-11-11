import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { LEVELS, privacyLevel, highestShared, changeWarning, setPrivacyLevel, statusWords, isPublicLevel } from "../../app/js/privacy.js";
import { buildSummary, newOwnerKeyPair } from "../../app/js/summary.js";
import { newRecord } from "../../app/js/record.js";
import { choicesSummary } from "../../app/js/onboarding.js";
import {
  BADGES, defaultRecognition, recognitionOf, noteFirstShare, earnedBadges, helpedWords, cardLines, cleanNote,
  publicRecognition, shouldGlow, branchTreeSvg, NOTE_MAX,
} from "../../app/js/recognition.js";
import { localStubSource, stubHelpedCount } from "../../app/js/recognition-source.js";

const J = (p) => JSON.parse(readFileSync(p, "utf8"));
const publicSchema = J("schema/public-summary.schema.json");
const localSchema = J("schema/local-record.schema.json");
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(publicSchema);
const validPublic = ajv.getSchema(publicSchema.$id);
const validLocal = ajv.compile(localSchema);
const bundle = J("schema/examples/example-fhir-bundle.json");
const examples = J("app/data/example-summaries.json").summaries;
const ON = new Date("2026-11-01T12:00:00Z");
const withRecords = () => {
  const r = newRecord();
  r.sources.push({ id: "s1", kind: "smart-health-card", importedAt: ON.toISOString(), verification: { status: "verified", method: "smart-health-card", issuer: "https://example.invalid" }, bundle });
  return r;
};
const pubKey = async () => crypto.subtle.exportKey("jwk", (await newOwnerKeyPair()).publicKey);

// ---------- 4 levels ----------
test("four levels, in order, and nothing is preselected", () => {
  assert.deepEqual(LEVELS.map((l) => l.id), ["private", "basic", "detailed", "full"]);
  assert.deepEqual(LEVELS.map((l) => l.n), [1, 2, 3, 4]);
  const r = newRecord();
  assert.equal(privacyLevel(r), null);
  assert.equal(r.privacy.public, false);
  assert.equal(localSchema.properties.privacy.properties.level.default, undefined, "schema must not preselect a level");
  assert.ok(validLocal(r), JSON.stringify(validLocal.errors));
  assert.equal(statusWords(r).title, "Sharing: not chosen yet");
  assert.equal(choicesSummary(r).find((x) => x.label === "Sharing").value, "Not chosen yet (nothing is shared)");
});

test("older records with public:true read as Basic", () => {
  assert.equal(privacyLevel({ privacy: { public: true } }), "basic");
  assert.equal(privacyLevel({ privacy: { public: false } }), null);
});

test("picking level 2-4 always warns first that shared data can't be pulled back", () => {
  for (const to of ["basic", "detailed", "full"]) {
    const w = changeWarning(newRecord(), to);
    assert.equal(w.needsConfirm, true);
    assert.equal(w.kind, "going-public");
    assert.ok(w.lines.join(" ").includes("can't be pulled back"), to);
    assert.match(w.yes, /^Yes, share at /);
  }
  // Picking Private from "not chosen" with nothing shared needs no warning.
  assert.equal(changeWarning(newRecord(), "private").needsConfirm, false);
});

test("moving down warns that what was already published stays out there", () => {
  const r = setPrivacyLevel(newRecord(), "full", ON);
  for (const to of ["detailed", "basic", "private"]) {
    const w = changeWarning(r, to);
    assert.equal(w.needsConfirm, true, to);
    assert.ok(["moving-down", "both"].includes(w.kind));
    const text = w.lines.join(" ");
    assert.ok(text.includes("stops sharing from now on"));
    assert.ok(text.includes("already shared at the Full public level stays out there"));
    assert.ok(text.includes("can't be pulled back"));
  }
  // Even after moving down, a later move stays warned about the highest level ever shared.
  setPrivacyLevel(r, "private", ON);
  assert.equal(highestShared(r), "full");
  assert.equal(r.privacy.public, false);
  assert.ok(changeWarning(r, "basic").lines.join(" ").includes("Full public level stays out there"));
  assert.ok(statusWords(r).help.includes("Earlier you shared at Full public; that stays public."));
  assert.ok(validLocal(r), JSON.stringify(validLocal.errors));
  assert.deepEqual(r.privacy.history.map((h) => h.level), ["full", "private"]);
});

test("moving down really stops future sharing", async () => {
  const pub = await pubKey();
  const r = setPrivacyLevel(withRecords(), "full", ON);
  assert.ok(buildSummary(r, pub, { on: ON }).location);
  setPrivacyLevel(r, "basic", ON);
  const s = buildSummary(r, pub, { on: ON });
  assert.equal(s.detailLevel, "basic");
  assert.equal(s.location, undefined);
  assert.equal(s.age, undefined);
  setPrivacyLevel(r, "private", ON);
  const p = buildSummary(r, pub, { on: ON });
  assert.equal(p.visibility, "private");
  assert.equal(p.markers, undefined);
});

test("each level adds exactly its details, and every summary is schema-valid", async () => {
  const pub = await pubKey();
  const at = {};
  for (const lvl of ["private", "basic", "detailed", "full"]) {
    const r = setPrivacyLevel(withRecords(), lvl, ON);
    at[lvl] = buildSummary(r, pub, { on: ON });
    assert.ok(validPublic(at[lvl]), lvl + " " + JSON.stringify(validPublic.errors));
  }
  assert.equal(at.private.visibility, "private");
  assert.equal(at.basic.ageBand, "60-69");
  assert.equal(at.basic.age, undefined);
  assert.equal(at.basic.diagnosisDate, undefined);
  assert.ok(at.basic.outcomes.every((o) => !o.date));
  assert.ok(at.basic.treatments.every((t) => !t.startDate));
  assert.equal(at.detailed.age, 65);
  assert.equal(at.detailed.stageDetail, "Stage IIIA");
  assert.equal(at.detailed.diagnosisDate, "2026-03-02");
  assert.ok(at.detailed.treatments.every((t) => t.startDate && !t.status));
  assert.ok(at.detailed.outcomes.every((o) => o.date));
  assert.equal(at.detailed.location, undefined);
  assert.deepEqual(at.full.location, { city: "Exampleville", state: "OH", country: "US" });
  assert.ok(at.full.treatments.every((t) => t.status));
  // Never shared at any level.
  for (const [lvl, s] of Object.entries(at)) {
    const t = JSON.stringify(s);
    for (const bad of ["EXAMPLE Street", "00000", "1961-05-14", "EXAMPLE-0000", "Patient\"", "EXAMPLE\""]) assert.ok(!t.includes(bad), `${lvl} leaked ${bad}`);
  }
});

test("example summaries (basic and full) validate", () => {
  for (const f of ["schema/examples/example-public-summary.json", "schema/examples/example-public-summary-full.json"]) {
    assert.ok(validPublic(J(f)), f + JSON.stringify(validPublic.errors));
  }
  assert.ok(validLocal(J("schema/examples/example-local-record.json")), JSON.stringify(validLocal.errors));
  assert.equal(J("schema/examples/example-public-summary-full.json").detailLevel, "full");
  for (const s of examples) assert.ok(validPublic(s), JSON.stringify(validPublic.errors));
});

// ---------- recognition ----------
test("recognition is all off by default and nothing goes public", async () => {
  assert.deepEqual(defaultRecognition(), { showOnProfile: { helped: false, branch: false, badges: false }, acceptNotes: false, shareCardIncludeCode: false });
  const r = setPrivacyLevel(withRecords(), "basic", ON);
  assert.equal(publicRecognition(r), undefined);
  assert.equal(buildSummary(r, await pubKey(), { on: ON }).recognition, undefined);
});

test("recognition shows only what was switched on, and only at a public level", async () => {
  const r = setPrivacyLevel(withRecords(), "basic", ON);
  noteFirstShare(r, ON);
  r.recognition = { ...recognitionOf(r), showOnProfile: { helped: true, branch: false, badges: true }, stats: { helpedCount: 12, foundingNumber: 7, example: true } };
  assert.deepEqual(publicRecognition(r), { helpedCount: 12, badges: ["first-share", "verified", "helped-10", "founding"], example: true });
  const s = buildSummary(r, await pubKey(), { on: ON });
  assert.ok(validPublic(s), JSON.stringify(validPublic.errors));
  assert.ok(validLocal(r), JSON.stringify(validLocal.errors));
  setPrivacyLevel(r, "private", ON);
  assert.equal(publicRecognition(r), undefined);
});

test("badges", () => {
  assert.deepEqual(BADGES.map((b) => b.name), ["First record shared", "Verified records", "Helped 10 people", "Founding branch"]);
  const r = withRecords();
  assert.deepEqual(earnedBadges(r, {}), ["verified"]);
  assert.equal(noteFirstShare(r, ON), false, "not shared until a public level");
  setPrivacyLevel(r, "detailed", ON);
  assert.equal(noteFirstShare(r, ON), true);
  assert.equal(noteFirstShare(r, ON), false, "only the first time");
  assert.deepEqual(earnedBadges(r, { helpedCount: 9, foundingNumber: 1001 }), ["first-share", "verified"]);
  assert.deepEqual(earnedBadges(r, { helpedCount: 10, foundingNumber: 1000 }), ["first-share", "verified", "helped-10", "founding"]);
});

test("counter words and share card text", () => {
  assert.equal(helpedWords(0), "Your branch hasn't helped match anyone yet.");
  assert.equal(helpedWords(1), "Your branch helped 1 other patient.");
  assert.equal(helpedWords(12), "Your branch helped 12 other patients.");
  const l = cardLines({ helpedCount: 12, code: "k7x2m9", includeCode: false });
  assert.deepEqual(l.slice(0, 2), ["I'm part of CureBranch.", "My data has helped 12 people."]);
  assert.ok(!l.join(" ").includes("k7x2m9"), "code only if the patient ticks the box");
  assert.ok(cardLines({ helpedCount: 1, code: "k7x2m9", includeCode: true }).includes("my.curebranch.ai/k7x2m9"));
});

test("thank-you notes stay anonymous and short", async () => {
  assert.equal(cleanNote("  Thank   you  ").text, "Thank you");
  assert.equal(cleanNote("").ok, false);
  assert.equal(cleanNote("x".repeat(NOTE_MAX + 1)).ok, false);
  for (const bad of ["see www.example.com", "mail me a@b.co", "call 555 123 4567", "find me @someone", "https://x.y"]) assert.equal(cleanNote(bad).ok, false, bad);
  const me = withRecords();
  const src = localStubSource({ summaries: examples, now: () => ON });
  assert.equal((await src.sendNote(me, "BAD!", "Thanks")).ok, false);
  const ok = await src.sendNote(me, "k7x2m9", "Thank you, this helped me.");
  assert.deepEqual(ok, { ok: true, status: "saved-on-device" });
  assert.equal(me.recognition.notesSent.length, 1);
  assert.ok(validLocal(me), JSON.stringify(validLocal.errors));
  // Inbox: empty unless the patient accepts notes AND is at a public level.
  const r = withRecords();
  assert.deepEqual(await src.inbox(r), []);
  r.recognition = { ...recognitionOf(r), acceptNotes: true };
  assert.deepEqual(await src.inbox(r), []);
  setPrivacyLevel(r, "basic", ON);
  const inbox = await src.inbox(r);
  assert.ok(inbox.length > 0 && inbox.every((n) => n.example && n.text.includes("EXAMPLE")));
});

test("stub counter and glow", async () => {
  const r = withRecords();
  assert.equal(stubHelpedCount(r, examples), 0, "private data helps no one");
  setPrivacyLevel(r, "basic", ON);
  assert.ok(stubHelpedCount(r, examples) > 0);
  const st = await localStubSource({ summaries: examples, now: () => ON }).stats(r);
  assert.equal(st.example, true);
  assert.ok(shouldGlow(st.nearby, ON));
  assert.equal(shouldGlow([{ at: "2026-10-01T00:00:00Z" }], ON), false);
  const svg = branchTreeSvg(examples, ["Lung", "KRAS", "G12C"], { glow: true });
  assert.ok(svg.includes('role="img"') && svg.includes("tr-glow") && svg.includes("glowing"));
  assert.ok(!branchTreeSvg(examples, ["Lung"], { glow: false }).includes("tr-glow"));
});

test("isPublicLevel", () => {
  assert.deepEqual(["private", "basic", "detailed", "full", null].map(isPublicLevel), [false, true, true, true, false]);
});
