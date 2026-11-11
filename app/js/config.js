// CureBranch configuration. Edit these before deploying. No secrets belong here:
// this file is public in the browser.
export const CONFIG = {
  // Where public profile pages live. The patient's address is PUBLIC_BASE + code.
  // Main site: https://curebranch.ai . Profiles: https://my.curebranch.ai/<code> (see docs/deploy.md).
  PUBLIC_BASE: "https://my.curebranch.ai/",

  // Length of the random address code (k7x2m9 = 6). See docs/open-choices.md.
  CODE_LENGTH: 6,

  // SMART on FHIR (hospital portal) connection. Empty = "not set up yet".
  // Get a free client ID by registering a patient-facing app at the EHR's developer
  // program (e.g. Epic's open.epic). The site owner does this; patients never do.
  SMART_CLIENT_ID: "",
  SMART_SCOPE: "openid fhirUser launch/patient patient/*.read offline_access",

  // Web push (opt-in). Needs a VAPID public key and a small push server, neither
  // of which exists yet. Leave empty to keep push as a stub.
  VAPID_PUBLIC_KEY: "",

  // Public tree index. There is no live index yet; the app shows EXAMPLE data.
  PUBLIC_INDEX_URL: "",

  // Plain-English consent video shown on step 1 of the setup guide. Empty = a placeholder
  // box until the real video exists. Host the file on this same site (e.g. "/media/consent.mp4")
  // so it works offline and stays inside the Content-Security-Policy. Captions: a .vtt file.
  // Bump CONSENT_VIDEO_VERSION when the video changes, so people are asked to watch it again.
  CONSENT_VIDEO_URL: "",
  CONSENT_VIDEO_CAPTIONS: "",
  CONSENT_VIDEO_VERSION: "placeholder",

};
