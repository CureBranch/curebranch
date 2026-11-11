// Builds, signs and checks the minimal PUBLIC summary from the private local record.
// Only fields the patient switched on are included. Signing uses the patient's own
// key (Web Crypto ECDSA P-256) over RFC 8785 canonical JSON (vendored 'canonicalize').
import canonicalize from "../vendor/canonicalize.js";
import { b64url, fromB64url, todayISO } from "./codes.js";
import { extractFacts, suggestBranch } from "./fhir.js";

export const DEFAULT_SHARE = Object.freeze({
  cancerType: true, stageGroup: true, ageBand: true, markers: true,
  treatments: true, outcomes: true, publicContact: false, profile: false,
});

/** A summary counts as verified only if EVERY source it was built from is verified. */
export function combinedVerification(sources, on = new Date()) {
  if (!sources.length) return { status: "unverified", method: "self-reported" };
  const allOk = sources.every((s) => s.verification.status === "verified");
  const first = sources[0].verification;
  const v = { status: allOk ? "verified" : "unverified", method: allOk ? first.method : (sources.find((s) => s.verification.status !== "verified").verification.method) };
  const issuers = [...new Set(sources.map((s) => s.verification.issuer).filter(Boolean))];
  if (issuers.length === 1) v.issuer = issuers[0];
  v.checkedOn = todayISO(on);
  return v;
}

const strip = (o) => JSON.parse(JSON.stringify(o)); // drops undefined

export function buildSummary(record, ownerPublicJwk, { on = new Date() } = {}) {
  const share = { ...DEFAULT_SHARE, ...(record.share || {}) };
  const facts = extractFacts(record.sources.map((s) => s.bundle), { on });
  const path = record.branchPath && record.branchPath.length ? record.branchPath : suggestBranch(facts);
  const s = {
    schemaVersion: "0.1",
    code: record.code,
    example: !!record.example,
    visibility: record.privacy && record.privacy.public ? "public" : "private",
    afterDeath: { choice: record.afterDeath.choice },
    branch: { path, placedBy: record.branchPlacedBy || "rules" },
    verification: combinedVerification(record.sources, on),
    owner: { publicKeyJwk: { kty: "EC", crv: "P-256", x: ownerPublicJwk.x, y: ownerPublicJwk.y } },
    updated: todayISO(on),
  };
  if (record.afterDeath.stewardKeyHash) s.afterDeath.stewardKeyHash = record.afterDeath.stewardKeyHash;
  if (share.cancerType && facts.cancerType) s.branch.cancerType = facts.cancerType.coding;
  if (!share.cancerType) s.branch.path = s.branch.path.slice(1).length ? ["Not shared", ...s.branch.path.slice(1)] : ["Not shared"];
  if (share.stageGroup && facts.stageGroup) s.stageGroup = facts.stageGroup;
  if (share.ageBand && facts.ageBand) s.ageBand = facts.ageBand;
  if (share.markers && facts.markers.length) s.markers = facts.markers;
  if (share.treatments && facts.treatments.length) s.treatments = facts.treatments;
  if (share.outcomes && facts.outcomes.length) {
    s.outcomes = share.treatments ? facts.outcomes : facts.outcomes.map(({ afterTreatment, ...o }) => o);
  }
  if (share.publicContact && record.publicContact) s.publicContact = record.publicContact;
  if (share.profile && record.profile && (record.profile.displayName || record.profile.photo)) {
    s.profile = {};
    if (record.profile.displayName) s.profile.displayName = record.profile.displayName;
    if (record.profile.photo) s.profile.photo = record.profile.photo;
  }
  // A private summary carries nothing but what is needed to ask for removal.
  if (s.visibility === "private") {
    return strip({ schemaVersion: s.schemaVersion, code: s.code, example: s.example, visibility: "private",
      afterDeath: s.afterDeath, branch: { path: ["Not shared"] }, verification: { status: "unverified", method: "self-reported" },
      owner: s.owner, updated: s.updated });
  }
  return strip(s);
}

export function signingBytes(summary) {
  const { signature, ...rest } = summary;
  return new TextEncoder().encode(canonicalize(rest));
}

export async function signSummary(summary, privateKey) {
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, signingBytes(summary));
  return { ...summary, signature: b64url(sig) };
}

export async function verifySummarySignature(summary) {
  if (!summary.signature) return false;
  const key = await crypto.subtle.importKey("jwk", summary.owner.publicKeyJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, fromB64url(summary.signature), signingBytes(summary));
}

export async function newOwnerKeyPair() {
  // Extractable so the patient can download a backup; it never leaves the device otherwise.
  return crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
}
