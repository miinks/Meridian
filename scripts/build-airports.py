#!/usr/bin/env python3
"""Rebuild public/airports.json and public/runways.json from OurAirports."""

import csv
import io
import json
import math
import re
import urllib.request
from pathlib import Path

AIRPORTS_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv"
RUNWAYS_URL = "https://davidmegginson.github.io/ourairports-data/runways.csv"
KEEP = {
    "large_airport": "L",
    "medium_airport": "M",
    "small_airport": "S",
    "seaplane_base": "P",
}
ROOT = Path(__file__).resolve().parent.parent
AIRPORTS_OUT = ROOT / "public" / "airports.json"
RUNWAYS_OUT = ROOT / "public" / "runways.json"
HELIPAD = re.compile(r"^H\d", re.I)
INTERNATIONAL = re.compile(r"international|intercontinental|\bintl\.?\b", re.I)
RUNWAY_IDENT = re.compile(r"^(\d{1,2})([LCR])?$")
EARTH_M = 6_371_000
FT_M = 0.3048


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "Meridian/0.2"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read().decode("utf-8", errors="replace")


def parse_float(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def destination(lat, lon, heading_deg, distance_m):
    bearing = math.radians(heading_deg)
    lat1 = math.radians(lat)
    lon1 = math.radians(lon)
    angular = distance_m / EARTH_M
    lat2 = math.asin(
        math.sin(lat1) * math.cos(angular) + math.cos(lat1) * math.sin(angular) * math.cos(bearing)
    )
    lon2 = lon1 + math.atan2(
        math.sin(bearing) * math.sin(angular) * math.cos(lat1),
        math.cos(angular) - math.sin(lat1) * math.sin(lat2),
    )
    return math.degrees(lat2), (math.degrees(lon2) + 540) % 360 - 180


def heading_ident(degrees):
    number = int(round(degrees / 10.0)) % 36
    if number == 0:
        number = 36
    return f"{number:02d}"


def normalize_ident(ident):
    ident = (ident or "").strip().upper()
    match = RUNWAY_IDENT.match(ident)
    if not match:
        return ident
    number = int(match.group(1))
    if number == 0:
        number = 36
    suffix = match.group(2) or ""
    return f"{number:02d}{suffix}"


def valid_point(lat, lon):
    return lat is not None and lon is not None and -90 <= lat <= 90 and -180 <= lon <= 180 and not (lat == 0 and lon == 0)


def is_international(kind, name):
    if kind == "L":
        return True
    return kind == "M" and bool(INTERNATIONAL.search(name or ""))


def build_airports(text):
    rows = []
    lookup = {}
    for row in csv.DictReader(io.StringIO(text)):
        kind = KEEP.get((row.get("type") or "").strip())
        if not kind:
            continue
        lat = parse_float(row.get("latitude_deg"))
        lon = parse_float(row.get("longitude_deg"))
        if not valid_point(lat, lon):
            continue
        ident = (row.get("ident") or "").strip()
        iata = (row.get("iata_code") or "").strip()
        name = (row.get("name") or ident or "Airport").strip()
        rows.append([kind, ident, iata, name, round(lon, 5), round(lat, 5)])
        lookup[ident] = {
            "kind": kind,
            "name": name,
            "lat": lat,
            "lon": lon,
            "international": is_international(kind, name),
        }
    return rows, lookup


def build_runways(text, airports):
    runways = []
    for row in csv.DictReader(io.StringIO(text)):
        ident = (row.get("airport_ident") or "").strip()
        airport = airports.get(ident)
        if not airport or not airport["international"]:
            continue
        if (row.get("closed") or "").strip() == "1":
            continue
        le = (row.get("le_ident") or "").strip().upper()
        he = (row.get("he_ident") or "").strip().upper()
        if HELIPAD.match(le) or HELIPAD.match(he):
            continue
        length_ft = parse_float(row.get("length_ft"))
        if length_ft is not None and length_ft < 2500:
            continue
        surface = (row.get("surface") or "").strip().upper()
        if "WATER" in surface:
            continue
        length_m = (length_ft or 0) * FT_M
        le_heading = parse_float(row.get("le_heading_degT"))
        he_heading = parse_float(row.get("he_heading_degT"))
        if le_heading is None and he_heading is not None:
            le_heading = (he_heading + 180) % 360
        if he_heading is None and le_heading is not None:
            he_heading = (le_heading + 180) % 360

        le_lat = parse_float(row.get("le_latitude_deg"))
        le_lon = parse_float(row.get("le_longitude_deg"))
        he_lat = parse_float(row.get("he_latitude_deg"))
        he_lon = parse_float(row.get("he_longitude_deg"))
        low = (le_lat, le_lon) if valid_point(le_lat, le_lon) else None
        high = (he_lat, he_lon) if valid_point(he_lat, he_lon) else None
        if low is None and high is None and le_heading is not None and length_m:
            low = destination(airport["lat"], airport["lon"], (le_heading + 180) % 360, length_m / 2)
            high = destination(airport["lat"], airport["lon"], le_heading, length_m / 2)
        elif low is None and high is not None and le_heading is not None and length_m:
            low = destination(high[0], high[1], (le_heading + 180) % 360, length_m)
        elif high is None and low is not None and le_heading is not None and length_m:
            high = destination(low[0], low[1], le_heading, length_m)
        if low is None or high is None:
            continue
        if abs(low[0] - high[0]) < 1e-6 and abs(low[1] - high[1]) < 1e-6:
            continue
        if not le and le_heading is not None:
            le = heading_ident(le_heading)
        if not he and he_heading is not None:
            he = heading_ident(he_heading)
        le = normalize_ident(le)
        he = normalize_ident(he)
        if not le and not he:
            continue
        runways.append(
            [
                ident,
                le,
                he,
                round(low[1], 6),
                round(low[0], 6),
                round(high[1], 6),
                round(high[0], 6),
            ]
        )
    runways.sort(key=lambda row: (row[0], row[1], row[2]))
    return runways


def main():
    airport_rows, lookup = build_airports(fetch(AIRPORTS_URL))
    AIRPORTS_OUT.write_text(json.dumps(airport_rows, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(airport_rows)} airports to {AIRPORTS_OUT} ({AIRPORTS_OUT.stat().st_size} bytes)")

    runway_rows = build_runways(fetch(RUNWAYS_URL), lookup)
    RUNWAYS_OUT.write_text(json.dumps(runway_rows, separators=(",", ":")), encoding="utf-8")
    airports_with_runways = len({row[0] for row in runway_rows})
    print(
        f"Wrote {len(runway_rows)} runways at {airports_with_runways} international airports to {RUNWAYS_OUT} "
        f"({RUNWAYS_OUT.stat().st_size} bytes)"
    )


if __name__ == "__main__":
    main()
