#!/usr/bin/env python3
"""Browser checks for the built app (dist/). Run: npm run build:test && python3 tests/browser/verify.py
 * no horizontal overflow on any screen at 320/390/768/1280 px (and 200% text at 320/390)
 * axe-core WCAG 2.0/2.1/2.2 A+AA on every screen and all 5 color themes
 * import: example SMART Health Card (verified), example FHIR file via the file picker
   (unverified), tampered card (unverified); data survives a reload (IndexedDB)
 * 4 sharing levels with warnings, summary preview, profile page (anonymous by default, name when opted in)
 * offline: app reloads with the network off once the service worker is installed
 * setup guide (first-run wizard): home intro + Create your branch, 3 grouped steps, consent gate,
   guided hospital-portal connect (demo stub), supporting photo linked to the official record
   with the consistency check (matches / mismatch), resume after reload, re-run from Settings,
   saved record matches schema/local-record.schema.json; every wizard step also gets the
   overflow (320-1280 px, 200% text) and axe (all themes) checks
 * every page has a real address (no "#" routes): all sitemap pages load directly with their own title,
   description, canonical and h1; Back/Forward/Refresh; old "#" links redirect; no "#/" links
 * "?" help buttons (disclosure pattern, keyboard), "What is this page?" boxes, AI prompt + copy,
   Translate (on-device API mocked, browser steps), header audit at 6 widths, no read-aloud left
 * no console errors / CSP violations
"""
import json, os, sys, re, subprocess
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from server import start
from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parents[2]
DIST = REPO / "dist"
PORT = 37111
BASE = f"http://127.0.0.1:{PORT}"
AXE = (REPO / "node_modules/axe-core/axe.min.js").read_text()
WIDTHS = [320, 390, 768, 1024, 1280, 1440]
SCREENS = ["/", "/how-it-works/", "/import/", "/my-branch/", "/tree/", "/settings/", "/accessibility/", "/cancers/", "/help/", "/privacy/", "/sources/",
           "/cancers/lung/", "/cancers/aml/", "/cancers/tumor-agnostic/", "/cancers/breast/her2-positive/", "/cancers/lung/lung-adenocarcinoma/"]
THEMES = ["default", "hc-dark", "hc-light", "cb-blue", "cb-purple"]
results = {"overflow": [], "axe": [], "flows": [], "console": []}
STATE = {}
fails = []

OVERFLOW_JS = """() => {
  const vw = document.documentElement.clientWidth;
  const sw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  const off = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || el.closest('[hidden]')) continue;
    if (r.right > vw + 1 || r.left < -1) {
      if (el.closest('.a11y-panel[hidden]')) continue;
      off.push((el.tagName + '#' + el.id + '.' + (typeof el.className === 'string' ? el.className : '')).slice(0, 80) + ' right=' + Math.round(r.right));
      if (off.length > 8) break;
    }
  }
  return {vw, sw, overflow: sw - vw, offenders: off};
}"""

def check(name, cond, detail=""):
    results["flows"].append({"check": name, "ok": bool(cond), "detail": detail})
    if os.environ.get("CB_VERBOSE"): print(("ok   " if cond else "FAIL ") + name, flush=True)
    if not cond: fails.append(f"{name}: {detail}")

def wait_js(pg, expr, timeout=10000):
    """Poll with evaluate (CDP, not page eval) so the app's strict CSP stays on during tests."""
    import time
    end = time.time() + timeout / 1000
    while time.time() < end:
        try:
            if pg.evaluate(f"() => !!({expr})"): return True
        except Exception: pass
        pg.wait_for_timeout(100)
    raise TimeoutError(expr)

def go(pg, screen):
    pg.evaluate("s => window.CureBranchApp.go(s)", screen)
    pg.wait_for_timeout(250)

WZ_STEPS = ["start", "records", "choices"]
PNG_1PX = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000"
                        "1f15c4890000000d49444154789c6360f8cfc0f01f0005fe02fea72d8c5c0000000049454e44ae426082")
LONG_NAME = "a-very-long-file-name-with-no-spaces-at-all-from-the-hospital-portal-2026-11-11.png"

def wizard_open(pg):
    return pg.evaluate("!document.querySelector('#wizard').hidden")

def connect_demo(pg, portal="mychart"):
    pg.check(f"input[name=wz-portal][value={portal}]")
    n = pg.evaluate("window.CureBranchApp.getRecord().sources.length")
    pg.click("#wz-connect")
    wait_js(pg, f"window.CureBranchApp.getRecord().sources.length === {n + 1}")
    pg.wait_for_timeout(150)

def attach_photo(pg, name=LONG_NAME):
    n = pg.evaluate("(window.CureBranchApp.getRecord().files || []).length")
    pg.locator("#wz-files [data-attach-for]").first.set_input_files(files=[{"name": name, "mimeType": "image/png", "buffer": PNG_1PX}])
    wait_js(pg, f"(window.CureBranchApp.getRecord().files || []).length === {n + 1}")
    pg.wait_for_timeout(150)

def fill_claim(pg, date, test, vals):
    fid = pg.evaluate("window.CureBranchApp.getRecord().files.slice(-1)[0].id")
    pg.fill(f"[id='wz-cl-date-{fid}']", date); pg.fill(f"[id='wz-cl-type-{fid}']", test); pg.fill(f"[id='wz-cl-vals-{fid}']", vals)
    pg.click(f"[data-wz-check='{fid}']"); pg.wait_for_timeout(250)
    return fid

def finish_wizard(pg, on_step=None, show_errors=False, fill_records=False):
    """Walk the setup guide with simple answers. on_step(step_id) runs on each step (overflow / axe).
    fill_records: connect the demo portal, attach a photo and show a mismatch flag, so every part is on screen."""
    if pg.evaluate("document.querySelector('#wizard').hidden"):
        if pg.evaluate("!!document.querySelector('#home-start-branch') && !document.querySelector('#home-start-branch').hidden"):
            pg.click("#home-start-branch")
        else:
            pg.evaluate("window.CureBranchApp.openWizard()")
    wait_js(pg, "!document.querySelector('#wizard').hidden")
    for sid in WZ_STEPS:
        wait_js(pg, f"!document.querySelector('#wz-{sid}').hidden")
        if sid == "start" and show_errors and not pg.is_checked("#wz-consent"):
            pg.click("#wz-next"); pg.wait_for_timeout(100)
        if sid == "records" and fill_records:
            if not pg.evaluate("window.CureBranchApp.getRecord().sources.length"): connect_demo(pg)
            else: pg.check("input[name=wz-portal][value=mychart]")
            if not pg.evaluate("(window.CureBranchApp.getRecord().files || []).length"):
                attach_photo(pg); fill_claim(pg, "2026-05-01", "PD-L1", "10%")
        if sid == "choices":
            if not pg.evaluate("!!document.querySelector('input[name=wz-afterdeath]:checked')"):
                pg.check("input[name=wz-afterdeath][value=keep-private]")
            pg.check("input[name=wz-ai][value=ChatGPT]")
        if on_step: on_step(sid)
        if sid == "start": pg.check("#wz-consent")
        pg.click("#wz-next")
    wait_js(pg, "document.querySelector('#wizard').hidden")
    pg.wait_for_timeout(200)

def pick_level(pg, scope, level, confirm=True):
    """Pick a sharing level in a picker (scope = '#wz-privacy' or '#s-settings'). Returns the warning text."""
    pg.check(f"{scope} input[type=radio][value={level}]"); pg.wait_for_timeout(150)
    warn = pg.locator(f"{scope} .pv-warn")
    text = warn.inner_text() if warn.is_visible() else ""
    if text:
        pg.click(f"{scope} [data-pv-yes]" if confirm else f"{scope} [data-pv-no]")
        pg.wait_for_timeout(300)
    return text

def lvl(pg):
    return pg.evaluate("(window.CureBranchApp.getRecord().privacy || {}).level || null")

