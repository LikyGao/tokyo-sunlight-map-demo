运行  python scripts/prepare_data.py  后，会在本目录生成
harumi_buildings.geojson（真实建筑，含 height 字段）。
请勿手动放入任何样本/假数据。部署 Netlify 时需要本目录中的该文件。

tokyo-areas.json 由 scripts/fetch_tokyo_areas.py 从 Geolonia 住所数据生成，
用于东京23区的町丁目下拉选择。运行时使用本地静态文件，不依赖外部地址接口。
