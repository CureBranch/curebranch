// Generates ALL example files. Everything it writes is made-up EXAMPLE data.
//   node tools/make-examples.mjs
// Outputs:
//   schema/examples/example-fhir-bundle.json          (FHIR R4 Bundle, mCODE-style codes)
//   schema/examples/example-local-record.json         (private local record)
//   schema/examples/example-public-summary.json       (signed public summary)
//   app/data/examples/example-fhir-bundle.json        (copy, for the in-app "try it" button)
//   app/data/examples/example-health-card.smart-health-card (signed with an EXAMPLE issuer key)
//   app/data/trusted-issuers.json                     (trust list: only the EXAMPLE issuer for now)
//   app/data/example-summaries.json                   (the example public tree)
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { b64url } from "../app/js/codes.js";
import { buildSummary, signSummary, newOwnerKeyPair } from "../app/js/summary.js";

mkdirSync("schema/examples", { recursive: true });
mkdirSync("app/data/examples", { recursive: true });
const write = (p, obj) => writeFileSync(p, (typeof obj === "string" ? obj : JSON.stringify(obj, null, 2)) + "\n");
const L = "http://loinc.org", SCT = "http://snomed.info/sct", HGNC = "http://www.genenames.org";
const EX_TAG = { meta: { tag: [{ system: "urn:curebranch:tag", code: "EXAMPLE", display: "Made-up example data" }] } };

// ---------- 1. Example FHIR bundle ----------
const pid = "example-patient";
const ref = { reference: `Patient/${pid}` };
let n = 0;
const entry = (resource) => ({ fullUrl: `resource:${n++}`, resource: { ...EX_TAG, ...resource } });
const variant = (id, gene, pHgvs, date, method = "DNA") => entry({
  resourceType: "Observation", id, status: "final",
  category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory" }] }],
  code: { coding: [{ system: L, code: "69548-6", display: "Genetic variant assessment" }], text: `Tumor ${method} variant` },
  subject: ref, effectiveDateTime: date,
  valueCodeableConcept: { coding: [{ system: L, code: "LA9633-4", display: "Present" }] },
  component: [
    { code: { coding: [{ system: L, code: "48018-6", display: "Gene studied [ID]" }] }, valueCodeableConcept: { coding: [{ system: HGNC, display: gene }], text: gene } },
    ...(pHgvs ? [{ code: { coding: [{ system: L, code: "48005-3", display: "Amino acid change (pHGVS)" }] }, valueCodeableConcept: { text: pHgvs } }] : []),
  ],
});
const med = (id, name, start) => entry({ resourceType: "MedicationStatement", id, status: "active",
  medicationCodeableConcept: { text: name }, subject: ref, effectivePeriod: { start } });
const status = (id, date, code, display) => entry({ resourceType: "Observation", id, status: "final",
  code: { coding: [{ system: L, code: "97509-4", display: "Cancer disease progression" }], text: "Cancer disease status" },
  subject: ref, effectiveDateTime: date, valueCodeableConcept: { coding: [{ system: SCT, code, display }] } });

