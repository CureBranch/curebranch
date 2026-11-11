#!/usr/bin/env python3
"""Two-build test of the PWA update flow (app/js/update.js + app/sw.js).
Deploys build A, opens it, deploys build B into the same folder, and checks:
  1. early (first ~8 s), nothing focused  -> applied silently, exactly one reload, ends on B
  2. later                                -> banner (role=status); "Later" hides it, no reload
  3. later, "Refresh"                     -> one reload, ends on B
  4. early but a text field is focused    -> banner, no reload
  5. version.json says B but sw.js is still A (stuck update) AND storage throws
                                          -> at most one automatic reload, then banner; no loop
Run: python3 tests/browser/update_flow.py
"""
import json, os, subprocess, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from server import start
from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parents[2]
SITE = Path("/tmp/cb-update-site")
PORT = 37131
BASE = f"http://127.0.0.1:{PORT}"
results = []

def deploy(build_id, version_override=None):
    env = dict(os.environ, CB_BUILD_ID=build_id, CB_OUT=str(SITE))
    subprocess.run(["node", "tools/stamp-build.mjs"], cwd=REPO, env=env, check=True, capture_output=True)
    if version_override:
        (SITE / "version.json").write_text(json.dumps({"v": version_override, "built": "test"}))

def wait_js(pg, expr, timeout=15000):
    end = time.time() + timeout / 1000
    while time.time() < end:
        try:
            if pg.evaluate(f"() => !!({expr})"): return True
        except Exception: pass
        time.sleep(0.1)
    return False

def build_of(pg):
    try: return pg.evaluate("document.querySelector('meta[name=cb-build]').content")
    except Exception: return None

def navs(state):
    """Page navigations only (Sec-Fetch-Mode: navigate), not service-worker precache fetches."""
    return list(state.get("navs", []))

def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("  ok   " if ok else "  FAIL ") + name + ("" if ok else f"  -> {detail}"))

NO_STORAGE = """
for (const k of ['localStorage','sessionStorage']) {
  Object.defineProperty(window, k, { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } });
}"""

def fresh(browser, no_storage=False):
    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    if no_storage: ctx.add_init_script(NO_STORAGE)
    pg = ctx.new_page()
    return ctx, pg

def open_controlled(pg):
    pg.goto(BASE + "/", wait_until="load")
    wait_js(pg, "navigator.serviceWorker.controller")
    pg.reload(wait_until="load")              # a controlled, freshly opened page
    wait_js(pg, "window.CureBranchUpdate")

def main():
    deploy("buildA")
    httpd, state = start(SITE, PORT, headers_file=REPO / "app/_headers")
    state["hits"] = []
    with sync_playwright() as p:
        b = p.chromium.launch()

        # 1. silent apply
        ctx, pg = fresh(b); open_controlled(pg)
        check("1. starts on A", build_of(pg) == "buildA", build_of(pg))
        deploy("buildB"); state["hits"].clear(); state["navs"] = []
        pg.evaluate("window.CureBranchUpdate.check()")
        ok = wait_js(pg, "document.querySelector('meta[name=cb-build]').content === 'buildB' && window.CureBranchUpdate", 12000)
        time.sleep(10)
        n = len(navs(state))
        check("1. early + idle: silently updated to B", ok and build_of(pg) == "buildB", build_of(pg))
        check("1. exactly one reload, no loop", n == 1, f"navigations={navs(state)}")
        check("1. new worker controls the page", pg.evaluate("window.CureBranchUpdate._state().running") == "buildB")
        ctx.close()

        # 2 + 3. banner after the early window
        deploy("buildA")
        ctx, pg = fresh(b); open_controlled(pg)
        time.sleep(9)
        deploy("buildB"); state["hits"].clear(); state["navs"] = []
        pg.evaluate("window.CureBranchUpdate.check()")
        shown = wait_js(pg, "document.querySelector('#update-banner')", 8000)
        role = pg.evaluate("document.querySelector('#update-banner') && document.querySelector('#update-banner').getAttribute('role')")
        check("2. later: banner shown (role=status), no reload", shown and role == "status" and not navs(state), f"shown={shown} role={role} navs={navs(state)}")
        txt = pg.inner_text("#update-banner") if shown else ""
        check("2. banner has Refresh / Later / Listen", all(w in txt for w in ["New version available", "Refresh", "Later", "Listen"]), txt)
        pg.click("#update-banner [data-act=later]"); time.sleep(0.5)
        pg.evaluate("window.CureBranchUpdate.check()"); time.sleep(3)
        check("2. Later hides it and it stays hidden", not pg.evaluate("!!document.querySelector('#update-banner')") and not navs(state))
        ctx.close()

        deploy("buildA")
        ctx, pg = fresh(b); open_controlled(pg)
        time.sleep(9)
        deploy("buildB"); state["hits"].clear(); state["navs"] = []
        pg.evaluate("window.CureBranchUpdate.check()")
        wait_js(pg, "document.querySelector('#update-banner')", 8000)
        pg.click("#update-banner [data-act=refresh]")
        ok = wait_js(pg, "document.querySelector('meta[name=cb-build]').content === 'buildB'", 8000)
        time.sleep(4)
        check("3. Refresh: one reload, now on B", ok and len(navs(state)) == 1, f"build={build_of(pg)} navs={navs(state)}")
        check("3. URL marker cleaned up", "cb_v" not in pg.url, pg.url)
        ctx.close()

        # 4. focused text field inside the early window
        deploy("buildA")
        ctx, pg = fresh(b); open_controlled(pg)
        pg.evaluate("window.CureBranchApp.go('import'); document.querySelector('#shc-text').focus()")
        deploy("buildB"); state["hits"].clear(); state["navs"] = []
        pg.evaluate("window.CureBranchUpdate.check()")
        shown = wait_js(pg, "document.querySelector('#update-banner')", 8000)
        time.sleep(3)
        check("4. focused field: banner instead of reload", shown and not navs(state) and build_of(pg) == "buildA", f"navs={navs(state)}")
        ctx.close()

        # 5. stuck update + storage unavailable: loop guard
        deploy("buildA")
        ctx, pg = fresh(b, no_storage=True); open_controlled(pg)
        storage_blocked = pg.evaluate("(() => { try { sessionStorage; return false } catch (e) { return true } })()")
        deploy("buildA", version_override="buildB"); state["hits"].clear(); state["navs"] = []
        pg.reload(wait_until="load")   # fresh open: version.json says B, but only A can be installed
        time.sleep(20)
        n = len(navs(state))
        banner = pg.evaluate("!!document.querySelector('#update-banner')")
        check("5. storage blocked in this test", storage_blocked)
        check("5. stuck update: at most one automatic reload (no loop)", n <= 2, f"navigations={navs(state)}")
        check("5. then shows the banner instead", banner)
        ctx.close()
        b.close()
    httpd.shutdown()
    failed = [r for r in results if not r[1]]
    print(f"{len(results) - len(failed)}/{len(results)} update-flow checks passed")
    return 1 if failed else 0

if __name__ == "__main__":
    sys.exit(main())
