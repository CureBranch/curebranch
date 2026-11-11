#!/usr/bin/env python3
"""Browser checks for the built app (dist/). Run: npm run build:test && python3 tests/browser/verify.py
 * no horizontal overflow on any screen at 320/390/768/1280 px (and 200% text at 320/390)
 * axe-core WCAG 2.0/2.1/2.2 A+AA on every screen and all 5 color themes
 * import: example SMART Health Card (verified), example FHIR file via the file picker
   (unverified), tampered card (unverified); data survives a reload (IndexedDB)
 * public switch, summary preview, profile page (anonymous by default, name when opted in)
 * offline: app reloads with the network off once the service worker is installed
 * setup guide (first-run wizard): opens on first visit, one step at a time, consent gate,
   guided hospital-portal connect (demo stub), supporting photo linked to the official record
   with the consistency check (matches / mismatch), resume after reload, re-run from Settings,
   saved record matches schema/local-record.schema.json; every wizard step also gets the
   overflow (320-1280 px, 200% text) and axe (all themes) checks
 * no console errors / CSP violations
"""
import json, sys, re, subprocess
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from server import start
from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parents[2]
DIST = REPO / "dist"
PORT = 37111
BASE = f"http://127.0.0.1:{PORT}"
AXE = (REPO / "node_modules/axe-core/axe.min.js").read_text()
WIDTHS = [320, 390, 768, 1280]
SCREENS = ["home", "start", "import", "repo", "tree", "settings", "a11y"]
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

WZ_STEPS = ["welcome", "profile", "records", "privacy", "after", "ai", "done"]
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
    wait_js(pg, "!document.querySelector('#wizard').hidden")
    for sid in WZ_STEPS:
        wait_js(pg, f"!document.querySelector('#wz-{sid}').hidden")
        if sid == "welcome" and show_errors and not pg.is_checked("#wz-consent"):
            pg.click("#wz-next"); pg.wait_for_timeout(100)
        if sid == "records" and fill_records:
            if not pg.evaluate("window.CureBranchApp.getRecord().sources.length"): connect_demo(pg)
            else: pg.check("input[name=wz-portal][value=mychart]")
            if not pg.evaluate("(window.CureBranchApp.getRecord().files || []).length"):
                attach_photo(pg); fill_claim(pg, "2026-05-01", "PD-L1", "10%")
        if sid == "ai": pg.check("input[name=wz-ai][value=Grok]")
        if on_step: on_step(sid)
        if sid == "welcome": pg.check("#wz-consent")
        if sid == "after" and not pg.evaluate("!!document.querySelector('input[name=wz-afterdeath]:checked')"):
            pg.check("input[name=wz-afterdeath][value=keep-private]")
        pg.click("#wz-next")
    wait_js(pg, "document.querySelector('#wizard').hidden")
    pg.wait_for_timeout(200)

