"""Tiny local stand-in for Cloudflare Pages: serves a folder and applies app/_headers
(simplified: exact paths + "/*") and the /p/:code -> /profile.html rewrite from app/_redirects.
Usage: python3 tests/browser/server.py [dir] [port]"""
import http.server, socketserver, sys, re, threading
from pathlib import Path

def parse_headers(path):
    rules, cur = {}, None
    for line in Path(path).read_text().splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if not line.startswith(" "):
            cur = line.strip(); rules.setdefault(cur, [])
        else:
            k, v = line.strip().split(":", 1); rules[cur].append((k.strip(), v.strip()))
    return rules

def make_handler(root, rules, state):
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw): super().__init__(*a, directory=str(root), **kw)
        def log_message(self, *a): pass
        def translate_path(self, path):
            p = path.split("?", 1)[0]
            if re.match(r"^/p/[^/]+/?$", p): path = "/profile.html"
            return super().translate_path(path)
        def end_headers(self):
            p = self.path.split("?", 1)[0]
            for k, v in rules.get("/*", []) + rules.get(p, []):
                self.send_header(k, v)
            super().end_headers()
        def do_GET(self):
            state.setdefault("hits", []).append(self.path)
            if self.headers.get("Sec-Fetch-Mode") == "navigate":
                state.setdefault("navs", []).append(self.path)
            if state.get("offline"):
                self.send_error(503); return
            return super().do_GET()
    return H

class S(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

def start(root, port, headers_file=None):
    root = Path(root)
    rules = parse_headers(headers_file or root / "_headers")
    state = {}
    httpd = S(("127.0.0.1", port), make_handler(root, rules, state))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, state

if __name__ == "__main__":
    d = sys.argv[1] if len(sys.argv) > 1 else "dist"; port = int(sys.argv[2]) if len(sys.argv) > 2 else 8787
    httpd, _ = start(d, port)
    print(f"Serving {d} on http://127.0.0.1:{port}")
    threading.Event().wait()
