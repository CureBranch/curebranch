# CureBranch

**An open-source, patient-owned cancer knowledge tree.**

[How it started](docs/how-it-started.md), and how it all works, in plain English.

## What it is, in plain English

- **Your records stay with you.** You load your own medical records into the app. They are saved only in your browser, on your device. CureBranch has no server that stores medical records.
- **You decide everything.** You pick one of 4 sharing levels: Private (device only), Basic public summary, Detailed public, or Full public. Nothing is preselected. Moving to a lower level stops sharing from then on, and the app says plainly that what was already shared stays out there. You also choose what happens to that summary after you die, and you name the person who carries it out.
- **No names, ever.** A public summary lives at a random address like `my.curebranch.ai/k7x2m9`. It never includes your name, birthday or record numbers. A name or photo appears only if you turn that on yourself.
- **Only checked records count.** Records signed by a hospital or lab (SMART Health Cards), or pulled straight from a hospital portal (SMART on FHIR), count in the tree's numbers. Everything else is shown but not counted. One person counts once.
- **Bring your own AI.** If you want an AI to read your records, you use your own (ChatGPT, Claude, Gemini or any other) and pay for it yourself. CureBranch never runs AI on your data and stores no AI keys.
- **No money involved.** No prizes, no fees, no donations. The tree only shares information, and the code never touches money.
- **Information, not medical advice.** See [DISCLAIMER.md](DISCLAIMER.md).

## First-run setup guide

The home page explains what CureBranch is and has a **Create your branch** button. That button opens a full-screen guide in 3 steps, with big buttons, Back and Next, progress dots, and a Listen button on every step. Every answer is saved on the device right away. If they close the app after starting, they come back to the same step, and they can run the guide again from **Settings**. There's no account and no password.

1. **Get started.** A slot for the plain-English consent video (`CONSENT_VIDEO_URL` in `app/js/config.js`; a placeholder until it exists), the main points of the disclaimer, an "I watched and understand" box that must be ticked, and a random private code like `k7x2m9`, kept on this device.
2. **Your records.** Connect your hospital portal: records come only from official sources (SMART on FHIR portals such as MyChart), marked verified. Until `SMART_CLIENT_ID` is set, **Connect** runs a demo stub (`app/js/portal-stub.js`) that adds made-up EXAMPLE records, with no login and no real data. Photos and files can only be attached to an official record, are labeled "supporting, from patient", and are never counted. The patient can say what a photo shows (date, test type, key results). `app/js/consistency.js` checks that against the linked record and sets `matchStatus` to `matches`, `mismatch` or `unchecked`. A mismatch gets a plain-English flag and `ignoreForAiMatching: true`. Portal connect can be skipped. Then, how much to share: 4 levels, nothing preselected, with "only share what you'd be OK with the world knowing someday". Picking a public level, or moving down, shows a plain warning first. If they skip the sharing choice, nothing is shared.
3. **Your choices.** After you're gone: keep private, delete, make public, or let the person decide, plus the trusted person's name (kept on this device only). This choice is required. Then, your own AI (optional guided steps; CureBranch never asks for or stores AI keys), and a summary of every choice, all changeable in Settings.

Progress and answers are stored in the local record (`onboarding`, `files`, and `sources[].origin` in `schema/local-record.schema.json`).

## Sharing levels

There are 4 levels, picked in the setup guide or in **Settings** (`app/js/privacy.js`, `app/js/privacy-ui.js`). Nothing is preselected, and until the patient picks a level nothing is shared.

1. **Private**: only on the device.
2. **Basic public summary**: cancer type, stage group, 10-year age range, markers, treatment names and start year, and "months from start" results.
3. **Detailed public**: adds exact age, exact stage (for example "Stage IIIA"), and the dates of the diagnosis, treatments and results.
4. **Full public**: adds city, state and country, plus treatment end dates, status and dose text.

No level ever includes name, birthday, street, postal code, phone, email or record numbers. Picking level 2 to 4 shows a plain warning first, and nothing changes until the patient taps **Yes**. Moving to a lower level stops sharing from then on. The app says, before and after the move, that what was already published at the higher level stays out there and can't be pulled back. `privacy.highestShared` and `privacy.history` keep track of this.

## Patient recognition

The recognition features are on the patient's own profile page (`/p/<code>#recognition`, `app/js/recognition.js`). Everything is off until the patient turns it on, and the public page shows only the random code unless they choose more.

- **"Your branch helped"**: how many other patients were matched using their data.
- **Their branch on the tree**: it glows when someone lands near it.
- **Badges**: First record shared, Verified records, Helped 10 people, and Founding branch (first 1,000).
- **Share card**: a one-tap picture (canvas PNG, shared with the Web Share API, or downloaded where that isn't available).
- **Thank-you notes**: anonymous "this helped me" notes, up to 280 characters, with no links, emails or phone numbers.

There's no shared network yet. The numbers come from `app/js/recognition-source.js`, a local stub that works them out from the EXAMPLE tree and labels them as examples, and sent notes stay on the device. A future network source only has to provide the same three calls: `stats`, `inbox` and `sendNote`.

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
npm run test:browser           # every screen and setup-guide step at 320/390/768/1280 px, axe-core, import + guide flows, offline, update flow
```

## Licenses (and why)

- **Code: Apache License 2.0** ([LICENSE](LICENSE)). Anyone, including companies and hospitals, can use, change and ship it. It includes an explicit patent grant, which matters in health tech, and it matches the licenses of the libraries we use.
- **Data format and example data: CC0 1.0** ([schema/LICENSE-CC0.txt](schema/LICENSE-CC0.txt)). The schema and examples are public domain, so any app, hospital or researcher can adopt the format without asking or giving credit. A data format spreads best with no strings attached. (CC BY 4.0 would require credit; see [docs/open-choices.md](docs/open-choices.md).)
- **Patients' own summaries** belong to the patients. The license a published summary carries is an open choice listed in [docs/open-choices.md](docs/open-choices.md).
- Third-party pieces keep their own licenses: idb-keyval, canonicalize and fhirclient (Apache-2.0), jose (MIT) and js-base64 (BSD-3-Clause) inside the fhirclient bundle; Primer Primitives and Octicons (MIT); fonts Mona Sans, Atkinson Hyperlegible, Source Serif 4 and OpenDyslexic (SIL Open Font License 1.1); the home photo "Through the leaves" (CC0, see `app/img/CREDITS.txt`). Copies are in `app/vendor/LICENSES/`. axe-core (MPL-2.0) and Ajv (MIT) are used only for testing and are not shipped.

## Built on proven open tools

SMART Health Cards and SMART on FHIR (HL7 FHIR R4, mCODE-style codes), Web Crypto and IndexedDB (built into browsers), the Web Speech API for read-aloud, and Cloudflare Pages for static hosting.

## Support

CureBranch takes no donations and involves no money. (The public website footer has a personal Buy Me a Coffee tip link for the creator; it is not part of the project or this app.)

---

CureBranch contributors. Not affiliated with any hospital, EHR company, or AI company.
