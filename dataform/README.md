# Dataform

`plan.md` に沿って `raw -> stg -> mart -> ops` の変換を定義しています。

## 構成

- `definitions/raw`: BigQuery `raw` テーブル宣言
- `definitions/stg`: `store_id` 単位の最新化とチェーン横断 UNION
- `definitions/mart`: `mart.rideoasis_supply_points`
- `definitions/ops`: 未解決一覧と日次メトリクス

## 事前設定

`workflow_settings.yaml` の `defaultProject` を実プロジェクトに変更してください。

## 主な出力

- `stg.stores_latest_all`
- `stg.stores_geocode_latest_all`
- `mart.rideoasis_supply_points`
- `ops.geocode_unmatched`
- `ops.metrics_daily`