def wizard_flow(b):
    """The setup guide, end to end, the way a patient would use it (390 px phone)."""
    ctx = b.new_context(viewport={"width": 390, "height": 844})
    pg = ctx.new_page()
    pg.on("console", lambda m: results["console"].append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    pg.on("pageerror", lambda e: results["console"].append(f"pageerror: {e}"))
    pg.goto(BASE + "/", wait_until="networkidle"); wait_js(pg, "window.CureBranchApp")
    check("wizard: opens by itself on first visit", wizard_open(pg) and not pg.is_visible("#tabs"))
    check("wizard: step 1 of 7, 7 progress dots, current one marked", pg.inner_text("#wz-count") == "Step 1 of 7"
          and pg.locator("#wz-dots li").count() == 7 and pg.locator("#wz-dots li[aria-current=step]").count() == 1)
    check("wizard: a Listen button on every step", pg.evaluate("[...document.querySelectorAll('#wizard .wz-step')].every(s => s.querySelectorAll('.listen-bar [data-act=play]').length === 1)"))
    check("wizard: Back hidden on step 1", not pg.is_visible("#wz-back"))
    check("wizard: consent video slot + disclaimer shown", pg.is_visible("#wz-video") and "not medical advice" in pg.inner_text("#wz-welcome"))
    pg.click("#wz-next"); pg.wait_for_timeout(150)
    check("wizard: can't go on without 'I watched and understand'", pg.inner_text("#wz-count") == "Step 1 of 7"
          and "check the box" in pg.inner_text("#wz-consent-err") and pg.evaluate("document.activeElement.id") == "wz-consent")
    pg.check("#wz-consent"); pg.click("#wz-next"); wait_js(pg, "!document.querySelector('#wz-profile').hidden")
    rec = pg.evaluate("window.CureBranchApp.getRecord()")
    check("wizard: consent saved with time and video version", rec["onboarding"]["consent"]["watchedAndUnderstood"] is True and rec["onboarding"]["consent"]["videoVersion"] == "placeholder")
    code = pg.inner_text("#wz-code")
    check("wizard: private code shown, matches the record, no account", re.fullmatch(r"[0-9a-hjkmnp-tv-z]{6}", code) and code == rec["code"], code)
    check("wizard: focus moves to the step heading", pg.evaluate("document.activeElement.id") == "wz-h-profile")
    pg.click("#wz-new-code"); pg.wait_for_timeout(200)
    code2 = pg.inner_text("#wz-code")
    check("wizard: 'different code' makes and saves a new one", code2 != code and pg.evaluate("window.CureBranchApp.getRecord().code") == code2)
    pg.click("#wz-next"); wait_js(pg, "!document.querySelector('#wz-records').hidden")
    check("records step: is 'Connect your hospital portal'", "Connect your hospital portal" in pg.inner_text("#wz-h-records"))
    check("records step: skippable", pg.inner_text("#wz-next") == "Skip for now")
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
    t = pg.inner_text("#wz-files")
    check("consistency check: mismatch flagged in plain English, ignored by AI", f["matchStatus"] == "mismatch" and f["ignoreForAiMatching"] is True
          and "doesn't match your hospital record" in t and "AI matching will ignore it" in t and "2026-03-20" in t, t[:400])
    check("consistency check: flag gets focus (announced)", pg.evaluate("document.activeElement.id").startswith("wz-cl-flag-"))
    fill_claim(pg, "2026-03-20", "PD-L1", "70%")
    f = pg.evaluate("window.CureBranchApp.getRecord().files[0]")
    check("consistency check: correct details -> matches", f["matchStatus"] == "matches" and f["ignoreForAiMatching"] is False and "Matches your hospital record" in pg.inner_text("#wz-files"))
    check("records step: Next once a record is in", pg.inner_text("#wz-next") == "Next")
    pg.click("#wz-next"); wait_js(pg, "!document.querySelector('#wz-privacy').hidden")
    check("wizard: privacy reminder shown", "Only share what you'd be OK with the world knowing someday." in pg.inner_text("#wz-privacy"))
    check("wizard: starts private", pg.get_attribute("#wz-privacy [data-privacy-switch]", "aria-checked") == "false")
    pg.reload(wait_until="networkidle"); wait_js(pg, "window.CureBranchApp"); pg.wait_for_timeout(300)
    check("wizard: resumes at the same step after closing the app", wizard_open(pg) and pg.inner_text("#wz-count") == "Step 4 of 7")
    pg.click("#wz-privacy [data-privacy-switch]"); pg.wait_for_timeout(300)
    check("wizard: one switch turns public on", pg.evaluate("window.CureBranchApp.getRecord().privacy.public") is True and "On:" in pg.inner_text("#wz-priv-state"))
    pg.click("#wz-privacy [data-privacy-switch]"); pg.wait_for_timeout(300)
    check("wizard: and off again", pg.evaluate("window.CureBranchApp.getRecord().privacy.public") is False)
    pg.click("#wz-next"); wait_js(pg, "!document.querySelector('#wz-after').hidden")
    check("wizard: no after-death choice is picked for the patient", pg.evaluate("!document.querySelector('input[name=wz-afterdeath]:checked')"))
    pg.click("#wz-next"); pg.wait_for_timeout(150)
    check("wizard: must pick an after-death choice", pg.inner_text("#wz-count") == "Step 5 of 7" and "pick one" in pg.inner_text("#wz-after-err"))
    pg.check("input[name=wz-afterdeath][value=remove]")
    pg.fill("#wz-person", "EXAMPLE Trusted Person"); pg.fill("#wz-person-reach", "555-0100 (EXAMPLE)")
    pg.click("#wz-back"); wait_js(pg, "!document.querySelector('#wz-privacy').hidden")
    check("wizard: Back keeps what was typed", pg.evaluate("window.CureBranchApp.getRecord().afterDeath.person.name") == "EXAMPLE Trusted Person")
    pg.click("#wz-next"); wait_js(pg, "!document.querySelector('#wz-after').hidden")
    pg.check("input[name=wz-afterdeath][value=remove]")
    pg.click("#wz-next"); wait_js(pg, "!document.querySelector('#wz-ai').hidden")
    check("wizard: AI step is skippable", pg.inner_text("#wz-next") == "Skip for now" and not pg.is_visible("#wz-ai-steps"))
    pg.check("input[name=wz-ai][value=Grok]"); pg.wait_for_timeout(100)
    check("wizard: picking an AI shows the guided steps", pg.is_visible("#wz-ai-steps") and "Open Grok" in pg.inner_text("#wz-ai-steps"))
    check("wizard: no AI key field anywhere", pg.locator("#wizard input[type=password]").count() == 0)
    pg.click("#wz-next"); wait_js(pg, "!document.querySelector('#wz-done').hidden")
    t = pg.inner_text("#wz-summary")
    check("wizard: done screen sums up every choice", all(x in t for x in [code2, "2 items", "Private", "Delete my summary", "EXAMPLE Trusted Person", "Grok"]), t)
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
    go(pg, "repo"); pg.wait_for_timeout(300)
    t = pg.inner_text("#files-list")
    check("record screen lists the supporting photo with its label and check result", "photo-of-my-pathology-report-page-1.png" in t and "Supporting, from patient" in t and "Matches your hospital record" in t, t)
    go(pg, "settings"); pg.click("#rerun-wizard"); pg.wait_for_timeout(300)
    check("settings: 'Run the setup guide again' reopens at step 1", wizard_open(pg) and pg.inner_text("#wz-count") == "Step 1 of 7")
    check("re-run keeps earlier consent", pg.is_checked("#wz-consent"))
    for _ in range(4): pg.click("#wz-next"); pg.wait_for_timeout(150)
    check("re-run keeps earlier answers", pg.is_checked("input[name=wz-afterdeath][value=remove]") and pg.input_value("#wz-person") == "EXAMPLE Trusted Person")
    pg.click("#wz-later"); pg.wait_for_timeout(300)
    check("'Finish later' closes the guide", not wizard_open(pg) and pg.is_visible("#s-home"))
    pg.reload(wait_until="networkidle"); wait_js(pg, "window.CureBranchApp"); pg.wait_for_timeout(300)
    check("'Finish later' then reopen: back at the same step", wizard_open(pg) and pg.inner_text("#wz-count") == "Step 5 of 7")
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

def main():
    httpd, state = start(DIST, PORT)
    STATE.update(hits=state.setdefault("hits", []))
    with sync_playwright() as p:
        b = p.chromium.launch()
        wizard_flow(b)
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
        check("dedication present", "In honor of my dad, whose son wishes AI had come a few months sooner." in pg.inner_text("#s-home"))
        check("default is private", pg.get_attribute("[data-privacy-switch]", "aria-checked") == "false")

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
        pg.click("#s-home [data-privacy-switch]") if pg.is_visible("#s-home [data-privacy-switch]") else None
        go(pg, "home"); pg.click("#s-home [data-privacy-switch]"); pg.wait_for_timeout(300)
        go(pg, "repo"); pg.wait_for_timeout(500)
        summ = json.loads(pg.inner_text("#summary-json"))
        check("public summary built", summ["visibility"] == "public" and summ["branch"]["path"] == ["Lung", "KRAS", "G12C"], json.dumps(summ["branch"]))
        check("summary unverified because one source is unverified", summ["verification"]["status"] == "unverified")
        txt = json.dumps(summ)
        check("summary has no name/birthdate/MRN", not any(x in txt for x in ["1961", "EXAMPLE-0000", "family", "birthDate"]))
        check("summary anonymous by default", "profile" not in summ)
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
                    if sid == "welcome":
                        pg.evaluate("CureBranchA11y.openPanel()"); pg.wait_for_timeout(150)
                        r = pg.evaluate(OVERFLOW_JS); results["overflow"].append({"w": w, "scale": sc, "screen": "wizard-a11y-panel", **r})
                        if r["overflow"] > 1: fails.append(f"overflow w={w} scale={sc} wizard a11y-panel: {r}")
                        pg.evaluate("CureBranchA11y.closePanel()")
                finish_wizard(pg, on_step=wz_overflow, fill_records=True)
                for s in SCREENS:
                    go(pg, s)
                    if s == "tree":
                        pg.click("#tab-explore"); pg.evaluate("document.querySelectorAll('#tree-list details').forEach(d=>d.open=true)")
                    r = pg.evaluate(OVERFLOW_JS)
                    results["overflow"].append({"w": w, "scale": sc, "screen": s, **r})
                    if r["overflow"] > 1 or r["offenders"]: fails.append(f"overflow w={w} scale={sc} {s}: {r}")
                pg.evaluate("CureBranchA11y.openPanel()"); pg.wait_for_timeout(200)
                r = pg.evaluate(OVERFLOW_JS); results["overflow"].append({"w": w, "scale": sc, "screen": "a11y-panel", **r})
                if r["overflow"] > 1: fails.append(f"overflow w={w} scale={sc} a11y-panel: {r}")
                pg.evaluate("CureBranchA11y.closePanel()")
            pg.evaluate("CureBranchA11y.set({textScale:100})")
            pp = ctx.new_page(); pp.goto(f"{BASE}/p/{ex}", wait_until="networkidle"); pp.wait_for_timeout(500)
            r = pp.evaluate(OVERFLOW_JS); results["overflow"].append({"w": w, "scale": 100, "screen": "profile", **r})
            if r["overflow"] > 1 or r["offenders"]: fails.append(f"overflow w={w} profile: {r}")
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
                finish_wizard(pg, on_step=lambda sid, w=w, th=th: run_axe(pg, f"{w}px {th} wizard-{sid}"), show_errors=True, fill_records=True)
                for s in SCREENS:
                    go(pg, s)
                    if s == "tree": pg.click("#tab-explore")
                    run_axe(pg, f"{w}px {th} {s}")
                pg.evaluate("CureBranchA11y.openPanel()"); pg.wait_for_timeout(200)
                run_axe(pg, f"{w}px {th} a11y-panel"); pg.evaluate("CureBranchA11y.closePanel()")
            pp = ctx.new_page(); pp.goto(f"{BASE}/p/{ex}", wait_until="networkidle"); pp.wait_for_timeout(500)
            run_axe(pp, f"{w}px profile")
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
