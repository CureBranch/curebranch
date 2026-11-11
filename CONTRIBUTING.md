# Contributing

Thank you for helping. A few ground rules keep CureBranch safe and simple.

## The rules that never bend

1. **Patients decide.** Code may suggest (for example, a branch), but the patient can always change it. No code makes medical judgment calls, ranks treatments, or hides a patient's own data from them.
2. **Raw records never leave the device.** Nothing in `app/` may send a patient's records anywhere. Only the minimal public summary may ever be published, and only when the patient's switch is on.
3. **No names in public data.** Public summaries use random codes. A name or photo appears only if the patient opts in.
4. **Only verified records count.** Unverified data is shown but never counted. One person, one count.
5. **No money in the code.** No payments, prizes or bounties in the app. Donations live on Open Collective.
6. **Nothing scrolls sideways.** Every page must stack on narrow screens. Check 320, 390, 768 and 1280 px, and 200% text.
7. **Accessible by default.** Aim for WCAG 2.2 AA. Every screen keeps its Listen button and works with the accessibility settings.
8. **Reuse before you build.** Prefer proven, maintained libraries with permissive licenses (Apache-2.0, MIT, BSD, OFL for fonts). No GPL code in `app/` (it would change the license of the whole app). No CDNs at runtime: vendor files with `tools/vendor.mjs`.

## How to send a change

1. Run `npm install`, then `npm test` and `npm run test:browser`. Both must pass.
2. Keep pull requests small, and explain the "why" in plain English.
3. If you change the data format, update `schema/`, the examples (`npm run make-examples`), and `docs/architecture.md`.
4. Never commit real patient data, even your own. Use EXAMPLE data only.
5. Don't put personal details (yours or anyone's) in code, comments, or commit messages.

By contributing, you agree your code is licensed under Apache-2.0 and any schema or example changes under CC0 1.0.

## Reporting a security or privacy problem

Please don't open a public issue for something that could expose patient data. Use the project's private security contact (to be listed in SECURITY.md once the project is public).
