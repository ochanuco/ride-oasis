# RideOasis
[![Unit Tests](https://github.com/ochanuco/ride-oasis/actions/workflows/unit-tests.yml/badge.svg?branch=main)](https://github.com/ochanuco/ride-oasis/actions/workflows/unit-tests.yml)

コンビニ等の公式サイトから店舗情報を収集し、住所正規化と座標付与を行って BigQuery のマートとして提供する補給地点DBです。

## 目的

- コア対象: セブン‐イレブン / ローソン / ファミリーマートの店舗情報を収集
- 住所を正規化し、緯度経度を付与
- BigQuery 上で最新化・重複排除し `mart.rideoasis_supply_points` を提供
- 補給地点を GPX 経路や現在地の近傍で確認できるローカル WebUI を提供

## 実装済みクローラ

- 7-Eleven
- Lawson
- FamilyMart
- Daily Yamazaki
- 道の駅
- MINISTOP

## 使い方（取得）

都道府県をローマ字 (`tokyo`, `osaka` など) で指定して NDJSON を出力します。全都道府県を回すときは `--pref all` を使えます。利用可能な指定値は `--pref-list` で確認できます。

```bash
node scripts/7eleven_pref_ndjson.js --pref osaka
node scripts/lawson_pref_ndjson.js --pref tokyo
node scripts/familymart_pref_ndjson.js --pref kanagawa
node scripts/daily_yamazaki_pref_ndjson.js --pref hokkaido
node scripts/michi_no_eki_pref_ndjson.js --pref kochi
node scripts/ministop_pref_ndjson.js --pref osaka
node scripts/7eleven_pref_ndjson.js --pref all
node scripts/7eleven_pref_ndjson.js --pref-list
npm run crawl:all
npm run geocode:all
npm run publish:all
```

補足:

- 都道府県はローマ字指定です
- 全都道府県を回すときは `--pref all` を使えます
- 利用可能な指定値は `--pref-list` で確認できます

## 使い方（住所正規化）

ローカルの住所データを使って geocode する場合（例）:

```bash
npm run geocode:ndjson -- \
  --chain lawson \
  --input data/lawson/ndjson \
  --existing data/geocoded \
  --output data/geocoded/stores_geocoded_lawson.ndjson \
  --engine-version 3.1.3 \
  --japanese-addresses-api file:///path/to/japanese-addresses/api/ja
```

`geocode:all` でも環境変数で同じ指定ができます:

```bash
JAPANESE_ADDRESSES_API=file:///path/to/japanese-addresses/api/ja npm run geocode:all
```

取得済み NDJSON から `raw.stores_geocoded` 共通スキーマの NDJSON を作る:

```bash
npm run geocode:ndjson -- \
  --chain lawson \
  --input data/lawson/ndjson \
  --existing data/geocoded \
  --output data/geocoded/stores_geocoded_lawson.ndjson \
  --engine-version 3.1.3
```

ローカルで 1 件だけ座標付与を確認する:

```bash
mkdir -p /tmp/ride-oasis-check
head -n 1 data/lawson/ndjson/stores_lawson_pref_13.ndjson > /tmp/ride-oasis-check/one_store.ndjson

npm run geocode:ndjson -- \
  --chain lawson \
  --input /tmp/ride-oasis-check/one_store.ndjson \
  --output /tmp/ride-oasis-check/one_store_geocoded.ndjson \
  --engine-version 3.1.3

cat /tmp/ride-oasis-check/one_store_geocoded.ndjson
```

`raw.stores_geocoded` へ Upsert（`bq load` + `MERGE`）する:

```bash
npm run bq:upsert:geocoded -- \
  --project your-gcp-project \
  --dataset raw \
  --table stores_geocoded \
  --source data/geocoded/stores_geocoded_lawson.ndjson
```

補足:

- `michi_no_eki` は都道府県コード体系が独自ですが、`--pref` は他チェーン同様にローマ字指定で利用できます（内部変換）
- `ministop` は配信 JSON（`_next/data/.../map.json`）を利用するため高速
- 取得元データに存在しない場合、`detail_url` は出力しません
- `bq:upsert:geocoded` は `schemas/raw/stores_geocoded.json` を使って一時テーブルへロードし、`chain + store_id` 単位で最新 `geocoded_at` を残す Upsert を行います

## 使い方（補給地点マップ）

`mart.rideoasis_supply_points` をローカル `sqlite` にエクスポートし、GPX 経路の近傍にある補給地点を OpenLayers で確認できます。

1. BigQuery からローカル DB を作る

```bash
npm run export:map-db -- \
  --project your-gcp-project \
  --output ./.local/rideoasis-map.db
```

2. ローカルサーバを起動する

```bash
npm run map:serve -- --db ./.local/rideoasis-map.db --port 8787
```

3. ブラウザで `http://localhost:8787` を開き、GPX ファイルを選ぶ


## 注意事項

- クローリング対象サイトの利用規約/robots を確認し、アクセス頻度を制限します。
- `raw.stores_scraped_*` の詳細スキーマはクロール実装に合わせて確定します。