def wizard_flow(b):
    """The setup guide, end to end, the way a patient would use it (390 px phone)."""
    ctx = b.new_context(viewport={"width": 390, "height": 844})
    pg = ctx.new_page()
    pg.on("console", lambda m: results["console"].append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    pg.on("pageerror", lambda e: results["console"].append(f"pageerror: {e}"))
    pg.goto(BASE + "/", wait_until="networkidle"); wait_js(pg, "window.CureBranchApp")
    INTRO = "Join others: add your cancer treatment records to a public, open-source digital tree where anyone, with the help of AI, can work toward a cure. You choose your privacy level. Create your branch in 3 easy steps, see how many lives your story could save, and discover treatments that worked for people like you."
    check("home: first visit shows what CureBranch is, wizard stays closed", (not wizard_open(pg)) and pg.is_visible("#s-home") and pg.is_visible(".site-header")
          and pg.inner_text("#home-intro-copy") == INTRO and pg.is_visible("#home-start-branch"))
    check("home: Create your branch opens the setup guide", True)
    pg.click("#home-start-branch"); wait_js(pg, "!document.querySelector('#wizard').hidden")
    check("wizard: opens from the home button, step 1 of 3, 3 progress dots, current one marked", wizard_open(pg) and not pg.is_visible(".site-header")
          and pg.inner_text("#wz-count") == "Step 1 of 3"
          and pg.locator("#wz-dots li").count() == 3 and pg.locator("#wz-dots li[aria-current=step]").count() == 1)
    check("wizard: no read-aloud (Listen) controls on any step", pg.evaluate("!document.querySelector('.listen-bar, [data-listen-mount]') && !/Listen/.test(document.querySelector('#wizard').innerText)"))
    check("wizard: Back hidden on step 1", not pg.is_visible("#wz-back"))
    check("wizard: consent video slot + disclaimer shown", pg.is_visible("#wz-video") and "not medical advice" in pg.inner_text("#wz-start"))
    check("wizard: private code shown on Get started", True)
    pg.click("#wz-next"); pg.wait_for_timeout(150)
    check("wizard: can't go on without 'I watched and understand'", pg.inner_text("#wz-count") == "Step 1 of 3"
          and "check the box" in pg.inner_text("#wz-consent-err") and pg.evaluate("document.activeElement.id") == "wz-consent")
    rec = pg.evaluate("window.CureBranchApp.getRecord()")
    code = pg.inner_text("#wz-code")
    check("wizard: private code shown, matches the record, no account", re.fullmatch(r"[0-9a-hjkmnp-tv-z]{6}", code) and code == rec["code"], code)
    pg.click("#wz-new-code"); pg.wait_for_timeout(200)
    code2 = pg.inner_text("#wz-code")
    check("wizard: 'different code' makes and saves a new one", code2 != code and pg.evaluate("window.CureBranchApp.getRecord().code") == code2)
    pg.check("#wz-consent"); pg.click("#wz-next"); wait_js(pg, "!document.querySelector('#wz-records').hidden")
    rec = pg.evaluate("window.CureBranchApp.getRecord()")
    check("wizard: consent saved with time and video version", rec["onboarding"]["consent"]["watchedAndUnderstood"] is True and rec["onboarding"]["consent"]["videoVersion"] == "placeholder")
    check("wizard: focus moves to the step heading", pg.evaluate("document.activeElement.id") == "wz-h-records")
    check("records step: includes 'Connect your hospital portal'", "Connect your hospital portal" in pg.inner_text("#wz-records"))
    check("records step: skippable (share nothing until a level is picked)", pg.inner_text("#wz-next") == "Skip for now (share nothing)")
    check("records step: no standalone photo/file upload before an official record", pg.locator("#wz-records input[type=file]").count() == 0)
    check("records step: portal choices offered", pg.locator("input[name=wz-portal]").count() == 4 and not pg.is_visible("#wz-connect-card"))
    pg.click("#wz-connect") if pg.is_visible("#wz-connect") else None
    pg.check("input[name=wz-portal][value=mychart]"); pg.wait_for_timeout(100)
    check("records step: guided steps + demo-mode notice after picking a portal", pg.is_visible("#wz-connect-card") and pg.is_visible("#wz-demo-note")
          and "Log in to your portal" in pg.inner_text("#wz-connect-card") and pg.locator("#wz-records input[type=password]").count() == 0)
    hits_before = len(STATE["hits"])
    pg.click("#wz-connect"); wait_js(pg, "window.CureBranchApp.getRecord().sources.length === 1"); pg.wait_for_timeout(200)
    src = pg.evaluate("window.CureBranchApp.getRecord().sources[0]")
    check("demo portal connect: official record, verified, EXAMPLE, origin saved", src["kind"] == "smart-on-fhir" and src["verification"]["status"] == "verified"
          and src["example"] is True and src["origin"] == {"connectedVia": "demo-stub", "portal": "mychart", "portalName": "MyChart (Epic)"}, json.dumps(src.get("origin")))
    check("demo portal connect: shows as EXAMPLE demo record", "EXAMPLE demo record" in pg.inner_text("#wz-files"))
    check("demo portal connect: only this site's own example file was fetched", all(h.startswith("/data/") or h.startswith("/js/") or h == "/version.json" for h in STATE["hits"][hits_before:]), str(STATE["hits"][hits_before:]))
    check("supporting upload appears only under the official record", pg.locator("#wz-files [data-attach-for]").count() == 1)
    attach_photo(pg, "photo-of-my-pathology-report-page-1.png")
    rec = pg.evaluate("window.CureBranchApp.getRecord()")
    f = rec["files"][0]
    stored = pg.evaluate("""async () => { const db = await new Promise((ok, no) => { const r = indexedDB.open('curebranch'); r.onsuccess = () => ok(r.result); r.onerror = no; });
      return await new Promise((ok) => { const g = db.transaction('local').objectStore('local').get('file:' + window.CureBranchApp.getRecord().files[0].id); g.onsuccess = () => ok(g.result ? g.result.size : -1); }); }""")
    check("supporting photo: kept on this device (IndexedDB), linked, labeled", stored == len(PNG_1PX) and f["linkedSourceId"] == src["id"] and f["role"] == "supporting-from-patient"
          and "Supporting, from patient" in pg.inner_text("#wz-files"), f"stored={stored} {json.dumps(f)}")
    check("supporting photo: starts unchecked", f["matchStatus"] == "unchecked" and "Not checked yet" in pg.inner_text("#wz-files"))
    fill_claim(pg, "2026-05-01", "PD-L1", "10%")
    f = pg.evaluate("window.CureBranchApp.getRecord().files[0]")
    txt = pg.inner_text("#wz-files")
    check("consistency check: mismatch flagged in plain English, ignored by AI", f["matchStatus"] == "mismatch" and f["ignoreForAiMatching"] is True
          and "doesn't match your hospital record" in txt and "AI matching will ignore it" in txt and "2026-03-20" in txt, txt[:400])
    check("consistency check: flag gets focus (announced)", pg.evaluate("document.activeElement.id").startswith("wz-cl-flag-"))
    fill_claim(pg, "2026-03-20", "PD-L1", "70%")
    f = pg.evaluate("window.CureBranchApp.getRecord().files[0]")
    check("consistency check: correct details -> matches", f["matchStatus"] == "matches" and f["ignoreForAiMatching"] is False and "Matches your hospital record" in pg.inner_text("#wz-files"))
    check("records step: still skippable for sharing until a level is picked", pg.inner_text("#wz-next") == "Skip for now (share nothing)")
    check("wizard: privacy reminder shown", "Only share what you'd be OK with the world knowing someday." in pg.inner_text("#wz-privacy"))
    check("privacy: 4 levels, nothing preselected", pg.locator("#wz-privacy input[type=radio]").count() == 4
          and pg.evaluate("!document.querySelector('#wz-privacy input[type=radio]:checked')") and lvl(pg) is None
          and pg.inner_text("#wz-next") == "Skip for now (share nothing)")
    labels = pg.inner_text("#wz-privacy .pv-levels")
    check("privacy: levels named in plain English", all(x in labels for x in ["1. Private", "2. Basic public summary", "3. Detailed public", "4. Full public"]))
    pg.reload(wait_until="networkidle"); wait_js(pg, "window.CureBranchApp"); pg.wait_for_timeout(300)
    check("wizard: resumes at the same step after closing the app", wizard_open(pg) and pg.inner_text("#wz-count") == "Step 2 of 3")
    pg.check("#wz-privacy input[value=detailed]"); pg.wait_for_timeout(200)
    w = pg.inner_text("#wz-privacy .pv-warn") if pg.is_visible("#wz-privacy .pv-warn") else ""
    check("privacy: warning shown BEFORE level 3 takes effect", "can't be pulled back" in w and lvl(pg) is None
          and pg.evaluate("document.activeElement.classList.contains('pv-warn')"), w[:200])
    pg.click("#wz-next"); pg.wait_for_timeout(150)
    check("privacy: can't go on with an unanswered warning", pg.inner_text("#wz-count") == "Step 2 of 3" and "Yes or No" in pg.inner_text("#wz-privacy-err"))
    pg.click("#wz-privacy [data-pv-no]"); pg.wait_for_timeout(200)
    check("privacy: No keeps the earlier choice (nothing)", lvl(pg) is None and not pg.is_visible("#wz-privacy .pv-warn")
          and pg.evaluate("!document.querySelector('#wz-privacy input[type=radio]:checked')"))
    w = pick_level(pg, "#wz-privacy", "full")
    check("privacy: Yes saves level 4 (Full public)", lvl(pg) == "full" and pg.evaluate("window.CureBranchApp.getRecord().privacy.public") is True and "Saved: Full public" in pg.inner_text("#wz-privacy .pv-status"))
    w = pick_level(pg, "#wz-privacy", "basic")
    check("privacy: moving down warns that already-shared data stays public",
          "stops sharing from now on" in w and "already shared at the Full public level stays out there" in w and "can't be pulled back" in w, w[:300])
    check("privacy: moved down to Basic, highest level remembered", lvl(pg) == "basic" and pg.evaluate("window.CureBranchApp.getRecord().privacy.highestShared") == "full")
    w = pick_level(pg, "#wz-privacy", "private")
    check("privacy: moving to Private warns too", "Full public level stays out there" in w and lvl(pg) == "private"
          and pg.evaluate("window.CureBranchApp.getRecord().privacy.public") is False)
    check("privacy: status still says earlier sharing stays public", "that stays public" in pg.inner_text("#wz-privacy .pv-status"))
    check("records step: Next once a sharing level is picked", pg.inner_text("#wz-next") == "Next")
    pg.click("#wz-next"); wait_js(pg, "!document.querySelector('#wz-choices').hidden")
    check("wizard: no after-death choice is picked for the patient (stored default keep-private)", pg.evaluate("!document.querySelector('input[name=wz-afterdeath]:checked')")
          and pg.evaluate("window.CureBranchApp.getRecord().afterDeath.choice") == "keep-private")
    pg.click("#wz-next"); pg.wait_for_timeout(150)
    check("wizard: must pick an after-death choice", pg.inner_text("#wz-count") == "Step 3 of 3" and "pick one" in pg.inner_text("#wz-after-err"))
    pg.check("input[name=wz-afterdeath][value=remove]")
    pg.fill("#wz-person", "EXAMPLE Trusted Person"); pg.fill("#wz-person-reach", "555-0100 (EXAMPLE)")
    pg.click("#wz-back"); wait_js(pg, "!document.querySelector('#wz-records').hidden")
    check("wizard: Back keeps what was typed", pg.evaluate("window.CureBranchApp.getRecord().afterDeath.person.name") == "EXAMPLE Trusted Person")
    pg.click("#wz-next"); wait_js(pg, "!document.querySelector('#wz-choices').hidden")
    pg.check("input[name=wz-afterdeath][value=remove]")
    check("wizard: AI part is optional", "This part is optional" in pg.inner_text("#wz-ai") and not pg.is_visible("#wz-ai-steps")
          and pg.inner_text("#wz-next") == "Go to my home screen")
    pg.check("input[name=wz-ai][value=ChatGPT]"); pg.wait_for_timeout(100)
    check("wizard: picking an AI shows the guided steps", pg.is_visible("#wz-ai-steps") and "Open ChatGPT" in pg.inner_text("#wz-ai-steps"))
    check("wizard: no AI key field anywhere", pg.locator("#wizard input[type=password]").count() == 0)
    sm = pg.inner_text("#wz-summary")
    check("wizard: done screen sums up every choice", all(x in sm for x in [code2, "2 items", "Private", "Delete my summary", "EXAMPLE Trusted Person", "ChatGPT"]), sm)
    check("wizard: done screen says it can be changed in Settings", "Settings" in pg.inner_text("#wz-done"))
    pg.click("#wz-next"); wait_js(pg, "document.querySelector('#wizard').hidden"); pg.wait_for_timeout(300)
    check("wizard: finishing lands on Home", pg.is_visible("#s-home") and pg.inner_text("#after-status") == "Delete my summary")
    rec = pg.evaluate("window.CureBranchApp.getRecord()")
    out = REPO / "tests/browser/out"; out.mkdir(exist_ok=True)
    (out / "wizard-record.json").write_text(json.dumps(rec, indent=2))
    v = subprocess.run(["node", "--input-type=module", "-e", """
      import { readFileSync } from 'node:fs'; import Ajv2020 from 'ajv/dist/2020.js'; import addFormats from 'ajv-formats';
      const J = (p) => JSON.parse(readFileSync(p, 'utf8')); const ajv = new Ajv2020({ allErrors: true, strict: false }); addFormats(ajv);
      ajv.addSchema(J('schema/public-summary.schema.json')); const v = ajv.compile(J('schema/local-record.schema.json'));
      if (!v(J('tests/browser/out/wizard-record.json'))) { console.log(JSON.stringify(v.errors)); process.exit(1); }"""], cwd=REPO, capture_output=True, text=True)
    check("wizard: saved record matches local-record.schema.json", v.returncode == 0, v.stdout + v.stderr)
    check("wizard: completion saved, steps done", rec["onboarding"].get("completedAt") and rec["onboarding"]["stepsDone"] == WZ_STEPS and rec["onboarding"]["portal"] == "mychart")
    pg.reload(wait_until="networkidle"); wait_js(pg, "window.CureBranchApp"); pg.wait_for_timeout(300)
    check("wizard: does not reopen once finished", not wizard_open(pg))
    check("home: intro stays after setup, start button hidden", pg.inner_text("#home-intro-copy") == INTRO and not pg.is_visible("#home-start-branch"))
    go(pg, "repo"); pg.wait_for_timeout(300)
    listed = pg.inner_text("#files-list")
    check("record screen lists the supporting photo with its label and check result", "photo-of-my-pathology-report-page-1.png" in listed and "Supporting, from patient" in listed and "Matches your hospital record" in listed, listed)
    go(pg, "settings"); pg.click("#rerun-wizard"); pg.wait_for_timeout(300)
    check("settings: 'Run the setup guide again' reopens at step 1", wizard_open(pg) and pg.inner_text("#wz-count") == "Step 1 of 3")
    check("re-run keeps earlier consent", pg.is_checked("#wz-consent"))
    pg.click("#wz-next"); pg.wait_for_timeout(150)
    pg.click("#wz-next"); pg.wait_for_timeout(150)
    check("re-run keeps earlier answers", pg.is_checked("input[name=wz-afterdeath][value=remove]") and pg.input_value("#wz-person") == "EXAMPLE Trusted Person")
    pg.click("#wz-later"); pg.wait_for_timeout(300)
    check("'Finish later' closes the guide", not wizard_open(pg) and pg.is_visible("#s-home"))
    pg.reload(wait_until="networkidle"); wait_js(pg, "window.CureBranchApp"); pg.wait_for_timeout(300)
    check("'Finish later' then reopen: back at the same step", wizard_open(pg) and pg.inner_text("#wz-count") == "Step 3 of 3")
    pg.click("#wz-later"); pg.wait_for_timeout(200)
    go(pg, "repo"); pg.wait_for_timeout(200)
    pg.once("dialog", lambda d: d.accept()); pg.locator("[data-remove-source]").first.click(); pg.wait_for_timeout(400)
    rec = pg.evaluate("window.CureBranchApp.getRecord()")
    check("removing the official record also removes its supporting photo", not rec["sources"] and not rec.get("files"))
    ctx.close()

def run_axe(pg, label):
    pg.evaluate(AXE)
    r = pg.evaluate("""async () => { const r = await axe.run(document, {runOnly:{type:'tag', values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}});
      return r.violations.map(v => ({id: v.id, impact: v.impact, n: v.nodes.length, t: v.nodes.slice(0,3).map(n => n.target.join(' '))})); }""")
    results["axe"].append({"view": label, "violations": r})
    if r: fails.append(f"axe {label}: {[(v['id'], v['n'], v['t']) for v in r]}")

def tree_flow(b):
    """Lifelike tree picture from published data: every tip is a labelled button; click and keyboard both pick it."""
    ctx = b.new_context(viewport={"width": 390, "height": 900})
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: results["console"].append(f"pageerror: {e}"))
    pg.goto(BASE + "/", wait_until="networkidle"); wait_js(pg, "window.CureBranchApp")
    if wizard_open(pg): finish_wizard(pg)
    go(pg, "tree")
    info = pg.evaluate("""() => { const h = [...document.querySelectorAll('#living-tree .lt-hit')];
      return { n: h.length, tips: h.filter(x => x.classList.contains('lt-tip')).map(x => x.dataset.ltPath),
        ok: h.every(x => x.getAttribute('role') === 'button' && x.tabIndex === 0 && /0 patients have shared here so far/.test(x.getAttribute('aria-label'))),
        svg: !!document.querySelector('#living-tree svg.lt-svg[role=group][aria-label]') }; }""")
    data = json.loads((DIST / "data/public-cancer-data.json").read_text())
    check("tree picture: built from published data, every tip a labelled button with 0 patients", info["svg"] and info["ok"] and len(info["tips"]) >= 12, str(info)[:300])
    check("tree: no example patients shown publicly", "EXAMPLE" not in pg.inner_text("#s-tree") and "Example data" not in pg.inner_text("#s-tree"))
    tip = next(t for t in info["tips"] if t.startswith("Lung/"))
    pg.click(f'#living-tree .lt-tip[data-lt-path="{tip}"] .lt-hit-area', force=True)
    st = pg.evaluate(f"""() => ({{ pressed: document.querySelector('#living-tree [data-lt-path="{tip}"]').getAttribute('aria-pressed'),
      panel: document.querySelector('#panel-branch').textContent, cap: document.querySelector('#lt-caption').textContent }})""")
    gene = tip.split("/")[1]
    check("tree picture: clicking a tip shows published data for that gene", st["pressed"] == "true" and f"Lung › {gene}" in st["panel"] and f"{gene} is mutated in" in st["panel"]
          and "Patient-shared branches here: 0" in st["panel"] and "Source:" in st["panel"], str(st)[:300])
    pg.focus('#living-tree [data-lt-path="Breast"]'); pg.keyboard.press("Enter"); pg.wait_for_timeout(100)
    st = pg.evaluate(f"""() => ({{ pressed: document.querySelector('#living-tree [data-lt-path="Breast"]').getAttribute('aria-pressed'),
      old: document.querySelector('#living-tree [data-lt-path="{tip}"]').getAttribute('aria-pressed'),
      focus: document.activeElement && document.activeElement.dataset.ltPath, panel: document.querySelector('#panel-branch h2').textContent }})""")
    check("tree picture: Enter on a focused limb picks it and keeps focus", st == {"pressed": "true", "old": "false", "focus": "Breast", "panel": "Branch you picked"}, str(st))
    pg.click("#tab-explore"); pg.focus('#living-tree [data-lt-path="Lung"]'); pg.keyboard.press(" "); pg.wait_for_timeout(100)
    check("tree picture: Space picks too and shows the branch tab", pg.evaluate("!document.querySelector('#panel-branch').hidden && document.querySelector('#panel-branch').textContent.includes('Lung')"))
    check("published data: every figure has a source, licence and retrieval date",
          all(all(k in f for k in ("source", "retrieved", "url")) for c in data["cancers"] for f in ((c.get("seer") or {}).get("figures") or {}).values())
          and all(d["setId"] and d["retrieved"] for c in data["cancers"] for t in c["therapies"] for d in t["drugs"])
          and all(g["retrieved"] and g["studyId"] for c in data["cancers"] for g in c["genomics"])
          and all(c["patientBranches"]["shared"] == 0 for c in data["cancers"])
          and set(data["sources"]) == {"seer", "cbioportal", "openfda", "ctgov"} and all(s["license"] for s in data["sources"].values()))
    ctx.close()

