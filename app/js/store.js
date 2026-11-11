// On-device storage only. IndexedDB via the vendored idb-keyval library (Apache-2.0).
// Nothing in this file talks to a server.
import { get, set, del, createStore } from "../vendor/idb-keyval.js";
import { randomCode } from "./codes.js";
import { CONFIG } from "./config.js";
import { DEFAULT_SHARE, newOwnerKeyPair } from "./summary.js";

const db = createStore("curebranch", "local");

export async function loadRecord() { return (await get("record", db)) || null; }

export async function saveRecord(record, what) {
  record.updated = new Date().toISOString();
  if (what) (record.editLog = record.editLog || []).push({ at: record.updated, what });
  await set("record", record, db);
  return record;
}

export function newRecord() {
  const now = new Date().toISOString();
  return {
    schemaVersion: "0.1",
    code: randomCode(CONFIG.CODE_LENGTH),
    created: now,
    updated: now,
    privacy: { public: false },
    afterDeath: { choice: "keep-public" },
    sources: [],
    share: { ...DEFAULT_SHARE },
    editLog: [{ at: now, what: "Created on this device" }],
  };
}

export async function getOrCreateRecord() {
  return (await loadRecord()) || saveRecord(newRecord(), null);
}

/** The patient's signing key pair. Created once, kept in this browser. */
export async function ownerKeys() {
  let kp = await get("ownerKeys", db);
  if (!kp) { kp = await newOwnerKeyPair(); await set("ownerKeys", kp, db); }
  return kp;
}
export async function ownerPublicJwk() {
  return crypto.subtle.exportKey("jwk", (await ownerKeys()).publicKey);
}

/** Full backup: record plus private key. The patient keeps it safe; we never see it. */
export async function backupBlob() {
  const record = await loadRecord();
  const kp = await ownerKeys();
  const backup = {
    kind: "curebranch-backup",
    warning: "PRIVATE. Contains your medical records and your signing key. Anyone with this file can edit or remove your public summary.",
    record,
    ownerPrivateKeyJwk: await crypto.subtle.exportKey("jwk", kp.privateKey),
  };
  return new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
}

export async function deleteEverything() {
  await del("record", db);
  await del("ownerKeys", db);
}
