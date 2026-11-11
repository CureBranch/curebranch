# Accessibility

Target: **WCAG 2.2 Level AA**. Not formally audited or certified.

## What's built in (carried over from the mockups)
- An accessibility panel on every page with text size up to 200%, fonts (Inter, the system font, OpenDyslexic, Atkinson Hyperlegible, Source Serif), line and letter spacing, high-contrast dark and light themes, two colorblind-safe themes, custom colors with a contrast warning, reduced motion, underlined links, and a bigger focus ring. Settings stay on the device.
- A **Listen** bar on every screen, using the browser's free Web Speech API. It picks the most natural voice the device offers: names with *Natural*, *Neural*, *Premium* or *Enhanced* come first, then voices in the page's language, then on-device voices.
- Skip link, real headings, labeled controls, ARIA switches and tabs (arrow keys move between tabs), focus moves to each screen's heading, and focused fields stay clear of the sticky header and tab bar.
- **Nothing scrolls sideways.** Layouts stack on narrow screens. They are tested at 320, 390, 768 and 1280 px, and at 200% text.

## Testing
`npm run test:browser` runs axe-core (WCAG 2.0, 2.1 and 2.2 A/AA rules) on every screen, in all five themes, at 390 and 1280 px, plus the accessibility panel and the profile page. It also checks every element for sideways overflow. Automated tools catch only part of the problems, so test with a real screen reader (VoiceOver, TalkBack, NVDA) before launch.

## Optional upgrade: Piper (natural on-device voices)
[Piper](https://github.com/OHF-Voice/piper1-gpl) is an open-source, fast, offline neural text-to-speech engine. It could give every device the same natural voice.
- **License caution:** the current Piper engine is **GPL-3.0-or-later** (the older rhasspy/piper was MIT but is archived). Bundling GPL code into `app/` would affect the app's Apache-2.0 licensing, so keep Piper as a separate, optional add-on (for example, a separately licensed web worker package) rather than mixing it into the core.
- **Voice licenses vary.** Each voice's MODEL_CARD has its own license, and some voices (for example those derived from the "lessac" dataset) are not cleared for commercial use. Pick voices whose whole training chain allows it (CC0 or CC BY based).
- Voice files are tens of megabytes, so only download them if the person asks.
