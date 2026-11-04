// 日本の劇場公開日が「今週の前後2週間」の作品を TMDB から集め、data/releases.json に書き出す。
// 日本の新作はたいてい金曜に公開されるので、週は金曜〜翌木曜で区切る。
// 対象は、直近の金曜（今日が金曜なら今日）の2週前の金曜 〜 2週後の木曜（5週分）。
// 範囲は金曜に1週ずつ進む（古い週が消え、新しい週が加わる）。GitHub Actions から毎日実行し、新しく登録された作品も拾う。
import { writeFile, mkdir } from "node:fs/promises";

const TOKEN = process.env.TMDB_TOKEN;
if (!TOKEN) { console.error("TMDB_TOKEN が設定されていません"); process.exit(1); }

const get = async (path, tries = 3) => {
  for (let i = 0; ; i++) {
    const r = await fetch("https://api.themoviedb.org/3" + path, {
      headers: { Authorization: "Bearer " + TOKEN, accept: "application/json" },
    });
    if (r.ok) return r.json();
    if (i + 1 >= tries || (r.status !== 429 && r.status < 500)) throw new Error(`${path} → HTTP ${r.status}`);
    await new Promise(res => setTimeout(res, 1000 * (i + 1)));
  }
};
// 日本語タイトルが未登録だと原題（タミル語など）が返るので、日本語・英数字以外を含むタイトルは除外
const readable = t => !!t && !/[^\u0000-ɏ -⁯⺀-ヿ㐀-鿿豈-﫿＀-￯]/.test(t);

// 日本時間の今日と、直近の金曜
const D = 864e5;
const today = new Date(Date.now() + 9 * 3600e3);   // 日本時間の日付として扱う
today.setUTCHours(0, 0, 0, 0);
// 基準：直近の金曜（今日が金曜なら今日）
const anchor = new Date(today - ((today.getUTCDay() - 5 + 7) % 7) * D);
const ymd = d => d.toISOString().slice(0, 10);
const from = ymd(new Date(anchor - 14 * D)), to = ymd(new Date(+anchor + 20 * D));

// 1. 日本で劇場公開（限定公開を含む）される作品を、公開日の範囲で集める
const base = `/discover/movie?language=ja-JP&region=JP&with_release_type=2|3&release_date.gte=${from}&release_date.lte=${to}&sort_by=popularity.desc&include_adult=false`;
const first = await get(base + "&page=1");
const pages = Math.min(first.total_pages || 1, 10);
const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => get(base + "&page=" + (i + 2)).catch(() => ({ results: [] }))));
const found = new Map();
for (const m of [first, ...rest].flatMap(p => p.results || [])) {
  if (found.has(m.id) || !readable(m.title) || /^untitled$/i.test(m.title.trim())) continue;   // 題名未定の仮登録は外す
  // ジャンルもポスターもない作品（グラビアなどの映像商品が多い）は外す
  if (!(m.genre_ids || []).length && !m.poster_path) continue;
  found.set(m.id, m);
}

// 2. 作品ごとに日本の公開日を確かめる（一覧の日付は国によって違うことがあるため）。劇場公開（3）を優先し、なければ限定公開（2）
const list = [...found.values()];
const items = [];
let next = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (next < list.length) {
    const m = list[next++];
    try {
      const jp = ((await get(`/movie/${m.id}/release_dates`)).results || []).find(r => r.iso_3166_1 === "JP")?.release_dates || [];
      const date = ((jp.find(d => d.type === 3) || jp.find(d => d.type === 2))?.release_date || "").slice(0, 10);
      if (date && date >= from && date <= to) {
        items.push({ id: m.id, title: m.title, original: m.original_title, date, poster: m.poster_path, pop: Math.round((m.popularity || 0) * 10) / 10 });
      }
    } catch (e) { console.warn(m.title, e.message); }
  }
}));
items.sort((a, b) => a.date.localeCompare(b.date) || b.pop - a.pop);
if (items.length < 5) throw new Error(`取得できた作品が少なすぎるため更新を中止しました（${items.length}本）`);

await mkdir("data", { recursive: true });
await writeFile("data/releases.json", JSON.stringify({ updated: new Date().toISOString(), anchor: ymd(anchor), from, to, items }, null, 1) + "\n");
console.log(`${from} 〜 ${to}（基準の金曜＝${ymd(anchor)}）: ${items.length}本`);
