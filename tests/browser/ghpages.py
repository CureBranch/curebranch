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
        pg.goto(BASE + "/how-it-started.html", wait_until="networkidle")
        check("How it started page loads", pg.evaluate("document.querySelectorAll('a[href=\"/?setup=1\"]').length") >= 1)
        bad = [l for l in logs if "404" not in l]
        check("no console errors or CSP violations", not bad, bad)
        b.close()
    httpd.shutdown()
    print("ALL GITHUB PAGES CHECKS PASSED" if not fails else f"FAILURES: {fails}")
    return 1 if fails else 0

if __name__ == "__main__":
    sys.exit(main())
