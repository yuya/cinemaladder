# Cinemaladder

作品名から国内の映画レビューサイト・ムビチケ・SNS・配信サービスへ飛べるリンク集。構成と運用は README.md を参照。

## 姉妹プロジェクト

- **trailadder**（https://github.com/yuya/trailadder）は姉妹プロジェクト。作業を始めたら、trailadder のリポジトリもこのセッションに追加し（読み書きできる形で）、いつでも参照・修正できるようにしておく。
- TMDB の扱い（日本語の題名がない作品を外す判定 `readable`、部首の文字を直す `fixRad`、ジャンル名 `GENRE_JA`、あらすじの英語補完と DeepL の機械翻訳）は trailadder とそろえる。片方を直したら、もう片方も同じように直すか、直さない理由をユーザーに伝える。

## 運用の要点

- 修正はまず `stg` に入れ、確認できたら `main` に取り込む（`git merge -X theirs stg`）。
- 直下の `index.html` などは `npm run build` で作るファイル。直すのは `src/`・`css/`・`js/`。
- `data/` は GitHub Actions が毎日更新する。手で編集しない。