const bundle = {
  resourceType: "Bundle", id: "example-bundle", type: "collection", ...EX_TAG,
  entry: [
    entry({ resourceType: "Patient", id: pid, name: [{ family: "EXAMPLE", given: ["Patient"] }], birthDate: "1961-05-14",
      address: [{ line: ["1 EXAMPLE Street"], city: "Exampleville", state: "OH", postalCode: "00000", country: "US" }],
      identifier: [{ system: "urn:example:mrn", value: "EXAMPLE-0000" }] }),
    entry({ resourceType: "Condition", id: "example-primary-cancer", subject: ref,
      clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }] },
      code: { coding: [
        { system: "http://hl7.org/fhir/sid/icd-10-cm", code: "C34.90", display: "Malignant neoplasm of unspecified part of unspecified bronchus or lung" },
        { system: SCT, code: "254637007", display: "Non-small cell lung cancer" }], text: "Non-small cell lung cancer (EXAMPLE)" },
      onsetDateTime: "2026-03-02" }),
    entry({ resourceType: "Observation", id: "example-stage", status: "final", subject: ref, effectiveDateTime: "2026-03-10",
      code: { coding: [{ system: L, code: "21908-9", display: "Stage group.clinical Cancer" }] }, valueCodeableConcept: { text: "Stage IIIA" } }),
    variant("example-kras", "KRAS", "p.Gly12Cys", "2026-04-01"),
    variant("example-tp53", "TP53", "p.Arg273His", "2026-04-01"),
    entry({ resourceType: "Observation", id: "example-rna", status: "final", subject: ref, effectiveDateTime: "2026-04-03",
      code: { text: "Tumor RNA expression panel" },
      interpretation: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: "H" }] }],
      component: [{ code: { coding: [{ system: L, code: "48018-6", display: "Gene studied [ID]" }] }, valueCodeableConcept: { text: "CD274" } }] }),
    entry({ resourceType: "Observation", id: "example-pdl1", status: "final", subject: ref, effectiveDateTime: "2026-03-20",
      code: { text: "PD-L1 by immunohistochemistry (tumor proportion score)" }, valueQuantity: { value: 70, unit: "%" },
      interpretation: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: "H" }] }] }),
    entry({ resourceType: "Observation", id: "example-tmb", status: "final", subject: ref, effectiveDateTime: "2026-04-01",
      code: { coding: [{ system: L, code: "94076-7", display: "Mutations/Megabase [# Ratio] in Tumor" }] }, valueQuantity: { value: 14, unit: "mut/Mb" },
      interpretation: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: "H" }] }] }),
    med("example-med-1", "carboplatin", "2026-05-04"),
    med("example-med-2", "pembrolizumab", "2026-05-04"),
    status("example-status-1", "2026-08-12", "268910001", "Patient's condition improved"),
    med("example-med-3", "sotorasib", "2026-09-01"),
    status("example-status-2", "2026-10-20", "359746009", "Patient's condition stable"),
  ],
};
write("schema/examples/example-fhir-bundle.json", bundle);
write("app/data/examples/example-fhir-bundle.json", bundle);

// ---------- 2. Example SMART Health Card ----------
const ISS = "https://example-issuer.curebranch.invalid";
const issuerKeys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const pub = await crypto.subtle.exportKey("jwk", issuerKeys.publicKey);
// kid = RFC 7638 JWK thumbprint, as the SMART Health Cards spec requires
const thumbInput = JSON.stringify({ crv: pub.crv, kty: pub.kty, x: pub.x, y: pub.y });
const kid = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(thumbInput)));
const shcBundle = JSON.parse(JSON.stringify(bundle));
shcBundle.type = "collection";
const payload = { iss: ISS, nbf: Math.floor(Date.UTC(2026, 9, 21) / 1000),
  vc: { type: ["https://smarthealth.cards#health-card"], credentialSubject: { fhirVersion: "4.0.1", fhirBundle: shcBundle } } };
const header = { alg: "ES256", zip: "DEF", kid };
const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
const signingInput = `${enc(header)}.${b64url(deflateRawSync(Buffer.from(JSON.stringify(payload))))}`;
const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, issuerKeys.privateKey, new TextEncoder().encode(signingInput));
write("app/data/examples/example-health-card.smart-health-card", { verifiableCredential: [`${signingInput}.${b64url(sig)}`] });
write("app/data/trusted-issuers.json", {
  note: "Issuers whose SMART Health Card signatures count as verified. Real issuers should come from a published directory (e.g. the VCI directory); see docs/open-choices.md. The entry below is an EXAMPLE issuer whose private key was thrown away after signing the example card.",
  issuers: [{ iss: ISS, name: "Example Issuer (EXAMPLE DATA)", example: true,
    jwks: { keys: [{ kty: "EC", crv: "P-256", x: pub.x, y: pub.y, kid, use: "sig", alg: "ES256" }] } }],
});