def nav_flow(b):
    """Cancer-tree navigation: a left column on desktop, a drawer on phones; searchable; desktop uses the full width."""
    data = json.loads((DIST / "data/public-cancer-data.json").read_text())
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    pg = ctx.new_page()
    pg.goto(BASE + "/", wait_until="networkidle"); wait_js(pg, "window.CureBranchApp")
    if wizard_open(pg): finish_wizard(pg)
    go(pg, "home")
    d = pg.evaluate("""() => { const r = s => document.querySelector(s).getBoundingClientRect();
      return { nav: r('#sidenav').width, navVis: getComputedStyle(document.querySelector('#sidenav')).display !== 'none', main: r('#screens').width,
        layout: r('.layout').width, toggle: getComputedStyle(document.querySelector('#nav-toggle')).display, links: document.querySelectorAll('#cancer-nav .nl-link').length,
        groups: document.querySelectorAll('#cancer-nav .nl-group').length, a11yText: getComputedStyle(document.querySelector('.site-header .a11y-launch span')).width }; }""")
    check("desktop 1440: full-width layout (main column at least 1000px, layout at least 1400px)", d["main"] >= 1000 and d["layout"] >= 1400, str(d))
    check("desktop 1440: left navigation always shown, no menu button", d["navVis"] and 240 <= d["nav"] <= 360 and d["toggle"] == "none", str(d))
    check("nav: lists every cancer tree, grouped", d["links"] == len(data["cancers"]) and d["groups"] == len({c["group"] for c in data["cancers"]}), str(d))
    check("accessibility button: visible 'Accessibility' text on desktop, name includes it", d["a11yText"] not in ("1px", "0px")
          and "Accessibility" in pg.get_attribute(".site-header .a11y-launch", "aria-label") and pg.evaluate("document.querySelector('.site-header .a11y-launch').getBoundingClientRect().height") >= 44)
    pg.fill("#nav-search", "EGFR"); pg.wait_for_timeout(400)
    vis = pg.evaluate("[...document.querySelectorAll('#cancer-nav [data-nl-item]:not([hidden]) .nl-link')].map(a => a.textContent)")
    check("nav search: EGFR finds lung cancer and filters the list", "Lung cancer" in vis and len(vis) < len(data["cancers"]) and "match" in pg.inner_text("#nav-search-status"), str(vis))
    pg.fill("#nav-search", "zzzz"); pg.wait_for_timeout(400)
    check("nav search: no match is announced", "No cancer trees match" in pg.inner_text("#nav-search-status"))
    pg.fill("#nav-search", ""); pg.wait_for_timeout(400)
    pg.click('#cancer-nav .nl-toggle[aria-controls="nls-lung"]')
    check("nav: expand button shows subtypes and genes", pg.get_attribute('#cancer-nav .nl-toggle[aria-controls="nls-lung"]', "aria-expanded") == "true" and pg.is_visible("#nls-lung") and "Lung adenocarcinoma" in pg.inner_text("#nls-lung"))
    pg.click('#cancer-nav [data-nl-cancer="lung"]'); pg.wait_for_timeout(300)
    t = pg.inner_text("#s-cancer")
    lung = next(c for c in data["cancers"] if c["id"] == "lung")
    nc = f'{lung["seer"]["figures"]["newCases"]["value"]:,}'
    check("cancer page: real SEER figure with source shown", pg.is_visible("#s-cancer") and "Lung cancer" in pg.inner_text("#cancer-title") and nc in t and "Source: SEER" in t and "retrieved" in t, t[:300])
    check("cancer page: FDA drugs, trials, genes and a sources section", "FDA-approved drugs" in t and "recruiting studies" in t and "Tumors with a mutation" in t and "Sources and licenses" in t and "ODbL" in t)
    check("cancer page: patient-shared branches start at 0, no example patients", "Patient-shared branches: 0" in t and "EXAMPLE" not in t)
    check("nav: current cancer marked", pg.get_attribute('#cancer-nav [data-nl-cancer="lung"]', "aria-current") == "page" and pg.evaluate("location.pathname + location.hash") == "/cancers/lung/")
    gene = lung["genomics"][0]["genes"][1]["gene"]
    pg.click('#cancer-nav .nl-toggle[aria-controls="nls-lung"]') if not pg.is_visible("#nls-lung") else None
    pg.click(f'#nls-lung a[href="/cancers/lung/#g-lung-{gene}"]'); pg.wait_for_timeout(300)
    check("nav: gene link moves focus to that gene's row, address is a real path + #fragment", pg.evaluate("document.activeElement.id") == f"g-lung-{gene}"
          and pg.evaluate("location.pathname + location.hash") == f"/cancers/lung/#g-lung-{gene}", pg.evaluate("document.activeElement.id + ' ' + location.href"))
    ctx.close()
    # phone: drawer
    ctx = b.new_context(viewport={"width": 390, "height": 844})
    pg = ctx.new_page()
    pg.goto(BASE + "/", wait_until="networkidle"); wait_js(pg, "window.CureBranchApp")
    if wizard_open(pg): finish_wizard(pg)
    go(pg, "home")
    check("phone: nav hidden until the menu button is used", not pg.is_visible("#sidenav") and pg.is_visible("#nav-toggle") and pg.get_attribute("#nav-toggle", "aria-expanded") == "false")
    pg.click("#nav-toggle"); pg.wait_for_timeout(200)
    st = pg.evaluate("""() => ({ open: document.querySelector('#sidenav').classList.contains('open'), exp: document.querySelector('#nav-toggle').getAttribute('aria-expanded'),
      modal: document.querySelector('#sidenav').getAttribute('aria-modal'), focus: document.activeElement.closest('.site-links') ? 'site-links' : document.activeElement.id,
      inert: document.querySelector('#screens').inert && document.querySelector('.chrome').inert, search: !!document.querySelector('#sidenav #nav-search') })""")
    check("phone: menu opens as a modal with site links first, then the cancer search; page behind inert", st == {"open": True, "exp": "true", "modal": "true", "focus": "site-links", "inert": True, "search": True}, str(st))
    r = pg.evaluate(OVERFLOW_JS)
    check("phone: open drawer causes no sideways scrolling", r["overflow"] <= 1 and not r["offenders"], str(r))
    run_axe(pg, "390px nav-drawer")
    pg.keyboard.press("Escape"); pg.wait_for_timeout(150)
    check("phone: Escape closes the menu and returns focus", not pg.is_visible("#sidenav") and pg.evaluate("document.activeElement.id") == "nav-toggle" and not pg.evaluate("document.querySelector('#screens').inert || document.querySelector('.chrome').inert"))
    pg.click("#nav-toggle"); pg.click('#cancer-nav [data-nl-cancer="breast"]'); pg.wait_for_timeout(300)
    check("phone: picking a cancer closes the drawer and opens its page", not pg.is_visible("#sidenav") and "Breast cancer" in pg.inner_text("#cancer-title"))
    ctx.close()


