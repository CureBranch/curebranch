// Patient recognition: "your branch helped" counter, badges, branch picture, share card
// text, and anonymous thank-you notes. Pure logic (no DOM, no storage) so it is unit-tested.
// Rules: everything is OFF until the patient turns it on. The public page shows only the
// random code unless the patient chooses more. No names, no money, no rankings.
import { buildTree } from "./tree.js";
import { livingTreeSvg, hashStr } from "./living-tree.js";
import { privacyLevel, isPublicLevel } from "./privacy.js";

export const FOUNDING_LIMIT = 1000;
export const NOTE_MAX = 280;

export const BADGES = Object.freeze([
  { id: "first-share", name: "First record shared", how: "You shared your summary for the first time." },
  { id: "verified", name: "Verified records", how: "Your records came from your hospital or lab." },
  { id: "helped-10", name: "Helped 10 people", how: "Your data helped match 10 or more people." },
  { id: "founding", name: "Founding branch", how: `One of the first ${FOUNDING_LIMIT.toLocaleString("en-US")} branches on the tree.` },
]);
export const BADGE_IDS = BADGES.map((b) => b.id);

/** Starting settings: nothing shown, no notes accepted. */
export function defaultRecognition() {
  return { showOnProfile: { helped: false, branch: false, badges: false }, acceptNotes: false, shareCardIncludeCode: false };
}
export function recognitionOf(record) {
  const d = defaultRecognition();
  const r = record.recognition || {};
  return { ...d, ...r, showOnProfile: { ...d.showOnProfile, ...(r.showOnProfile || {}) } };
}

/** Called when a public sharing level is picked (or records arrive at one): remembers the first time a summary was shared. */
export function noteFirstShare(record, on = new Date()) {
  if (!isPublicLevel(privacyLevel(record)) || !(record.sources || []).length) return false;
  const r = (record.recognition = recognitionOf(record));
  if (r.firstSharedAt) return false;
  r.firstSharedAt = on.toISOString();
  return true;
}

const official = (s) => s.verification && s.verification.status === "verified" && ["smart-on-fhir", "smart-health-card"].includes(s.verification.method);

/** Which badges are earned. stats = { helpedCount, foundingNumber } from the recognition source. */
export function earnedBadges(record, stats = {}) {
  const r = recognitionOf(record);
  const out = [];
  if (r.firstSharedAt) out.push("first-share");
  if ((record.sources || []).some(official)) out.push("verified");
  if ((stats.helpedCount || 0) >= 10) out.push("helped-10");
  if (Number.isInteger(stats.foundingNumber) && stats.foundingNumber >= 1 && stats.foundingNumber <= FOUNDING_LIMIT) out.push("founding");
  return out;
}

export function helpedWords(n) {
  if (!n) return "Your branch hasn't helped match anyone yet.";
  return `Your branch helped ${n} other ${n === 1 ? "patient" : "patients"}.`;
}

/** Text on the shareable image card. The random code only if the patient ticks the box. */
export function cardLines({ helpedCount = 0, code = "", includeCode = false, badges = [] } = {}) {
  const lines = ["I'm part of CureBranch."];
  lines.push(helpedCount > 0 ? `My data has helped ${helpedCount} ${helpedCount === 1 ? "person" : "people"}.` : "My branch is on the tree.");
  const names = badges.map((id) => (BADGES.find((b) => b.id === id) || {}).name).filter(Boolean);
  if (names.length) lines.push(names.join(" · "));
  if (includeCode && code) lines.push(`my.curebranch.ai/${code}`);
  lines.push("curebranch.ai");
  return lines;
}

/**
 * Check a thank-you note. Notes are anonymous and short, so they can't carry contact details.
 * Returns { ok, text } or { ok: false, reason } with a plain-English reason.
 */
export function cleanNote(input) {
  const text = String(input ?? "").replace(/\s+/g, " ").trim();
  if (!text) return { ok: false, reason: "Please write a short note first." };
  if (text.length > NOTE_MAX) return { ok: false, reason: `Please keep it under ${NOTE_MAX} letters. It has ${text.length}.` };
  if (/(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|org|net|ai|io|co|me|info|app)\b)/i.test(text)) return { ok: false, reason: "Notes can't include links. This keeps everyone safe." };
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(text)) return { ok: false, reason: "Notes can't include email addresses. Notes stay anonymous." };
  if ((text.match(/\d/g) || []).length >= 7) return { ok: false, reason: "Notes can't include phone numbers or long numbers. Notes stay anonymous." };
  if (/(^|\s)@[a-z0-9_]{2,}/i.test(text)) return { ok: false, reason: "Notes can't include social media handles. Notes stay anonymous." };
  return { ok: true, text };
}

/** What may go in the PUBLIC summary: only what the patient switched on, only when public. */
export function publicRecognition(record) {
  if (!isPublicLevel(privacyLevel(record))) return undefined;
  const r = recognitionOf(record);
  const st = r.stats || {};
  const out = {};
  if (r.showOnProfile.helped && Number.isInteger(st.helpedCount)) out.helpedCount = st.helpedCount;
  if (r.showOnProfile.badges) { const b = earnedBadges(record, st); if (b.length) out.badges = b; }
  if (r.showOnProfile.branch) out.showBranch = true;
  if (r.acceptNotes) out.acceptsNotes = true;
  if (!Object.keys(out).length) return undefined;
  if (st.example) out.example = true;
  return out;
}

/** Is a "someone landed near your branch" event recent enough to make the branch glow? */
export function shouldGlow(nearby = [], now = new Date(), hours = 24) {
  return nearby.some((e) => e && e.at && now - new Date(e.at) <= hours * 3600000 && now - new Date(e.at) >= 0);
}

/**
 * The tree picture for the profile page (SVG string, drawn by living-tree.js). Limbs are
 * cancer types; the patient's own branch is outlined in gold with a flower at its tip, and
 * the flower glows (CSS) when someone landed near it recently.
 */
export function branchTreeSvg(summaries, path, { glow = false } = {}) {
  const mine = path && path.length ? path : null;
  const desc = mine ? `Your branch, ${mine.join(", then ")}, is outlined in gold with a flower at its tip${glow ? ". The flower is glowing, because someone landed near your branch in the last day" : ""}.` : "Your branch isn't on the tree yet.";
  return livingTreeSvg(buildTree(summaries), { mine, glow, interactive: false, label: `Tree picture. ${desc}`, idPrefix: "lt-p" + (hashStr((mine || []).join("|")) % 100000) });
}
