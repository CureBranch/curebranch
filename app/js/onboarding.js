// First-run setup guide: pure logic, no DOM and no storage, so it runs in Node tests too.
// The guide only RECORDS the patient's choices in the local record (schema/local-record.schema.json,
// "onboarding" and "files"). It never decides anything for them.

import { privacyLevel, levelName, rank } from "./privacy.js";
function sharingWords(record) {
  const l = privacyLevel(record);
  if (!l) return "Not chosen yet (nothing is shared)";
  if (l === "private") return "Private (device only, nothing is shared)";
  return `${levelName(l)} (level ${rank(l)} of 4, under your code)`;
}

export const ONBOARDING_VERSION = 1;

/** The steps, in order. ids are stored in record.onboarding.step / stepsDone. */
export const STEPS = Object.freeze([
  { id: "start", title: "Get started" },
  { id: "records", title: "Your records" },
  { id: "choices", title: "Your choices" },
]);
export const STEP_IDS = STEPS.map((s) => s.id);

/** Plain-English words for each after-death choice (shared by the guide, Home and Settings). */
export const AFTER_WORDS = Object.freeze({
  "keep-private": "Keep it private",
  remove: "Delete my summary",
  "keep-public": "Make it public",
  "person-decides": "Let the person I name decide",
});
export const AI_CHOICES = Object.freeze(["Grok", "ChatGPT", "Claude", "Gemini", "Another AI", "I don't use an AI"]);

/** Max size of one photo or file kept on the device by the guide (bytes). */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** true when the guide should open by itself: never finished on this device. */
export function needsOnboarding(record) {
  return !(record && record.onboarding && record.onboarding.completedAt);
}

/** true when the guide was started but not finished: resume it (for example after a portal login). */
export function shouldResumeOnboarding(record) {
  return needsOnboarding(record) && !!(record && record.onboarding && (record.onboarding.startedAt || record.onboarding.step));
}

/** Where to pick up. Unknown or missing step -> the first step. */
export function resumeIndex(record) {
  const o = record && record.onboarding;
  if (!o || !o.step) return 0;
  const i = STEP_IDS.indexOf(o.step);
  return i < 0 ? 0 : i;
}

function ensure(record) {
  if (!record.onboarding) record.onboarding = { version: ONBOARDING_VERSION, step: STEP_IDS[0], stepsDone: [], startedAt: new Date().toISOString() };
  if (!Array.isArray(record.onboarding.stepsDone)) record.onboarding.stepsDone = [];
  return record.onboarding;
}

/** Remember the step the patient is on, so they can close the app and come back. */
export function setStep(record, stepId) {
  if (!STEP_IDS.includes(stepId)) throw new Error("unknown step " + stepId);
  const o = ensure(record);
  o.step = stepId;
  return record;
}

/** Mark a step finished (or skipped) and move to the next one.
 *  skipId: when a combined step skips only one part (for example "ai" on "choices"). */
export function completeStep(record, stepId, { skipped = false, skipId } = {}) {
  if (!STEP_IDS.includes(stepId)) throw new Error("unknown step " + stepId);
  const o = ensure(record);
  if (!o.stepsDone.includes(stepId)) o.stepsDone.push(stepId);
  const flag = skipId || stepId;
  o.skipped = (o.skipped || []).filter((s) => s !== flag);
  if (skipped) o.skipped.push(flag);
  if (!o.skipped.length) delete o.skipped;
  const next = STEP_IDS[Math.min(STEP_IDS.indexOf(stepId) + 1, STEP_IDS.length - 1)];
  o.step = next;
  return record;
}

/** Step 1 is the only gate: the patient must say they watched and understood (the welcome part of Get started). */
export function recordConsent(record, { videoVersion = "placeholder", on = new Date() } = {}) {
  const o = ensure(record);
  o.consent = { watchedAndUnderstood: true, at: on.toISOString(), videoVersion: String(videoVersion).slice(0, 60) };
  return record;
}
export function hasConsent(record, videoVersion) {
  const c = record && record.onboarding && record.onboarding.consent;
  return !!(c && c.watchedAndUnderstood && (videoVersion === undefined || c.videoVersion === String(videoVersion)));
}

