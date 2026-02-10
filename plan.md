# RideOasis：補給地点DB（Crawler + Geocoding + Dataform）仕様

## 1. 目的

* コンビニ等の公式サイトから店舗情報（主に住所）を収集し、住所を正規化して緯度経度を付与し、BigQuery 上のマートとして提供する。
* 対象チェーン：**セブン‐イレブン / ローソン / ファミリーマート**（将来拡張可能な設計にする）。

## 2. 前提・方針

* 実行基盤は **Cloud Run（Job/Service）** を使用する。
* 店舗情報の取得（クローリング/抽出）は **Codex + Playwright** を用いて実装・保守する（公式サイトのHTML/JS変更に追従しやすくする）。
* 住所→座標付与は **@geolonia/normalize-japanese-addresses** を利用する。
* **Dataform は BigQuery 上の整形・履歴・差分・マート化を担当**し、外部ネットワークI/Oや npm ライブラリ実行（座標付与処理）は前段（Cloud Run）に寄せる。
* BQ 内完結（マート完結）とし、CSV Export は必須要件に含めない。
* インフラ（Cloud Run / BigQuery / Scheduler 等）は **Terraform** でコード管理する。

## 3. コンポーネント責務（使い分け）

### 3.1 Cloud Run（前段処理）

**責務**

1. 公式サイトから店舗一覧/店舗詳細を収集（クローリング/スクレイピング）。

   * 実装は **Codex + Playwright** を前提（Network/XHR解析・DOM抽出・サイト別の差異吸収）。
2. 収集データを正規化しやすい形へ整形（郵便番号、都道府県欠落補完など）。
3. `normalize()` を実行し、`address_norm` と `point.lat/lng` 等を得る。
4. BigQuery の `raw` テーブルへロード（Upsert 可能な形にする）。

**非責務（やらない）**

* 最終的な重複排除、最新化、マート構築
* 品質メトリクス集計

### 3.2 Dataform（BQ内処理）

**責務**

1. `raw` → `stg`：型/NULL/文字列整形、キー生成、最新化
2. `stg` → `mart`：store_id 単位で 1 行に確定、供給点として使う列に整形
3. `ops`：未解決（unmatched）、成功率/精度分布などの監視テーブル

**非責務（やらない）**

* Web へのアクセス、npm ライブラリによる住所正規化/座標付与

## 4. データフロー

1. Cloud Run が店舗情報を取得し `raw.stores_scraped` に投入
2. Cloud Run が住所を `normalize()` し `raw.stores_geocoded` に投入
3. Dataform が `raw` を取り込み、最新化/重複排除して `stg.*` を生成
4. Dataform が `mart.rideoasis_supply_points` を生成
5. Dataform が `ops.*` を生成（未解決・品質）

## 5. BigQuery スキーマ（案）

### 5.1 raw（チェーン別）

チェーンごとに生テーブルを分け、取得仕様・欠損項目・更新頻度の差異を吸収する。

> **重要（仕様）**：`raw.stores_scraped_*` の詳細スキーマは **Codex + Playwright によるサイト解析・抽出実装の結果に合わせて確定**する。本仕様書では **「案（例）」**として記載し、運用開始後も変更可能な前提とする。

#### raw.stores_scraped_7eleven（案）

* `store_id` STRING（公式サイト由来の一意IDを優先、無い場合はハッシュID）
* `store_name` STRING
* `address_raw` STRING
* `postal_code` STRING
* `source_url` STRING
* `scraped_at` TIMESTAMP
* `payload_json` JSON（取得元の生データ。**将来のスキーマ変更吸収用**）

#### raw.stores_scraped_lawson（案）

（上と同様。取得可能項目はサイト仕様に従う）

#### raw.stores_scraped_familymart（案）

（上と同様。取得可能項目はサイト仕様に従う）

> 備考：運用が落ち着いたら `raw.stores_scraped`（単一）に統合し、`chain` でパーティション/クラスタリングする方式へ移行してもよい。

### 5.2 raw（geocoded：統合）

> **仕様（確定）**：`normalize-japanese-addresses` の出力はチェーン差が出にくく、カラムも共通化できるため、**geocoded は単一テーブルに統合**する。
> クローラ由来のばらつきは `raw.stores_scraped_*` 側で吸収し、geocoded 以降は **共通スキーマ**を契約とする。

#### raw.stores_geocoded（必須最小・確定）

