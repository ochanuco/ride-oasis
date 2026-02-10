# Skill: dataform-modeling

`raw` → `stg` → `mart` → `ops` を Dataform で整備するための作業手順。

## 目的

- `raw` のばらつきを吸収して最新化
- 供給点マートと品質監視テーブルを提供

## 手順（最短ルート）

1. `raw.stores_scraped_*` と `raw.stores_geocoded` のスキーマを確認
2. `stg` で store_id 単位の最新化を実装
3. `stg` をチェーン横断で UNION して `stg.*_all` を作成
4. `mart.rideoasis_supply_points` を生成
5. `ops` に未解決・成功率・分布を集計

## モデリング方針

- `supply_point_id = CONCAT(chain, ':', store_id)` を一意キーにする
- `updated_at` は Dataform の生成日時または upstream の最新日時
- `point_level` の閾値は運用開始後に可変とする

## テーブル要件

- `stg` は最新化・整形に限定（重いロジックは避ける）
- `mart` は 1 行 1 供給点を厳守
- `ops` は可視化しやすい粒度で作成