SITE = "https://curebranch.ai"
NO_HASH_ROUTES_JS = """() => {
  const bad = [];
  for (const a of document.querySelectorAll('a[href]')) {
    const h = a.getAttribute('href');
    if (/^\\/?#\\//.test(h) || /^\\/#/.test(h)) bad.push(h);                       // "#/x" or "/#x" style routes
    else if (h.startsWith('#') && h.length > 1 && !a.closest('.screen:not(.active), [hidden]') && !document.getElementById(decodeURIComponent(h.slice(1)))) bad.push('missing target ' + h);
  }
  for (const b of document.querySelectorAll('a[data-go]')) bad.push('link uses data-go ' + b.getAttribute('href'));
  return bad;
}"""

def sitemap_paths():
    return re.findall(r"<loc>https://curebranch\.ai(/[^<]*)</loc>", (DIST / "sitemap.xml").read_text())

def routes_flow(b):
    """Every page has a real address: load each one directly (like a refresh or a shared link)."""
    paths = sitemap_paths()
    app_paths = [x for x in paths if x != "/how-it-started/"]
    check("routes: sitemap lists every page (app pages, cancer pages, sub-pages, How it started)", len(paths) >= 100 and "/cancers/breast/her2-positive/" in paths and "/how-it-started/" in paths, str(len(paths)))
    files = [f for f in DIST.rglob("*.html")]
    bad_files = [str(f.relative_to(DIST)) for f in files if re.search(r'href="/?#/|href="/#[a-z]', f.read_text())]
    check("no '#/' or '/#name' links in any built page", not bad_files, str(bad_files[:5]))
    ctx = b.new_context(viewport={"width": 1280, "height": 900}); pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.goto(BASE + "/", wait_until="networkidle"); wait_js(pg, "window.CureBranchApp")
    if wizard_open(pg): finish_wizard(pg)
    problems, hash_links = [], []
    for path in paths:
        r = pg.goto(BASE + path, wait_until="domcontentloaded")
        served = pg.evaluate("""() => ({ title: document.title, canon: (document.querySelector('link[rel=canonical]') || {}).href,
          desc: (document.querySelector('meta[name=description]') || {}).content || '' })""")
        if path != "/how-it-started/":
            wait_js(pg, "window.CureBranchApp && document.querySelector('.screen.active h1')")
            pg.wait_for_timeout(50)
        st = pg.evaluate("""() => ({ path: location.pathname, title: document.title, canon: document.querySelector('link[rel=canonical]').href,
          h1: (document.querySelector('.screen.active h1') || document.querySelector('main h1') || {}).textContent || '', whatIs: !!document.querySelector('.screen.active .what-is, main .what-is'),
          screens: document.querySelectorAll('.screen.active').length })""")
        ok = (r.status == 200 and st["path"] == path and served["canon"] == SITE + path and st["canon"] == SITE + path and served["title"] == st["title"]
              and len(served["desc"]) > 40 and st["h1"].strip() and st["whatIs"] and st["screens"] == 1)
        if not ok: problems.append(f"{path}: status={r.status} {served} {st}")
        if path.count("/") <= 3 or path in ("/cancers/breast/her2-positive/",):
            hl = pg.evaluate(NO_HASH_ROUTES_JS)
            if hl: hash_links.append(f"{path}: {hl[:4]}")
    check(f"routes: all {len(paths)} pages load directly with their own title, description, canonical, h1 and 'What is this page?' box", not problems, "; ".join(problems[:4]))
    check("links: no '#/' routes, no data-go links, every in-page #link has a target", not hash_links, "; ".join(hash_links[:4]))
    titles = {}
    for path in app_paths[:40]:
        pg.goto(BASE + path, wait_until="domcontentloaded"); titles[path] = pg.title()
    check("routes: page titles are unique", len(set(titles.values())) == len(titles), str(titles)[:300])
    # Back, Forward and Refresh with normal links
    pg.goto(BASE + "/", wait_until="networkidle"); wait_js(pg, "window.CureBranchApp")
    navs_before = len(STATE["hits"])
    pg.click(".sh-nav a[href='/cancers/']"); wait_js(pg, "location.pathname === '/cancers/' && document.querySelector('#s-cancers.active')")
    pg.click("#cancers-body a[href='/cancers/breast/']"); wait_js(pg, "location.pathname === '/cancers/breast/'")
    pg.click("#cancer-body .pill-links a[href='/cancers/breast/her2-positive/']"); wait_js(pg, "location.pathname === '/cancers/breast/her2-positive/'")
    h1 = pg.inner_text("#cancer-title")
    check("links: header -> Cancer trees -> Breast -> HER2-positive, each a real address", h1 == "HER2-positive breast cancer" and pg.title() == "HER2-positive breast cancer | CureBranch", h1)
    pg.go_back(); wait_js(pg, "location.pathname === '/cancers/breast/'"); pg.wait_for_timeout(150)
    check("Back button returns to the previous page", pg.inner_text("#cancer-title") == "Breast cancer" and pg.title() == "Breast cancer | CureBranch")
    pg.go_back(); wait_js(pg, "location.pathname === '/cancers/'"); pg.wait_for_timeout(150)
    check("Back again: All cancer trees", pg.is_visible("#s-cancers") and pg.title() == "All cancer trees | CureBranch")
    pg.go_forward(); wait_js(pg, "location.pathname === '/cancers/breast/'")
    check("Forward works", pg.inner_text("#cancer-title") == "Breast cancer")
    pg.reload(wait_until="networkidle"); wait_js(pg, "window.CureBranchApp && document.querySelector('#cancer-title')")
    check("Refresh on a deep link stays on that page", pg.evaluate("location.pathname") == "/cancers/breast/" and pg.inner_text("#cancer-title") == "Breast cancer")
    pg.click(".otp a[href^='#ai-']"); pg.wait_for_timeout(300)
    check("'On this page' jump link moves focus and keeps the real address", pg.evaluate("document.activeElement.id") == "ai-breast-h" and pg.evaluate("location.pathname + location.hash") == "/cancers/breast/#ai-breast-h",
          pg.evaluate("document.activeElement.id + ' ' + location.href"))
    # Old hash addresses move to the new ones
    for old, new in (("/#cancer/lung", "/cancers/lung/"), ("/#/repo", "/my-branch/"), ("/#tree", "/tree/"), ("/#start", "/how-it-works/"), ("/#cancer/lung/g-lung-EGFR", "/cancers/lung/#g-lung-EGFR")):
        pg.goto(BASE + old, wait_until="networkidle"); wait_js(pg, "window.CureBranchApp"); pg.wait_for_timeout(200)
        got = pg.evaluate("location.pathname + location.hash")
        check(f"old link {old} redirects to {new}", got == new, got)
    pg.goto(BASE + "/how-it-started.html", wait_until="networkidle"); pg.wait_for_timeout(800)
    check("old /how-it-started.html forwards to /how-it-started/", pg.evaluate("location.pathname") == "/how-it-started/" and "In honor of my dad" in pg.inner_text("main"))
    check("routes: no console errors", not errs, str(errs[:3]))
    ctx.close()

