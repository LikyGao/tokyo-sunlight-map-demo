#!/usr/bin/env python3
"""Fetch Tokyo ward town centers for the frontend area picker."""

import json
from pathlib import Path
from urllib.parse import quote
from urllib.request import urlopen

from prepare_tokyo23_data import DATA_DIR, WARDS


API_ROOT = "https://geolonia.github.io/japanese-addresses/api/ja"
SOURCE_URL = "https://geolonia.github.io/japanese-addresses/"


def fetch_ward(ward_name):
    url = f"{API_ROOT}/{quote('東京都')}/{quote(ward_name)}.json"
    with urlopen(url, timeout=30) as response:
        rows = json.load(response)

    seen = set()
    areas = []
    for row in rows:
        town = str(row.get("town") or "").strip()
        koaza = str(row.get("koaza") or "").strip()
        lat = row.get("lat")
        lng = row.get("lng")
        if not town or not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
            continue
        name = town if not koaza else f"{town} {koaza}"
        key = (name, round(lat, 6), round(lng, 6))
        if key in seen:
            continue
        seen.add(key)
        areas.append({"name": name, "center": [round(lng, 6), round(lat, 6)]})

    return areas


def main():
    wards = {}
    for _, _, ward_name in WARDS:
        areas = fetch_ward(ward_name)
        wards[ward_name] = areas
        print(f"{ward_name}: {len(areas)} areas", flush=True)

    payload = {
        "schema_version": 1,
        "source": {
            "name": "Geolonia 住所データ",
            "url": SOURCE_URL,
            "api_root": API_ROOT,
        },
        "wards": wards,
    }
    out_path = DATA_DIR / "tokyo-areas.json"
    out_path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {out_path}", flush=True)


if __name__ == "__main__":
    main()
