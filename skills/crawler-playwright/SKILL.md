# Skill: crawler-playwright

公式サイトの店舗情報を Playwright で安定的に収集し、`raw.stores_scraped_*` へ投入するための作業手順。

## 目的

- サイト変更に強い抽出ロジックを作る
- 収集結果を `raw` へ Upsert しやすい形に整形する

## 手順（最短ルート）

1. 対象サイトの一覧/詳細ページを調査し、XHR/JSON 取得の有無を確認
2. XHR がある場合はそれを優先（HTML 直接抽出は最後の手段）
3. store_id の取得方法を確定（公式 ID がなければハッシュ）
4. 取得項目を `raw.stores_scraped_{chain}` に合わせて整形
5. 取得失敗時のリトライ、rate limit、ログ出力を実装
6. 出力スキーマを `plan.md` の「案」に合わせて更新

## 抽出の基本方針

- セレクタは安定性優先（id/data 属性、API レスポンス優先）
- 取得元 URL は `source_url` として必ず保存
- 取得した生データは `payload_json` に保存

## 住所整形の前提

- 住所正規化は Cloud Run 内で実行
- 郵便番号や都道府県の欠落があれば補完を試みる

## 期待する出力（最小）

- `store_id`
- `store_name`
- `address_raw`
- `postal_code`
- `source_url`
- `scraped_at`
- `payload_json`
