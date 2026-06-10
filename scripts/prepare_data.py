#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
prepare_data.py  —— 【离线专用】从 PLATEAU CityGML 提取晴海周边 1km 的真实建筑

  输入 : raw/plateau_chuo_citygml.zip  (PLATEAU 东京都中央区 建筑物 CityGML)
  输出 : data/harumi_buildings.geojson (真实建筑轮廓 + height，浏览器读取)

原则:
  - 直接解析 CityGML（不依赖 PlateauKit/在线下载）
  - 只保留【晴海中心点周边 1km】内的建筑
  - 提取真实 footprint（LOD0 优先，否则取 LOD1 实体的底面）
  - 提取 bldg:measuredHeight；没有高度的建筑直接跳过，绝不估算
  - 处理日志输出：总建筑数 / 范围内 / 有高度 / 输出数

依赖:  pip install lxml
运行:  cd project && python scripts/prepare_data.py
"""

import json
import math
import os
import sys
import zipfile
from pathlib import Path

try:
    from lxml import etree
except ImportError:
    sys.exit("需要 lxml：请先运行  pip install lxml")

# ===================== 配置 =====================
ZIP_PATH = "raw/plateau_edogawa_citygml.zip"  # 江戸川区 CityGML
OUT_PATH = Path("data/higashikasai_buildings.geojson")

# 東葛西中心点（6丁目付近）
HARUMI_LAT = 35.6590
HARUMI_LON = 139.8770
RADIUS_M = 1000

# 東葛西 1km 覆盖的三次メッシュ
MESH_CODES = ("53393679", "53393689", "53393699",
              "53393770", "53393771", "53393780",
              "53393781", "53393790", "53393791",
              "53394609", "53394700", "53394701")


# ===================== 几何/坐标工具 =====================
def haversine(lon1, lat1, lon2, lat2):
    R = 6371000.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(dlon / 2) ** 2)
    return 2 * R * math.asin(math.sqrt(a))


def parse_ring(text, dim):
    """gml:posList -> [[lon,lat], ...]。PLATEAU(EPSG:6697) は (lat lon h) 順なので入替。"""
    nums = [float(x) for x in text.split()]
    pts = []
    for i in range(0, len(nums), dim):
        c = nums[i:i + dim]
        if len(c) >= 2:
            pts.append((c[0], c[1]))
    if not pts:
        return []
    a, b = pts[0]
    if 20 < a < 46 and 120 < b < 154:        # (lat, lon) 順 -> [lon, lat]
        ring = [[lon, lat] for (lat, lon) in pts]
    else:                                     # 既に (lon, lat)
        ring = [[x, y] for (x, y) in pts]
    # 閉じる
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    return ring


def L(tag):
    return "*[local-name()='%s']" % tag


def get_measured_height(b):
    for e in b.xpath(".//" + L("measuredHeight")):
        if e.text and e.text.strip():
            try:
                v = float(e.text.strip())
                if v > 0:
                    return v
            except ValueError:
                pass
    return None


def get_footprint(b):
    """真の輪郭を取得。LOD0(FootPrint/RoofEdge) 優先、無ければ LOD1 Solid の最下面。"""
    # 1) LOD0
    for tag in ("lod0FootPrint", "lod0RoofEdge"):
        els = b.xpath(".//" + L(tag) + "//" + L("posList"))
        if els:
            dim = int(els[0].get("srsDimension") or 3)
            ring = parse_ring(els[0].text, dim)
            if len(ring) >= 4:
                return ring
    # 2) LOD1 Solid: z 平均が最小の面＝底面
    polys = b.xpath(".//" + L("lod1Solid") + "//" + L("Polygon"))
    best, best_z = None, None
    for p in polys:
        pl = p.xpath(".//" + L("posList"))
        if not pl or not pl[0].text:
            continue
        dim = int(pl[0].get("srsDimension") or 3)
        nums = [float(x) for x in pl[0].text.split()]
        zs = nums[2::3] if dim >= 3 else []
        mz = (sum(zs) / len(zs)) if zs else 0.0
        if best_z is None or mz < best_z:
            best_z, best = mz, pl[0]
    if best is not None:
        dim = int(best.get("srsDimension") or 3)
        ring = parse_ring(best.text, dim)
        if len(ring) >= 4:
            return ring
    return None


def centroid(ring):
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return sum(xs) / len(xs), sum(ys) / len(ys)


# ===================== 输入：列出 CityGML =====================
def iter_gml_sources():
    """返回 (名称, 可读对象) 列表。支持 zip 或已解压目录。"""
    if not os.path.exists(ZIP_PATH):
        sys.exit(
            "[错误] 找不到输入 %s\n"
            "请下载 PLATEAU 中央区(13102) 的【建筑物モデル CityGML】，\n"
            "把 zip 重命名为 plateau_chuo_citygml.zip 放到 raw/ 目录（详见 README）。"
            % ZIP_PATH
        )
    sources = []
    if zipfile.is_zipfile(ZIP_PATH):
        zf = zipfile.ZipFile(ZIP_PATH)
        names = [n for n in zf.namelist()
                 if n.lower().endswith(".gml")
                 and "bldg" in n.replace("\\", "/").lower()]
        sel = [n for n in names if any(m in n for m in MESH_CODES)]
        names = sel or names
        for n in names:
            sources.append((n, zf.open(n)))
    else:  # 目录
        base = Path(ZIP_PATH)
        for p in base.rglob("*.gml"):
            if "bldg" in str(p).lower():
                if any(m in p.name for m in MESH_CODES) or True:
                    sources.append((str(p), open(p, "rb")))
    if not sources:
        sys.exit("[错误] 在输入中未找到 udx/bldg/*.gml 建筑文件。")
    return sources


# ===================== 主流程 =====================
def main():
    total = in_range = with_height = output = 0
    features = []

    for name, fh in iter_gml_sources():
        try:
            tree = etree.parse(fh)
        except Exception as e:
            print("  [跳过] 解析失败 %s: %s" % (name, e))
            continue
        finally:
            try:
                fh.close()
            except Exception:
                pass

        for b in tree.xpath("//" + L("Building")):
            total += 1
            ring = get_footprint(b)
            if not ring:
                continue
            cx, cy = centroid(ring)
            if haversine(HARUMI_LON, HARUMI_LAT, cx, cy) > RADIUS_M:
                continue
            in_range += 1

            h = get_measured_height(b)
            if h is None:
                continue            # 没有高度 -> 跳过，绝不估算
            with_height += 1

            gml_id = b.get("{http://www.opengis.net/gml}id") or ""
            features.append({
                "type": "Feature",
                "properties": {"height": round(h, 2), "gml_id": gml_id},
                "geometry": {"type": "Polygon", "coordinates": [ring]},
            })
            output += 1

    # ---- 处理日志 ----
    print("=========== 处理日志 ===========")
    print("总建筑数      :", total)
    print("范围内建筑数  :", in_range, "(晴海中心 %dm 以内)" % RADIUS_M)
    print("有高度建筑数  :", with_height)
    print("输出建筑数    :", output)
    print("================================")

    if output == 0:
        sys.exit(
            "[错误] 输出 0 栋，已中止（不写出空/假数据）。\n"
            "请确认：①下载的是中央区建筑 CityGML；②晴海中心坐标/半径；"
            "③数据是否含 measuredHeight。"
        )

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    fc = {"type": "FeatureCollection",
          "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
          "features": features}
    OUT_PATH.write_text(json.dumps(fc, ensure_ascii=False), encoding="utf-8")
    print("[完成] 已写出 %d 栋真实建筑 -> %s" % (output, OUT_PATH))


if __name__ == "__main__":
    main()