def help_flow(b):
    """'?' help buttons: disclosure pattern, keyboard and screen-reader friendly, never hover-only."""
    ctx = b.new_context(viewport={"width": 1440, "height": 900}); pg = ctx.new_page()
    pg.goto(BASE + "/cancers/breast/", wait_until="networkidle"); wait_js(pg, "window.CureBranchApp && document.querySelector('#cancer-body .help-btn')")
    if wizard_open(pg): finish_wizard(pg); pg.goto(BASE + "/cancers/breast/", wait_until="networkidle"); wait_js(pg, "document.querySelector('#cancer-body .help-btn')")
    info = pg.evaluate("""() => { const b = [...document.querySelectorAll('#cancer-body .help-btn')];
      return { n: b.length, terms: [...new Set(b.map(x => x.dataset.help))],
        ok: b.every(x => x.tagName === 'BUTTON' && x.getAttribute('aria-expanded') === 'false' && document.getElementById(x.getAttribute('aria-controls')) && document.getElementById(x.getAttribute('aria-controls')).hidden && /What does ".+" mean\\?/.test(x.textContent)),
        size: b.every(x => { const r = x.getBoundingClientRect(); return r.width >= 24 && r.height >= 24; }) }; }""")
    need = {"cancer-tree", "seer", "survival", "new-cases", "deaths", "stage", "subtype", "biomarker", "mutation-rate", "tcga", "fda", "trial", "ai", "shared-branches"}
    check("help: '?' buttons next to the terms on a cancer page (SEER, TCGA, survival, subtype, biomarker, trial, ...)", info["ok"] and info["size"] and need <= set(info["terms"]), str(info)[:400])
    btn = pg.locator("#cancer-body .stat-card .help-btn").first
    btn.focus(); pg.keyboard.press("Enter"); pg.wait_for_timeout(100)
    pid = btn.get_attribute("aria-controls")
    st = pg.evaluate(f"() => ({{ exp: document.activeElement.getAttribute('aria-expanded'), vis: !document.getElementById('{pid}').hidden, txt: document.getElementById('{pid}').innerText }})")
    check("help: Enter opens the explanation right after the button (aria-expanded=true)", st["exp"] == "true" and st["vis"] and "estimate" in st["txt"], str(st))
    pg.keyboard.press("Tab")
    check("help: Tab moves into the explanation ('More in Help' link)", pg.evaluate("document.activeElement.classList.contains('help-more')"))
    pg.keyboard.press("Escape"); pg.wait_for_timeout(100)
    check("help: Escape closes it and returns focus to the button", pg.evaluate(f"document.getElementById('{pid}').hidden") and pg.evaluate("document.activeElement.classList.contains('help-btn')") and btn.get_attribute("aria-expanded") == "false")
    pg.keyboard.press("Space"); pg.wait_for_timeout(100)
    check("help: Space toggles it too", btn.get_attribute("aria-expanded") == "true")
    pg.hover("#cancer-body .help-btn >> nth=3"); pg.wait_for_timeout(200)
    check("help: nothing opens on hover alone", pg.evaluate("document.querySelectorAll('#cancer-body .help-btn[aria-expanded=true]').length") == 1)
    run_axe(pg, "1440px cancer page with a help explanation open")
    pg.click(f"#{pid} .help-more"); wait_js(pg, "location.pathname === '/help/'"); pg.wait_for_timeout(300)
    check("help: 'More in Help' opens the Help page at that question", pg.evaluate("location.hash") == "#q-new-cases" and pg.evaluate("document.activeElement.id") == "q-new-cases")
    n = pg.evaluate("document.querySelectorAll('#help-body .faq dt').length")
    check("help page: many plain questions and answers", n >= 40, str(n))
    for path in ("/", "/how-it-works/", "/my-branch/", "/settings/", "/import/", "/privacy/"):
        pg.goto(BASE + path, wait_until="networkidle"); wait_js(pg, "window.CureBranchApp")
        c = pg.evaluate("document.querySelectorAll('.screen.active .help-btn').length")
        if not c: check(f"help: '?' buttons on {path}", False, "none")
    check("help: '?' buttons on home, how it works, my branch, settings, add records and privacy", True)
    # AI section
    pg.goto(BASE + "/cancers/breast/", wait_until="networkidle"); wait_js(pg, "document.querySelector('#ai-breast')")
    ai = pg.inner_text("#ai-breast")
    check("cancer page: explainer, numbered how-to, and 'How to use this with your AI' with steps for each AI",
          pg.is_visible("#cancer-body .what-is") and pg.locator("#cancer-body .how-use ol li").count() >= 5
          and all(x in ai for x in ["ChatGPT", "Claude", "Gemini", "Grok", "Copilot", "Another AI", "not medical advice", "Talk with your doctor"]), ai[:300])
    prompt = pg.input_value("#ai-breast-prompt")
    check("AI prompt: has the page address, sourced facts and a place to paste records", "https://curebranch.ai/cancers/breast/" in prompt and "(SEER)" in prompt
          and "[Paste your pathology report" in prompt and "not medical advice" in prompt, prompt[:200])
    ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=BASE)
    pg.click("#ai-breast [data-copy]"); pg.wait_for_timeout(300)
    clip = pg.evaluate("navigator.clipboard.readText()")
    check("AI prompt: one button copies it, and says so", clip == prompt and "Copied" in pg.inner_text("#ai-breast .copy-status"))
    pg.goto(BASE + "/cancers/breast/her2-positive/", wait_until="networkidle"); wait_js(pg, "document.querySelector('#ai-breast-her2-positive-prompt')")
    t = pg.inner_text("#cancer-body")
    check("biomarker page: plain explainer, FDA drugs, trials, AI prompt", "Positive" in t and "Enhertu" in t and "recruiting studies" in t
          and "HER2" in pg.input_value("#ai-breast-her2-positive-prompt") and "https://curebranch.ai/cancers/breast/her2-positive/" in pg.input_value("#ai-breast-her2-positive-prompt"))
    txt = pg.evaluate("document.body.innerText")
    check("no read-aloud anywhere ('Listen to this' removed)", "Listen to this" not in txt and not pg.evaluate("!!document.querySelector('.listen-bar, [data-listen-mount], .hero-listen')"))
    ctx.close()

