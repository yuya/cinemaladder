// css/ フォルダの CSS を、各 HTML の <style data-css="…"> の中に埋め込む。
//
// 使い方：
//   1. CSS を直すときは css/ の中のファイル（base.css・top.css・pages.css）だけを編集する
//   2. node scripts/build-css.mjs を実行すると、HTML の <style> の中身が書き換わる
//      （GitHub 上で css/ を直して push した場合は、Actions がこれを自動で実行してコミットする）
//   node scripts/build-css.mjs --check … 埋め込みが最新かを確かめるだけ（古ければ終了コード1）
//
// HTML 側の書き方：<style data-css="base top">…</style>
//   data-css に並べた順に css/base.css → css/top.css をつなげて中に入れる。
//   中身は毎回まるごと置き換わるので、HTML の <style> の中は直接編集しないこと。
//
// 外部のツールは使わない（Node だけで動く）。CSS の変数や入れ子はいまのブラウザがそのまま理解するので、Sass などは入れていない。
import { readFile, writeFile } from "node:fs/promises";

const PAGES = ["index.html", "about.html", "privacy.html"];
const check = process.argv.includes("--check");
const NOTE = "/* この中身は css/ のファイルから scripts/build-css.mjs で自動で作られます。ここは直接編集しないでください */";

let stale = 0;
for (const page of PAGES) {
  const html = await readFile(page, "utf8");
  let found = 0;
  const parts = [];
  const re = /<style data-css="([^"]+)">[\s\S]*?<\/style>/g;
  for (const m of html.matchAll(re)) {
    found++;
    const css = [];
    for (const name of m[1].trim().split(/\s+/)) css.push((await readFile(`css/${name}.css`, "utf8")).trimEnd());
    parts.push({ from: m.index, to: m.index + m[0].length, text: `<style data-css="${m[1]}">\n${NOTE}\n${css.join("\n\n")}\n</style>` });
  }
  if (!found) throw new Error(`${page} に <style data-css="…"> がありません`);
  let out = "", pos = 0;
  for (const p of parts) { out += html.slice(pos, p.from) + p.text; pos = p.to; }
  out += html.slice(pos);
  if (out === html) { console.log(`${page}: 変更なし`); continue; }
  stale++;
  if (check) console.log(`${page}: 埋め込みが古くなっています`);
  else { await writeFile(page, out); console.log(`${page}: 埋め込み直しました`); }
}
if (check && stale) process.exit(1);
