# CureBranch data format (v0.1)

Licensed **CC0 1.0** (public domain), see `LICENSE-CC0.txt`. Use it in anything.

| File | What it describes |
|---|---|
| `public-summary.schema.json` | The only thing ever published: random code, coarse facts, verification status, after-death choice, optional opt-in profile, patient's public key and signature. |
| `local-record.schema.json` | Everything kept on the patient's device: raw FHIR R4 Bundles, the privacy switch, the after-death person (private), share choices, edit log. |
| `examples/` | **EXAMPLE DATA only.** A FHIR Bundle (mCODE-style codes), a local record, and a signed public summary. Regenerate with `npm run make-examples`. |

JSON Schema draft 2020-12. Codes follow HL7 FHIR R4 and mCODE where possible (LOINC 69548-6 / 48018-6 / 48005-3 for variants, 97509-4 for disease status, 21908-9 for stage; SNOMED CT and ICD-10 for cancer type). Treat the code mappings in `app/js/fhir.js` as a starting point that needs clinical-informatics review.

Signing: ECDSA P-256 / SHA-256 over the RFC 8785 canonical JSON of the summary without `signature`, encoded base64url (r‖s).