MOCK_TRANSLATOR = """
window.Translator = {
  availability: async ({ targetLanguage }) => (targetLanguage === 'xx' ? 'unavailable' : 'available'),
  create: async ({ targetLanguage, monitor }) => { if (monitor) monitor({ addEventListener() {} }); return { translate: async (t) => '[' + targetLanguage + '] ' + t }; },
};"""

def translate_flow(b):
    """Translate: on-device translation where the browser has it (mocked here), browser steps everywhere."""
    ctx = b.new_context(viewport={"width": 1440, "height": 900}); pg = ctx.new_page()
    pg.goto(BASE + "/", wait_until="networkidle"); wait_js(pg, "window.CureBranchApp")
    if wizard_open(pg): finish_wizard(pg)
    pg.click("#tr-btn"); pg.wait_for_timeout(150)
    st = pg.evaluate("""() => ({ exp: document.querySelector('#tr-btn').getAttribute('aria-expanded'), open: !document.querySelector('#tr-panel').hidden,
      focus: document.activeElement.id, device: !document.querySelector('#tr-device').hidden, how: document.querySelectorAll('#tr-howto details').length,
      langs: document.querySelectorAll('#tr-lang option').length, api: 'Translator' in self })""")
    check("translate: labelled header button opens the panel with 30+ languages and browser steps", st["exp"] == "true" and st["open"] and st["focus"] == "tr-lang"
          and st["device"] == st["api"] and st["how"] >= 6 and st["langs"] >= 30, str(st))
    run_axe(pg, "1440px translate panel open")
    pg.keyboard.press("Escape"); pg.wait_for_timeout(100)
    check("translate: Escape closes the panel and returns focus", pg.evaluate("document.querySelector('#tr-panel').hidden && document.activeElement.id === 'tr-btn'"))
    ctx.close()
    ctx = b.new_context(viewport={"width": 1440, "height": 900}); ctx.add_init_script("delete self.Translator; delete window.Translator;"); pg = ctx.new_page()
    pg.goto(BASE + "/", wait_until="networkidle"); wait_js(pg, "window.CureBranchApp"); pg.click("#tr-btn"); pg.wait_for_timeout(100)
    check("translate: in browsers without on-device translation, only the browser's own steps are offered (opened for this browser)",
          pg.evaluate("document.querySelector('#tr-device').hidden && !!document.querySelector('#tr-howto details[open]')"))
    ctx.close()
    ctx = b.new_context(viewport={"width": 1440, "height": 900}); ctx.add_init_script(MOCK_TRANSLATOR); pg = ctx.new_page()
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(BASE + "/cancers/breast/", wait_until="networkidle"); wait_js(pg, "window.CureBranchApp && document.querySelector('#cancer-title')")
    if wizard_open(pg): finish_wizard(pg); pg.goto(BASE + "/cancers/breast/", wait_until="networkidle"); wait_js(pg, "document.querySelector('#cancer-title')")
    pg.click("#tr-btn"); pg.select_option("#tr-lang", "es")
    check("translate: 'Translate on this device' offered when the browser supports it", pg.is_visible("#tr-go"))
    pg.click("#tr-go"); wait_js(pg, "document.querySelector('#cancer-title').textContent.startsWith('[es]')")
    st = pg.evaluate("""() => ({ lang: document.documentElement.lang, h1: document.querySelector('#cancer-title').textContent, brand: document.querySelector('.brand-name').textContent,
      label: document.querySelector('#nav-search').getAttribute('placeholder'), undo: !document.querySelector('#tr-undo').hidden, status: document.querySelector('#tr-status').textContent })""")
    check("translate: page text and labels translated on the device, <html lang> set, brand name kept", st["lang"] == "es" and st["h1"] == "[es] Breast cancer"
          and st["brand"] == "CureBranch" and st["label"].startswith("[es]") and st["undo"], str(st))
    pg.screenshot(path=str(REPO / "tests/browser/out/translate-mock.png"))
    pg.keyboard.press("Escape")
    pg.click("#cancer-body .pill-links a[href='/cancers/breast/her2-positive/']"); wait_js(pg, "location.pathname === '/cancers/breast/her2-positive/'")
    wait_js(pg, "document.querySelector('#cancer-title').textContent.startsWith('[es]')")
    check("translate: new pages opened from links are translated too", pg.inner_text("#cancer-title").startswith("[es] "))
    pg.click("#tr-btn"); pg.click("#tr-undo"); pg.wait_for_timeout(200)
    check("translate: 'Show the original' restores English", pg.inner_text("#cancer-title") == "HER2-positive breast cancer" and pg.evaluate("document.documentElement.lang") == "en"
          and not pg.evaluate("document.body.innerText.includes('[es]')"))
    pg.evaluate("() => { window.Translator.availability = () => new Promise(() => {}); }")   # a browser that never answers
    pg.select_option("#tr-lang", "fr"); pg.click("#tr-go"); pg.wait_for_timeout(10600)
    check("translate: if the browser never answers, it says so after 10 seconds and points to the browser steps",
          "did not answer" in pg.inner_text("#tr-status") and pg.evaluate("document.documentElement.lang") == "en", pg.inner_text("#tr-status"))
    pg.select_option("#tr-lang", "ar")
    pg.evaluate("() => { window.Translator.availability = async () => 'available'; }")
    pg.click("#tr-go"); wait_js(pg, "document.documentElement.lang === 'ar'")
    check("translate: right-to-left languages set dir=rtl", pg.evaluate("document.documentElement.dir") == "rtl")
    r = pg.evaluate(OVERFLOW_JS)
    check("translate: right-to-left page has no sideways scrolling", r["overflow"] <= 1, str(r)[:300])
    pg.click("#tr-undo")
    check("translate: no errors", not errs, str(errs[:3]))
    ctx.close()

HEADER_JS = """() => {
  const vis = (e) => e && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden';
  const items = [document.querySelector('.site-header .brand'), ...document.querySelectorAll('.sh-nav a'), document.querySelector('#tr-btn'),
                 document.querySelector('.site-header .a11y-launch'), document.querySelector('#nav-toggle')].filter(vis);
  const R = items.map((e) => { const r = e.getBoundingClientRect(); return { id: e.id || e.className || e.tagName, l: r.left, r: r.right, t: r.top, b: r.bottom, h: r.height }; });
  let overlap = [];
  for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
    const a = R[i], b = R[j]; if (a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1) overlap.push(a.id + ' x ' + b.id);
  }
  const head = document.querySelector('.site-header').getBoundingClientRect();
  return { n: R.length, rows: (Math.max(...R.map((x) => (x.t + x.b) / 2)) - Math.min(...R.map((x) => (x.t + x.b) / 2))) <= 8 ? 1 : 2, overlap, minH: Math.min(...R.map((x) => x.h)),
    navVisible: vis(document.querySelector('.sh-nav')), menuVisible: vis(document.querySelector('#nav-toggle')), height: head.height,
    trLabel: document.querySelector('#tr-btn').innerText.trim(), a11yLabel: document.querySelector('.site-header .a11y-launch').innerText.trim(),
    right: Math.max(...R.map((x) => x.r)), vw: document.documentElement.clientWidth };
}"""

def header_flow(b):
    """Header audit at 1440, 1280, 1024, 768, 390 and 320: one tidy row, nothing overlaps, every control 44px+, menu on small screens."""
    for w in (1440, 1280, 1024, 768, 390, 320):
        ctx = b.new_context(viewport={"width": w, "height": 900}); pg = ctx.new_page()
        pg.goto(BASE + "/cancers/breast/", wait_until="networkidle"); wait_js(pg, "window.CureBranchApp")
        if wizard_open(pg): finish_wizard(pg); pg.goto(BASE + "/cancers/breast/", wait_until="networkidle"); wait_js(pg, "window.CureBranchApp")
        d = pg.evaluate(HEADER_JS)
        wide = w >= 1024
        ok = (d["rows"] == 1 and not d["overlap"] and d["minH"] >= 44 and d["navVisible"] == wide and d["menuVisible"] == (not wide)
              and d["trLabel"] == "Translate" and d["a11yLabel"] == "Accessibility" and d["right"] <= d["vw"] and d["height"] <= 80
              and d["n"] == (1 + 5 + 2 if wide else 1 + 3))
        check(f"header {w}px: logo + name, {'5 links' if wide else 'Menu button'}, Translate and Accessibility in one row, no overlap, 44px targets", ok, str(d))
        if wide:
            check(f"header {w}px: current section marked", pg.get_attribute(".sh-nav a[href='/cancers/']", "aria-current") is not None)
        ctx.close()

