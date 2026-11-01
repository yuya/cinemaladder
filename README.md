# Cinemaladder

映画の評判を、はしごする。

作品名を1回入れるだけで、国内の映画レビューサイト・ムビチケ・SNS・配信サービスの検索結果へ飛べるリンク集。

## 構成
- `index.html` … サイト本体（1ファイル完結。ライブラリなし）
- `about.html` / `privacy.html` / `pages.css` … 運営者情報とプライバシーポリシー（外部送信の公表を含む）。アクセス解析・広告・アフィリエイトを入れたら privacy.html の表と説明を更新する。公開URLは /about・/privacy（Cloudflare Pages が .html を省いた URL で配信し、.html 付きは自動で転送する）
- `functions/index.js` … Cloudflare Pages Functions。`/?q=作品名` で開かれたとき、HTML の題名・説明文・正規URLを作品名入りに書き換えて返す（共有のプレビューや検索エンジン向け。JS を動かさずに読まれるため）。push するだけで Pages が一緒に公開する
- `worker/worker.js` … TMDB 中継（Cloudflare Workers）。https://cinemaladder-api.twilightwind.workers.dev で稼働。サジェストに使う。コードを変えたら Cloudflare の画面で貼り直して Deploy
- `data/trending.json` … 話題作TOP10。GitHub Actions が毎日自動更新（手で編集しない）
- `data/titles.json` … 検索ボックスのサジェスト用の作品一覧（数千本）。Actions が毎日自動更新
- `scripts/fetch-trending.mjs` / `scripts/fetch-titles.mjs` … 上の2つの JSON を作るスクリプト
- `scripts/fetch-icons.mjs` … ファビコンを取得するスクリプト（サイトを増やしたらここにも追加）
- `.github/workflows/trending.yml` … 毎日 6:17（日本時間）に上のスクリプトを実行し、staging と main の両方を更新。定期実行は既定ブランチの設定しか動かないため、このファイルは main にも置く
- `icons/` … 各サイトのファビコンの元画像。Actions が足りない分だけ取得し、`scripts/inline-icons.py` が index.html の CSS に埋め込む（通信回数を減らすため。表示には icons/ を直接使わない）
- `brand/icon.svg` … サイトのアイコンの元絵。`node scripts/build-brand.mjs` で favicon.svg / favicon.ico / apple-touch-icon.png / brand/*.png を書き出す
- `robots.txt` / `sitemap.xml` / `llms.txt` … 検索エンジンと AI 向けの案内（llms.txt はサイトの説明と作品ページの URL の形）
- `manifest.webmanifest` … ホーム画面に追加したときの名前・アイコン・色

## ブランチと公開先（Cloudflare Pages）
- `main` … 本番。https://cinemaladder.com で公開（cinemaladder.pages.dev でも同じものが見られる）
- `staging` … 確認用。https://staging.cinemaladder.pages.dev で公開し、Cloudflare Access で自分だけが見られるようにする
- 修正はまず `staging` に入れ、確認できたら `main` に取り込む（`git merge -X theirs staging`。data/ の衝突は staging 側を採用）
- `_headers` … Cloudflare Pages のキャッシュ設定

## TMDB
話題作TOP10は、リポジトリの Secret `TMDB_TOKEN` を使って Actions が取得するので、訪問者はトークン不要。

サジェストは Cloudflare Workers の中継（`worker/`）経由で TMDB の検索を使う。中継が応答しないときは `data/titles.json` から候補を出す。トークンはブラウザに一切置かない。

This product uses the TMDB API but is not endorsed or certified by TMDB.