// ---------- 3. Example local record + public summary ----------
const ownerKp = await newOwnerKeyPair();
const ownerPub = await crypto.subtle.exportKey("jwk", ownerKp.publicKey);
const record = {
  schemaVersion: "0.1", code: "k7x2m9", example: true,
  created: "2026-11-01T12:00:00.000Z", updated: "2026-11-01T12:00:00.000Z",
  privacy: { public: true, level: "basic", highestShared: "basic", history: [{ level: "basic", at: "2026-11-01T12:00:00.000Z" }] },
  recognition: { showOnProfile: { helped: true, branch: true, badges: true }, acceptNotes: true, shareCardIncludeCode: false,
    firstSharedAt: "2026-11-01T12:00:00.000Z", stats: { helpedCount: 12, foundingNumber: 42, nearby: [{ at: "2026-11-01T10:00:00.000Z", path: ["Lung", "KRAS"] }], example: true, checkedAt: "2026-11-01T12:00:00.000Z" } },
  afterDeath: { choice: "person-decides", person: { name: "EXAMPLE Person", howToReach: "example@example.invalid" },
    stewardKeyHash: "sha256:" + "0".repeat(63) + "1", stewardKeyGivenOn: "2026-11-01" },
  sources: [{ id: "src-1", kind: "smart-health-card", fileName: "example-health-card.smart-health-card", importedAt: "2026-11-01T12:00:00.000Z",
    origin: { connectedVia: "smart-health-card" },
    verification: { status: "verified", method: "smart-health-card", issuer: ISS, detail: "EXAMPLE issuer signature checked" }, bundle }],
  share: { cancerType: true, stageGroup: true, ageBand: true, markers: true, treatments: true, outcomes: true, publicContact: false, profile: false },
  branchPlacedBy: "rules",
  ai: { name: "Patient's own AI (EXAMPLE)" },
  notifications: { pushOptIn: false },
  files: [{ id: "file-1", linkedSourceId: "src-1", role: "supporting-from-patient", name: "EXAMPLE photo of a paper report.jpg", mediaType: "image/jpeg", size: 245760, kind: "photo",
    addedAt: "2026-11-01T12:00:00.000Z", verification: "unverified",
    claims: { date: "2026-03-20", testType: "PD-L1", keyValues: ["70%"] }, matchStatus: "matches", checkedAt: "2026-11-01T12:00:00.000Z", ignoreForAiMatching: false }],
  onboarding: { version: 1, step: "choices", stepsDone: ["start", "records", "choices"],
    consent: { watchedAndUnderstood: true, at: "2026-11-01T12:00:00.000Z", videoVersion: "placeholder" },
    afterDeathChosen: true, startedAt: "2026-11-01T12:00:00.000Z", completedAt: "2026-11-01T12:00:00.000Z" },
  editLog: [{ at: "2026-11-01T12:00:00.000Z", what: "Created (EXAMPLE)" }],
};
write("schema/examples/example-local-record.json", record);
const summary = await signSummary(buildSummary(record, ownerPub, { on: new Date("2026-11-01") }), ownerKp.privateKey);
write("schema/examples/example-public-summary.json", summary);
// Same patient at level 4 (Full public), to show what the extra levels add.
const fullRecord = { ...record, privacy: { public: true, level: "full", highestShared: "full", history: [{ level: "full", at: "2026-11-01T12:00:00.000Z" }] } };
write("schema/examples/example-public-summary-full.json", await signSummary(buildSummary(fullRecord, ownerPub, { on: new Date("2026-11-01") }), ownerKp.privateKey));

