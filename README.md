# Tokyo Sunlight Map Demo

Project PLATEAU の建物 GeoJSON を使った、東京向けの日当たりマップ demo です。
現在は `chuo_harumi` と `edogawa_higashikasai` の 2 dataset を収録しています。

## 現在の表示ロジック

- 初期表示では建物と影を表示せず、底図だけを表示します。
- 地図を移動・拡大すると、現在の表示範囲と交差する dataset だけを読み込みます。
- MapLibre に渡す建物 GeoJSON は現在の表示範囲内の建物だけです。
- 影計算も現在の表示範囲内の建物だけを対象にします。
- 低 zoom では影を表示せず、「拡大すると影を表示します」と案内します。
- 影は Turf.js の union 後の形状だけを表示します。union 失敗時や建物数が多すぎる場合は影を非表示にします。

## Dataset 管理

Dataset は `data/datasets.json` で管理します。将来 23 区に広げるときは、以下の形式で追加します。

```js
{
  dataset_id: "koto_toyosu",
  ward: "江東区",
  area: "豊洲",
  label: "江東区 豊洲",
  bbox: [west, south, east, north],
  center: [lng, lat],
  geojson_path: "./data/koto_toyosu_buildings.geojson",
  fallback_geojson_path: "./data/koto_toyosu_buildings.geojson",
  address_prefix: "東京都江東区豊洲"
}
```

詳細なデータ成果物の標準は [docs/data-standard.md](docs/data-standard.md) を参照してください。

## ファイル構成

```text
index.html                         # メイン地図
detail.html                        # 詳細3Dモード
data/harumi_buildings.geojson
data/higashikasai_buildings.geojson
scripts/prepare_data.py            # 既存の建物抽出スクリプト
scripts/extract_structures.py      # brid / tran 調査用の準備スクリプト
raw/README.txt
```

`raw/*.zip` は multi-GB の PLATEAU 原始データなので Git 管理しません。

## ローカル確認

`file://` では GeoJSON を fetch できないため、静的サーバで開きます。

```bash
python3 -m http.server 4173
```

ブラウザで `http://localhost:4173/` を開きます。

## GitHub Pages

この demo は GitHub Pages で公開できます。Build command は不要で、公開元は repository root です。

## 構造物データの準備

PLATEAU の原始 zip には `brid` と `tran` が含まれる場合があります。将来、橋梁・道路高架・歩道橋などを日照遮蔽物として使うため、建物 dataset とは別に `structures.geojson` を用意する想定です。

想定 schema:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "structure_type": "bridge | elevated_road | pedestrian_bridge | unknown",
        "height": null,
        "height_source": "measuredHeight | lod geometry | unknown",
        "source_dataset": "plateau module and mesh code"
      },
      "geometry": {}
    }
  ]
}
```

現在の `scripts/extract_structures.py` は、信頼できない形状や高さを生成しないための調査用です。

```bash
python3 scripts/extract_structures.py raw/plateau_chuo_citygml.zip
```

次の調査事項:

- `brid` の footprint / height を安定して抽出できるか
- `tran` から道路高架・鉄道高架・歩道橋を分類できる属性があるか
- 構造物を建物とは別 source として表示し、影計算に加える境界条件

## MVP の制限

- 影は建物 footprint を太陽反対方向へ伸ばした簡易モデルです。
- 地形起伏、屋根形状、階別の日照は厳密には扱いません。
- 時刻は JST として扱います。
- `prepare_data.py` は既存の建物抽出用スクリプトとして維持しています。
