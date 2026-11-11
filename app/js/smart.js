// SMART on FHIR (hospital patient portals such as MyChart) using the official
// SMART Health IT client library 'fhirclient' (Apache-2.0), vendored in /vendor.
// STATUS: wired but untested against a real hospital. Needs CONFIG.SMART_CLIENT_ID,
// which the site owner gets by registering a free patient-facing app (e.g. open.epic).
import { CONFIG } from "./config.js";

function loadLib() {
  if (window.FHIR) return Promise.resolve(window.FHIR);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/vendor/fhir-client.min.js";
    s.onload = () => resolve(window.FHIR);
    s.onerror = () => reject(new Error("Could not load the SMART on FHIR library."));
    document.head.appendChild(s);
  });
}

/** Starts the portal login. The patient's browser goes to the hospital and comes back. */
export function startSmartConnect() {
  if (!CONFIG.SMART_CLIENT_ID) return { notSetUp: true };
  // TODO(UI): replace with a searchable list of hospital endpoints (Epic publishes one).
  const iss = window.prompt("Your hospital's FHIR address (your hospital or the open.epic endpoint list has it):");
  if (!iss) return { cancelled: true };
  loadLib().then((FHIR) => FHIR.oauth2.authorize({
    clientId: CONFIG.SMART_CLIENT_ID, scope: CONFIG.SMART_SCOPE, iss, redirectUri: location.origin + "/",
  }));
  return { started: true };
}

/** If we just came back from the portal, pull the records and return a source object. */
export async function finishSmartConnectIfReturning() {
  const q = new URLSearchParams(location.search);
  if (!q.has("code") || !q.has("state") || !CONFIG.SMART_CLIENT_ID) return null;
  const FHIR = await loadLib();
  const client = await FHIR.oauth2.ready();
  const pid = client.patient.id;
  const opts = { pageLimit: 0, flat: true };
  const queries = [`Patient/${pid}`, `Condition?patient=${pid}`, `Observation?patient=${pid}&category=laboratory`,
    `MedicationRequest?patient=${pid}`, `MedicationStatement?patient=${pid}`];
  const resources = [];
  for (const q2 of queries) {
    try { const r = await client.request(q2, opts); resources.push(...(Array.isArray(r) ? r : [r])); }
    catch { /* some servers don't support every resource type; skip */ }
  }
  history.replaceState(null, "", location.pathname + location.hash);
  return {
    id: crypto.randomUUID(), kind: "smart-on-fhir", fileName: "Hospital portal", importedAt: new Date().toISOString(),
    verification: { status: "verified", method: "smart-on-fhir", issuer: client.state.serverUrl,
      detail: "Pulled directly from your hospital's server after you logged in." },
    bundle: { resourceType: "Bundle", type: "collection", entry: resources.filter((r) => r && r.resourceType).map((resource) => ({ resource })) },
  };
}
