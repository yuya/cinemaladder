// トップ（/）が「?q=作品名」付きで開かれたとき、HTML の題名・説明文・正規URLを作品名入りに書き換えて返す。
// 共有シートや SNS のリンクのプレビュー、検索エンジンは JS を動かさずに HTML を読むため、
// 画面側（index.html の JS）で題名を変えるだけでは作品名が伝わらない。
// Cloudflare Pages Functions として動く（このファイルは「/」だけを受け持ち、ほかのファイルには関わらない）。

const SITE = "https://cinemaladder.com/";
// 部首の文字（「⼆」康煕部首、「⻯」CJK部首補助など）を普通の漢字に直す。index.html の fixRad と同じ
const RAD = { "⻁": "虎", "⻄": "西", "⻆": "角", "⻑": "長", "⻘": "青", "⻝": "食", "⻣": "骨", "⻤": "鬼", "⻨": "麦", "⻩": "黄", "⻫": "斉", "⻭": "歯", "⻯": "竜", "⻲": "亀" };
const fixRad = s => (s || "").replace(/[\u2F00-\u2FD5]/g, c => c.normalize("NFKC")).replace(/[\u2E80-\u2EFF]/g, c => RAD[c] || c.normalize("NFKC"));


export async function onRequestGet(ctx) {
  const res = await ctx.next();   // いつもの index.html
  const url = new URL(ctx.request.url);
  // 作品名：前後の空白を除き、長すぎるものは切る。HTML の属性を壊しうる記号と制御文字は外す
  const q = fixRad(url.searchParams.get("q") || "").replace(/[\u0000-\u001f\u007f"<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 100);
  if (!q || !(res.headers.get("content-type") || "").includes("text/html")) return res;

  const title = `${q} - Cinemaladder`;
  const desc = `「${q}」について、Filmarks、映画.com、Yahoo!など各サイトの検索結果へ移動できます。チケット、SNS、配信サービスの検索結果も開けます。`;
  const canon = new URL(SITE); canon.searchParams.set("q", q);
  const set = (attr, value) => ({ element(e) { e.setAttribute(attr, value); } });

  return new HTMLRewriter()
    .on("title", { element(e) { e.setInnerContent(title); } })
    .on('meta[name="description"]', set("content", desc))
    .on('meta[property="og:title"]', set("content", title))
    .on('meta[property="og:description"]', set("content", desc))
    .on('meta[property="og:url"]', set("content", canon.href))
    .on('link[rel="canonical"]', set("href", canon.href))
    .transform(res);
}
