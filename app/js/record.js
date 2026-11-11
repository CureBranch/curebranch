// A brand-new private record. Pure (no storage), so the defaults are unit-tested in Node.
// Rule: nothing is public unless the patient explicitly picks it.
//  * privacy.public = false (private)
//  * afterDeath.choice = "keep-private"; the guide/Home still say "Not chosen yet" until the
//    patient picks one themselves (onboarding.afterDeathChosen).
import { randomCode } from "./codes.js";
import { CONFIG } from "./config.js";
import { DEFAULT_SHARE } from "./summary.js";

export function newRecord(now = new Date().toISOString()) {
  return {
    schemaVersion: "0.1",
    code: randomCode(CONFIG.CODE_LENGTH),
    created: now,
    updated: now,
    privacy: { public: false },
    afterDeath: { choice: "keep-private" },
    sources: [],
    share: { ...DEFAULT_SHARE },
    editLog: [{ at: now, what: "Created on this device" }],
  };
}
