# Data Standard

This project separates heavy local PLATEAU processing from lightweight frontend
development. The frontend should be able to run in GitHub Pages, Codespaces, or
another cloud editor using only committed files under `data/`.

## Committed Artifacts

Commit these files:

- `data/datasets.json`
- `data/*_buildings.geojson`
- future `data/*_structures.geojson` files after their extraction logic is reliable

Do not commit these files:

- `raw/*.zip`
- extracted CityGML folders
- temporary analysis output

## Building GeoJSON Schema

Each building dataset is a GeoJSON `FeatureCollection`.

Required feature properties:

- `gml_id`: stable PLATEAU building id when available
- `height`: building height in meters, numeric, greater than 0

Required geometry:

- `Polygon`
- coordinates in WGS84 longitude / latitude
- one footprint per feature

Current examples:

- `data/harumi_buildings.geojson`
- `data/higashikasai_buildings.geojson`

## Dataset Manifest

`data/datasets.json` is the contract between processed data and frontend code.
Add new areas there instead of hard-coding Tokyo area metadata in `index.html`.

Required dataset fields:

- `dataset_id`: stable id, for example `koto_toyosu`
- `ward`: Japanese ward name shown in quick navigation
- `area`: Japanese area name shown in quick navigation
- `label`: user-facing Japanese label
- `bbox`: `[west, south, east, north]`
- `center`: `[lng, lat]`
- `geojson_path`: path to the building GeoJSON
- `fallback_geojson_path`: usually the same path
- `address_prefix`: prefix used for short address search input

Recommended source fields:

- `source.city`
- `source.plateau_module`
- `source.raw_archive`
- `source.generated_by`

## Local Processing Flow

1. Keep PLATEAU source archives in local `raw/`.
2. Generate or update `data/*_buildings.geojson` locally.
3. Update `data/datasets.json` with bbox, center, and paths.
4. Verify the static site locally with `python3 -m http.server 4173`.
5. Commit only `data/`, frontend files, scripts, and docs.

## Cloud-Friendly Frontend Flow

After the processed GeoJSON and manifest are committed, frontend work no longer
needs the local PLATEAU zip files. A cloud environment only needs the repository
contents to edit map UI, viewport behavior, styling, and GitHub Pages output.

## Future Structures Schema

Structures should stay separate from buildings:

- `data/<dataset_id>_structures.geojson`

Planned feature properties:

- `structure_type`: `bridge`, `elevated_road`, `pedestrian_bridge`, or `unknown`
- `height`: numeric meters or `null`
- `height_source`: source of the height value
- `source_dataset`: source module and mesh id

Until `brid` / `tran` parsing is reliable, do not generate placeholder
structure geometries.
