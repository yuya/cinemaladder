// 日本の劇場公開日が「今日の1か月前〜2か月後」の作品を TMDB から集め、data/releases.json に書き出す（trailadder と同じ範囲）。
// あわせて、これまで一覧に載せた作品を data/releases-archive.json に残す。範囲から外れた作品の共有リンク（?q=作品名&id=TMDBの番号）でも、
// ポスターや作品情報を出せるようにするため。古い作品も消さずに足していく。
// GitHub Actions から毎日実行し、新しく登録された作品も拾う。
import { writeFile, readFile, mkdir } from "node:fs/promises";

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
// 日本語タイトルが未登録だと原題（タミル語など）が返るので、日本語・英数字以外を含むタイトルは除外（─ ★ ♪ → などの記号は日本語の題名にも使われるので許す）
const readable = t => !!t && !/[^\u0000-\u024F\u2000-\u206F\u2100-\u27BF\u2E80-\u30FF\u3400-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(t);

// 日本時間の今日。範囲は1か月前〜2か月後（月末で日がずれるときは、その月の末日にする。trailadder の addMonths と同じ）
const today = new Date(Date.now() + 9 * 3600e3);   // 日本時間の日付として扱う
today.setUTCHours(0, 0, 0, 0);
const addMonths = (d, n) => {
  const r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate()));
  if (r.getUTCDate() !== d.getUTCDate()) r.setUTCDate(0);
  return r;
};
const ymd = d => d.toISOString().slice(0, 10);
const from = ymd(addMonths(today, -1)), to = ymd(addMonths(today, 2));
// 直近の金曜（今日が金曜なら今日）。画面側で、公開日順のスクロール位置を週が変わったら忘れるのに使う
const anchor = new Date(today - ((today.getUTCDay() - 5 + 7) % 7) * 864e5);

// 1. 日本で劇場公開（限定公開を含む）される作品を、公開日の範囲で集める
const base = `/discover/movie?language=ja-JP&region=JP&with_release_type=2|3&release_date.gte=${from}&release_date.lte=${to}&sort_by=popularity.desc&include_adult=false`;
const first = await get(base + "&page=1");
const pages = Math.min(first.total_pages || 1, 30);   // 3か月分は多いので、10ページ（200本）では足りないことがある
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
await writeFile("data/releases.json", JSON.stringify({ updated: new Date().toISOString(), today: ymd(today), anchor: ymd(anchor), from, to, items }, null, 1) + "\n");

// これまで載せた作品の控え。{ "TMDBの番号": { t: 題名, o: 原題（題名と同じなら省く）, d: 公開日, p: ポスター } }。
// 1作品1行・番号順に並べる（stg と main を取り込むときに、行ごとに合わさるように）
let archive = {};
try { archive = JSON.parse(await readFile("data/releases-archive.json", "utf8")); } catch (e) {}
for (const m of items)
  archive[m.id] = { t: m.title, ...(m.original && m.original !== m.title ? { o: m.original } : {}), d: m.date, ...(m.poster ? { p: m.poster } : {}) };
const ids = Object.keys(archive).sort((a, b) => a - b);
await writeFile("data/releases-archive.json", "{\n" + ids.map(id => JSON.stringify(id) + ":" + JSON.stringify(archive[id])).join(",\n") + "\n}\n");
console.log(`${from} 〜 ${to}: ${items.length}本（控え：${ids.length}本）`);
