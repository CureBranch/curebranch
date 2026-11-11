// Small helpers built only on the browser's (or Node's) built-in Web Crypto.
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"; // Crockford base32, lower case, no i l o u

/** Random public address code, e.g. "k7x2m9". Never derived from personal data. */
export function randomCode(length = 6) {
  const out = [];
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (const b of bytes) out.push(ALPHABET[b & 31]); // 256 is a multiple of 32, so no bias
  return out.join("");
}

export function b64url(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromB64url(str) {
  const s = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Secret key the patient hands to the person they name for the after-death choice. */
export function newStewardKey() {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  // Grouped for reading aloud / writing down: xxxx-xxxx-...
  const raw = [...bytes].map((b) => ALPHABET[b & 31]).join("");
  return raw.match(/.{1,4}/g).join("-");
}
export async function stewardKeyHash(key) {
  return "sha256:" + (await sha256Hex(key.trim().toLowerCase()));
}

export function todayISO(d = new Date()) {
  return d.toISOString().slice(0, 10);
}
