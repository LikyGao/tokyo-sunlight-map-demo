#!/usr/bin/env python3
"""Inventory PLATEAU structure modules without generating placeholder geometry.

This is a preparation script for future bridge / elevated-road support. It does
not modify building data and does not fabricate structure features.
"""

from __future__ import annotations

import argparse
import json
import zipfile
from collections import Counter
from pathlib import Path


TARGET_MODULES = ("brid", "tran")
OUTPUT_SCHEMA = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {
                "structure_type": "bridge | elevated_road | pedestrian_bridge | unknown",
                "height": "number | null",
                "height_source": "measuredHeight | lod geometry | unknown",
                "source_dataset": "plateau module and mesh code",
            },
            "geometry": "Polygon or MultiPolygon",
        }
    ],
}


def inventory(zip_path: Path) -> dict:
    counts: Counter[str] = Counter()
    examples: dict[str, list[str]] = {name: [] for name in TARGET_MODULES}
    with zipfile.ZipFile(zip_path) as zf:
        for name in zf.namelist():
            parts = name.split("/")
            if len(parts) < 3 or parts[0] != "udx":
                continue
            module = parts[1]
            if module in TARGET_MODULES:
                counts[module] += 1
                if name.endswith(".gml") and len(examples[module]) < 5:
                    examples[module].append(name)
    return {
        "zip": str(zip_path),
        "modules": dict(counts),
        "examples": examples,
        "planned_output_schema": OUTPUT_SCHEMA,
        "note": (
            "Geometry extraction is intentionally not implemented yet. "
            "Bridge and transport CityGML need separate height and class "
            "validation before they can affect sunlight calculation."
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect PLATEAU brid/tran modules.")
    parser.add_argument("zip_path", type=Path)
    args = parser.parse_args()
    print(json.dumps(inventory(args.zip_path), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
