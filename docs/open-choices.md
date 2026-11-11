# Open choices

These are decisions for the project owner. Each lists the real options and their tradeoffs. Nothing here is decided by the code.

## 1. Where public summaries live (the "public index")
Today nothing is published; patients can download their signed summary.

| Option | Good | Not so good |
|---|---|---|
| A public Git repo of JSON files, added by pull request | Free, transparent history, forkable | Needs a GitHub account per patient or a bot to submit; slower |
| Cloudflare Worker + R2 or D1 storage | Instant, cheap at small scale, same vendor as hosting | A small server to maintain; costs grow with use |
| IPFS (content-addressed files) | Hard to censor, no single owner | Removal is not guaranteed; pinning costs; slower |
| No central index: each patient hosts their own file | Zero cost to the project | Hard to find and count; most patients can't host |

## 2. One person, one count (`personKey`)
Signed records prove a hospital issued them, not that the same person hasn't uploaded twice.

| Option | Good | Not so good |
|---|---|---|
| No dedup key (today) | Simple, private | Duplicates can be counted |
| Hash of (issuer + hospital patient ID) | Catches repeat uploads of the same hospital's records | A plain hash can be guessed and could link a person across uploads; misses the same person at two hospitals |
| Keyed hash done by a small server with a secret | Not guessable | Needs a server and trust in it |
| Identity check (ID.me, CLEAR, etc.) | Strong | Costs money, adds a company in the middle, less anonymous |

## 3. Should SMART on FHIR pulls count as "verified"?
They come straight from the hospital, but can't be re-checked later by others.
- **Count them** (today): many more people can take part, since few hospitals issue cancer SHCs. Weaker against fakes.
- **Show but don't count**: strongest. Very few people would be counted at first.
- **Count with a separate label**: honest middle ground; more complex tree.

## 4. Trusted issuer list
- Use the public **VCI directory** of SMART Health Card issuers *(general knowledge; confirm it is still maintained)*: ready-made, but mostly vaccination issuers.
- Keep our own list: full control, more work.

## 5. License for published patient summaries
- **CC0** (public domain): most reusable; patients give up all control of copies.
- **CC BY 4.0**: reusers must credit "CureBranch contributors"; slightly less reuse.
- **No license stated**: legally murky for researchers.
(The code license, Apache-2.0, and the format license, CC0, are set; this is only about patients' own data.)

## 6. Address code length
- **6 characters** (like `k7x2m9`, today): about 1 billion codes. Fine for millions of patients, but the index must reject duplicates at publish time.
- **8 characters**: about 1 trillion; collisions basically never happen; a bit harder to read aloud.

## 7. Default for the share checkboxes
Today no sharing level is preselected (nothing is shared until the patient picks one of the 4 levels), and at any public level every coarse fact is included except contact and profile. Option: start with every box unchecked. That's more cautious, but people may publish empty summaries.

## 8. Treatments other than medicines
Surgery and radiation (FHIR `Procedure`) aren't read yet. Adding them makes the tree richer, but procedure codes vary a lot between hospitals.

## 9. Consent video
The mockup had a short recorded consent clip. Options: build it (camera, local storage, hash + timestamp); replace with a typed statement; or skip. Video is the strongest proof but also the most personal data to keep. **Update:** the setup guide now has a slot for a plain-English video that the patient *watches* (`CONSENT_VIDEO_URL`), plus an "I watched and understand" box. It stores the time and video version, but no recording of the patient. The video itself still needs to be made.

## 10. Direct AI connection
Today patients copy a prompt into their own AI. Option: let them paste an API key to call their AI from the browser. Easier for them, but then their key sits in the browser, and CureBranch would need per-provider code.

## 10b. Demo portal and supporting-photo check
Until a SMART client ID exists, the guide's **Connect** runs a demo stub with made-up EXAMPLE records (marked verified so the flow can be shown). The supporting-photo check is simple text and date matching against the linked record (with 1 day of leeway on dates), not AI or OCR. Open questions: should mismatched photos be hidden as well as ignored by AI, and should the check also read the photo itself (OCR, on the device)?

## 10c. What "Full public (everything)" includes
Level 4 adds city, state and country, plus full treatment details. It still leaves out name, birthday, street address, postal code, phone, email and record numbers, because those identify a person directly and aren't needed for matching. A name and photo can still appear through the separate profile switch. Open question: should Full also allow a birthday or postal code if the patient asks for it?

## 10d. Recognition network
The "helped" counter, the glow and the thank-you notes run on a local stub until a shared network exists. Open questions: who runs the note relay, and how to stop spam without accounts (for example rate limits per signed key)?

## 11. Website vs app on one domain
Today the app is at the root of `curebranch.ai`. Options: website at `curebranch.ai` and app at `app.curebranch.ai` (clean split, two projects), or one project with the app under `/app` (one deploy, slightly more routing).

## 12. Push notifications
Wired as a stub. Turning them on needs VAPID keys and a small push server (for example a Cloudflare Worker) that stores subscriptions. That's a server holding device tokens, so it's a privacy decision as well as a cost one.
