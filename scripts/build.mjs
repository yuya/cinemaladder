// 公開用の HTML（index.html・about.html・privacy.html）を、元のファイルから作る。
//
//   src/*.html … ページの骨組み（HTML だけ）
//   css/*.css  … 見た目。base.css は全ページ共通、top.css はトップ、pages.css は運営者情報・プライバシーポリシー
//   js/*.js    … 動き。app.js がトップの本体
//
// src/*.html の中の目印を、縮めた（コメントと空白を除いた）CSS・JS に置き換えて、同じ名前でリポジトリ直下に書き出す。
//   <style data-css="base top"></style> … css/base.css → css/top.css の順につなげて1つの <style> にする
//   <script data-js="app"></script>     … js/app.js を1つの <script> にする
// 縮めたコードと元のファイルの対応表（ソースマップ）を maps/ に書き出す。
// ブラウザの開発者ツールを開いたときだけ読み込まれ、元のファイル名・行番号・コメントのまま表示される（普段の通信は増えない）。
//
// 使い方：npm install（初回だけ）→ npm run build
//   npm run check … 書き出し済みの HTML が最新かを確かめるだけ（古ければ終了コード1）
// GitHub で src/・css/・js/ を直して push した場合は、Actions（.github/workflows/build.yml）が自動で実行してコミットする。
import { readFile, writeFile, mkdir } from "node:fs/promises";
import * as esbuild from "esbuild";

const PAGES = ["index.html", "about.html", "privacy.html"];
const check = process.argv.includes("--check");
const HEAD = (src) =>
  `<!-- このファイルは ${src} から scripts/build.mjs（npm run build）で自動で作られます。直接編集せず、src/・css/・js/ を直してください -->`;

// Instagram の公式ハッシュタグ表（data/insta-tags.json）を読み、形を確かめてから js/app.js の __INSTA_TAGS__ に入れる
async function instaTags() {
  const raw = await readFile("data/insta-tags.json", "utf8").catch(() => null);
  if (raw === null) return {};
  let j;
  try { j = JSON.parse(raw); } catch (e) { throw new Error("data/insta-tags.json が JSON として読めません：" + e.message); }
  const tags = {};
  for (const [id, v] of Object.entries(j?.tags || {})) {
    const tag = typeof v === "string" ? v : v?.tag;
    if (!/^\d+$/.test(id)) throw new Error(`data/insta-tags.json：作品番号「${id}」が数字ではありません`);
    if (typeof tag !== "string" || !/^[\p{L}\p{N}_]+$/u.test(tag)) throw new Error(`data/insta-tags.json：${id} のタグ「${tag}」に、ハッシュタグに使えない文字（# や空白・記号）があります`);
    tags[id] = tag;
  }
  return tags;
}
const DEFINE = { __INSTA_TAGS__: JSON.stringify(JSON.stringify(await instaTags())) }; // 文字列として埋め込む（オブジェクトのままだと esbuild が全体の変数に括り出すため）

const out = new Map(); // 書き出すファイル → 中身
const cache = new Map(); // 同じ CSS・JS は1回だけ縮める

// 縮める。ソースマップは maps/<名前>.map に置き、元のファイルの中身も対応表に含める（開発者ツールがそのまま表示できるように）
async function minify(kind, names) {
  const key = kind + ":" + names.join(" ");
  if (cache.has(key)) return cache.get(key);
  const name = names.join("+");
  const mapFile = `maps/${name}.${kind}.map`;
  const r = await esbuild.build({
    stdin:
      kind === "css"
        ? { contents: names.map((n) => `@import "./${n}.css";`).join("\n"), resolveDir: "css", sourcefile: "styles.css", loader: "css" }
        : undefined,
    entryPoints: kind === "js" ? [`js/${names[0]}.js`] : undefined,
    bundle: kind === "css", // CSS は @import でつなげる。JS は1ファイルずつそのまま（名前の付け替えで他のスクリプトから見えなくならないよう束ねない）
    minify: true,
    sourcemap: "external",
    sourcesContent: true,
    legalComments: "none",
    charset: "utf8", // 日本語を \u エスケープにしない
    target: ["es2020", "safari15"],
    define: kind === "js" ? DEFINE : undefined,
    outfile: `maps/${name}.${kind}`, // ソースマップの中の元ファイルの場所（../css/…・../js/…）を正しくするための仮の出力先
    write: false,
    logLevel: "silent",
  });
  let code = r.outputFiles.find((f) => !f.path.endsWith(".map")).text;
  let map = r.outputFiles.find((f) => f.path.endsWith(".map")).text;
  code = code.replace(/\n?\/[*/]# sourceMappingURL=.*$/s, "").trim();
  if (kind === "js" && /<\/script/i.test(code)) throw new Error(`js/${name}.js の中に </script が残っています`);
  if (kind === "css" && /<\/style/i.test(code)) throw new Error(`css の中に </style が残っています`);
  code += kind === "css" ? `\n/*# sourceMappingURL=/${mapFile} */` : `\n//# sourceMappingURL=/${mapFile}`;
  out.set(mapFile, map.endsWith("\n") ? map : map + "\n");
  cache.set(key, code);
  return code;
}

for (const page of PAGES) {
  let html = await readFile(`src/${page}`, "utf8");
  const tasks = [];
  html.replace(/<style data-css="([^"]+)"><\/style>|<script data-js="([^"]+)"><\/script>/g, (m, css, js) => {
    tasks.push({ m, css, js });
    return m;
  });
  if (!tasks.length) throw new Error(`src/${page} に <style data-css> も <script data-js> もありません`);
  for (const t of tasks) {
    const code = t.css ? await minify("css", t.css.trim().split(/\s+/)) : await minify("js", [t.js.trim()]);
    html = html.replace(t.m, () => (t.css ? `<style>${code}</style>` : `<script>${code}</script>`));
  }
  // 自動生成の注記は <!doctype html> のすぐ後に入れる（前に置くと古いブラウザで表示が崩れることがあるため）
  html = html.replace(/^(<!doctype html>\n?)/i, (d) => d.trimEnd() + "\n" + HEAD(`src/${page}`) + "\n");
  out.set(page, html);
}

let stale = 0;
await mkdir("maps", { recursive: true });
for (const [file, text] of out) {
  const now = await readFile(file, "utf8").catch(() => null);
  if (now === text) continue;
  stale++;
  if (check) console.log(`${file}: 古くなっています（npm run build で作り直してください）`);
  else {
    await writeFile(file, text);
    console.log(`${file}: 書き出しました`);
  }
}
if (!stale) console.log("すべて最新です");
if (check && stale) process.exit(1);
