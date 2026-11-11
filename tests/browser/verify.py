#!/usr/bin/env python3
"""Browser checks for the built app (dist/). Run: npm run build:test && python3 tests/browser/verify.py
 * no horizontal overflow on any screen at 320/390/768/1280 px (and 200% text at 320/390)
 * axe-core WCAG 2.0/2.1/2.2 A+AA on every screen and all 5 color themes
 * import: example SMART Health Card (verified), example FHIR file via the file picker
   (unverified), tampered card (unverified); data survives a reload (IndexedDB)
 * public switch, summary preview, profile page (anonymous by default, name when opted in)
 * offline: app reloads with the network off once the service worker is installed
 * no console errors / CSP violations
"""
import json, sys, re
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

def run_axe(pg, label):
    pg.evaluate(AXE)
    r = pg.evaluate("""async () => { const r = await axe.run(document, {runOnly:{type:'tag', values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}});
      return r.violations.map(v => ({id: v.id, impact: v.impact, n: v.nodes.length, t: v.nodes.slice(0,3).map(n => n.target.join(' '))})); }""")
    results["axe"].append({"view": label, "violations": r})
    if r: fails.append(f"axe {label}: {[(v['id'], v['n'], v['t']) for v in r]}")

def main():
    httpd, state = start(DIST, PORT)
    with sync_playwright() as p:
        b = p.chromium.launch()
        # ---------- flows ----------
        ctx = b.new_context(viewport={"width": 390, "height": 844})
        pg = ctx.new_page()
        pg.on("console", lambda m: results["console"].append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e: results["console"].append(f"pageerror: {e}"))
        pg.goto(BASE + "/", wait_until="networkidle")
        wait_js(pg, "window.CureBranchApp")
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
