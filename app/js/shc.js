// SMART Health Cards (https://spec.smarthealth.cards): signed, compressed FHIR bundles
// from hospitals, labs and pharmacies. Checked here with built-in browser features only:
// DecompressionStream (DEFLATE) + Web Crypto (ECDSA P-256). No custom crypto.
import { fromB64url } from "./codes.js";

/** Accepts the text of a .smart-health-card file, a "shc:/..." QR string, or a bare JWS. */
export function extractJwsList(text) {
  const t = String(text).trim();
  if (t.startsWith("{")) {
    const obj = JSON.parse(t);
    if (Array.isArray(obj.verifiableCredential)) return obj.verifiableCredential;
    throw new Error("This JSON is not a SMART Health Card file (no verifiableCredential list).");
  }
  if (/^shc:\//i.test(t)) {
    const digits = t.replace(/^shc:\//i, "");
    if (/^\d+\/\d+\//.test(digits)) throw new Error("Multi-part QR codes are not supported yet. Scan all parts with a SMART Health Card app and export the file.");
    let jws = "";
    for (let i = 0; i + 1 < digits.length; i += 2) jws += String.fromCharCode(Number(digits.slice(i, i + 2)) + 45);
    return [jws];
  }
  if (/^[\w-]+\.[\w-]+\.[\w-]+$/.test(t)) return [t];
  throw new Error("Not a recognised SMART Health Card format.");
}

async function inflateRaw(bytes) {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

/** Decode without checking anything. */
export async function decodeJws(jws) {
  const [h, p, s] = jws.split(".");
  const header = JSON.parse(new TextDecoder().decode(fromB64url(h)));
  const raw = fromB64url(p);
  const payload = JSON.parse(header.zip === "DEF" ? await inflateRaw(raw) : new TextDecoder().decode(raw));
  return { header, payload, signingInput: `${h}.${p}`, signature: fromB64url(s) };
}

async function keysFor(iss, trustList, fetchImpl) {
  const entry = trustList.find((e) => e.iss === iss);
  if (!entry) return { entry: null, keys: [] };
  if (entry.jwks) return { entry, keys: entry.jwks.keys || [] };
  // Spec: issuers publish keys at <iss>/.well-known/jwks.json with CORS enabled.
  const res = await fetchImpl(iss.replace(/\/$/, "") + "/.well-known/jwks.json");
  if (!res.ok) throw new Error("Could not download the issuer's public keys.");
  return { entry, keys: (await res.json()).keys || [] };
}

/**
 * Verify one SMART Health Card JWS.
 * trustList: [{ iss, name, example?, jwks? }]. Only issuers on this list can be "verified".
 * Returns { bundle, issuer, issuerName, example, verification: {status, method, issuer, detail} }.
 */
export async function verifyHealthCard(jws, { trustList = [], fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  const { header, payload, signingInput, signature } = await decodeJws(jws);
  const bundle = payload && payload.vc && payload.vc.credentialSubject && payload.vc.credentialSubject.fhirBundle;
  if (!bundle || bundle.resourceType !== "Bundle") throw new Error("The card has no FHIR Bundle inside.");
  const iss = payload.iss;
  const result = { bundle, issuer: iss, issuerName: null, example: false,
    verification: { status: "unverified", method: "smart-health-card", issuer: iss, detail: "" } };

  if (header.alg !== "ES256") { result.verification.detail = "Unsupported signature type."; return result; }
  if (payload.nbf && payload.nbf * 1000 > now + 60_000) { result.verification.detail = "Card says it is not valid yet."; return result; }

  let found;
  try { found = await keysFor(iss, trustList, fetchImpl); }
  catch (e) { result.verification.detail = e.message; return result; }
  if (!found.entry) {
    result.verification.detail = "The issuer is not on CureBranch's trusted-issuer list, so this card is shown but not counted.";
    return result;
  }
  result.issuerName = found.entry.name || null;
  result.example = !!found.entry.example;
  const jwk = found.keys.find((k) => k.kid === header.kid);
  if (!jwk) { result.verification.detail = "No matching public key from the issuer."; return result; }
  const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
    { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature, new TextEncoder().encode(signingInput));
  if (ok) {
    result.verification.status = "verified";
    result.verification.detail = result.example
      ? "Signature checked against the EXAMPLE issuer key. Example data only; never counted in the real tree."
      : `Signature checked against ${found.entry.name || iss}'s public key.`;
  } else {
    result.verification.detail = "Signature did not match. The file may have been changed.";
  }
  return result;
}
