#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
enrich_with_osm.py
PLATEAU 建物 GeoJSON に OpenStreetMap の name を付与する独立スクリプト。
※ prepare_data.py は一切変更しない。サンプル名称は生成しない。

入力:
  data/harumi_buildings.geojson         + osm_names_harumi.geojson
  data/higashikasai_buildings.geojson   + osm_names_higashikasai.geojson
出力:
  data/harumi_buildings_named.geojson
  data/higashikasai_buildings_named.geojson

OSM データの作り方（overpass-turbo.eu で実行 → Export → data → 「GeoJSON」で保存）:
  [out:json][timeout:90];
  (
    nwr["name"]["building"](BBOX);
    nwr["name"]["amenity"](BBOX);
    nwr["name"]["shop"](BBOX);
    nwr["name"]["office"](BBOX);
    nwr["name"]["leisure"](BBOX);
    nwr["name"]["railway"="station"](BBOX);
    nwr["addr:housenumber"](BBOX);   // ← 住所(番-号)ラベル用。不要なら削除可
  );
  out geom;
  晴海 BBOX     : 35.645,139.778,35.663,139.795
  東葛西 BBOX   : 35.650,139.866,35.668,139.888
  ※ overpass-turbo の Export は GeoJSON 形式。Point / Polygon / MultiPolygon に対応。
  ※ addr 行を入れると、名称が無い建物にも「番-号」ラベルが付く（任意）。