* `chain` STRING（'7eleven' / 'lawson' / 'familymart'）
* `store_id` STRING（チェーン内一意）
* `address_raw` STRING
* `address_norm` STRING
* `point_lat` FLOAT64
* `point_lng` FLOAT64
* `level` INT64（住所の正規化レベル）
* `point_level` INT64（位置情報のレベル）
* `geocode_engine` STRING 例: 'geolonia/normalize-japanese-addresses'
* `engine_version` STRING
* `geocoded_at` TIMESTAMP
* `geocode_error` STRING（失敗時）

**推奨キー**

* `supply_point_id = CONCAT(chain, ':', store_id)`（全体一意）

#### raw.stores_geocoded（任意拡張・案）

* `pref` STRING
* `city` STRING
* `town` STRING
* `addr` STRING
* `other` STRING

### 5.3 stg（Dataform）

* `stg.stores_latest_7eleven`：`raw.stores_scraped_7eleven` から store_id 単位で最新を確定
* `stg.stores_latest_lawson`
* `stg.stores_latest_familymart`
* `stg.stores_geocode_latest_7eleven`：`raw.stores_geocoded_7eleven` から store_id 単位で最新を確定
* `stg.stores_geocode_latest_lawson`
* `stg.stores_geocode_latest_familymart`

> 備考：最終的に `stg.stores_latest_all` / `stg.stores_geocode_latest_all`（chain列付きUNION）を作り、以降のマートはチェーン横断で組む。

### 5.4 mart（Dataform）

#### mart.rideoasis_supply_points

* `supply_point_id` STRING（基本は `chain:store_id`）
* `chain` STRING
* `store_id` STRING
* `name` STRING
* `lat` FLOAT64
* `lng` FLOAT64
* `address_norm` STRING
* `geocode_level` INT64
* `geocode_point_level` INT64
* `source_url` STRING
* `updated_at` TIMESTAMP（Dataform 作成日時 or upstream 最新日時）

### 5.5 ops（Dataform）

* `ops.geocode_unmatched`：`point_lat/lng IS NULL` もしくは `point_level < 閾値` の行
* `ops.metrics_daily`：日次で件数、成功率、point_level 分布など

## 6. 正規化・座標付与の仕様（Cloud Run）

### 6.1 normalize-japanese-addresses の使い方

* 1住所あたり **1回の normalize()** を原則とし、リトライは例外系に限定する。
* 大量処理のため、結果は `raw.stores_geocoded` に保存し、同一住所の再計算を避ける（キャッシュ）。

### 6.2 データソース（住所API）

* デフォルトの住所データAPIを利用（PoC/初期）
* 需要が増えたら `japaneseAddressesApi` を `file://`（ローカル）参照に切り替える、または自前ホストを検討。

### 6.3 位置精度の扱い

* `level`（住所の正規化レベル）と `point_level`（位置情報レベル）を分離して保存する。
* マート側の利用要件に応じて、`point_level >= X` を必須条件にする（Xは運用開始後に決定）。

## 7. 差分更新・冪等性

* Cloud Run は

  * `store_id` が同一で `address_raw` が不変なら geocode を再実行しない
  * `address_raw` が変わった場合のみ geocode を更新
* Dataform は store_id 単位で最新化（`scraped_at`, `geocoded_at` に基づく）

## 8. エラー処理

* 取得（クローラ）失敗：リトライ（指数バックオフ）、失敗URLを別ログに記録
* geocode 失敗：`geocode_error` に理由を保存し `ops.geocode_unmatched` で可視化
* BQ ロード失敗：ジョブ失敗として再実行可能に（同一入力で結果が重複しない Upsert 方式）

## 9. 運用・監視

* `ops.metrics_daily` を Looker Studio 等に接続し、

  * 総店舗数
  * geocode 成功率
  * point_level 分布
  * unmatched 件数
    を監視する。

## 10. セキュリティ

* クローリング対象サイトの利用規約/robots を確認し、アクセス頻度は制限する。
* Cloud Run のサービスアカウントに最小権限（BQ書き込み権限）を付与。

## 11. IaC（Terraform）

* 管理対象（例）

  * Cloud Run（Service/Job）
  * Cloud Scheduler（定期実行する場合）
  * BigQuery（dataset、必要ならテーブル定義/権限）
  * IAM（サービスアカウント/権限）
  * Artifact Registry（コンテナイメージ保管）
  * Secret Manager（必要なら）
* 方針

  * 環境分割（dev/prod）を想定し、変数で project_id / region / dataset 名を切り替え可能にする。
  * 権限は最小権限（BQ write、ログ出力、必要ならScheduler実行など）を基本とする。

---

## 付録：ディレクトリ（Dataform）例

* `definitions/raw/`（外部テーブル/参照のみ）
* `definitions/stg/`（最新化・整形）
* `definitions/mart/`（供給点マート）
* `definitions/ops/`（未解決・指標）
