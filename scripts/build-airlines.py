#!/usr/bin/env python3
"""Rebuild public/airlines.json from the OpenFlights public airline list."""

import csv
import json
import urllib.request
from pathlib import Path

URL = "https://raw.githubusercontent.com/jpatokal/openflights/master/data/airlines.dat"
OUT = Path(__file__).resolve().parent.parent / "public" / "airlines.json"


def put(lookup, code, name, active):
    if not code or not code.isalnum():
        return
    previous = lookup.get(code)
    if previous is None or (active == "Y" and previous[1] != "Y"):
        lookup[code] = (name, active)


def main():
    request = urllib.request.Request(URL, headers={"User-Agent": "Meridian/0.2"})
    with urllib.request.urlopen(request, timeout=60) as response:
        text = response.read().decode("utf-8", errors="replace")

    lookup = {}
    for row in csv.reader(text.splitlines()):
        if len(row) < 8:
            continue
        name = (row[1] or "").strip()
        iata = "" if row[3] in {"", "\\N", "-"} else row[3].strip().upper()
        icao = "" if row[4] in {"", "\\N", "-"} else row[4].strip().upper()
        active = (row[7] or "").strip().upper()
        if not name:
            continue
        put(lookup, icao, name, active)
        put(lookup, iata, name, active)

    OUT.write_text(json.dumps({code: name for code, (name, _) in lookup.items()}, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(lookup)} airline codes to {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
