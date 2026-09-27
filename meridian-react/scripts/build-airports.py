#!/usr/bin/env python3
"""Rebuild public/airports.json from the OurAirports public dataset."""

import csv
import io
import json
import urllib.request
from pathlib import Path

URL = "https://davidmegginson.github.io/ourairports-data/airports.csv"
KEEP = {
    "large_airport": "L",
    "medium_airport": "M",
    "small_airport": "S",
    "seaplane_base": "P",
}
OUT = Path(__file__).resolve().parent.parent / "public" / "airports.json"


def main():
    request = urllib.request.Request(URL, headers={"User-Agent": "Meridian/0.2"})
    with urllib.request.urlopen(request, timeout=60) as response:
        text = response.read().decode("utf-8", errors="replace")

    rows = []
    for row in csv.DictReader(io.StringIO(text)):
        kind = KEEP.get((row.get("type") or "").strip())
        if not kind:
            continue
        try:
            lat = float(row["latitude_deg"])
            lon = float(row["longitude_deg"])
        except (TypeError, ValueError, KeyError):
            continue
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            continue
        ident = (row.get("ident") or "").strip()
        iata = (row.get("iata_code") or "").strip()
        name = (row.get("name") or ident or "Airport").strip()
        rows.append([kind, ident, iata, name, round(lon, 5), round(lat, 5)])

    OUT.write_text(json.dumps(rows, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(rows)} airports to {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
