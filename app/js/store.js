// On-device storage only. IndexedDB via the vendored idb-keyval library (Apache-2.0).
// Nothing in this file talks to a server.
import { get, set, del, keys, delMany, createStore } from "../vendor/idb-keyval.js";
import { newOwnerKeyPair } from "./summary.js";
import { newRecord } from "./record.js";

const db = createStore("curebranch", "local");

export async function loadRecord() { return (await get("record", db)) || null; }

export async function saveRecord(record, what) {
  record.updated = new Date().toISOString();
  if (what) (record.editLog = record.editLog || []).push({ at: record.updated, what });
  await set("record", record, db);
  return record;
}

export { newRecord };

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

/** Photos and files the patient adds: bytes kept in this browser only, under "file:<id>". */
export async function putFile(id, blob) { await set("file:" + id, blob, db); }
export async function getFile(id) { return (await get("file:" + id, db)) || null; }
export async function deleteFile(id) { await del("file:" + id, db); }

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
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
  const files = [];
  for (const f of (record && record.files) || []) {
    const b = await getFile(f.id);
    if (b) files.push({ id: f.id, dataUrl: await blobToDataUrl(b) });
  }
  if (files.length) backup.files = files;
  return new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
}

export async function deleteEverything() {
  await del("record", db);
  await del("ownerKeys", db);
  const fileKeys = (await keys(db)).filter((k) => typeof k === "string" && k.startsWith("file:"));
  if (fileKeys.length) await delMany(fileKeys, db);
}
