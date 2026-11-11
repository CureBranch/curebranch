// Consistency check for supporting attachments (photos/files from the patient).
// The patient may say what a photo shows: its date, the test type, and key results.
// We compare that with the OFFICIAL record the photo is linked to. Plain string and date
// matching, no AI, nothing leaves the device. A mismatch never deletes anything: the photo
// is kept, flagged in plain English, and marked so AI matching ignores it.
import { shortProteinChange } from "./fhir.js";

const MATCH_STATUSES = Object.freeze(["matches", "mismatch", "unchecked"]);
export { MATCH_STATUSES };

const norm = (s) => String(s ?? "").toLowerCase().replace(/(\d)\s+%/g, "$1%").replace(/[^a-z0-9%.]+/g, " ").replace(/\s+/g, " ").trim();
const tokens = (s) => norm(s).split(" ").filter(Boolean).map((t) => t.replace(/\.+$/, "")).filter(Boolean);

function texts(cc) {
  if (!cc) return [];
  return [cc.text, ...((cc.coding || []).map((c) => c.display))].filter(Boolean);
}
function dateOf(r) {
  const d = r.effectiveDateTime || r.issued || r.onsetDateTime || r.recordedDate || r.authoredOn || r.dateAsserted ||
    (r.effectivePeriod && r.effectivePeriod.start) || (r.period && r.period.start) || "";
  return /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : "";
}
function valueTexts(x) {
  const out = [];
  if (x.valueString) out.push(x.valueString);
  if (x.valueCodeableConcept) out.push(...texts(x.valueCodeableConcept));
  if (x.valueQuantity && x.valueQuantity.value !== undefined) {
    out.push(String(x.valueQuantity.value), `${x.valueQuantity.value}${x.valueQuantity.unit || ""}`, `${x.valueQuantity.value} ${x.valueQuantity.unit || ""}`);
  }
  for (const t of [...out]) if (/^p\./i.test(t)) { const s = shortProteinChange(t); if (s) out.push(s); }
  return out;
}

/** Every test-like entry in a FHIR Bundle: names, date, values (all as plain text). */
export function recordEntries(bundle) {
  const out = [];
  for (const e of (bundle && bundle.entry) || []) {
    const r = e.resource || {};
    if (!["Observation", "DiagnosticReport", "Condition", "MedicationStatement", "MedicationRequest", "Procedure"].includes(r.resourceType)) continue;
    const names = [...texts(r.code), ...texts(r.medicationCodeableConcept)];
    const values = [...valueTexts(r)];
    for (const c of r.component || []) { values.push(...valueTexts(c)); }
    if (r.resourceType === "Condition") values.push(...texts(r.code));
    out.push({ type: r.resourceType, names, date: dateOf(r), values, all: new Set(tokens([...names, ...values].join(" "))) });
  }
  return out;
}

/** Names of tests in the linked record, for the "test type" suggestions list. */
export function testNames(bundle) {
  return [...new Set(recordEntries(bundle).flatMap((x) => x.names).map((n) => n.replace(/\s*\(EXAMPLE\)\s*/g, "").trim()).filter(Boolean))];
}

const nameMatches = (entry, testType) => {
  const want = tokens(testType).filter((t) => t.length >= 2);
  return want.length > 0 && want.every((t) => entry.all.has(t) || [...entry.all].some((h) => h.startsWith(t) && t.length >= 4));
};
const valueIn = (entry, v) => { const want = tokens(v); return want.length > 0 && want.every((t) => entry.all.has(t)); };
const dayDiff = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);

/** Clean what the patient typed. Returns undefined when nothing was entered. */
export function cleanClaims({ date, testType, keyValues } = {}) {
  const c = {};
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(String(date).trim())) c.date = String(date).trim();
  if (testType && String(testType).trim()) c.testType = String(testType).trim().slice(0, 120);
  const kv = (Array.isArray(keyValues) ? keyValues : String(keyValues || "").split(/[,;\n]/)).map((s) => String(s).trim()).filter(Boolean).slice(0, 10).map((s) => s.slice(0, 80));
  if (kv.length) c.keyValues = kv;
  return Object.keys(c).length ? c : undefined;
}

/**
 * Compare what the patient said about an attachment with the official record it is linked to.
 * Returns { matchStatus, mismatchReasons, ignoreForAiMatching }.
 * Dates may differ by 1 day (time zones); everything else must be found in the record.
 */
export function checkClaims(claims, bundle) {
  if (!claims || !Object.keys(claims).length) return { matchStatus: "unchecked", mismatchReasons: [], ignoreForAiMatching: false };
  const entries = recordEntries(bundle);
  const reasons = [];
  let pool = entries;
  if (claims.testType) {
    const named = entries.filter((e) => nameMatches(e, claims.testType));
    if (!named.length) reasons.push(`We couldn't find a test called "${claims.testType}" in your hospital record.`);
    else pool = named;
  }
  if (claims.date) {
    const dated = pool.filter((e) => e.date && dayDiff(e.date, claims.date) <= 1);
    if (!dated.length) {
      const known = [...new Set(pool.map((e) => e.date).filter(Boolean))].sort();
      reasons.push(`The date ${claims.date} doesn't match your hospital record${claims.testType && pool !== entries ? ` for "${claims.testType}"` : ""}.` +
        (known.length && known.length <= 3 ? ` The record says ${known.join(", ")}.` : ""));
    } else pool = dated;
  }
  for (const v of claims.keyValues || []) {
    if (!pool.some((e) => valueIn(e, v))) reasons.push(`"${v}" isn't in your hospital record${pool !== entries ? " for that test" : ""}.`);
  }
  const mismatch = reasons.length > 0;
  return { matchStatus: mismatch ? "mismatch" : "matches", mismatchReasons: reasons, ignoreForAiMatching: mismatch };
}

/** Apply the check to one attachment of the record (mutates and returns it). */
export function checkAttachment(record, fileId, claimsInput, { on = new Date() } = {}) {
  const f = (record.files || []).find((x) => x.id === fileId);
  if (!f) throw new Error("That file is no longer on this device.");
  const src = (record.sources || []).find((s) => s.id === f.linkedSourceId);
  const claims = cleanClaims(claimsInput);
  const res = checkClaims(claims, src && src.bundle);
  if (claims) f.claims = claims; else delete f.claims;
  f.matchStatus = res.matchStatus;
  f.ignoreForAiMatching = res.ignoreForAiMatching;
  if (res.mismatchReasons.length) f.mismatchReasons = res.mismatchReasons; else delete f.mismatchReasons;
  if (claims) f.checkedAt = on.toISOString(); else delete f.checkedAt;
  return f;
}

/** Plain-English flag for the screen. */
export function matchWords(f) {
  if (f.matchStatus === "matches") return "Matches your hospital record.";
  if (f.matchStatus === "mismatch") return "This doesn't match your hospital record. It's kept, but AI matching will ignore it.";
  return "Not checked yet.";
}

/** Supporting files an AI may use for matching: never mismatched ones, never ones whose record is gone. */
export function attachmentsForAi(record) {
  const ids = new Set((record.sources || []).map((s) => s.id));
  return (record.files || []).filter((f) => ids.has(f.linkedSourceId) && f.matchStatus !== "mismatch" && !f.ignoreForAiMatching);
}
