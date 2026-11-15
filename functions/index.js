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

// 共有リンク（?q=作品名&f=TMDBの番号、または ?f=番号 だけ）の題名とポスター。リンクのプレビュー（LINE・X・iMessage など）に
// 作品名と画像を出すため。trailadder の worker.js と同じ考え方。手元のデータ（サジェスト用の作品一覧、公開日順の控え）から探し、
// どちらにもなければ中継サーバー（worker/worker.js の /movie）に聞く。手元のデータは数分ごとに読み直す
let films = null, filmsAt = 0;
async function loadFilms(ctx, origin) {
  if (films && Date.now() - filmsAt < 10 * 60e3) return films;
  const m = new Map();
  const get = async (path) => {
    try { const r = await ctx.env.ASSETS.fetch(new Request(origin + path)); return r.ok ? await r.json() : null; } catch (e) { return null; }
  };
  const [arc, titles] = await Promise.all([get("/data/releases-archive.json"), get("/data/titles.json")]);
  const f = titles?.fields || [], iId = f.indexOf("id"), iT = f.indexOf("title"), iP = f.indexOf("poster");
  if (iId >= 0 && iT >= 0) for (const t of titles.items || []) m.set(String(t[iId]), { t: t[iT], p: iP >= 0 ? t[iP] : null });
  for (const [id, a] of Object.entries(arc || {})) m.set(id, { t: a.t, p: a.p || null });
  films = m; filmsAt = Date.now();
  return m;
}
async function filmOf(ctx, origin, id) {
  const f = (await loadFilms(ctx, origin)).get(id);
  if (f) return f;
  try {
    const r = await fetch(`${API}?id=${id}`, { signal: AbortSignal.timeout(1500) });   // 待ちすぎて表示が遅れないように
    if (r.ok) { const d = await r.json(); if (d?.title) return { t: d.title, p: d.poster || null }; }
  } catch (e) {}
  return null;
}
const cleanQ = (s) => fixRad(s || "").replace(/[\u0000-\u001f\u007f"<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 100);

export async function onRequestGet(ctx) {
  const res = await ctx.next();   // いつもの index.html
  const url = new URL(ctx.request.url);
  // 作品名：前後の空白を除き、長すぎるものは切る。HTML の属性を壊しうる記号と制御文字は外す
  if (!(res.headers.get("content-type") || "").includes("text/html")) return res;
  const id = url.searchParams.get("f") || "";
  const film = /^\d{1,9}$/.test(id) ? await filmOf(ctx, url.origin, id).catch(() => null) : null;
  const q = cleanQ(url.searchParams.get("q")) || cleanQ(film?.t);   // ?f= だけなら、番号から分かった題名を使う
  if (!q) return res;
  const poster = film?.p || null;

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
    .on('meta[property="og:image"]', set("content", poster && /^\/[\w.-]+$/.test(poster) ? IMG + poster : ICON))
    .on('meta[property="og:image:alt"]', set("content", poster ? `${q} のポスター` : "Cinemaladder"))
    .transform(res);
}
