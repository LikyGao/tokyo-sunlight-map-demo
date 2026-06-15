#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Build one lightweight buildings GeoJSON per Tokyo special ward from PLATEAU
CityGML archives.

The script reads CityGML directly from zip files, extracts bldg:Building
footprints and bldg:measuredHeight, and writes frontend-ready GeoJSON files
under data/. It intentionally skips buildings without measuredHeight.
"""

import argparse
import json
import sys
import zipfile
from pathlib import Path

try:
    from lxml import etree
except ImportError:
    sys.exit("需要 lxml：请先运行  pip install lxml")


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RAW_DIR = Path("/Volumes/Elements/星火科技/阳光地图/raw")
DATA_DIR = PROJECT_ROOT / "data"

WARDS = [
    ("13101", "chiyoda", "千代田区"),
    ("13102", "chuo", "中央区"),
    ("13103", "minato", "港区"),
    ("13104", "shinjuku", "新宿区"),
    ("13105", "bunkyo", "文京区"),
    ("13106", "taito", "台東区"),
    ("13107", "sumida", "墨田区"),
    ("13108", "koto", "江東区"),
    ("13109", "shinagawa", "品川区"),
    ("13110", "meguro", "目黒区"),
    ("13111", "ota", "大田区"),
    ("13112", "setagaya", "世田谷区"),
    ("13113", "shibuya", "渋谷区"),
    ("13114", "nakano", "中野区"),
    ("13115", "suginami", "杉並区"),
    ("13116", "toshima", "豊島区"),
    ("13117", "kita", "北区"),
    ("13118", "arakawa", "荒川区"),
    ("13119", "itabashi", "板橋区"),
    ("13120", "nerima", "練馬区"),
    ("13121", "adachi", "足立区"),
    ("13122", "katsushika", "葛飾区"),
    ("13123", "edogawa", "江戸川区"),
]


def L(tag):
    return "*[local-name()='%s']" % tag


def parse_ring(text, dim):
    nums = [float(x) for x in text.split()]
    pts = []
    for i in range(0, len(nums), dim):
        c = nums[i:i + dim]
        if len(c) >= 2:
            pts.append((c[0], c[1]))
    if not pts:
        return []

    a, b = pts[0]
    if 20 < a < 46 and 120 < b < 154:
        ring = [[lon, lat] for (lat, lon) in pts]
    else:
        ring = [[x, y] for (x, y) in pts]
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    return ring


def get_measured_height(building):
    for e in building.xpath(".//" + L("measuredHeight")):
        if e.text and e.text.strip():
            try:
                height = float(e.text.strip())
            except ValueError:
                continue
            if height > 0:
                return height
    return None


def get_footprint(building):
    for tag in ("lod0FootPrint", "lod0RoofEdge"):
        els = building.xpath(".//" + L(tag) + "//" + L("posList"))
        if not els or not els[0].text:
            continue
        dim = int(els[0].get("srsDimension") or 3)
        ring = parse_ring(els[0].text, dim)
        if len(ring) >= 4:
            return ring

    best, best_z = None, None
    polys = building.xpath(".//" + L("lod1Solid") + "//" + L("Polygon"))
    for polygon in polys:
        pos_lists = polygon.xpath(".//" + L("posList"))
        if not pos_lists or not pos_lists[0].text:
            continue
        dim = int(pos_lists[0].get("srsDimension") or 3)
        nums = [float(x) for x in pos_lists[0].text.split()]
        zs = nums[2::dim] if dim >= 3 else []
        mean_z = (sum(zs) / len(zs)) if zs else 0.0
        if best_z is None or mean_z < best_z:
            best_z, best = mean_z, pos_lists[0]

    if best is None:
        return None
    dim = int(best.get("srsDimension") or 3)
    ring = parse_ring(best.text, dim)
    return ring if len(ring) >= 4 else None


def update_bbox(bbox, ring):
    for lon, lat in ring:
        bbox[0] = min(bbox[0], lon)
        bbox[1] = min(bbox[1], lat)
        bbox[2] = max(bbox[2], lon)
        bbox[3] = max(bbox[3], lat)


def clear_element(element):
    element.clear()
    parent = element.getparent()
    while parent is not None and element.getprevious() is not None:
        del parent[0]


def iter_bldg_gml(zip_path):
    with zipfile.ZipFile(zip_path) as zf:
        names = sorted(
            name for name in zf.namelist()
            if name.lower().endswith(".gml")
            and "/bldg/" in name.replace("\\", "/").lower()
        )
        if not names:
            raise RuntimeError(f"no udx/bldg/*.gml files found in {zip_path}")
        for name in names:
            with zf.open(name) as fh:
                yield name, fh


def write_ward_geojson(raw_dir, ward):
    code, ward_id, ward_name = ward
    zip_path = raw_dir / f"plateau_{ward_id}_citygml.zip"
    out_path = DATA_DIR / f"{ward_id}_buildings.geojson"

    if not zip_path.exists():
        raise FileNotFoundError(zip_path)
    if not zipfile.is_zipfile(zip_path):
        raise RuntimeError(f"not a valid zip: {zip_path}")

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    total = with_footprint = with_height = output = 0
    bbox = [180.0, 90.0, -180.0, -90.0]

    print(f"[{ward_name}] start {zip_path.name}", flush=True)
    with out_path.open("w", encoding="utf-8") as out:
        out.write('{"type":"FeatureCollection","crs":{"type":"name","properties":{"name":"urn:ogc:def:crs:OGC:1.3:CRS84"}},"features":[')
        first = True

        for gml_name, fh in iter_bldg_gml(zip_path):
            context = etree.iterparse(
                fh,
                events=("end",),
                tag="{*}Building",
                huge_tree=True,
                recover=True,
            )
            file_output = 0
            for _, building in context:
                total += 1
                ring = get_footprint(building)
                if not ring:
                    clear_element(building)
                    continue
                with_footprint += 1

                height = get_measured_height(building)
                if height is None:
                    clear_element(building)
                    continue
                with_height += 1

                gml_id = building.get("{http://www.opengis.net/gml}id") or ""
                feature = {
                    "type": "Feature",
                    "properties": {"height": round(height, 2), "gml_id": gml_id},
                    "geometry": {"type": "Polygon", "coordinates": [ring]},
                }
                if not first:
                    out.write(",")
                out.write(json.dumps(feature, ensure_ascii=False, separators=(",", ":")))
                first = False
                output += 1
                file_output += 1
                update_bbox(bbox, ring)
                clear_element(building)
            print(f"  {Path(gml_name).name}: +{file_output} buildings", flush=True)

        out.write("]}")

    if output == 0:
        out_path.unlink(missing_ok=True)
        raise RuntimeError(f"{ward_name}: output 0 buildings")

    bbox = [round(v, 6) for v in bbox]
    center = [round((bbox[0] + bbox[2]) / 2, 6), round((bbox[1] + bbox[3]) / 2, 6)]
    print(
        f"[{ward_name}] done total={total} footprint={with_footprint} "
        f"height={with_height} output={output} -> {out_path.name}",
        flush=True,
    )

    return {
        "dataset_id": ward_id,
        "ward": ward_name,
        "area": "全域",
        "label": f"{ward_name} 全域",
        "bbox": bbox,
        "center": center,
        "geojson_path": f"./data/{ward_id}_buildings.geojson",
        "fallback_geojson_path": f"./data/{ward_id}_buildings.geojson",
        "address_prefix": f"東京都{ward_name}",
        "source": {
            "city": f"東京都{ward_name}",
            "plateau_module": "bldg",
            "raw_archive": f"raw/plateau_{ward_id}_citygml.zip",
            "raw_archive_external": str(zip_path),
            "generated_by": "scripts/prepare_tokyo23_data.py",
        },
    }


def write_manifest(datasets):
    manifest_path = DATA_DIR / "datasets.json"
    payload = {"schema_version": 1, "datasets": datasets}
    manifest_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"[manifest] wrote {manifest_path}", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-dir", type=Path, default=DEFAULT_RAW_DIR)
    parser.add_argument("--ward", choices=[ward_id for _, ward_id, _ in WARDS])
    parser.add_argument("--manifest-only", action="store_true")
    args = parser.parse_args()

    selected = [w for w in WARDS if args.ward in (None, w[1])]
    datasets = []
    for ward in selected:
        dataset = write_ward_geojson(args.raw_dir, ward)
        datasets.append(dataset)

    if args.ward is None:
        write_manifest(datasets)
    elif args.manifest_only:
        write_manifest(datasets)


if __name__ == "__main__":
    main()
