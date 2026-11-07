# Cinemaladder

映画の評判を、はしごする。

作品名を1回入れるだけで、国内の映画レビューサイト・ムビチケ・SNS・配信サービスの検索結果へ飛べるリンク集。

## 構成
- `index.html` / `about.html` / `privacy.html` … 公開用の HTML。**自動で作るファイルなので直接編集しない**（下の「サイトの直し方」）。CSS と JS は縮めて中に埋め込んである（通信を増やさず表示を速くするため）
- `src/*.html` … 各ページの骨組み（HTML だけ）。`<style data-css="…">` と `<script data-js="…">` の場所に CSS・JS が入る
- `css/base.css` … 全ページ共通の変数（色・フォント・横幅 `--maxw`・左右の余白）とダーク表示。`css/top.css` … トップ用。`css/pages.css` … 運営者情報・プライバシーポリシー用
- `js/app.js` … トップの本体（検索・リンク・話題作など。アフィリエイトの設定 `AFF` も先頭にある）。`js/theme.js`・`js/theme-early.js` … 表示の色の切り替え（全ページ）。`js/ads.js` … AdSense の遅延読み込み。`js/hashist.js`・`js/pages.js` … 小さな補助
- `scripts/build.mjs` … `src/`・`css/`・`js/` から公開用の HTML を作る（esbuild で縮める）。`maps/` … 縮めたコードと元のファイルの対応表（ソースマップ）。開発者ツールを開くと、元のファイル名・行番号・コメントで見られる
- `data/insta-tags.json` … Instagram の公式ハッシュタグの表（TMDB の作品番号 → タグ。# なし。出典と確認日も残す）。Muse が公式サイト・公式X などから週1回集めて更新する。`npm run build` で js/app.js に埋め込まれる（タグに # や空白・記号があるとビルドが止まる）。表にない作品は作品名から記号を除いたタグを使う
- `package.json` … ビルドに使う道具（esbuild）の版を固定する
- `about.html` / `privacy.html` … 運営者情報とプライバシーポリシー（外部送信の公表を含む）。アクセス解析・広告・アフィリエイトを入れたら privacy.html の表と説明を更新する。公開URLは /about・/privacy（Cloudflare Pages が .html を省いた URL で配信し、.html 付きは自動で転送する）
- `functions/index.js` … Cloudflare Pages Functions。`/?q=作品名` で開かれたとき、HTML の題名・説明文・正規URLを作品名入りに書き換えて返す（共有のプレビューや検索エンジン向け。JS を動かさずに読まれるため）。push するだけで Pages が一緒に公開する
- `worker/worker.js` / `worker/wrangler.toml` … TMDB 中継（Cloudflare Workers、名前は cinemaladder-api）。https://cinemaladder-api.twilightwind.workers.dev で稼働。サジェスト・作品情報・英語あらすじの機械翻訳（DeepL、使えないときは Workers AI）。main の worker/ が変わると `.github/workflows/worker.yml` が自動で公開する（GitHub の Secret：CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / DEEPL_API_KEY。DeepL のキーは公開のたびに Worker の Secret へ渡す）
- `data/trending.json` … 話題作TOP10。GitHub Actions が毎日自動更新（手で編集しない）
- `data/releases.json` … 日本の公開日が今週の前後2週間（金曜〜木曜の週で5週分）の作品。「いま話題の映画」の「公開日順」タブで使う。`scripts/fetch-releases.mjs` で Actions が毎日更新
- `data/titles.json` … 検索ボックスのサジェスト用の作品一覧（数千本）。Actions が毎日自動更新
- `scripts/fetch-trending.mjs` / `scripts/fetch-titles.mjs` … 上の2つの JSON を作るスクリプト
- `scripts/fetch-icons.mjs` … ファビコンを取得するスクリプト（サイトを増やしたらここにも追加）
- `.github/workflows/trending.yml` … 毎日 6:17（日本時間）に上のスクリプトを実行し、staging と main の両方を更新。定期実行は既定ブランチの設定しか動かないため、このファイルは main にも置く
- `icons/` … 各サイトのファビコンの元画像。Actions が足りない分だけ取得し、`scripts/inline-icons.py` が css/top.css に埋め込み、`npm run build` で index.html に入る（通信回数を減らすため。表示には icons/ を直接使わない）
- `brand/icon.svg` … サイトのアイコンの元絵。`node scripts/build-brand.mjs` で favicon.svg / favicon.ico / apple-touch-icon.png / brand/*.png を書き出す
- `robots.txt` / `sitemap.xml` / `llms.txt` … 検索エンジンと AI 向けの案内（llms.txt はサイトの説明と作品ページの URL の形）
- `manifest.webmanifest` … ホーム画面に追加したときの名前・アイコン・色

## サイトの直し方
1. 元のファイルだけを直す（直下の index.html などは毎回作り直されるので、直接直しても消える）
   - 文言・ページの構造 → `src/*.html`
   - 見た目 → `css/`（全ページに効くものは `css/base.css`）
   - 動き → `js/`
2. 反映のしかたはどちらでもよい
   - GitHub の画面で直して `staging` にコミット → Actions（公開用の HTML を作る）が自動で HTML を作り直してコミットする。1〜2分で staging に出る
   - 手元なら、初回だけ `npm install`、そのあと `npm run build` を実行し、元のファイルと作られたファイル（index.html など・maps/）を一緒にコミットする
3. `npm run check` で、公開用の HTML が最新か確かめられる

Sass などのプリプロセッサは使っていない。変数（`var(--maxw)`）や入れ子はいまのブラウザがそのまま理解する。使う道具は縮めるための esbuild だけ。

## ブランチと公開先（Cloudflare Pages）
- `main` … 本番。https://cinemaladder.com で公開（cinemaladder.pages.dev でも同じものが見られる）
- `staging` … 確認用。https://staging.cinemaladder.pages.dev で公開し、Cloudflare Access で自分だけが見られるようにする
- 修正はまず `staging` に入れ、確認できたら `main` に取り込む（`git merge -X theirs staging`。data/ の衝突は staging 側を採用）
- `_headers` … Cloudflare Pages のキャッシュ設定

## TMDB
話題作TOP10は、リポジトリの Secret `TMDB_TOKEN` を使って Actions が取得するので、訪問者はトークン不要。

サジェストは Cloudflare Workers の中継（`worker/`）経由で TMDB の検索を使う。中継が応答しないときは `data/titles.json` から候補を出す。トークンはブラウザに一切置かない。

This product uses the TMDB API but is not endorsed or certified by TMDB.
