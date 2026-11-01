// Cinemaladder 用 TMDB 中継（Cloudflare Workers）
// 目的: TMDB のトークンをブラウザやアプリに置かず、サーバー側だけに持たせる。
// 使い方:
//   1. 公開は GitHub Actions（.github/workflows/worker.yml）が行う。main の worker/ が変わると自動で Deploy する
//      設定は worker/wrangler.toml（Worker の名前、Workers AI の割り当てなど）
//   2. TMDB_TOKEN（API Read Access Token）は Cloudflare の画面で Secret として設定済み（Deploy しても消えない）
//   3. 通信を許可するサイトは下の ALLOWED_ORIGINS
//   4. index.html の TMDB_PROXY に「https://<worker名>.<サブドメイン>.workers.dev/search」を設定

// 通信を許可するサイト（本番と、手元での確認用の http://localhost:8000）
const ALLOWED_ORIGINS = ["https://cinemaladder.com", "https://www.cinemaladder.com", "http://localhost:8000"];
// Cloudflare Pages の確認用URL（staging.cinemaladder.pages.dev や 1回ごとのプレビューURL）を許可
const ALLOWED_SUFFIXES = [".cinemaladder.pages.dev"];
const isAllowed = o => ALLOWED_ORIGINS.includes(o) || o === "https://cinemaladder.pages.dev" ||
  (o.startsWith("https://") && ALLOWED_SUFFIXES.some(s => o.endsWith(s)));

export default {
  async fetch(req, env, ctx) {
    const origin = req.headers.get("Origin") || "";
    const allow = isAllowed(origin) ? origin : ALLOWED_ORIGINS[0];
    const cors = { "Access-Control-Allow-Origin": allow, "Vary": "Origin" };

    const url = new URL(req.url);
    const tmdb = path => fetch("https://api.themoviedb.org/3" + path, {
      headers: { Authorization: "Bearer " + env.TMDB_TOKEN, accept: "application/json" },
      cf: { cacheTtl: 3600, cacheEverything: true },
    }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });

    // 日本で上映中＋公開予定の作品を人気順に上位10本
    if (url.pathname === "/trending") {
      try {
        const q = "?language=ja-JP&region=JP&page=";
        // 日本語タイトルが未登録だと原題（タミル語など）が返るので、日本語・英数字以外を含むタイトルは除外
        const readable = t => !!t && !/[^\u0000-\u024F\u2000-\u206F\u2E80-\u30FF\u3400-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(t);
        const pages = await Promise.all([tmdb("/movie/now_playing" + q + 1), tmdb("/movie/now_playing" + q + 2), tmdb("/movie/upcoming" + q + 1)]);
        const map = new Map();
        pages.flatMap(p => p.results || []).filter(m => readable(m.title)).forEach(m => map.set(m.id, {
          id: m.id, title: m.title, original: m.original_title, date: m.release_date, poster: m.poster_path, pop: m.popularity,
        }));
        const top = [...map.values()].sort((a, b) => b.pop - a.pop).slice(0, 10);
        return json(top, { ...cors, "Cache-Control": "public, max-age=3600" });
      } catch (e) {
        return json({ error: String(e.message) }, cors, 502);
      }
    }

    // 作品の詳しい情報（あらすじ・公開日・上映時間・ジャンル・監督・出演など）。作品番号で1本ずつ返す
    if (url.pathname === "/movie") {
      const id = url.searchParams.get("id") || "";
      if (!/^\d{1,9}$/.test(id)) return json({ error: "bad id" }, cors, 400);
      try {
        const m = await tmdb(`/movie/${id}?language=ja-JP&append_to_response=credits,release_dates`);
        let overview = (m.overview || "").trim(), overviewLang = "ja";
        if (!overview) {   // 日本語のあらすじが未登録なら英語で補う
          const en = await tmdb(`/movie/${id}?language=en-US`).catch(() => null);
          if (en?.overview) { overview = en.overview.trim(); overviewLang = "en"; }
        }
        if (overviewLang === "en") {   // 英語しかなければ機械翻訳する（できなければ英語のまま）
          const ja = await translate(env, ctx, id, overview);
          if (ja) { overview = ja; overviewLang = "mt"; }
        }
        // 日本の劇場公開日（種類3）を優先し、なければ日本の最初の公開日、最後に全体の公開日
        const jp = (m.release_dates?.results || []).find(r => r.iso_3166_1 === "JP")?.release_dates || [];
        const jpDate = (jp.find(d => d.type === 3) || jp[0])?.release_date?.slice(0, 10) || "";
        const crew = m.credits?.crew || [];
        const out = {
          id: m.id, title: m.title, original: m.original_title, poster: m.poster_path,
          date: m.release_date || "", jpDate, runtime: m.runtime || 0, tagline: m.tagline || "",
          overview, overviewLang,
          genres: (m.genres || []).map(g => g.name),
          countries: (m.production_countries || []).map(c => c.iso_3166_1),
          directors: crew.filter(c => c.job === "Director").map(c => c.name).slice(0, 3),
          cast: (m.credits?.cast || []).slice(0, 6).map(c => c.name),
        };
        return json(out, { ...cors, "Cache-Control": "public, max-age=86400" });   // 作品情報はめったに変わらないので1日
      } catch (e) {
        return json({ error: String(e.message) }, cors, e.message === "404" ? 404 : 502);
      }
    }

    if (url.pathname !== "/search") return new Response("Not found", { status: 404, headers: cors });

    const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
    if (!q) return json([], cors);

    const api = "https://api.themoviedb.org/3/search/movie?query=" + encodeURIComponent(q) +
      "&language=ja-JP&region=JP&include_adult=false&page=1";
    const r = await fetch(api, {
      headers: { Authorization: "Bearer " + env.TMDB_TOKEN, accept: "application/json" },
      cf: { cacheTtl: 3600, cacheEverything: true }, // 同じ検索語は1時間キャッシュして TMDB への負荷を減らす
    });
    if (!r.ok) return json({ error: r.status }, cors, 502);

    const j = await r.json();
    // 並べ替えはブラウザ側で行う（有名さ＝評価数と人気度も返す）ので、多めの20件まで返す
    // ジャンルが1つも付いておらず評価もほとんどない作品（グラビアなどの映像商品が多い）は外す。
    // ただし公開前後の新作は、まだジャンルや評価が付いていないことがあるので残す（半年前より後の公開日）
    const since = new Date(Date.now() - 183 * 864e5).toISOString().slice(0, 10);
    const out = (j.results || []).filter(m => (m.genre_ids || []).length || (m.vote_count || 0) >= 5 || (m.release_date || "") >= since).slice(0, 20).map(m => ({
      id: m.id, title: m.title, original: m.original_title, date: m.release_date, poster: m.poster_path,
      votes: m.vote_count || 0, pop: Math.round((m.popularity || 0) * 10) / 10,
    }));
    return json(out, { ...cors, "Cache-Control": "public, max-age=3600" });
  },
};

