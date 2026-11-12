#!/usr/bin/env python3
"""GitHub Pages stand-in: serves dist/ with NO custom headers and NO redirects, and answers
unknown paths with dist/404.html (status 404), like GitHub Pages does. Checks that the app,
the How it started page and /p/<code> profile addresses work there, with the meta-tag CSP on
and no console errors. Run after: npm run build:test"""
import http.server, socketserver, threading, json, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parents[2]
DIST = REPO / "dist"
PORT = 37133
BASE = f"http://127.0.0.1:{PORT}"

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(DIST), **k)
    def log_message(self, *a): pass
    def send_head(self):
        path = Path(self.translate_path(self.path))
        if not path.exists():
            body = (DIST / "404.html").read_bytes()
            self.send_response(404); self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body))); self.end_headers()
            import io; return io.BytesIO(body)
        return super().send_head()
    def guess_type(self, path):
        return "application/manifest+json" if str(path).endswith(".webmanifest") else super().guess_type(path)

class S(socketserver.ThreadingTCPServer):
    allow_reuse_address = True; daemon_threads = True

def main():
    fails = []
    def check(name, ok, detail=""):
        print(("  ok   " if ok else "  FAIL ") + name + ("" if ok else "  -> " + str(detail)[:300]))
        if not ok: fails.append(name)
    for f in ("404.html", ".nojekyll", "CNAME"):
        check(f"dist/{f} exists", (DIST / f).exists())
    check("CNAME is curebranch.ai", (DIST / "CNAME").read_text().strip() == "curebranch.ai")
    httpd = S(("127.0.0.1", PORT), H); threading.Thread(target=httpd.serve_forever, daemon=True).start()
    code = json.loads((DIST / "data/example-summaries.json").read_text())["summaries"][0]["code"]
    with sync_playwright() as p:
        b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 390, "height": 844}); pg = ctx.new_page()
        logs = []
        pg.on("console", lambda m: logs.append(f"{m.type}: {m.text}") if m.type == "error" else None)
        pg.on("pageerror", lambda e: logs.append(f"pageerror: {e}"))
        pg.goto(BASE + "/", wait_until="networkidle"); pg.wait_for_timeout(500)
        check("app loads at the domain root", pg.evaluate("!!window.CureBranchApp"))
        check("CSP is set by a meta tag", pg.evaluate("!!document.querySelector('meta[http-equiv=Content-Security-Policy]')"))
        check("service worker registers with scope /", pg.evaluate("navigator.serviceWorker.ready.then(r => new URL(r.scope).pathname)") == "/")
        r = pg.goto(f"{BASE}/p/{code}", wait_until="networkidle"); pg.wait_for_timeout(800)
        check("/p/<code> loads the profile page via 404.html", pg.evaluate("location.pathname") == f"/p/{code}" and code in pg.evaluate("document.body.innerText"), pg.evaluate("document.body.innerText")[:200])
        pg.goto(BASE + "/how-it-started.html", wait_until="networkidle"); pg.wait_for_timeout(600)
        check("old /how-it-started.html forwards to /how-it-started/", pg.evaluate("location.pathname") == "/how-it-started/")
        check("How it started page loads, with its setup links", pg.evaluate("document.querySelectorAll('a[href=\"/?setup=1\"]').length") >= 1)
        # Real addresses load directly (a shared link or a refresh), with no server rewrites
        for path, h1 in (("/cancers/breast/her2-positive/", "HER2-positive breast cancer"), ("/cancers/breast/", "Breast cancer"), ("/how-it-works/", None),
                         ("/privacy/", None), ("/sources/", None), ("/my-branch/", None), ("/help/", None), ("/cancers/lung/lung-adenocarcinoma/", None)):
            r = pg.goto(BASE + path, wait_until="networkidle"); pg.wait_for_timeout(300)
            got = pg.evaluate("(document.querySelector('.screen.active h1') || {}).textContent || ''")
            check(f"{path} loads directly (200) on the right page", r.status == 200 and pg.evaluate("location.pathname") == path and got.strip() and (h1 is None or got == h1), f"{r.status} {got}")
        pg.reload(wait_until="networkidle"); pg.wait_for_timeout(300)
        check("refresh on a deep link stays put", pg.evaluate("location.pathname") == "/cancers/lung/lung-adenocarcinoma/" and pg.evaluate("!!document.querySelector('#s-cancer.active #cancer-title')"))
        pg.goto(BASE + "/cancers/breast", wait_until="networkidle"); pg.wait_for_timeout(300)
        check("/cancers/breast (no slash) ends up at /cancers/breast/", pg.evaluate("location.pathname") == "/cancers/breast/")
        r = pg.goto(BASE + "/nope/", wait_until="networkidle"); pg.wait_for_timeout(500)
        check("unknown address gives a real 404 page", r.status == 404 and "Page not found" in pg.evaluate("document.body.innerText") and pg.title().startswith("Page not found"), pg.title())
        check("404 page links back home", pg.evaluate("!!document.querySelector('main a[href=\"/\"]')"))
        bad = [l for l in logs if "404" not in l]  # the deliberate /nope/ and /p/ 404s
        check("no console errors or CSP violations", not bad, bad)
        b.close()
    httpd.shutdown()
    print("ALL GITHUB PAGES CHECKS PASSED" if not fails else f"FAILURES: {fails}")
    return 1 if fails else 0

if __name__ == "__main__":
    sys.exit(main())
