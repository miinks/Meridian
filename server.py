#!/usr/bin/env python3
"""Serve Meridian and proxy OpenSky (browsers cannot call OpenSky directly)."""

from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
OPEN_SKY = "https://opensky-network.org/api"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/opensky"):
            self.proxy_opensky(parsed)
            return
        super().do_GET()

    def proxy_opensky(self, parsed):
        upstream = f"{OPEN_SKY}{parsed.path[len('/api/opensky'):]}"
        if parsed.query:
            upstream = f"{upstream}?{parsed.query}"

        request = Request(upstream, headers={"User-Agent": "Meridian/0.1"})
        try:
            with urlopen(request, timeout=12) as response:
                body = response.read()
                self.send_response(response.status)
                self.send_header("Content-Type", response.headers.get("Content-Type", "application/json"))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
        except HTTPError as error:
            body = error.read()
            self.send_response(error.code)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body or str(error).encode())
        except URLError as error:
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(f'{{"error": "{error.reason}"}}'.encode())

    def log_message(self, format, *args):
        if self.path.startswith("/api/opensky") or args[1] != "200":
            super().log_message(format, *args)


if __name__ == "__main__":
    port = 5173
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Meridian is running at http://127.0.0.1:{port}")
    server.serve_forever()
