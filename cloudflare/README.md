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

## Workers Builds (CF 純正の CI/CD で自動デプロイ)

Cloudflare Dashboard 側の Workers Builds から GitHub リポジトリを連携すると、push 毎に自動でビルド/デプロイできる。設定値:

- **Workers & Pages → ride-oasis → Settings → Builds → Connect**
- **Repository**: `ochanuco/ride-oasis`
- **Production branch**: `main`
- **Build command** (任意、テスト実行する場合): `npm ci && npm test`
- **Deploy command (production branch)**: `npx wrangler deploy`
- **Deploy command (non-production branches)**: `npx wrangler versions upload`

Production branch (main) への push は `wrangler deploy` で本番 (`https://ride-oasis.teacatus.workers.dev`) に直接反映、それ以外のブランチへの push は `wrangler versions upload` でバージョンが追加されるだけで本番には影響せず、`https://<version-id>-ride-oasis.teacatus.workers.dev` のプレビュー URL が払い出される。プレビューを本番昇格したいときは Dashboard か `npx wrangler versions deploy` を実行。

### 非本番ブランチで気をつけるポイント
- `wrangler versions upload` は Worker 本体のコード/asset のみ更新する。`wrangler.toml` の binding 構造変更 (D1 追加など) は production deploy 経由でしか反映されない。
- D1 のスキーマ変更 (新マイグレーション) は preview に対しても適用が必要 (`wrangler d1 migrations apply rideoasis-supply-points --remote` をローカルで一度走らせれば preview/prod 両方が同じ DB を使うため反映される)。
- D1 のデータ更新 (`cf:seed:remote`) は preview/prod で共有される。データを切り離したい場合は `[env.preview]` セクションを wrangler.toml に追加し別 D1 を bind する。
- `cf:preview` をローカルで叩く場合と Workers Builds で走らせる場合で Worker Version ID が異なる。Dashboard 側の自動付与の Version ID をブックマークするのが楽。
- ブランチを削除しても作成済みの Version は履歴に残る (CF 側で世代管理)。

### Workers Builds の権限
- Workers Builds は OAuth で GitHub に接続する。明示的なシークレット (CLOUDFLARE_API_TOKEN 等) は不要。
- D1 binding は Worker の binding として deploy 時に決まるため、Workers Builds 側では追加設定なしで wrangler.toml の D1 binding がそのまま効く。
- `nodejs_compat` flag も wrangler.toml に書いてあれば自動で適用される。

## ローカル開発

ローカルでは 2 系統が併存:

- **Node 直 (推奨)**: `npm run map:serve -- --db ./.local/rideoasis-map.db --port 8787` — SQLite を直接読み込む。wrangler 不要、`lib/map_data.js` を共有しているので挙動は Worker と同等。
- **Wrangler dev**: `npm run cf:dev` — D1 のローカル sqlite (.wrangler/state/) を使ったプレビュー。`npm run cf:migrate:local && npm run cf:seed:local` で初期化。

## 制限

- D1 free tier: 5M reads/day, 100k writes/day, 5GB storage (2026-04 時点)
- Worker の Static Assets: 20k ファイル / 25MB per file
- 公開 Nominatim (geo-search) は Worker を経由せずブラウザから直接叩いている (CORS 通る) ので Cloudflare の制限影響なし
