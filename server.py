#!/usr/bin/env python3
"""Serve Meridian and proxy OpenSky (browsers cannot call OpenSky directly)."""

import json
import os
import time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
OPEN_SKY = "https://opensky-network.org/api"
TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token"
RATE_HEADERS = ("X-Rate-Limit-Remaining", "X-Rate-Limit-Retry-After-Seconds")


def load_credentials():
    client_id = os.environ.get("OPENSKY_CLIENT_ID")
    client_secret = os.environ.get("OPENSKY_CLIENT_SECRET")
    path = ROOT / "credentials.json"
    if (not client_id or not client_secret) and path.exists():
        data = json.loads(path.read_text(encoding="utf-8"))
        client_id = client_id or data.get("clientId") or data.get("client_id")
        client_secret = client_secret or data.get("clientSecret") or data.get("client_secret")
    return client_id, client_secret


class TokenManager:
    def __init__(self):
        self.client_id, self.client_secret = load_credentials()
        self.token = None
        self.expires_at = 0

    @property
    def authenticated(self):
        return bool(self.client_id and self.client_secret)

    def clear(self):
        self.token = None
        self.expires_at = 0

    def get_token(self):
        if not self.authenticated:
            return None
        if self.token and time.time() < self.expires_at:
            return self.token

        body = urlencode(
            {
                "grant_type": "client_credentials",
                "client_id": self.client_id,
                "client_secret": self.client_secret,
            }
        ).encode()
        request = Request(
            TOKEN_URL,
            data=body,
            headers={"Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Meridian/0.2"},
        )
        with urlopen(request, timeout=12) as response:
            data = json.loads(response.read().decode())
        self.token = data["access_token"]
        self.expires_at = time.time() + int(data.get("expires_in", 1800)) - 30
        return self.token


tokens = TokenManager()


def retry_after_seconds(headers):
    if not headers:
        return None
    raw = headers.get("X-Rate-Limit-Retry-After-Seconds") or headers.get("Retry-After")
    try:
        value = int(float(raw))
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def rate_header_map(headers):
    extra = {}
    if not headers:
        return extra
    for name in RATE_HEADERS:
        value = headers.get(name)
        if value:
            extra[name] = value
    return extra


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/status":
            self.send_json(200, {"authenticated": tokens.authenticated})
            return
        if parsed.path.startswith("/api/opensky"):
            self.proxy_opensky(parsed)
            return
        super().do_GET()

    def send_json(self, status, payload, extra_headers=None):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        if extra_headers:
            for name, value in extra_headers.items():
                if value is not None:
                    self.send_header(name, str(value))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def proxy_opensky(self, parsed):
        upstream = f"{OPEN_SKY}{parsed.path[len('/api/opensky'):]}"
        if parsed.query:
            upstream = f"{upstream}?{parsed.query}"

        last_error = None
        for attempt in range(2):
            headers = {"User-Agent": "Meridian/0.2"}
            token = tokens.get_token()
            if token:
                headers["Authorization"] = f"Bearer {token}"
            request = Request(upstream, headers=headers)
            try:
                with urlopen(request, timeout=20) as response:
                    body = response.read()
                    self.send_response(response.status)
                    self.send_header("Content-Type", response.headers.get("Content-Type", "application/json"))
                    self.send_header("Cache-Control", "no-store")
                    for name, value in rate_header_map(response.headers).items():
                        self.send_header(name, value)
                    self.end_headers()
                    self.wfile.write(body)
                    return
            except HTTPError as error:
                if error.code == 401 and attempt == 0 and tokens.authenticated:
                    tokens.clear()
                    last_error = error
                    continue
                extra = rate_header_map(error.headers)
                if error.code == 429:
                    retry = retry_after_seconds(error.headers)
                    if retry is not None:
                        extra["X-Rate-Limit-Retry-After-Seconds"] = str(retry)
                    self.send_json(
                        429,
                        {"error": "Too many requests", "retryAfterSeconds": retry},
                        extra_headers=extra,
                    )
                    return
                body = error.read()
                self.send_response(error.code)
                self.send_header("Content-Type", "application/json")
                for name, value in extra.items():
                    self.send_header(name, value)
                self.send_header("Content-Length", str(len(body or b"")))
                self.end_headers()
                self.wfile.write(body or json.dumps({"error": str(error)}).encode())
                return
            except URLError as error:
                self.send_json(502, {"error": str(error.reason)})
                return

        if last_error:
            self.send_json(401, {"error": "OpenSky authentication failed"})

    def end_headers(self):
        if not urlparse(self.path).path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format, *args):
        # Never let logging abort a response. A closed stderr pipe (background
        # terminal) used to reset /api/* connections with an empty reply.
        try:
            status = args[1] if len(args) > 1 else ""
            if self.path.startswith("/api/") or status != "200":
                super().log_message(format, *args)
        except OSError:
            pass


if __name__ == "__main__":
    port = 5173
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    mode = "authenticated" if tokens.authenticated else "anonymous"
    print(f"Meridian is running at http://127.0.0.1:{port} ({mode} OpenSky)")
    server.serve_forever()
