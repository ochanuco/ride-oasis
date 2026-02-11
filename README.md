# RideOasis

コンビニ等の公式サイトから店舗情報を収集し、住所正規化と座標付与を行って BigQuery のマートとして提供する補給地点DBです。

## 目的

- コア対象: セブン‐イレブン / ローソン / ファミリーマートの店舗情報を収集
- 住所を正規化し、緯度経度を付与
- BigQuery 上で最新化・重複排除し `mart.rideoasis_supply_points` を提供

## 実装済みクローラ

- 7-Eleven
- Lawson
- FamilyMart
- Daily Yamazaki
- 道の駅
- MINISTOP

## アーキテクチャ

- Cloud Run（Job/Service）
- Codex + Playwright によるクロール/抽出
- `@geolonia/normalize-japanese-addresses` による住所正規化/座標付与
- Dataform による BigQuery 内の整形・履歴・マート化
- Terraform による IaC

## データフロー

1. Cloud Run が店舗情報を取得し `raw.stores_scraped_*` に投入
2. Cloud Run が `normalize()` を実行し `raw.stores_geocoded` に投入
3. Dataform が `raw` を最新化/重複排除して `stg.*` を生成
4. Dataform が `mart.rideoasis_supply_points` を生成
5. Dataform が `ops.*` を生成（未解決・品質）

## BigQuery スキーマ（要約）

- `raw.stores_scraped_{chain}`: クローラ出力（チェーン別）
- `raw.stores_geocoded`: 正規化済み住所 + 座標（共通）
- `stg.*`: 最新化・整形
- `mart.rideoasis_supply_points`: 供給点マート
- `ops.*`: 未解決・品質監視

詳細は `plan.md` を参照してください。

## ディレクトリ（予定）

- `apps/`: Cloud Run ジョブ/サービス
- `dataform/`: Dataform 定義
- `terraform/`: IaC
- `skills/`: 本リポジトリ用の作業スキル

## 使い方（取得）

都道府県コードで絞って NDJSON を出力します。

```bash
node scripts/7eleven_pref_ndjson.js --pref 27
node scripts/lawson_pref_ndjson.js --pref 27
node scripts/famima_pref_ndjson.js --pref 27
node scripts/daily_yamazaki_pref_ndjson.js --pref 27
node scripts/michi_no_eki_pref_ndjson.js --pref 48
node scripts/ministop_pref_ndjson.js --pref 27
```

補足:

- `michi_no_eki` は都道府県コード体系が独自（例: 高知は `48`）
- `ministop` は配信 JSON（`_next/data/.../map.json`）を利用するため高速
- 取得元データに存在しない場合、`detail_url` は出力しません

## 注意事項

- クローリング対象サイトの利用規約/robots を確認し、アクセス頻度を制限します。
- `raw.stores_scraped_*` の詳細スキーマはクロール実装に合わせて確定します。
