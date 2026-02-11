# AGENTS.md

このリポジトリで作業するエージェント向けのガイドです。`plan.md` を正として、実装とドキュメントを進めてください。

## 最優先の前提

- 目的は「補給地点DB」を BigQuery マートとして提供すること
- 公式サイトの変更に追従しやすいよう、クロールは Codex + Playwright 前提
- 住所正規化/座標付与は Cloud Run 側で実行し、Dataform は BQ 内完結
- `plan.md` 上のコア対象チェーンは 7-Eleven / Lawson / FamilyMart（拡張可能な設計）
- 現在の実装済みクローラは 7-Eleven / Lawson / FamilyMart / Daily Yamazaki / 道の駅 / MINISTOP

## コンポーネント責務

- Cloud Run: クロール、整形、正規化、`raw` へのロード
- Dataform: `raw` → `stg` → `mart` → `ops`
- Terraform: Cloud Run / BQ / Scheduler / IAM / Artifact Registry / Secret Manager など

## 作業ルール

- `plan.md` の仕様に反する提案や実装は行わない（必要なら先に提案して合意を取る）
- `raw.stores_scraped_*` の詳細スキーマはクロール実装に合わせて確定する
- `raw.stores_geocoded` は単一テーブルで共通スキーマを維持する
- 住所正規化は 1 住所 1 回を原則とし、再計算を避ける
- Dataform 側で外部 I/O や npm 実行を行わない
- 取得元に詳細URLが存在しない場合は `detail_url` を無理に生成しない
- API/JSONが使えるサイトでは、DOM抽出より API/JSON 取得を優先する
- リトライ処理にはタイムアウトを設定し、最終試行後の不要な待機を避ける

## 変更時のチェック

- Cloud Run: 収集失敗時のリトライ/バックオフ、ログ、Upsert 安全性
- Dataform: store_id 単位の最新化、`supply_point_id` の一意性
- ops: 未解決件数や成功率の集計が維持されているか

## ユニットテスト運用

- ユニットテストは Node.js 標準の `node:test` を使い、`tests/*.test.js` に配置する
- `npm test` と `npm run test:unit` は同じく `node --test tests/*.test.js` を実行する
- CLI 引数パースなどの安全性に関わる変更では、正常系と異常系（値欠落・不正値）の両方をテストで担保する
- テスト名は日本語で記述し、仕様意図が読める名前にする

## このリポジトリの Skills

- `skills/crawler-playwright/SKILL.md`
- `skills/dataform-modeling/SKILL.md`

必要に応じて上記 Skills を使用してください。
