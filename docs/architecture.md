# Architecture

CureBranch is a **static web app** plus an **open data format**. There is no application server and no database of medical records.

```
 Patient's device (browser)                                  Public (only if the patient's switch is ON)
 ┌──────────────────────────────────────────────┐           ┌────────────────────────────────────┐
 │ Import                                        │           │ Public summary  (schema/public-…)  │
 │  • SMART Health Card file / QR text  ──verify─┤           │  random code, coarse facts only,    │
 │  • FHIR Bundle file (unverified)              │           │  signed by the patient's own key    │
 │  • Hospital portal (SMART on FHIR)            │  build +  │                                     │
 │                                               │  sign     │ Profile page  my.curebranch.ai/<code>│
 │ Local record (schema/local-record…)  ─────────┼──────────►│ (anonymous unless patient opts in)  │
 │  stored in IndexedDB, never uploaded          │           │                                     │
 │                                               │           │ Tree = all public summaries          │
 │ Patient's own AI (copy/paste prompt)          │           │  shown: all · counted: verified,     │
 └──────────────────────────────────────────────┘           │  one person one count               │
                                                             └────────────────────────────────────┘
```

## The pieces (all in `app/js/`)

| File | Job | Built on |
|---|---|---|
| `store.js` | Keeps the record and the patient's signing key on the device | IndexedDB via **idb-keyval** |
| `shc.js` | Reads SMART Health Cards and checks the hospital/lab signature | Browser **DecompressionStream** + **Web Crypto** (ES256) |
| `smart.js` | Logs into a hospital portal and pulls records | **fhirclient** (SMART Health IT) |
| `fhir.js` | Pulls coarse facts from FHIR: cancer type, stage, age range, markers, medicines, disease status | Plain functions; mCODE / LOINC / SNOMED / ICD-10 codes |
| `summary.js` | Builds the minimal public summary and signs it | **canonicalize** (RFC 8785) + Web Crypto ECDSA P-256 |
| `tree.js` | Builds the tree and the counts | Plain functions |
| `codes.js` | Random address codes, steward keys, hashing | Web Crypto |
| `update.js`, `pwa.js`, `../sw.js` | Install banner, offline, update flow, web push stub | Service Worker, Push API |
| `a11y.js` | Accessibility panel and read-aloud (from the mockups) | Web Speech API |
| `profile.js` | Public profile page | |

## Data flow

1. **Import.** Files are read in the browser. A SMART Health Card's signature is checked against the issuer's public key, and the issuer must be on `app/data/trusted-issuers.json`. A plain FHIR file is kept but marked **unverified**. A hospital-portal pull is marked **verified (smart-on-fhir)** because the data came straight from the hospital's server after the patient logged in.
2. **Store.** The raw FHIR Bundle is saved, unchanged, in IndexedDB inside the local record.
3. **Summarize.** `fhir.js` reads the bundles with simple matching rules and no AI. The patient sees the result, can change the branch, and picks which parts to include.
4. **Sign.** Each device makes its own ECDSA P-256 key pair. The summary is signed over its canonical JSON. Whoever has the private key (the patient, via a backup file) can update or remove it.
5. **Publish.** Not built yet. Today the patient can download the signed summary. See *open choices*.
6. **Tree.** Every public summary is **shown**. Only `verification.status = "verified"` summaries are **counted**. If two counted summaries share a `personKey`, only the newest counts. Example summaries are never mixed with real ones.

## Privacy rules built into the format

- The public schema has `additionalProperties: false` everywhere, so names, birth dates, record numbers, addresses and free text cannot be added.
- Age is a 10-year band; stage is a roman numeral; dates are years or "months from start".
- A summary is **verified** only if *every* record it was built from is verified.
- When the switch is **private**, the summary shrinks to a removal request (code, key, "Not shared").
- The after-death choice is public; the chosen person's name is **not**. They get a secret key; only its SHA-256 hash is published.
- Profile name/photo appear only if `share.profile` is on. Photos are re-encoded on the device (max 512 px), which strips location and camera data.

## What "verified" means, honestly

- **SMART Health Cards** are cryptographically checkable by anyone, later. In practice today they mostly cover vaccinations and some lab results; full cancer records as SHCs are rare. *(Based on general knowledge of how SHCs are used; worth re-checking.)*
- **SMART on FHIR** pulls come straight from the hospital, but once saved they carry no signature a third party can check later. Counting them means trusting the patient's copy of the app. This is listed in open choices.
- The trust list today contains only an **EXAMPLE** issuer, whose private key was thrown away after signing the example card.

## SMART on FHIR setup (not done)

1. Register a patient-facing app with the EHR's developer program (Epic: open.epic). It's free for patient apps *(general knowledge; confirm current terms)*. Redirect URI: `https://curebranch.ai/`.
2. Put the client ID in `app/js/config.js` (`SMART_CLIENT_ID`). It's public by design; there is no client secret in a browser app.
3. Replace the `prompt()` for the hospital address with a searchable endpoint list.
4. Test against the SMART Health IT sandbox (launch.smarthealthit.org) before any real hospital.

## Hosting

Static files on Cloudflare Pages. See [deploy.md](deploy.md). There are no servers to run unless a public index or push notifications are added.
