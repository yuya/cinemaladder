// トップ（/）が「?q=作品名」付きで開かれたとき、HTML の題名・説明文・正規URLを作品名入りに書き換えて返す。
// 共有シートや SNS のリンクのプレビュー、検索エンジンは JS を動かさずに HTML を読むため、
// 画面側（index.html の JS）で題名を変えるだけでは作品名が伝わらない。
// Cloudflare Pages Functions として動く（このファイルは「/」だけを受け持ち、ほかのファイルには関わらない）。

const SITE = "https://cinemaladder.com/";
// 部首の文字（「⼆」康煕部首、「⻯」CJK部首補助など）を普通の漢字に直す。index.html の fixRad と同じ
const RAD = { "⻁": "虎", "⻄": "西", "⻆": "角", "⻑": "長", "⻘": "青", "⻝": "食", "⻣": "骨", "⻤": "鬼", "⻨": "麦", "⻩": "黄", "⻫": "斉", "⻭": "歯", "⻯": "竜", "⻲": "亀" };
const fixRad = s => (s || "").replace(/[\u2F00-\u2FD5]/g, c => c.normalize("NFKC")).replace(/[\u2E80-\u2EFF]/g, c => RAD[c] || c.normalize("NFKC"));


const IMG = "https://image.tmdb.org/t/p/w500";
const ICON = SITE + "brand/icon-512.png";
const API = "https://cinemaladder-api.twilightwind.workers.dev/movie";

// 共有リンク（?q=作品名&id=TMDBの番号）のポスター。リンクのプレビュー（LINE・X・iMessage など）に作品の画像を出すため。
// trailadder の worker.js と同じ考え方。手元のデータ（公開日順の控え、サジェスト用の作品一覧）から探し、
// どちらにもなければ中継サーバー（worker/worker.js の /movie）に聞く。手元のデータは数分ごとに読み直す
let posters = null, postersAt = 0;
async function loadPosters(ctx, origin) {
  if (posters && Date.now() - postersAt < 10 * 60e3) return posters;
  const m = new Map();
  const get = async (path) => {
    try { const r = await ctx.env.ASSETS.fetch(new Request(origin + path)); return r.ok ? await r.json() : null; } catch (e) { return null; }
  };
  const [arc, titles] = await Promise.all([get("/data/releases-archive.json"), get("/data/titles.json")]);
  const f = titles?.fields || [], iId = f.indexOf("id"), iP = f.indexOf("poster");
  if (iId >= 0 && iP >= 0) for (const t of titles.items || []) if (t[iP]) m.set(String(t[iId]), t[iP]);
  for (const [id, a] of Object.entries(arc || {})) if (a.p) m.set(id, a.p);
  posters = m; postersAt = Date.now();
  return m;
}
async function posterOf(ctx, origin, id) {
  const p = (await loadPosters(ctx, origin)).get(id);
  if (p) return p;
  try {
    const r = await fetch(`${API}?id=${id}`, { signal: AbortSignal.timeout(1500) });   // 待ちすぎて表示が遅れないように
    if (r.ok) return (await r.json()).poster || null;
  } catch (e) {}
  return null;
}

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
  const id = url.searchParams.get("id") || "";
  const poster = /^\d{1,9}$/.test(id) ? await posterOf(ctx, url.origin, id).catch(() => null) : null;

  return new HTMLRewriter()
    .on("title", { element(e) { e.setInnerContent(title); } })
    .on('meta[name="description"]', set("content", desc))
    .on('meta[property="og:title"]', set("content", title))
    .on('meta[property="og:description"]', set("content", desc))
    .on('meta[property="og:url"]', set("content", canon.href))
    .on('link[rel="canonical"]', set("href", canon.href))
    .on('meta[property="og:image"]', set("content", poster && /^\/[\w.-]+$/.test(poster) ? IMG + poster : ICON))
    .on('meta[property="og:image:alt"]', set("content", poster ? `${q} のポスター` : "Cinemaladder"))
    .transform(res);
}
