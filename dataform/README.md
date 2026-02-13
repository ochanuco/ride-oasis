# Dataform

`plan.md` に沿って `rideoasis_raw -> rideoasis_stg -> rideoasis_mart -> rideoasis_ops` の変換を定義しています。

## 構成

- `definitions/raw`: BigQuery `rideoasis_raw` テーブル宣言
- `definitions/stg`: `store_id` 単位の最新化とチェーン横断 UNION
- `definitions/mart`: `rideoasis_mart.rideoasis_supply_points`
- `definitions/ops`: 未解決一覧と日次メトリクス

## 事前設定

`workflow_settings.yaml` の `defaultProject` を実プロジェクトに変更してください。

## 主な出力

- `rideoasis_stg.stores_latest_all`
- `rideoasis_stg.stores_geocode_latest_all`
- `rideoasis_mart.rideoasis_supply_points`
- `rideoasis_ops.geocode_unmatched`
- `rideoasis_ops.metrics_daily`
