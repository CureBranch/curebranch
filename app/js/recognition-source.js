// Where recognition numbers and thank-you notes come from.
//
// INTERFACE (what a future network source must provide; the local stub implements it):
//   stats(record)                -> Promise<{ helpedCount: number, foundingNumber: number|null,
//                                             nearby: Array<{ at: ISO date, path: string[] }>, example: boolean }>
//   inbox(record)                -> Promise<Array<{ id, text, at, example? }>>   (anonymous notes)
//   sendNote(record, toCode, text) -> Promise<{ ok, status, reason? }>           (no sender identity)
//
// There is no public network yet, so the app uses localStubSource(): numbers are computed on
// this device from the EXAMPLE tree, flagged example: true, and sent notes stay on this device.
import { suggestBranch, extractFacts } from "./fhir.js";
import { cleanNote, recognitionOf } from "./recognition.js";
import { privacyLevel, isPublicLevel } from "./privacy.js";

function pathOf(record) {
  if (record.branchPath && record.branchPath.length) return record.branchPath;
  if (!(record.sources || []).length) return null;
  return suggestBranch(extractFacts(record.sources.map((s) => s.bundle)));
}

/** "Matched using their data" in the stub = other public summaries on the same branch (first two levels). */
export function stubHelpedCount(record, summaries) {
  if (!isPublicLevel(privacyLevel(record))) return 0; // data only helps others once shared
  const p = pathOf(record);
  if (!p || p.length < 1) return 0;
  const depth = Math.min(2, p.length);
  return summaries.filter((s) => s.visibility === "public" && s.code !== record.code && s.branch && s.branch.path &&
    p.slice(0, depth).every((x, i) => s.branch.path[i] === x)).length;
}

const EXAMPLE_NOTES = [
  { id: "ex-note-1", text: "Your branch helped me ask my doctor the right question. Thank you. (EXAMPLE)", example: true },
  { id: "ex-note-2", text: "Seeing someone like me on the tree gave me hope this week. (EXAMPLE)", example: true },
];

export function localStubSource({ summaries = [], now = () => new Date() } = {}) {
  return {
    kind: "local-stub",
    async stats(record) {
      const helpedCount = stubHelpedCount(record, summaries);
      const shared = !!recognitionOf(record).firstSharedAt;
      const t = now();
      return {
        helpedCount,
        foundingNumber: shared ? summaries.length + 1 : null,
        nearby: helpedCount ? [{ at: new Date(t - 2 * 3600000).toISOString(), path: (pathOf(record) || []).slice(0, 2) }] : [],
        example: true,
      };
    },
    async inbox(record) {
      const r = recognitionOf(record);
      if (!r.acceptNotes || !isPublicLevel(privacyLevel(record))) return [];
      const t = now();
      return EXAMPLE_NOTES.map((n, i) => ({ ...n, at: new Date(t - (i + 1) * 86400000).toISOString() }));
    },
    async sendNote(record, toCode, text) {
      const c = cleanNote(text);
      if (!c.ok) return { ok: false, reason: c.reason };
      if (!/^[0-9a-hjkmnp-tv-z]{6,12}$/.test(String(toCode || ""))) return { ok: false, reason: "That page code isn't valid." };
      const r = (record.recognition = recognitionOf(record));
      r.notesSent = [...(r.notesSent || []), { id: crypto.randomUUID(), toCode, text: c.text, at: now().toISOString(), status: "saved-on-device" }].slice(-50);
      return { ok: true, status: "saved-on-device" };
    },
  };
}
