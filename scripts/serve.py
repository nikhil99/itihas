#!/usr/bin/env python3
"""Local dev server for site/ that tells browsers not to cache anything,
so edits to app.js / styles.css / data/*.json show up on a normal reload.

    python3 scripts/serve.py [port]      (default 8095)
"""
import functools
import http.server
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "site"


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8095
    handler = functools.partial(NoCacheHandler, directory=str(SITE))
    with http.server.ThreadingHTTPServer(("", port), handler) as httpd:
        print(f"Serving {SITE} at http://localhost:{port}")
        httpd.serve_forever()
