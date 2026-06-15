#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Build mesh-sized building GeoJSON tiles for Tokyo special wards.

PLATEAU CityGML bldg files are already organized by standard mesh code. This
script keeps that natural split, writes one frontend-ready GeoJSON per mesh, and
generates data/tile-datasets.json.
"""

import argparse
import json
import sys
from pathlib import Path

from lxml import etree

from prepare_tokyo23_data import (
    DATA_DIR,
    DEFAULT_RAW_DIR,
    WARDS,
    clear_element,
    get_footprint,
    get_measured_height,
    iter_bldg_gml,
    update_bbox,
)


TILE_DIR = DATA_DIR / "tiles"


def mesh_id_from_gml_name(gml_name):
    stem = Path(gml_name).name
    return stem.split("_bldg", 1)[0]


def write_feature_collection(features, out_path):
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as out:
        out.write(
            '{"type":"FeatureCollection",'
            '"crs":{"type":"name","properties":{"name":"urn:ogc:def:crs:OGC:1.3:CRS84"}},'
            '"features":['
        )
        for index, feature in enumerate(features):
            if index:
                out.write(",")
            out.write(json.dumps(feature, ensure_ascii=False, separators=(",", ":")))
        out.write("]}")


def build_tile_for_gml(ward_id, ward_name, gml_name, fh):
    mesh_id = mesh_id_from_gml_name(gml_name)
    features = []
    bbox = [180.0, 90.0, -180.0, -90.0]
    total = with_height = output = 0

    context = etree.iterparse(
        fh,
        events=("end",),
        tag="{*}Building",
        huge_tree=True,
        recover=True,
    )
    for _, building in context:
        total += 1
        ring = get_footprint(building)
        if not ring:
            clear_element(building)
            continue

        height = get_measured_height(building)
        if height is None:
            clear_element(building)
            continue
        with_height += 1

        gml_id = building.get("{http://www.opengis.net/gml}id") or ""
        features.append({
            "type": "Feature",
            "properties": {"height": round(height, 2), "gml_id": gml_id},
            "geometry": {"type": "Polygon", "coordinates": [ring]},
        })
        output += 1
        update_bbox(bbox, ring)
        clear_element(building)

    if not features:
        return None

    rel_path = f"./data/tiles/{ward_id}/{mesh_id}_buildings.geojson"
    out_path = DATA_DIR.parent / rel_path.replace("./", "")
    write_feature_collection(features, out_path)

    bbox = [round(v, 6) for v in bbox]
    return {
        "tile_id": mesh_id,
        "label": f"{ward_name} {mesh_id}",
        "bbox": bbox,
        "center": [round((bbox[0] + bbox[2]) / 2, 6), round((bbox[1] + bbox[3]) / 2, 6)],
        "geojson_path": rel_path,
        "feature_count": output,
        "source_gml": gml_name,
        "source_total_buildings": total,
        "source_with_height": with_height,
    }


def build_tiles_for_ward(raw_dir, ward):
    _, ward_id, ward_name = ward
    tiles = []
    bbox = [180.0, 90.0, -180.0, -90.0]
    total_features = 0

    print(f"[{ward_name}] tile start", flush=True)
    for gml_name, fh in iter_bldg_gml(raw_dir / f"plateau_{ward_id}_citygml.zip"):
        try:
            tile = build_tile_for_gml(ward_id, ward_name, gml_name, fh)
        finally:
            try:
                fh.close()
            except Exception:
                pass
        if tile is None:
            print(f"  {Path(gml_name).name}: empty", flush=True)
            continue
        tiles.append(tile)
        total_features += tile["feature_count"]
        update_bbox(bbox, [
            [tile["bbox"][0], tile["bbox"][1]],
            [tile["bbox"][2], tile["bbox"][3]],
        ])
        print(
            f"  {Path(gml_name).name}: tile={tile['tile_id']} "
            f"features={tile['feature_count']}",
            flush=True,
        )

    if not tiles:
        raise RuntimeError(f"{ward_name}: no non-empty tiles")

    bbox = [round(v, 6) for v in bbox]
    dataset = {
        "dataset_id": ward_id,
        "ward": ward_name,
        "area": "全域",
        "label": f"{ward_name} 全域",
        "bbox": bbox,
        "center": [round((bbox[0] + bbox[2]) / 2, 6), round((bbox[1] + bbox[3]) / 2, 6)],
        "address_prefix": f"東京都{ward_name}",
        "tile_count": len(tiles),
        "feature_count": total_features,
        "tiles": sorted(tiles, key=lambda t: t["tile_id"]),
        "source": {
            "city": f"東京都{ward_name}",
            "plateau_module": "bldg",
            "raw_archive": f"raw/plateau_{ward_id}_citygml.zip",
            "raw_archive_external": str(raw_dir / f"plateau_{ward_id}_citygml.zip"),
            "generated_by": "scripts/prepare_tokyo23_tiles.py",
        },
    }
    print(
        f"[{ward_name}] tile done tiles={len(tiles)} features={total_features}",
        flush=True,
    )
    return dataset


def write_tile_manifest(datasets):
    out_path = DATA_DIR / "tile-datasets.json"
    payload = {"schema_version": 1, "tile_schema_version": 1, "datasets": datasets}
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[manifest] wrote {out_path}", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-dir", type=Path, default=DEFAULT_RAW_DIR)
    parser.add_argument("--ward", choices=[ward_id for _, ward_id, _ in WARDS])
    args = parser.parse_args()

    selected = [ward for ward in WARDS if args.ward in (None, ward[1])]
    datasets = [build_tiles_for_ward(args.raw_dir, ward) for ward in selected]

    if args.ward is None:
        write_tile_manifest(datasets)
    else:
        partial_manifest = DATA_DIR / f"tile-datasets.{args.ward}.json"
        partial_manifest.write_text(
            json.dumps({"schema_version": 1, "tile_schema_version": 1, "datasets": datasets}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"[manifest] wrote {partial_manifest}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