/** The patient picked an after-death choice themselves (the stored default is not a choice). */
export function chooseAfterDeath(record, choice) {
  if (!Object.prototype.hasOwnProperty.call(AFTER_WORDS, choice)) throw new Error("unknown choice " + choice);
  record.afterDeath = { ...(record.afterDeath || {}), choice };
  ensure(record).afterDeathChosen = true;
  return record;
}

export function finishOnboarding(record, on = new Date()) {
  const o = ensure(record);
  const last = STEP_IDS[STEP_IDS.length - 1];
  if (!o.stepsDone.includes(last)) o.stepsDone.push(last);
  o.step = last;
  o.completedAt = on.toISOString();
  return record;
}

/** Re-run from Settings: start again at step 1, keep every earlier answer so nothing is lost. */
export function restartOnboarding(record) {
  const o = ensure(record);
  delete o.completedAt;
  o.step = STEP_IDS[0];
  o.stepsDone = [];
  delete o.skipped;
  o.restartedAt = new Date().toISOString();
  return record;
}

/** What the summary on Your choices shows. Plain words; only things saved on this device. */
export function choicesSummary(record) {
  const files = (record.files || []).length;
  const sources = (record.sources || []).length;
  const n = files + sources;
  const ad = record.afterDeath || {};
  const person = ad.person && ad.person.name ? ad.person.name : "";
  const ai = record.ai && record.ai.name ? record.ai.name : "";
  return [
    { label: "Your private code", value: record.code },
    { label: "Records on this device", value: n === 0 ? "None yet" : `${n} ${n === 1 ? "item" : "items"}` },
    { label: "Sharing", value: sharingWords(record) },
    { label: "After you're gone", value: record.onboarding && record.onboarding.afterDeathChosen ? (AFTER_WORDS[ad.choice] || "Not chosen yet") : "Not chosen yet" },
    { label: "Your trusted person", value: person || "Not named yet" },
    { label: "Your AI", value: ai || "None" },
  ];
}

/** Patient portals offered on the "Connect your hospital portal" step. */
export const PORTALS = Object.freeze([
  { id: "mychart", name: "MyChart (Epic)" },
  { id: "oracle-health", name: "Oracle Health (Cerner)" },
  { id: "apple-health", name: "Apple Health records" },
  { id: "other", name: "Another portal, or I'm not sure" },
]);
export const portalName = (id) => (PORTALS.find((p) => p.id === id) || PORTALS[PORTALS.length - 1]).name;

/** Official records: verified, and pulled from a hospital or lab (portal or signed health card). */
export function isOfficial(source) {
  return !!(source && source.verification && source.verification.status === "verified" &&
    ["smart-on-fhir", "smart-health-card"].includes(source.verification.method));
}
export function officialSources(record) { return (record.sources || []).filter(isOfficial); }

/** Photos/files are only allowed as supporting attachments to an official record. */
export function canAttach(record, sourceId) {
  return officialSources(record).some((s) => s.id === sourceId);
}

/** Metadata saved in record.files (the bytes live in a separate on-device store entry). */
export function attachmentMeta(record, { id, sourceId, name, mediaType, size, on = new Date() }) {
  if (!canAttach(record, sourceId)) throw new Error("Photos and files can only be added to a record from your hospital.");
  const kind = String(mediaType || "").startsWith("image/") ? "photo" : "document";
  return {
    id,
    linkedSourceId: sourceId,
    role: "supporting-from-patient",
    name: String(name || (kind === "photo" ? "Photo" : "File")).slice(0, 200),
    mediaType: String(mediaType || "application/octet-stream").slice(0, 100),
    size: Math.max(0, Math.floor(size || 0)),
    kind,
    addedAt: on.toISOString(),
    verification: "unverified",
    matchStatus: "unchecked",
    ignoreForAiMatching: false,
  };
}

/** Removing an official record also removes the supporting files linked to it. Returns the file ids to delete. */
export function removeSource(record, sourceId) {
  record.sources = (record.sources || []).filter((s) => s.id !== sourceId);
  const gone = (record.files || []).filter((f) => f.linkedSourceId === sourceId).map((f) => f.id);
  record.files = (record.files || []).filter((f) => f.linkedSourceId !== sourceId);
  if (!record.files.length) delete record.files;
  return gone;
}