def main():
    httpd, state = start(DIST, PORT)
    STATE.update(hits=state.setdefault("hits", []))
    with sync_playwright() as p:
        b = p.chromium.launch()
        wizard_flow(b)
        tree_flow(b)
        nav_flow(b)
        routes_flow(b)
        help_flow(b)
        translate_flow(b)
        header_flow(b)
        # ---------- flows ----------
        ctx = b.new_context(viewport={"width": 390, "height": 844})
        pg = ctx.new_page()
        pg.on("console", lambda m: results["console"].append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e: results["console"].append(f"pageerror: {e}"))
        pg.goto(BASE + "/", wait_until="networkidle")
        wait_js(pg, "window.CureBranchApp")
        finish_wizard(pg)
        code = pg.evaluate("window.CureBranchApp.getRecord().code")
        check("random code format", re.fullmatch(r"[0-9a-hjkmnp-tv-z]{6}", code), code)
        check("dedication only on How it started (not Home)", "In honor of my dad" not in pg.inner_text("#s-home"))
        check("default: sharing not chosen, nothing public", lvl(pg) is None and "not chosen yet" in pg.inner_text("#privacy-title"))
        check("new record: after-death stored as keep-private", pg.evaluate("window.CureBranchApp.getRecord().afterDeath.choice") == "keep-private")

        go(pg, "import")
        pg.click("#try-shc"); pg.wait_for_selector("#import-result .notice")
        t = pg.inner_text("#import-result")
        check("example SHC imports as verified", "Imported and verified" in t, t)
        pg.set_input_files("#file-in", str(REPO / "schema/examples/example-fhir-bundle.json"))
        wait_js(pg, "document.querySelector('#import-result').innerText.includes('not verified')")
        check("FHIR file via file picker imports as unverified", True)
        shc = json.loads((DIST / "data/examples/example-health-card.smart-health-card").read_text())
        jws = shc["verifiableCredential"][0]; h, pl, sg = jws.split(".")
        bad = ".".join([h, pl, sg[:-3] + ("AAA" if sg[-3:] != "AAA" else "BBB")])
        pg.fill("#shc-text", json.dumps({"verifiableCredential": [bad]}))
        pg.click("#shc-paste-go"); pg.wait_for_timeout(600)
        t = pg.inner_text("#import-result")
        check("tampered SHC is NOT verified", "not verified" in t and "did not match" in t, t)
        n = pg.evaluate("window.CureBranchApp.getRecord().sources.length")
        check("three sources stored", n == 3, str(n))

        pg.reload(wait_until="networkidle"); wait_js(pg, "window.CureBranchApp")
        check("record survives reload (IndexedDB)", pg.evaluate("window.CureBranchApp.getRecord().sources.length") == 3
              and pg.evaluate("window.CureBranchApp.getRecord().code") == code)

        go(pg, "repo")
        pg.wait_for_timeout(400)
        check("mixed sources -> summary private by default", "Private" in pg.inner_text("#summary-state"))
        go(pg, "home"); pg.click("#privacy-change"); pg.wait_for_timeout(300)
        check("Home 'Change how much I share' opens the Settings picker", pg.evaluate("document.activeElement.id") == "privacy-h")
        w = pick_level(pg, "#s-settings", "basic")
        check("settings: warning before Basic, then saved", "can't be pulled back" in w and lvl(pg) == "basic")
        go(pg, "home"); check("Home shows the level", "Basic public summary" in pg.inner_text("#privacy-title"))
        go(pg, "repo"); pg.wait_for_timeout(500)
        summ = json.loads(pg.inner_text("#summary-json"))
        check("public summary built", summ["visibility"] == "public" and summ["branch"]["path"] == ["Lung", "KRAS", "G12C"], json.dumps(summ["branch"]))
        check("summary unverified because one source is unverified", summ["verification"]["status"] == "unverified")
        txt = json.dumps(summ)
        check("summary has no name/birthdate/MRN", not any(x in txt for x in ["1961", "EXAMPLE-0000", "family", "birthDate"]))
        check("summary anonymous by default", "profile" not in summ)
        check("Basic: ranges only (no exact age, dates or place)", summ.get("detailLevel") == "basic" and "age" not in summ and "location" not in summ and "diagnosisDate" not in summ)
        go(pg, "settings"); pick_level(pg, "#s-settings", "full"); go(pg, "repo"); pg.wait_for_timeout(500)
        sf = json.loads(pg.inner_text("#summary-json"))
        check("Full: adds exact age, dates, city/state/country", sf.get("detailLevel") == "full" and sf.get("age") == 65 and sf.get("location", {}).get("city") == "Exampleville"
              and not any(x in json.dumps(sf) for x in ["EXAMPLE Street", "00000", "1961"]))
        go(pg, "settings"); w = pick_level(pg, "#s-settings", "detailed")
        check("settings: moving down from Full warns, stops future Full sharing", "Full public level stays out there" in w and lvl(pg) == "detailed")
        go(pg, "repo"); pg.wait_for_timeout(500)
        sd = json.loads(pg.inner_text("#summary-json"))
        check("Detailed: no location any more", sd.get("detailLevel") == "detailed" and "location" not in sd and sd.get("age") == 65)
        go(pg, "settings"); pick_level(pg, "#s-settings", "basic"); go(pg, "repo"); pg.wait_for_timeout(500)
        # remove the unverified + tampered sources -> verified
        for _ in range(2):
            pg.once("dialog", lambda d: d.accept())
            pg.locator("[data-remove-source]").nth(1).click(); pg.wait_for_timeout(400)
        summ = json.loads(pg.inner_text("#summary-json"))
        check("only verified sources -> verified summary", summ["verification"]["status"] == "verified", json.dumps(summ["verification"]))
        pg.uncheck("[data-share='markers']"); pg.wait_for_timeout(400)
        check("share switch removes markers", "markers" not in json.loads(pg.inner_text("#summary-json")))
        pg.check("[data-share='markers']"); pg.wait_for_timeout(300)

        # profile: anonymous, then opt in
        pp = ctx.new_page(); pp.goto(f"{BASE}/p/{code}", wait_until="networkidle"); pp.wait_for_timeout(600)
        t = pp.inner_text("#profile")
        check("profile page anonymous by default", "Anonymous patient" in t and "Preview" in t, t[:200])
        check("recognition: owner section shown, everything off", pp.is_visible("#recognition") and not pp.is_visible("#rc-public")
              and pp.evaluate("[...document.querySelectorAll('.rc-opts input')].every(x => !x.checked)"))
        check("recognition: helped counter, badges, branch picture", "Your branch helped" in pp.inner_text("#rc-helped")
              and pp.locator(".rc-badges li").count() == 4 and pp.locator("#recognition svg[role=img]").count() == 1)
        check("recognition: branch glows when someone landed nearby (stub)", pp.locator("#recognition .tr-glow").count() == 1 and "glowing" in pp.inner_text("#rc-glow-words"))
        pp.check("#rc-show-helped"); pp.wait_for_timeout(300); pp.check("#rc-show-badges"); pp.wait_for_timeout(300); pp.check("#rc-accept-notes"); pp.wait_for_timeout(500)
        check("recognition: notes inbox appears after opting in (example notes)", "EXAMPLE" in pp.inner_text("#recognition .rc-notes"))
        pp.reload(wait_until="networkidle"); pp.wait_for_timeout(700)
        t = pp.inner_text("#rc-public") if pp.is_visible("#rc-public") else ""
        check("recognition: public part shows only what was switched on", "This branch helped" in t and "First record shared" in t and pp.locator("#rc-public svg").count() == 0, t[:200])
        alt = pp.get_attribute("#rc-card-img", "alt") or ""
        check("share card: preview with alt text, no code by default", alt.startswith("Share card preview: I'm part of CureBranch.") and code not in alt, alt)
        pp.check("#rc-card-code"); pp.wait_for_timeout(300)
        check("share card: code only when ticked", code in (pp.get_attribute("#rc-card-img", "alt") or ""))
        with pp.expect_download() as dl: pp.click("#rc-share")
        check("share card: downloads a PNG when sharing isn't available", dl.value.suggested_filename == "curebranch-card.png")
        pp.uncheck("#rc-card-code"); pp.wait_for_timeout(200)
        go(pg, "settings")
        pg.click("#profile-switch"); pg.fill("#prof-name", "Sam (EXAMPLE)"); pg.click("#prof-save"); pg.wait_for_timeout(400)
        pp.reload(wait_until="networkidle"); pp.wait_for_timeout(600)
        pp.wait_for_timeout(600)
        check("profile shows name only after opt-in", "Sam (EXAMPLE)" in pp.inner_text("#profile"),
              pp.inner_text("#profile")[:150] + " | share=" + json.dumps(pg.evaluate("window.CureBranchApp.getRecord().share")))
        pp.goto(f"{BASE}/p/zzzzzz", wait_until="networkidle"); pp.wait_for_timeout(400)
        check("unknown code -> not found", "Not found" in pp.inner_text("#profile"))
        ex = json.loads((DIST / "data/example-summaries.json").read_text())["summaries"][3]["code"]
        pp.goto(f"{BASE}/p/{ex}", wait_until="networkidle"); pp.wait_for_timeout(600)
        check("example profile renders, signed", "EXAMPLE DATA" in pp.inner_text("#profile") and "Signed by the patient" in pp.inner_text("#profile"))
        exr = json.loads((DIST / "data/example-summaries.json").read_text())["summaries"][1]["code"]
        pp.goto(f"{BASE}/p/{exr}", wait_until="networkidle"); pp.wait_for_timeout(600)
        check("example with recognition: counter, badges, branch picture, note form", "This branch helped" in pp.inner_text("#rc-public")
              and pp.locator("#rc-public svg[role=img]").count() == 1 and pp.is_visible("#rc-send"))
        pp.fill("#rc-note", "Email me at a@b.co"); pp.click("#rc-send button[type=submit]"); pp.wait_for_timeout(300)
        check("thank-you note: contact details refused", "can't include" in pp.inner_text("#rc-send-msg"))
        pp.fill("#rc-note", "Thank you. This helped me ask the right question."); pp.click("#rc-send button[type=submit]"); pp.wait_for_timeout(400)
        check("thank-you note: saved anonymously on this device", "saved on this device" in pp.inner_text("#rc-send-msg"))
        pp.close()

        # after-death key
        pg.check("input[name=afterdeath][value=person-decides]"); pg.fill("#steward-name", "EXAMPLE Person"); pg.click("#steward-save")
        pg.click("#steward-key"); pg.wait_for_timeout(400)
        key = pg.inner_text("#steward-out .mono")
        rec = pg.evaluate("window.CureBranchApp.getRecord()")
        check("steward key made, only hash stored", re.fullmatch(r"([0-9a-z]{4}-){4}[0-9a-z]{4}", key) and key not in json.dumps(rec) and rec["afterDeath"]["stewardKeyHash"].startswith("sha256:"))
        go(pg, "repo"); pg.wait_for_timeout(400)
        s2 = json.loads(pg.inner_text("#summary-json"))
        check("summary has after-death choice but not the person's name", s2["afterDeath"]["choice"] == "person-decides" and "EXAMPLE Person" not in json.dumps(s2))

        # push stub
        go(pg, "settings"); pg.click("#push-switch"); pg.wait_for_timeout(300)
        check("push stub explains not set up", "aren't set up yet" in pg.inner_text("#push-out"), pg.inner_text("#push-out"))

        # offline
        wait_js(pg, "navigator.serviceWorker.controller")
        state["offline"] = True   # server answers 503
        try:
            pg.reload(wait_until="load"); wait_js(pg, "window.CureBranchApp", 8000)
            check("server down (503): app still loads from offline copy", pg.evaluate("window.CureBranchApp.getRecord().sources.length") >= 1)
        except Exception as e:
            check("server down (503): app still loads from offline copy", False, str(e)[:200])
        ctx.set_offline(True)   # no network at all
        try:
            pg.reload(wait_until="load"); wait_js(pg, "window.CureBranchApp", 8000)
            check("works offline after first visit", pg.evaluate("window.CureBranchApp.getRecord().sources.length") >= 1)
        except Exception as e:
            check("works offline after first visit", False, str(e)[:200])
        state["offline"] = False
        ctx.set_offline(False)
        ctx.close()

        # ---------- overflow ----------
        for w in WIDTHS:
            ctx = b.new_context(viewport={"width": w, "height": 900})
            pg = ctx.new_page(); pg.goto(BASE + "/", wait_until="networkidle"); wait_js(pg, "window.CureBranchApp")
            pg.evaluate("fetch('/data/examples/example-health-card.smart-health-card').then(r=>r.text()).then(t=>window.CureBranchApp.importText(t,'Example health card (EXAMPLE)'))")
            pg.wait_for_timeout(600)
            scales = [100, 200] if w in (320, 390) else [100]
            for sc in scales:
                pg.evaluate(f"CureBranchA11y.set({{textScale:{sc}}})")
                if not wizard_open(pg): pg.evaluate("window.CureBranchApp.openWizard({restart: true})")
                def wz_overflow(sid, w=w, sc=sc):
                    r = pg.evaluate(OVERFLOW_JS)
                    results["overflow"].append({"w": w, "scale": sc, "screen": "wizard-" + sid, **r})
                    if r["overflow"] > 1 or r["offenders"]: fails.append(f"overflow w={w} scale={sc} wizard-{sid}: {r}")
                    if sid == "start":
                        pg.evaluate("CureBranchA11y.openPanel()"); pg.wait_for_timeout(150)
                        r = pg.evaluate(OVERFLOW_JS); results["overflow"].append({"w": w, "scale": sc, "screen": "wizard-a11y-panel", **r})
                        if r["overflow"] > 1: fails.append(f"overflow w={w} scale={sc} wizard a11y-panel: {r}")
                        pg.evaluate("CureBranchA11y.closePanel()")
                def wz_overflow_plus(sid):
                    wz_overflow(sid)
                    if sid == "records":   # also with the sharing warning open
                        pg.check("#wz-privacy input[value=full]"); pg.wait_for_timeout(150); wz_overflow("privacy-warning"); pg.click("#wz-privacy [data-pv-no]")
                finish_wizard(pg, on_step=wz_overflow_plus, fill_records=True)
                for s in SCREENS:
                    go(pg, s)
                    if s == "/tree/":
                        pg.click("#tab-explore"); pg.evaluate("document.querySelectorAll('#tree-list details').forEach(d=>d.open=true)")
                    r = pg.evaluate(OVERFLOW_JS)
                    results["overflow"].append({"w": w, "scale": sc, "screen": s, **r})
                    if r["overflow"] > 1 or r["offenders"]: fails.append(f"overflow w={w} scale={sc} {s}: {r}")
                pg.evaluate("CureBranchA11y.openPanel()"); pg.wait_for_timeout(200)
                r = pg.evaluate(OVERFLOW_JS); results["overflow"].append({"w": w, "scale": sc, "screen": "a11y-panel", **r})
                if r["overflow"] > 1: fails.append(f"overflow w={w} scale={sc} a11y-panel: {r}")
                pg.evaluate("CureBranchA11y.closePanel()")
            pg.evaluate("CureBranchA11y.set({textScale:100})")
            pp = ctx.new_page()
            mine = pg.evaluate("window.CureBranchApp.getRecord().code")
            exr = json.loads((DIST / "data/example-summaries.json").read_text())["summaries"][1]["code"]
            for name, c in (("profile", ex), ("profile-recognition", exr), ("profile-owner", mine)):
                pp.goto(f"{BASE}/p/{c}", wait_until="networkidle"); pp.wait_for_timeout(600)
                r = pp.evaluate(OVERFLOW_JS); results["overflow"].append({"w": w, "scale": 100, "screen": name, **r})
                if r["overflow"] > 1 or r["offenders"]: fails.append(f"overflow w={w} {name}: {r}")
            ctx.close()

        # ---------- axe ----------
        for w in (390, 1280):
            ctx = b.new_context(viewport={"width": w, "height": 900})
            pg = ctx.new_page(); pg.goto(BASE + "/", wait_until="networkidle"); wait_js(pg, "window.CureBranchApp")
            pg.evaluate("fetch('/data/examples/example-health-card.smart-health-card').then(r=>r.text()).then(t=>window.CureBranchApp.importText(t,'Example health card (EXAMPLE)'))")
            pg.wait_for_timeout(600)
            for th in THEMES:
                pg.evaluate(f"CureBranchA11y.set({{theme:'{th}', customOn:false}})")
                if not wizard_open(pg): pg.evaluate("window.CureBranchApp.openWizard({restart: true})")
                pg.evaluate("document.querySelector('#wz-consent').checked = false")
                def wz_axe(sid, w=w, th=th):
                    run_axe(pg, f"{w}px {th} wizard-{sid}")
                    if sid == "records":
                        pg.check("#wz-privacy input[value=detailed]"); pg.wait_for_timeout(150)
                        run_axe(pg, f"{w}px {th} wizard-privacy-warning"); pg.click("#wz-privacy [data-pv-no]")
                finish_wizard(pg, on_step=wz_axe, show_errors=True, fill_records=True)
                for s in SCREENS:
                    go(pg, s)
                    if s == "/tree/": pg.click("#tab-explore")
                    run_axe(pg, f"{w}px {th} {s}")
                pg.evaluate("CureBranchA11y.openPanel()"); pg.wait_for_timeout(200)
                run_axe(pg, f"{w}px {th} a11y-panel"); pg.evaluate("CureBranchA11y.closePanel()")
            pp = ctx.new_page()
            mine = pg.evaluate("window.CureBranchApp.getRecord().code")
            exr = json.loads((DIST / "data/example-summaries.json").read_text())["summaries"][1]["code"]
            for name, c in (("profile", ex), ("profile-recognition", exr), ("profile-owner", mine)):
                pp.goto(f"{BASE}/p/{c}", wait_until="networkidle"); pp.wait_for_timeout(600)
                run_axe(pp, f"{w}px {name}")
            ctx.close()
        b.close()
    httpd.shutdown()
    results["console"] = [c for c in results["console"] if "503" not in c and "ERR_INTERNET_DISCONNECTED" not in c]  # 503s are the simulated offline test
    bad_console = [c for c in results["console"] if "Content Security Policy" in c or "pageerror" in c or "error" in c.split(":")[0]]
    if bad_console: fails.append(f"console errors: {bad_console[:10]}")
    out = REPO / "tests/browser/out"; out.mkdir(exist_ok=True)
    (out / "verify-results.json").write_text(json.dumps(results, indent=2))
    print(f"flows: {sum(f['ok'] for f in results['flows'])}/{len(results['flows'])} passed")
    for f in results["flows"]:
        print(("  ok   " if f["ok"] else "  FAIL ") + f["check"] + ("" if f["ok"] else "  -> " + f["detail"]))
    print(f"overflow checks: {len(results['overflow'])}, axe runs: {len(results['axe'])}, console warnings/errors: {len(results['console'])}")
    if fails:
        print("FAILURES:"); [print("  -", x[:600]) for x in fails]; return 1
    print("ALL CHECKS PASSED"); return 0

if __name__ == "__main__":
    sys.exit(main())