/* 英語のあらすじを日本語に機械翻訳する。
   1. DeepL（訳がいちばん自然。DEEPL_API_KEY は GitHub の Secret から worker.yml が渡す）
   2. 使えないときは Cloudflare Workers AI
   同じ作品で何度も翻訳しないよう、結果は30日間キャッシュに置く。英語の文や翻訳サービスが変わったら作り直す */
async function translate(env, ctx, id, text) {
  if (!text || (!env.DEEPL_API_KEY && !env.AI)) return "";
  const key = new Request(`https://cache.cinemaladder.internal/mt/${id}?h=${hash(text)}&by=${env.DEEPL_API_KEY ? "deepl" : "ai"}`);
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return hit.text();
  let ja = "";
  if (env.DEEPL_API_KEY) {
    try {
      // 無料版のキーは末尾が「:fx」で、送り先が違う
      const host = env.DEEPL_API_KEY.endsWith(":fx") ? "api-free.deepl.com" : "api.deepl.com";
      const r = await fetch(`https://${host}/v2/translate`, {
        method: "POST",
        headers: { Authorization: "DeepL-Auth-Key " + env.DEEPL_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ text: [text], source_lang: "EN", target_lang: "JA" }),
      });
      if (r.ok) ja = ((await r.json())?.translations?.[0]?.text || "").trim();
    } catch (e) {}
  }
  if (!looksJapanese(ja, text) && env.AI) try {   // 2. Workers AI：文章として自然に訳せる言語モデル
    const r = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        { role: "system", content: "You translate English movie synopses into natural Japanese for a Japanese movie website. Output only the Japanese translation, with no notes. Write character names in katakana. Do not add anything that is not in the original." },
        { role: "user", content: text },
      ],
      max_tokens: 1024,
    });
    ja = (r?.response || "").trim();
  } catch (e) {}
  if (!looksJapanese(ja, text) && env.AI) {   // 3. それもだめなら翻訳専用のモデル
    ja = "";
    try {
      const r = await env.AI.run("@cf/meta/m2m100-1.2b", { text, source_lang: "english", target_lang: "japanese" });
      ja = (r?.translated_text || "").trim();
    } catch (e) {}
  }
  if (!looksJapanese(ja, text)) return "";
  ctx.waitUntil(cache.put(key, new Response(ja, { headers: { "Cache-Control": "public, max-age=2592000" } })));
  return ja;
}
// 訳文らしいか：かなを含み、元の文と比べて極端に短すぎたり長すぎたりしない
const looksJapanese = (ja, en) => !!ja && /[\u3040-\u30ff]/.test(ja) && ja.length > en.length * 0.15 && ja.length < en.length * 2;
const hash = s => { let h = 0; for (const c of s) h = (h * 31 + c.codePointAt(0)) | 0; return (h >>> 0).toString(36); };

function json(body, headers, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}
