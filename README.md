# 晴海 日当たりマップ — MVP（实数据 / 第一阶段：晴海周边 1km）

用 Project PLATEAU 的真实 3D 都市模型，提取**晴海中心点周边 1km** 的建筑轮廓与高度，
生成 `data/harumi_buildings.geojson`，网页据日期时间显示建筑阴影。

> 本项目**只用真实数据**。不含样本/假数据，不用示例矩形。
> 没有生成 `harumi_buildings.geojson` 之前，网页会显示明确错误（不会静默空白）。

## 项目结构

```
project/
├── index.html                      # 只读 ./data/harumi_buildings.geojson
├── data/
│   └── harumi_buildings.geojson    # ← prepare_data.py 生成（初始不存在）
├── raw/
│   └── plateau_chuo_citygml.zip    # ← 你下载的 PLATEAU CityGML（放这里）
├── scripts/
│   └── prepare_data.py             # 离线：CityGML -> harumi_buildings.geojson
└── README.md
```

---

## 1. 下载 PLATEAU 数据

- **数据集名称**：3D都市モデル（Project PLATEAU）東京都中央区（13102）／2023年度
- **下载页面**：
  - G空间信息中心：https://www.geospatial.jp/ckan/dataset/plateau-13102-chuo-ku-2023
  - 或地图入口：https://www.mlit.go.jp/plateau/open-data/ → 点「中央区」
- **下载哪个**：下载 **CityGML**（建築物モデル / bldg）。
  **不要用 3D Tiles** —— 3D Tiles 是网格几何，没有干净的「轮廓 + 高度」属性，不适合本用途。
- **放到哪里**：把下载的 zip **重命名为 `plateau_chuo_citygml.zip`**，放到 `raw/` 目录：
  ```
  project/raw/plateau_chuo_citygml.zip
  ```
  （脚本会直接读 zip，无需解压。zip 内建筑文件位于 `udx/bldg/*.gml`。）

> 晴海 1km 覆盖的三次网格：`53393672 / 53393673 / 53393682 / 53393683 / 53393692 / 53393693`
> （中心 `53393682`）。脚本会自动只读这些网格的 GML 来加速；匹配不到则读取全部 bldg。

---

## 2. 运行 prepare_data.py

```bash
cd project
pip install lxml
python scripts/prepare_data.py
```

脚本会：读取 CityGML → 只保留晴海中心 1km 内建筑 → 提取真实 footprint 与
`measuredHeight`（**无高度的建筑直接跳过，不估算**）→ 写出 `data/harumi_buildings.geojson`。

运行时会打印日志，例如：

```
=========== 处理日志 ===========
总建筑数      : 38214
范围内建筑数  : 1027 (晴海中心 1000m 以内)
有高度建筑数  : 1019
输出建筑数    : 1019
================================
[完成] 已写出 1019 栋真实建筑 -> data/harumi_buildings.geojson
```

（具体数字取决于数据。若「输出建筑数 = 0」脚本会报错中止，不会写出空/假数据。）

晴海中心点/半径可在脚本顶部修改：`HARUMI_LAT / HARUMI_LON / RADIUS_M`。

---

## 3. 确认生成是否成功

```bash
# 文件存在且非空
ls -la data/harumi_buildings.geojson

# 是 FeatureCollection、建筑数 > 0、每栋有 height
python3 - <<'PY'
import json
fc=json.load(open("data/harumi_buildings.geojson",encoding="utf-8"))
n=len(fc["features"])
hash=sum(1 for f in fc["features"] if f["properties"].get("height",0)>0)
print("type:",fc["type"],"| 建筑数:",n,"| 有height:",hash)
print("示例:",fc["features"][0]["properties"])
PY
```

本地预览（**不要双击打开**，`file://` 无法 fetch）：

```bash
npx serve .          # 然后浏览器打开提示的地址
```

页面左上「调试信息」应显示：GeoJSON `OK`、建物数 > 0、height有 > 0、影polygon数 > 0。
若显示红色错误框，按提示处理（多半是数据未生成或用了 `file://`）。

---

## 4. 部署到 Netlify

只部署**静态文件**，不依赖 Python（Python 仅离线生成数据时用）。

**务必先在本地跑完 prepare_data.py，确认 `data/harumi_buildings.geojson` 已生成**，再部署。

### Netlify Drop（最简单）
1. 准备一个只含以下内容的文件夹（**只要 index.html 和 data/**）：
   ```
   index.html
   data/harumi_buildings.geojson
   ```
2. 打开 https://app.netlify.com/drop ，把该文件夹拖进去，几秒得到 URL。

> `scripts/` 和 `raw/` **不需要**上传（Netlify 上不运行 Python）。
> 上传 `raw/`（CityGML 体积大）只会拖慢部署，没有意义。

### Netlify（Git 连接）
- Build command：留空
- Publish directory：项目根（含 index.html 与 data/）
- 确保 `data/harumi_buildings.geojson` 已提交到仓库。

---

## 限制（MVP 取舍）

- 影是简化模型：建筑沿太阳反方向平移 footprint 后取凸包（矩形精确，凹形略高估）。
- 影は重なりで濃くならないよう turf.js の union で1つに結合してから描画する。
- 投影到地面（标高 0），不考虑地形起伏、相邻建筑遮挡、屋顶形状。
- 时刻按日本时间 JST 处理。
- 几何只取 `bldg:Building` 自身；极少数仅在 `BuildingPart` 上有几何的建筑可能被略过。

## 表示モードについて（メイン地図 / 詳細3D）

- **メイン地図 `index.html`** … MapLibre GL JS による軽量モード。
  建物の2D/3D表示、地面の影、太陽点、明るさ変化、時刻スライダー、節気切替などを行う。
  普段の確認はこちらを使う。
- **詳細3Dモード `detail.html`** … 将来の **CesiumJS** による詳細3Dモード。
  メイン地図のクリックで開く建物 popup の「この建物の光を見る」から、
  `detail.html?buildingId=...` として遷移する。
- **現状の `detail.html` は入口と骨格のみ**：全画面の Cesium コンテナ、時刻スライダー、
  太陽高度角/方位角の表示、「地図に戻る」ボタン、buildingId の受け取りまで。
  まだ実際の建物3Dは読み込まず、画面に「準備中」と明示している。
- **今後の準備物**：詳細3Dで建物を表示するには **PLATEAU の 3D Tiles（`tileset.json` と
  タイル一式）** が必要。中央区データセットの「3D Tiles, MVT」zip を別途用意し、
  `detail.html` 側で `Cesium3DTileset` として読み込む実装を追加する予定。
  （メイン地図は MapLibre のままで、Cesium には置き換えない。）

> buildingId は現在 `prepare_data.py` が出力する `gml_id`（安定ID）を使用。
> 万一 gml_id が無いデータでは暫定的に feature index を使うが、将来は安定IDに統一する。
