// The 4 sharing levels. Pure logic (no DOM) so it is unit-tested.
//
// Rules:
//  * Nothing is preselected. Until the patient picks, nothing is shared (treated as Private).
//  * The patient can move to a LOWER level any time. That stops sharing from then on, but
//    anything already published at a higher level stays out there and can't be pulled back.
//    The app says this plainly before they pick level 2-4 and whenever they move down.
//  * No level ever includes name, birthday, street address, phone, email or record numbers.

export const LEVELS = Object.freeze([
  { id: "private", n: 1, name: "Private", tag: "device only",
    what: "Nothing is shared. Your records stay on this device. Others can't learn from your branch." },
  { id: "basic", n: 2, name: "Basic public summary", tag: "ranges only",
    what: "Cancer type, stage group (like Stage 3), age range (like 60 to 69), gene markers, treatment names and the year they started, and how it went in months. Shown under your random code." },
  { id: "detailed", n: 3, name: "Detailed public", tag: "exact ages and dates",
    what: "Everything in Basic, plus your exact age, exact stage (like Stage IIIA), the date you were diagnosed, and the exact dates of treatments and results." },
  { id: "full", n: 4, name: "Full public", tag: "everything",
    what: "Everything in Detailed, plus your city, state and country, and full treatment details: end dates, whether it is still going, and dose instructions." },
]);
export const LEVEL_IDS = LEVELS.map((l) => l.id);
export const PUBLIC_LEVELS = ["basic", "detailed", "full"];
export const NEVER_SHARED = "No level ever shares your name, birthday, street address, phone, email or record numbers. (Your name or photo appear only if you add them to your profile and switch that on separately.)";

const byId = (id) => LEVELS.find((l) => l.id === id) || null;
export const levelInfo = byId;
export const levelName = (id) => (byId(id) ? byId(id).name : "Not chosen yet");
export const rank = (id) => (byId(id) ? byId(id).n : 0);
export const isPublicLevel = (id) => PUBLIC_LEVELS.includes(id);

/** The patient's level, or null if they haven't picked one (nothing is shared then). */
export function privacyLevel(record) {
  const p = (record && record.privacy) || {};
  if (LEVEL_IDS.includes(p.level)) return p.level;
  if (p.public === true) return "basic"; // records saved before levels existed
  return null;
}

/** Highest level this patient has ever published at (null if never public). */
export function highestShared(record) {
  const p = (record && record.privacy) || {};
  if (PUBLIC_LEVELS.includes(p.highestShared)) return p.highestShared;
  const cur = privacyLevel(record);
  return isPublicLevel(cur) ? cur : null;
}

/**
 * What to tell the patient BEFORE a change takes effect.
 * Returns { needsConfirm, kind: "none"|"going-public"|"moving-down"|"both", title, lines[], yes, no }.
 */
export function changeWarning(record, to) {
  const from = privacyLevel(record);
  const top = highestShared(record);
  const target = byId(to);
  if (!target || to === from) return { needsConfirm: false, kind: "none", lines: [] };
  const down = !!top && rank(to) < rank(top);
  const pub = isPublicLevel(to);
  const lines = [];
  if (down) {
    lines.push(`Moving to ${target.name} stops sharing from now on. New records won't be shared${pub ? " beyond this level" : ""}.`);
    lines.push(`But what you already shared at the ${levelName(top)} level stays out there. It can't be pulled back. People may already have seen or copied it.`);
  }
  if (pub) {
    lines.push(`At ${target.name}, anyone can see: ${target.what.replace(/^Everything in/, "everything in")}`);
    if (!down) lines.push("Once something is shared, it can't be pulled back, even if you pick a lower level or Private later.");
    lines.push(NEVER_SHARED);
  }
  if (!lines.length) return { needsConfirm: false, kind: "none", lines: [] };
  const kind = down && pub ? "both" : down ? "moving-down" : "going-public";
  return {
    needsConfirm: true, kind, lines,
    title: down ? "Before you move down: already shared stays shared" : "Before you share: this can't be pulled back",
    yes: pub ? `Yes, share at ${target.name}` : `Yes, move to ${target.name}`,
    no: "No, keep my current choice",
  };
}

/** Apply a level the patient confirmed. Keeps a short history and the highest level ever shared. */
export function setPrivacyLevel(record, to, on = new Date()) {
  if (!byId(to)) throw new Error("Unknown sharing level");
  const before = highestShared(record);
  const p = (record.privacy = { ...(record.privacy || {}) });
  if (before) p.highestShared = before;
  p.level = to;
  p.public = isPublicLevel(to);
  if (p.public && rank(to) > rank(p.highestShared)) p.highestShared = to;
  p.history = [...(p.history || []), { level: to, at: on.toISOString() }].slice(-100);
  return record;
}

/** Plain-English status line for Home / Settings. */
export function statusWords(record) {
  const lvl = privacyLevel(record);
  const top = highestShared(record);
  const still = top && rank(lvl) < rank(top) ? ` Earlier you shared at ${levelName(top)}; that stays public.` : "";
  if (!lvl) return { title: "Sharing: not chosen yet", help: "Nothing is shared until you pick a level. Your records stay on this device." + still };
  if (lvl === "private") return { title: "Sharing: Private", help: "Nothing new is shared. Your records stay on this device." + still };
  return { title: `Sharing: ${levelName(lvl)} (level ${rank(lvl)} of 4)`, help: `Shared under your random code. Your records stay on this device.${still}` };
}
