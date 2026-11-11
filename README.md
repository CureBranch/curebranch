# CureBranch

**An open-source, patient-owned cancer knowledge tree.**

> In honor of my dad, whose son wishes AI had come a few months sooner. Let tomorrow be decided by patients and their own medical records. Here's to you, Dad.

## What it is, in plain English

- **Your records stay with you.** You load your own medical records into the app. They are saved only in your browser, on your device. CureBranch has no server that stores medical records.
- **You decide everything.** One switch makes a tiny summary public or keeps it private. You also choose what happens to that summary after you die, and you name the person who carries it out.
- **No names, ever.** A public summary lives at a random address like `my.curebranch.ai/k7x2m9`. It never includes your name, birthday or record numbers. A name or photo appears only if you turn that on yourself.
- **Only checked records count.** Records signed by a hospital or lab (SMART Health Cards), or pulled straight from a hospital portal (SMART on FHIR), count in the tree's numbers. Everything else is shown but not counted. One person counts once.
- **Bring your own AI.** If you want an AI to read your records, you use your own (Grok, ChatGPT, Claude or any other) and pay for it yourself. CureBranch never runs AI on your data and stores no AI keys.
- **No prize money.** The tree only shares information. Donations go through Open Collective and pay only for servers and outreach (merch, ads, and paid advocates who say they're paid). The code never touches money.
- **Information, not medical advice.** See [DISCLAIMER.md](DISCLAIMER.md).

## What's in this folder

| Path | What it is |
|---|---|
| `app/` | The web app. Plain HTML, CSS and JavaScript, no build step. Installable (PWA) and works offline. |
| `schema/` | The open data format: JSON Schemas for the **public summary** and the **private local record**, plus EXAMPLE files. |
| `docs/` | How it works ([architecture](docs/architecture.md)), [deploying](docs/deploy.md), the [update flow](docs/pwa.md), [accessibility](docs/accessibility.md), [images](docs/images.md), and [open choices](docs/open-choices.md). |
| `tests/` | Unit tests (Node) and browser tests (Playwright + axe-core). |
| `tools/` | Small scripts: copy libraries in, make example data, make icons, stamp a build. |

## Try it on your computer

You need Node.js 20+ and Python 3.

```sh
npm install            # libraries + test tools
npm run serve          # builds dist/ and serves it at http://127.0.0.1:8787
```

Open the app, go to **Import**, and press **Example health card**. Everything shown is made-up EXAMPLE data.

Tests:

```sh
npm test                       # unit tests: schemas, FHIR reading, card signatures, tree counting
pip install playwright && python3 -m playwright install chromium
npm run test:browser           # every screen at 320/390/768/1280 px, axe-core, import flows, offline, update flow
```

## Licenses (and why)

- **Code: Apache License 2.0** ([LICENSE](LICENSE)). Anyone, including companies and hospitals, can use, change and ship it. It includes an explicit patent grant, which matters in health tech, and it matches the licenses of the libraries we use.
- **Data format and example data: CC0 1.0** ([schema/LICENSE-CC0.txt](schema/LICENSE-CC0.txt)). The schema and examples are public domain, so any app, hospital or researcher can adopt the format without asking or giving credit. A data format spreads best with no strings attached. (CC BY 4.0 would require credit; see [docs/open-choices.md](docs/open-choices.md).)
- **Patients' own summaries** belong to the patients. The license a published summary carries is an open choice listed in [docs/open-choices.md](docs/open-choices.md).
- Third-party pieces keep their own licenses: idb-keyval, canonicalize and fhirclient (Apache-2.0), jose (MIT) and js-base64 (BSD-3-Clause) inside the fhirclient bundle; fonts Inter, Fraunces, Atkinson Hyperlegible, Source Serif 4 and OpenDyslexic (SIL Open Font License 1.1). Copies are in `app/vendor/LICENSES/`. axe-core (MPL-2.0) and Ajv (MIT) are used only for testing and are not shipped.

## Built on proven open tools

SMART Health Cards and SMART on FHIR (HL7 FHIR R4, mCODE-style codes), Web Crypto and IndexedDB (built into browsers), the Web Speech API for read-aloud, Cloudflare Pages for static hosting, and Open Collective for donations.

## Support

Donations: Open Collective (link coming), for servers and outreach only, shown publicly.

---

CureBranch contributors. Not affiliated with any hospital, EHR company, or AI company.