"""
import json, math
from pathlib import Path

# (PLATEAU入力, OSM GeoJSON入力, 出力)
AREAS = [
    ("data/harumi_buildings.geojson",       "osm_names_harumi.geojson",       "data/harumi_buildings_named.geojson"),
    ("data/higashikasai_buildings.geojson", "osm_names_higashikasai.geojson", "data/higashikasai_buildings_named.geojson"),
]
NEAREST_LIMIT_M = 20.0  # polygon 外なら 20m 以内の最寄り建物に紐づけ


def point_in_ring(x, y, ring):
    """ray casting。ring=[[lon,lat],...]（最後=最初）"""
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-18) + xi):
            inside = not inside
        j = i
    return inside


def centroid(ring):
    sx = sy = 0.0
    n = len(ring) - 1 if ring[0] == ring[-1] else len(ring)
    for i in range(n):
        sx += ring[i][0]; sy += ring[i][1]
    return sx / n, sy / n


def meters(lon1, lat1, lon2, lat2):
    dx = (lon2 - lon1) * 111320 * math.cos(math.radians((lat1 + lat2) / 2))
    dy = (lat2 - lat1) * 110540
    return math.hypot(dx, dy)


def name_rank(tags, height):
    """重要度: 1=主要施設(駅/学校/病院/モール/公園/公共), 2=大型建物/マンション, 3=その他"""
    a = tags.get("amenity", ""); s = tags.get("shop", "")
    b = tags.get("building", ""); rw = tags.get("railway", ""); le = tags.get("leisure", "")
    if (rw == "station" or tags.get("public_transport")
            or a in ("school", "university", "college", "hospital", "townhall",
                     "library", "police", "fire_station", "community_centre", "theatre")
            or s in ("mall", "department_store")
            or le == "park"
            or b in ("public", "civic", "hospital", "university", "school",
                     "train_station", "stadium")):
        return 1
    if b in ("apartments", "commercial", "office", "retail", "hotel") or (height and height >= 30):
        return 2
    return 3


def ring_area(ring):
    """符号付き面積（shoelace）。ring=[[lon,lat],...]"""
    s = 0.0
    n = len(ring)
    for i in range(n - 1):
        s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    return s / 2.0


def osm_repr_point(geom):
    """OSM GeoJSON geometry から代表点 (lon,lat) を求める。
       Point=その点 / Polygon=外環重心 / MultiPolygon=最大面積の外環重心。"""
    t = geom.get("type")
    cs = geom.get("coordinates")
    if not cs:
        return None, None
    if t == "Point":
        return cs[0], cs[1]
    if t == "Polygon":
        return centroid(cs[0])
    if t == "MultiPolygon":
        best, bestarea = None, -1.0
        for poly in cs:
            ring = poly[0]
            a = abs(ring_area(ring))
            if a > bestarea:
                bestarea, best = a, ring
        return centroid(best) if best else (None, None)
    if t == "LineString":
        mid = cs[len(cs) // 2]
        return mid[0], mid[1]
    return None, None


def osm_addr(tags):
    """OSM の addr:* から「番-号」を組み立てる。無ければ None。"""
    bn = tags.get("addr:block_number")   # 街区符号 = 番
    hn = tags.get("addr:housenumber")    # 住居番号 = 号（"14-10" の場合もある）
    if bn and hn:
        return f"{bn}-{hn}"
    if hn:
        return str(hn)
    return None


def load_osm(path):
    """overpass-turbo の GeoJSON エクスポートを読む。
       properties が OSM タグ（name/amenity/shop/building/addr:*...）。
       name か addr のどちらかがあれば対象にする。"""
    feats = []
    data = json.load(open(path, encoding="utf-8"))
    for ft in data.get("features", []):
        props = ft.get("properties") or {}
        name = props.get("name") or props.get("name:ja")
        addr = osm_addr(props)
        if not name and not addr:   # name も addr も無ければスキップ
            continue
        geom = ft.get("geometry") or {}
        lon, lat = osm_repr_point(geom)
        if lon is None or lat is None:
            continue
        oid = props.get("@id") or props.get("id") or ""
        if isinstance(oid, str) and "/" in oid:
            otype, oidnum = oid.split("/", 1)
        else:
            otype, oidnum = (geom.get("type", "node") or "node").lower(), oid
        feats.append({"name": name, "addr": addr, "lon": lon, "lat": lat,
                      "tags": props, "osm_type": otype, "osm_id": oidnum})
    return feats


def enrich(plateau_path, osm_path, out_path):
    if not Path(plateau_path).exists():
        print(f"[skip] {plateau_path} が無い"); return
    if not Path(osm_path).exists():
        print(f"[skip] {osm_path} が無い（overpass-turbo から GeoJSON で書き出してください）"); return

    fc = json.load(open(plateau_path, encoding="utf-8"))
    osm = load_osm(osm_path)
    print(f"--- {plateau_path}")
    print(f"  PLATEAU建物: {len(fc['features'])} / OSM命名要素: {len(osm)}")

    polys = []
    for f in fc["features"]:
        ring = f["geometry"]["coordinates"][0]
        cx, cy = centroid(ring)
        xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
        polys.append({"f": f, "ring": ring, "cx": cx, "cy": cy,
                      "bb": (min(xs), min(ys), max(xs), max(ys))})

    matched = nearest = 0
    for o in osm:
        lon, lat = o["lon"], o["lat"]
        target = None
        # 1) 点在多边形内
        for p in polys:
            bb = p["bb"]
            if lon < bb[0] or lon > bb[2] or lat < bb[1] or lat > bb[3]:
                continue
            if point_in_ring(lon, lat, p["ring"]):
                target = p; break
        # 2) 兜底: 20m 以内の最寄り建物
        used_nearest = False
        if target is None:
            best, bestd = None, NEAREST_LIMIT_M
            for p in polys:
                d = meters(lon, lat, p["cx"], p["cy"])
                if d < bestd:
                    bestd, best = d, p
            if best is not None:
                target, used_nearest = best, True
        if target is None:
            continue
        props = target["f"]["properties"]
        # 名称: あれば、より重要(rank 小)な場合のみ上書き
        if o["name"]:
            new_rank = name_rank(o["tags"], props.get("height"))
            if not (props.get("name") and props.get("name_rank", 9) <= new_rank):
                if used_nearest:
                    nearest += 1
                props["name"] = o["name"]
                props["name_source"] = "osm"
                props["osm_type"] = o["osm_type"]
                props["osm_id"] = o["osm_id"]
                props["name_rank"] = new_rank
        # 住所(番-号): 未設定のときだけ付与
        if o["addr"] and not props.get("addr"):
            props["addr"] = o["addr"]
            props.setdefault("name_source", "osm")

    matched = sum(1 for f in fc["features"]
                  if f["properties"].get("name") or f["properties"].get("addr"))
    n_name = sum(1 for f in fc["features"] if f["properties"].get("name"))
    n_addr = sum(1 for f in fc["features"] if f["properties"].get("addr"))

    print(f"  マッチ成功: {matched}（名称:{n_name} / 住所:{n_addr} / 最寄り紐づけ:{nearest}）")
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    json.dump(fc, open(out_path, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"  [完成] -> {out_path}")


if __name__ == "__main__":
    for p, o, out in AREAS:
        enrich(p, o, out)
    print("\n全エリア処理完了。前端は *_named.geojson を読み込みます。")
