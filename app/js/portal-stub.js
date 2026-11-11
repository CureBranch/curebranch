// Stand-in for a real hospital-portal (SMART on FHIR) connection, used until the site owner
// registers a patient app with Epic/Oracle Health and sets CONFIG.SMART_CLIENT_ID.
// No login, no credentials, no network except this site's own EXAMPLE file. Everything it
// returns is made-up EXAMPLE data and is flagged example: true so it is labeled everywhere.
import { portalName } from "./onboarding.js";

/** Build the same source shape a real portal import makes (see smart.js), from an EXAMPLE bundle. */
export function stubPortalSource(bundle, portal, { on = new Date(), id = crypto.randomUUID() } = {}) {
  if (!bundle || bundle.resourceType !== "Bundle") throw new Error("The example records could not be read.");
  return {
    id,
    kind: "smart-on-fhir",
    fileName: `${portalName(portal)} (EXAMPLE demo)`,
    importedAt: on.toISOString(),
    example: true,
    origin: { connectedVia: "demo-stub", portal, portalName: portalName(portal) },
    verification: {
      status: "verified", method: "smart-on-fhir", issuer: "https://example-portal.curebranch.invalid",
      detail: "EXAMPLE demo connection: made-up records, no real portal or login.",
    },
    bundle,
  };
}

export async function stubPortalImport(portal) {
  const bundle = await (await fetch("/data/examples/example-fhir-bundle.json")).json();
  return stubPortalSource(bundle, portal);
}
