// 日本で上映中・公開予定の映画を TMDB から取得し、人気上位10本を data/trending.json に書き出す。
// GitHub Actions から毎日実行する。トークンはリポジトリの Secret（TMDB_TOKEN）から読む。
import { writeFile, mkdir } from "node:fs/promises";

// ジャンル名は TMDB の日本語訳を使わず、番号から決める（TMDB の訳は History が「履歴」になるなど不自然なものがあるため）
const GENRE_JA = { 28: "アクション", 12: "アドベンチャー", 16: "アニメーション", 35: "コメディ", 80: "犯罪", 99: "ドキュメンタリー", 18: "ドラマ", 10751: "ファミリー", 14: "ファンタジー", 36: "歴史", 27: "ホラー", 10402: "音楽", 9648: "ミステリー", 10749: "ロマンス", 878: "サイエンスフィクション", 10770: "テレビ映画", 53: "スリラー", 10752: "戦争", 37: "西部劇" };
const TOKEN = process.env.TMDB_TOKEN;
if (!TOKEN) { console.error("TMDB_TOKEN が設定されていません"); process.exit(1); }

const get = async path => {
  const r = await fetch("https://api.themoviedb.org/3" + path, {
    headers: { Authorization: "Bearer " + TOKEN, accept: "application/json" },
  });
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return r.json();
};

// 日本語タイトルが未登録だと原題（タミル語など）が返るので、日本語・英数字以外を含むタイトルは除外（─ ★ ♪ → などの記号は日本語の題名にも使われるので許す）
const readable = t => !!t && !/[^\u0000-\u024F\u2000-\u206F\u2100-\u27BF\u2E80-\u30FF\u3400-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(t);

const q = "?language=ja-JP&region=JP&page=";
const pages = await Promise.all([
  get("/movie/now_playing" + q + 1), get("/movie/now_playing" + q + 2), get("/movie/upcoming" + q + 1),
]);
const map = new Map();
for (const m of pages.flatMap(p => p.results || [])) {
  if (!readable(m.title)) continue;
  map.set(m.id, { id: m.id, title: m.title, original: m.original_title, date: m.release_date, poster: m.poster_path, pop: m.popularity });
}
const items = [...map.values()].sort((a, b) => b.pop - a.pop).slice(0, 10);
if (items.length < 3) throw new Error("取得できた作品が少なすぎるため更新を中止しました");

// 最初の画面ですぐ出せるよう、作品の詳しい情報も入れておく（形は中継サーバーの /movie と同じ）
// 後から届いた文字で画面がずれる（CLS）のを防ぐため。取れなかった作品は今まで通り中継サーバーから読む
const details = async id => {
  const m = await get(`/movie/${id}?language=ja-JP&append_to_response=credits,release_dates`);
  let overview = (m.overview || "").trim(), overviewLang = "ja";
  if (!overview) {
    const en = await get(`/movie/${id}?language=en-US`).catch(() => null);
    if (en?.overview) { overview = en.overview.trim(); overviewLang = "en"; }
  }
  const jp = (m.release_dates?.results || []).find(r => r.iso_3166_1 === "JP")?.release_dates || [];
  const jpDate = (jp.find(d => d.type === 3) || jp[0])?.release_date?.slice(0, 10) || "";
  const crew = m.credits?.crew || [];
  return {
    id: m.id, title: m.title, original: m.original_title, poster: m.poster_path,
    date: m.release_date || "", jpDate, runtime: m.runtime || 0, tagline: m.tagline || "",
    overview, overviewLang,
    genres: (m.genres || []).map(g => GENRE_JA[g.id] || g.name),
    countries: (m.production_countries || []).map(c => c.iso_3166_1),
    directors: crew.filter(c => c.job === "Director").map(c => c.name).slice(0, 3),
    cast: (m.credits?.cast || []).slice(0, 6).map(c => c.name),
  };
};
await Promise.all(items.map(async it => { try { it.info = await details(it.id); } catch (e) { console.warn(it.title, e.message); } }));

await mkdir("data", { recursive: true });
await writeFile("data/trending.json", JSON.stringify({ updated: new Date().toISOString(), items }, null, 1) + "\n");
console.log(items.map((m, i) => `${i + 1}. ${m.title}`).join("\n"));