// ---------- 4. Example public tree ----------
let seed = 42;
const rand = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rand() * a.length)];
const A = "0123456789abcdefghjkmnpqrstvwxyz";
const code = () => Array.from({ length: 6 }, () => A[Math.floor(rand() * 32)]).join("");
const BR = [
  [["Lung", "KRAS", "G12C"], [["sotorasib"], ["carboplatin", "pembrolizumab"], ["adagrasib"]], 9, [{ gene: "TP53", kind: "dna-variant", change: "R273H", source: "dna" }]],
  [["Lung", "EGFR", "Exon 19 deletion"], [["osimertinib"], ["osimertinib", "carboplatin"]], 6, []],
  [["Lung", "ALK", "Fusion"], [["alectinib"], ["lorlatinib"]], 3, []],
  [["Colorectal", "KRAS", "G12D"], [["FOLFOX"], ["FOLFOX", "bevacizumab"]], 5, []],
  [["Colorectal", "BRAF", "V600E"], [["encorafenib", "cetuximab"]], 3, []],
  [["Melanoma", "BRAF", "V600E"], [["dabrafenib", "trametinib"], ["nivolumab"]], 5, []],
  [["Melanoma", "NRAS", "Q61R"], [["nivolumab", "ipilimumab"]], 3, []],
  [["Breast", "PIK3CA", "H1047R"], [["alpelisib", "fulvestrant"]], 3, []],
  [["Pancreas", "KRAS", "G12D"], [["FOLFIRINOX"]], 3, []],
];
const STATUSES = ["improving", "improving", "stable", "stable", "worsening", "no-evidence-of-disease", "not-determined"];
const summaries = [];
for (const [path, regimens, count, extra] of BR) {
  for (let i = 0; i < count; i++) {
    const kp = await newOwnerKeyPair();
    const pk = await crypto.subtle.exportKey("jwk", kp.publicKey);
    const reg = pick(regimens);
    const year = 2024 + Math.floor(rand() * 3);
    const verified = rand() < 0.75;
    const s = {
      schemaVersion: "0.1", code: code(), example: true, visibility: "public",
      afterDeath: { choice: pick(["keep-public", "keep-public", "remove", "person-decides"]) },
      branch: { path, placedBy: pick(["rules", "patient", "patient-ai"]) },
      stageGroup: pick(["II", "III", "III", "IV", "IV"]),
      ageBand: pick(["40-49", "50-59", "60-69", "60-69", "70-79"]),
      markers: [{ gene: path[1], kind: path[2] === "Fusion" ? "fusion" : "dna-variant", change: path[2], source: "dna" }, ...extra.filter(() => rand() < 0.5)],
      treatments: reg.map((name) => ({ name, startYear: year })),
      outcomes: [{ status: pick(STATUSES), afterTreatment: reg.length - 1, monthsFromStart: 2 + Math.floor(rand() * 18) }],
      verification: verified
        ? { status: "verified", method: pick(["smart-health-card", "smart-on-fhir"]), checkedOn: "2026-11-01" }
        : { status: "unverified", method: pick(["file-upload", "self-reported"]) },
      owner: { publicKeyJwk: { kty: "EC", crv: "P-256", x: pk.x, y: pk.y } },
      updated: `2026-${String(1 + Math.floor(rand() * 10)).padStart(2, "0")}-15`,
    };
    if (summaries.length < 2) {
      // Demonstrates "one person, one vote": two verified summaries with the same personKey; only one is counted.
      s.personKey = "EXAMPLE-same-person";
      s.verification = { status: "verified", method: "smart-health-card", checkedOn: "2026-11-01" };
    }
    if (summaries.length % 4 === 1) {
      // Some example patients switched on recognition (no extra random draws, so codes stay the same).
      s.recognition = { helpedCount: (summaries.length * 7) % 23, badges: ["first-share", ...(s.verification.status === "verified" ? ["verified"] : []), ...((summaries.length * 7) % 23 >= 10 ? ["helped-10"] : []), "founding"],
        showBranch: true, acceptsNotes: true, example: true };
    }
    summaries.push(await signSummary(s, kp.privateKey));
  }
}
write("app/data/example-summaries.json", { note: "EXAMPLE DATA. Made-up patients. Not medical information.", summaries });
console.log(`Wrote examples: ${summaries.length} example summaries, SHC kid ${kid}`);
