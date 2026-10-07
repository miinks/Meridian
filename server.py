#!/usr/bin/env python3
"""Proxy OpenSky for Meridian (browsers cannot call OpenSky directly).

Serves the React production build from dist/ when present.
In development the Vite app on :5173 is the site and this process is API-only.
"""

import csv
import gzip
import io
import json
import os
import threading
import time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
OPEN_SKY = "https://opensky-network.org/api"
TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token"
METAR_CACHE_URL = "https://aviationweather.gov/data/cache/metars.cache.csv.gz"
RATE_HEADERS = ("X-Rate-Limit-Remaining", "X-Rate-Limit-Retry-After-Seconds")
CEILING_COVER = {"BKN", "OVC", "OVX", "VV"}
METAR_TTL = 90


def load_aircraft_db():
    icao_path = ROOT / "data" / "icao-typecode.json.gz"
    names_path = ROOT / "data" / "typecode-names.json"
    icao_map, names = {}, {}
    if icao_path.exists():
        with gzip.open(icao_path, "rt", encoding="utf-8") as handle:
            icao_map = json.load(handle)
    if names_path.exists():
        names = json.loads(names_path.read_text(encoding="utf-8"))
    return icao_map, names


ICAO_TYPECODES, TYPECODE_NAMES = load_aircraft_db()


def enrich_states(body):
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return body
    states = payload.get("states")
    if not states or not ICAO_TYPECODES:
        return body
    aircraft = {}
    for row in states:
        if not row:
            continue
        icao = (row[0] or "").lower()
        typecode = ICAO_TYPECODES.get(icao)
        if not typecode:
            continue
        names = TYPECODE_NAMES.get(typecode) or {}
        aircraft[icao] = {
            "typecode": typecode,
            "model": names.get("m") or "",
            "manufacturer": names.get("n") or "",
        }
    payload["aircraft"] = aircraft
    return json.dumps(payload).encode()


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


def parse_csv_number(value):
    text = (value or "").strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def important_airport_idents():
    idents = set()
    airports_path = ROOT / "public" / "airports.json"
    runways_path = ROOT / "public" / "runways.json"
    if airports_path.exists():
        for row in json.loads(airports_path.read_text(encoding="utf-8")):
            if row and row[0] == "L" and row[1]:
                idents.add(row[1])
    if runways_path.exists():
        for row in json.loads(runways_path.read_text(encoding="utf-8")):
            if row and row[0]:
                idents.add(row[0])
    return idents


def compact_metar_row(row, header):
    columns = {name: index for index, name in enumerate(header)}
    get = lambda name: row[columns[name]] if name in columns and columns[name] < len(row) else ""
    ident = (get("station_id") or "").strip().upper()
    if not ident:
        return None
    layers = []
    index = 0
    while index < len(header):
        if header[index] == "sky_cover":
            sky = row[index].strip().upper() if index < len(row) else ""
            height = (
                parse_csv_number(row[index + 1])
                if index + 1 < len(header) and header[index + 1] == "cloud_base_ft_agl" and index + 1 < len(row)
                else None
            )
            if sky:
                layers.append((sky, height))
            index += 2
            continue
        index += 1
    cover, base = "", None
    for sky, height in layers:
        if sky in CEILING_COVER and height is not None and (base is None or height < base):
            cover, base = sky, height
    if not cover and layers:
        cover, base = layers[0]
    visib = (get("visibility_statute_mi") or "").strip()
    vis_number = parse_csv_number(visib.replace("+", ""))
    cat = (get("flight_category") or "").strip().upper()
    if cat in {"", "NULL", "UNK", "UNKNOWN"}:
        cat = None
    return {
        "id": ident,
        "cat": cat,
        "raw": (get("raw_text") or "").strip() or None,
        "temp": parse_csv_number(get("temp_c")),
        "dewp": parse_csv_number(get("dewpoint_c")),
        "wdir": parse_csv_number(get("wind_dir_degrees")),
        "wspd": parse_csv_number(get("wind_speed_kt")),
        "wgst": parse_csv_number(get("wind_gust_kt")),
        "vis": visib or None,
        "visSm": vis_number,
        "altim": parse_csv_number(get("altim_in_hg")),
        "wx": (get("wx_string") or "").strip() or None,
        "cover": cover or None,
        "base": base,
        "time": (get("observation_time") or "").strip() or None,
    }


class MetarCache:
    def __init__(self):
        self.lock = threading.Lock()
        self.fetched_at = 0
        self.payload = []
        self.idents = important_airport_idents()

    def get(self):
        now = time.time()
        with self.lock:
            if self.payload and now - self.fetched_at < METAR_TTL:
                return self.payload
            request = Request(METAR_CACHE_URL, headers={"User-Agent": "Meridian/0.2 (flight map)"})
            with urlopen(request, timeout=25) as response:
                text = gzip.decompress(response.read()).decode("utf-8", errors="replace")
            reader = csv.reader(io.StringIO(text))
            header = next(reader, None)
            if not header:
                self.payload = []
                self.fetched_at = now
                return self.payload
            rows = []
            for row in reader:
                ident = row[1].strip().upper() if len(row) > 1 else ""
                if self.idents and ident not in self.idents:
                    continue
                item = compact_metar_row(row, header)
                if item:
                    rows.append(item)
            self.payload = rows
            self.fetched_at = now
            return self.payload


metars = MetarCache()


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
        directory = str(DIST if DIST.is_dir() else ROOT)
        super().__init__(*args, directory=directory, **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/status":
            self.send_json(200, {"authenticated": tokens.authenticated})
            return
        if parsed.path == "/api/metar":
            try:
                self.send_json(200, metars.get())
            except (HTTPError, URLError, OSError, TimeoutError) as error:
                reason = getattr(error, "reason", None) or str(error)
                self.send_json(502, {"error": str(reason)})
            return
        if parsed.path.startswith("/api/opensky"):
            self.proxy_opensky(parsed)
            return
        if DIST.is_dir():
            super().do_GET()
            return
        self.send_json(
            404,
            {
                "error": "Meridian is the React app at the repo root. "
                "Run npm run dev, or npm run build to serve dist from this server."
            },
        )

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
                    if "/states/" in parsed.path:
                        body = enrich_states(body)
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
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    mode = "authenticated" if tokens.authenticated else "anonymous"
    frontend = f"serving {DIST}" if DIST.is_dir() else "API only; site is Vite on :5173"
    print(f"Meridian proxy at http://127.0.0.1:{port} ({mode} OpenSky, {frontend}, {len(ICAO_TYPECODES):,} aircraft types)")
    server.serve_forever()
