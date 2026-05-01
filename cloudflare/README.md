# Cloudflare Workers デプロイ

`frontend/` の静的アセット + `/api/supply-points` API を 1 つの Cloudflare Worker (`worker.mjs`) でホストし、補給地点 DB は Cloudflare D1 に置く構成。

## 構成

| 役割 | サービス | バインディング |
|---|---|---|
| 静的アセット (HTML/CSS/JS) | Cloudflare Workers + Static Assets | `ASSETS` (`frontend/` ディレクトリ) |
| API: `/api/supply-points` | Worker (`worker.mjs`) | — |
| 補給地点テーブル | Cloudflare D1 (`rideoasis-supply-points`) | `DB` |

`lib/map_data.js` の SQL ビルダ / GeoJSON 整形ロジックはローカル Node 開発サーバ (`scripts/map_dev_server.js`) と Worker で共有。Worker 側で `:named` プレースホルダを D1 の positional `?` に変換するアダプタが入っている。

## 初回セットアップ

```bash
npm install                         # wrangler が devDependency に入る

# 1. Cloudflare アカウントにログイン
npx wrangler login

# 2. D1 データベースを作成し、表示された database_id を wrangler.toml に貼る
npx wrangler d1 create rideoasis-supply-points

# 3. スキーマを apply
npm run cf:migrate:remote           # cloudflare/migrations/0001_init.sql を流す

# 4. ローカル SQLite から seed.sql を生成 (.gitignore 済み)
npm run cf:export-seed              # cloudflare/seed.sql

# 5. seed を D1 に投入
npm run cf:seed:remote
```

## 通常のデプロイ

```bash
npm run cf:deploy
# 既定では https://ride-oasis-map.<account>.workers.dev に公開
```

カスタムドメインは `wrangler.toml` の `routes` か Cloudflare Dashboard 側で設定。

## データ更新フロー

通常は BigQuery → SQLite → D1 の流れ:

```bash
# 1. BigQuery → ローカル SQLite (既存パイプライン)
npm run export:map-db -- --project <gcp-project>

# 2. ローカル SQLite → D1 用 seed.sql に変換
npm run cf:export-seed

# 3. D1 を一度クリアしてから seed を当てたい場合は migrations 経由で:
#    cloudflare/migrations/000N_truncate.sql に "DELETE FROM supply_points;" を入れて apply
#    あるいは: npx wrangler d1 execute rideoasis-supply-points --remote --command="DELETE FROM supply_points;"
npm run cf:seed:remote
```

cron や schedule 化したい場合は `npm run cf:export-seed && npm run cf:seed:remote` を GitHub Actions に乗せる。

## ローカル開発

ローカルでは 2 系統が併存:

- **Node 直 (推奨)**: `npm run map:serve -- --db ./.local/rideoasis-map.db --port 8787` — SQLite を直接読む。wrangler 不要、`lib/map_data.js` を共有しているので挙動は Worker と同等。
- **Wrangler dev**: `npm run cf:dev` — D1 のローカル sqlite (.wrangler/state/) を使ったプレビュー。`npm run cf:migrate:local && npm run cf:seed:local` で初期化。

## 制限

- D1 free tier: 5M reads/day, 100k writes/day, 5GB storage (2026-04 時点)
- Worker の Static Assets: 20k ファイル / 25MB per file
- 公開 Nominatim (geo-search) は Worker を経由せずブラウザから直接叩いている (CORS 通る) ので Cloudflare の制限影響なし
