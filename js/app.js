/* ===== 設定 =====
   TMDB のトークンはブラウザに置かない。サジェストは Cloudflare Workers の中継、
   話題作TOP10と予備の作品一覧は GitHub Actions が毎日作る data/*.json を使う。 */
/* ===== アフィリエイト設定 =====
   提携が決まったらここに入れるだけで、リンクの差し替えと「PR」表示が切り替わる。
   空のあいだは普通のリンクで、PR も出さない（広告でないものに PR を付けないため）。
   - amazonTag : Amazon アソシエイトのトラッキングID（例 "cinema-22"）。検索リンクに tag= を付ける
   - unext     : ASP の広告リンク。{url} を入れると遷移先（検索結果）を埋め込む
                 例 A8.net なら "https://px.a8.net/svt/ejp?a8mat=XXXX&a8ejpredirect={url}"
                 {url} がなければ、ASP が決めたページ（無料体験の案内など）へそのまま飛ぶ
   - mvtk      : ムビチケも同じ書き方（提携先が見つかったとき用） */
const AFF = {
  amazonTag: "",
  unext: "",
  mvtk: "",
};
const affWrap = (tpl, url) =>
  !tpl ? url : tpl.includes("{url}") ? tpl.replace("{url}", encodeURIComponent(url)) : tpl;
const TMDB_PROXY = "https://cinemaladder-api.twilightwind.workers.dev/search"; // Cloudflare Workers の中継（worker/worker.js）
const SITE = "https://cinemaladder.com/"; // 本番の住所
const IMG = "https://image.tmdb.org/t/p/w92";

const E = encodeURIComponent;
/* Instagram の公式ハッシュタグの対応表（TMDB の作品番号：タグ。# は付けない）。
   中身は data/insta-tags.json に置き、npm run build のときにここへ埋め込む（__INSTA_TAGS__ が表の JSON 文字列に置き換わる）。
   表にない作品は、作品名から記号を除いたタグを使う */
const INSTA_TAGS = JSON.parse(__INSTA_TAGS__);
const GROUPS = [
  {
    h: "レビュー",
    note: "星とレビューを見る",
    items: [
      {
        n: "Filmarks",
        ic: "filmarks",
        d: "評価・感想",
        u: (q) => "https://filmarks.com/search/movies?q=" + E(q),
      },
      {
        n: "映画.com",
        ic: "eiga",
        d: "評価・作品情報",
        u: (q) => "https://eiga.com/search/" + E(q) + "/",
      },
      {
        n: "Movie Walker",
        ic: "moviewalker",
        d: "評価・ニュース",
        u: (q) => "https://press.moviewalker.jp/search/free_search.cgi?keyword=" + E(q),
      },
      {
        n: "映画ランド",
        ic: "eigaland",
        d: "評価・上映情報",
        u: (q) => "https://eigaland.com/movie?sort=openDate&q=" + E(q),
      },
      {
        n: "KINENOTE",
        ic: "kinenote",
        d: "評価・鑑賞記録",
        u: (q) => "https://www.kinenote.com/sp/public/cinema/search_result.aspx?key=" + E(q),
      },
      // IMDb は日本語タイトルだと見つからないことが多いので、TMDB の原題が分かればそちらで検索する。s=tt&ttype=ft は「映画作品だけ」に絞る指定
      {
        n: "IMDb",
        ic: "imdb",
        d: "海外の評価",
        u: (q, m) => "https://www.imdb.com/find/?q=" + E(m?.original || q) + "&s=tt&ttype=ft",
      },
      // p=検索語、ei=文字コード。ほかのパラメータ（ai, ts, aq, fr など）は Yahoo の計測用なので不要
      {
        n: "Yahoo!検索",
        ic: "yahoo",
        d: "評価・口コミ・記事",
        u: (q) => "https://search.yahoo.co.jp/search?p=" + E(q + " レビュー") + "&ei=UTF-8",
      }, // 「作品名 レビュー」で、各サイトの評価がまとめて出る
      // Google ニュースで記事を探す。ニュースでないページを、題名に必ず入る言葉で除く（"" で囲むと、その言葉のかたまりで除外できる）
      // ・映画.com の利用者レビュー：「〇〇さんの映画レビュー（感想・評価）」
      // ・映画館ごとの上映時間のページ：「〇〇の上映時間・上映スケジュール」（MOVIE WALKER PRESS など）
      // ・作品の基本情報のまとめページ：「〇〇キャスト・登場人物・出演者一覧／あらすじ・公開日」（オリコンなど）
      {
        n: "Googleニュース",
        ic: "google",
        d: "ニュース記事",
        u: (q) =>
          "https://news.google.com/search?q=" +
          E(q + ' -"（感想・評価）" -"上映スケジュール" -"／あらすじ・公開日"') +
          "&hl=ja&gl=JP&ceid=JP:ja",
      },
    ],
  },
  {
    h: "チケット・上映館",
    note: "",
    items: [
      {
        n: "ムビチケ",
        ic: "mvtk",
        d: "前売券を買う",
        pr: () => !!AFF.mvtk,
        u: (q) => affWrap(AFF.mvtk, "https://store.moviewalker.jp/search?keyword=name:" + E(q)),
      },
      // 「上映スケジュール」を付けて検索すると、Yahoo!検索が上映館と上映時間の欄を最初から出す
      {
        n: "上映館を探す",
        ic: "yahoo",
        d: "上映スケジュール",
        u: (q) => "https://search.yahoo.co.jp/search?p=" + E(q + " 上映スケジュール") + "&ei=UTF-8",
      },
    ],
  },
  {
    h: "SNSの声",
    note: "",
    items: [
      // ハッシュタグには記号が使えないので、文字と数字だけにする。公式タグなどが分かっている作品は INSTA_TAGS の表を使う
      {
        n: "Instagram",
        ic: "instagram",
        d: "ハッシュタグ",
        u: (q, m) =>
          "https://www.instagram.com/explore/tags/" +
          E(INSTA_TAGS[m?.id] || q.replace(/[^\p{L}\p{N}_]/gu, "")) +
          "/",
      },
      // ハッシュタグのページは、そのタグが使われたことがないと 404 になるので、記事の検索を使う
      {
        n: "note",
        ic: "note",
        d: "作品名で記事を検索",
        u: (q) => "https://note.com/search?q=" + E(q) + "&context=note&mode=search",
      },
      {
        n: "X",
        ic: "x",
        d: "ネタバレ語を除外",
        u: (q) => "https://x.com/search?f=live&q=" + E(`"${q}" ` + ngQuery()),
      },
      // はてなパークスの「映画」パーク（park:1508347822422888448）の中だけを検索する
      {
        n: "はてなパークス",
        ic: "hatenaparks",
        d: "映画パークのコメント",
        u: (q) =>
          "https://p.hatena.ne.jp/search?q=" + E("park:1508347822422888448 " + q) + "&tab=replies",
      },
    ],
  },
  {
    h: "配信",
    note: "",
    items: [
      {
        n: "U-NEXT",
        ic: "unext",
        d: "見放題・レンタル",
        pr: () => !!AFF.unext,
        u: (q) => affWrap(AFF.unext, "https://video.unext.jp/freeword?query=" + E(q)),
      },
      {
        n: "Prime Video",
        ic: "primevideo",
        d: "見放題・レンタル",
        pr: () => !!AFF.amazonTag,
        u: (q) =>
          "https://www.amazon.co.jp/s?i=instant-video&k=" +
          E(q) +
          (AFF.amazonTag ? "&tag=" + E(AFF.amazonTag) : ""),
      },
      {
        n: "Netflix",
        ic: "netflix",
        d: "見放題",
        u: (q) => "https://www.netflix.com/search?q=" + E(q),
      },
      // 作品ページの「配信サービス」から各社の配信状況をまとめて見られる。作品ページは ID が要るので検索結果へ飛ぶ
      {
        n: "Filmarks",
        ic: "filmarks",
        d: "配信サービス一覧",
        u: (q) => "https://filmarks.com/search/movies?q=" + E(q),
      },
    ],
  },
];

const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
/* 部首の文字を普通の漢字に直す。TMDB の作品名には、PDF からの貼り付けなどで「⼆」（康煕部首）や「⻯」（CJK部首補助）の
   ような見た目がそっくりな別の文字が混ざっていることがあり、そのままだと各サイトの検索で見つからない（例：「RYUJI ⻯⼆」）。
   康煕部首は NFKC で直る。CJK部首補助は NFKC では直らないので、日本語でよく使うものだけ表で直す */
const RAD = {
  "⻁": "虎",
  "⻄": "西",
  "⻆": "角",
  "⻑": "長",
  "⻘": "青",
  "⻝": "食",
  "⻣": "骨",
  "⻤": "鬼",
  "⻨": "麦",
  "⻩": "黄",
  "⻫": "斉",
  "⻭": "歯",
  "⻯": "竜",
  "⻲": "亀",
};
const fixRad = (s) =>
  s
    .replace(/[\u2F00-\u2FD5]/g, (c) => c.normalize("NFKC"))
    .replace(/[\u2E80-\u2EFF]/g, (c) => RAD[c] || c.normalize("NFKC"));
// 空白だけ整える（全角の「／」などを半角に変えると、TMDB の作品名と一致しなくなるため NFKC はかけない）
// 部首の文字もここで普通の漢字に直す（入力・URL・作品名のどこから来ても、表示と共有の題名をそろえる）
const clean = (s) =>
  fixRad(s)
    .replace(/[\s\u3000]+/g, " ")
    .trim();
// TMDB から届いた作品の題名を整える（見出し・タブの題名・共有・履歴に部首の文字が出ないように）
const fixT = (m) =>
  m && m.title && /[\u2E80-\u2FDF]/.test(m.title) ? { ...m, title: fixRad(m.title) } : m;
// 本番以外（staging・手元）だけ、公開日順を好きな日付として表示できる。?today=2026-11-08 か右下の日付で指定（タブを閉じると戻る）
const IS_DEV = !/^(www\.)?cinemaladder\.com$/.test(location.hostname);
let fakeDay = null;
if (IS_DEV) {
  try {
    fakeDay =
      new URLSearchParams(location.search).get("today") || sessionStorage.getItem("cl_fakeDay");
  } catch {}
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fakeDay || "")) fakeDay = null;
}
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? d : JSON.parse(v);
    } catch (e) {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {}
  },
};
let hist = store.get("cl_hist", []).map(fixRad); // 以前の履歴に残っている部首の文字も直す
/* 検索欄：作品を表示したら、いつも空にする（作品名は見出しと履歴に出ているので、ここでは繰り返さない）。
   欄は「次の作品を探すための空欄」として使う */
const PH = "作品名を入力";
function setQ() {
  const q = $("#q");
  q.value = "";
  q.placeholder = PH;
  keepQ = null;
}
/* ただし、TMDB の作品に一致しなかった検索（打ち間違いなど）は、直しやすいよう入力した文字を残す。
   keepQ：一致するか分かるまで様子を見ている検索語。一致したら欄を空に、しなかったら文字を残す */
let keepQ = null;
function settleQ(q, found) {
  if (keepQ !== q) return;
  const box = $("#q");
  keepQ = null;
  if (found) {
    if (box.value === q) box.value = "";
  } // 一致した：空にする（その間に打ち直していたら触らない）
  else if (!box.value && document.activeElement !== box) box.value = q; // 一致しなかった：文字を残す
}
/* 履歴の作品ごとの TMDB 情報（ポスター・原題・公開日）。履歴から開いたときに使う */
let meta = Object.fromEntries(
  Object.entries(store.get("cl_meta", {})).map(([k, v]) => [fixRad(k), fixT(v)]),
); // 部首の文字を直した名前で引けるように
function saveMeta(q, m) {
  if (!m || !q) return;
  meta[q] = { id: m.id, title: m.title, original: m.original, date: m.date, poster: m.poster };
  for (const k of Object.keys(meta)) if (!hist.includes(k) && k !== q) delete meta[k]; // 履歴から消えた分は捨てる
  store.set("cl_meta", meta);
}
/* X検索で除外する語。増やすほど安全ですが、普通の感想も減ります。 */
const DEFAULT_NG = [
  "ネタバレ",
  "結末",
  "犯人",
  "ラスト",
  "最後",
  "オチ",
  "真相",
  "正体",
  "黒幕",
  "伏線回収",
  "考察",
  "どんでん返し",
  "世界線",
  "死亡",
  "タヒ",
  "生存",
];
// 利用者が編集した除外語（この端末にだけ保存）。未編集なら初期の語を使う
let ngWords = (() => {
  const v = store.get("cl_ng", null);
  if (!Array.isArray(v)) return DEFAULT_NG.slice();
  // 自分で編集した一覧を持っている人にも、あとから初期設定に加えた言葉だけは足す（自分で消した言葉は戻さない）
  const known = store.get("cl_ngdef", null) || [
    "ネタバレ",
    "結末",
    "犯人",
    "ラスト",
    "オチ",
    "真相",
    "正体",
    "黒幕",
    "伏線回収",
    "考察",
    "どんでん返し",
    "死亡",
    "生存",
  ];
  const add = DEFAULT_NG.filter((w) => !known.includes(w) && !v.includes(w));
  if (add.length) {
    v.push(...add);
    store.set("cl_ng", v);
  }
  return v;
})();
store.set("cl_ngdef", DEFAULT_NG);
const saveNg = () => store.set("cl_ng", ngWords);
// X の検索式：空白や記号を含む語は "" で囲む
const ngQuery = () =>
  ngWords.map((w) => (/[\s"()]/.test(w) ? `-"${w.replace(/"/g, "")}"` : "-" + w)).join(" ");

/* ===== TMDB サジェスト ===== */
const cache = new Map();
let ctrl = null,
  timer = null,
  items = [],
  active = -1;

/* 作品名一覧（data/titles.json）から候補を出す。トークン不要で誰でも使える。
   GitHub Actions が毎日、人気作・評価の多い作品・上映中・公開予定の数千本を書き出している。 */
let titles = null,
  titlesLoading = null;
// 表記ゆれ対策：全角半角・カタカナひらがな・記号や空白の違いを無視して比べる
const norm = (s) =>
  fixRad(s || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s・･:：\-‐－ー〜~!！?？、。,.「」『』（）()\/／&＆'"]/g, "");
function loadTitles() {
  if (titles) return Promise.resolve(titles);
  return (titlesLoading ??= fetch("data/titles.json")
    .then((r) => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    })
    .then((j) => {
      titles = j.items.map(
        ([id, title, date, poster, original, votes, pop]) => (
          (title = fixRad(title)),
          {
            id,
            title,
            date,
            poster,
            original: original || title,
            votes: votes || 0,
            pop: pop || 0,
            k: norm(title),
            ko: original ? norm(original) : "",
          }
        ),
      );
      return titles;
    })
    .catch((e) => {
      titlesLoading = null;
      throw e;
    }));
}
async function searchLocal(q) {
  const list = await loadTitles(),
    k = norm(q);
  if (!k) return [];
  const hits = []; // 前方一致・部分一致をまとめて拾い、並べ替えは searchTMDB でまとめて行う
  for (const m of list) {
    if (m.k.includes(k) || m.ko.includes(k)) hits.push(m);
  }
  return hits;
}

/* 入力中の候補：TMDB の検索（書いた文字の通りに探す）と、作品一覧からの検索（「・」「ー」や全角半角、
   ひらがな・カタカナの違いを無視して探す）を同時に行い、合わせて並べる。
   「スターウォーズ」でも「スター・ウォーズ／フォースの覚醒」などが出るようにするため */
// 入力 q と作品 m の一致の強さ：0＝完全一致、1＝先頭が一致、2＝途中に含む、3＝その他（記号・表記の違いは無視）
function rankOf(q, m) {
  const k = norm(q),
    t = norm(m.title),
    o = m.original ? norm(m.original) : "";
  return t === k || o === k
    ? 0
    : t.startsWith(k) || o.startsWith(k)
      ? 1
      : t.includes(k) || o.includes(k)
        ? 2
        : 3;
}
async function searchTMDB(q) {
  if (cache.has(q)) return cache.get(q);
  ctrl?.abort();
  ctrl = new AbortController();
  const sig = ctrl.signal;
  const remote = fetch(TMDB_PROXY + "?q=" + E(q), { signal: sig })
    .then((r) => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    })
    .then((j) => (Array.isArray(j) ? j.map(fixT) : []))
    .catch((e) => {
      if (e.name === "AbortError") throw e;
      return [];
    }); // 中継が使えなくても作品一覧の候補は出す
  const local = searchLocal(q).catch(() => []);
  const [r, l] = await Promise.all([remote, local]);
  // 並べ方：入力と完全一致した作品をいちばん上に。それ以外は「有名な順」（評価数と人気度）。
  // 先頭が一致する作品は少しだけ上げ、文字が含まれない作品（原題での一致など）は少し下げる
  const byId = new Map();
  for (const m of [...r, ...l]) {
    const o = byId.get(m.id);
    if (!o) byId.set(m.id, m);
    else if (!o.votes && m.votes)
      byId.set(m.id, { ...o, votes: m.votes, pop: m.pop, date: o.date || m.date });
  }
  // 公開から3か月以内か、1か月以内に公開予定の作品（いま映画館で観られる・もうすぐ観られる作品）は少し上げる
  const now = Date.now(),
    D = 864e5;
  const fresh = (m) => {
    const t = /^\d{4}-\d{2}-\d{2}/.test(m.date || "") ? Date.parse(m.date) : NaN;
    return t >= now - 90 * D && t <= now + 30 * D;
  };
  const score = (m) => {
    const rk = rankOf(q, m);
    return (
      Math.log10((m.votes || 0) + 1) +
      Math.log10((m.pop || 0) + 1) +
      (rk === 0 ? 99 : rk === 1 ? 0.5 : rk === 3 ? -1 : 0) +
      (fresh(m) ? 1 : 0)
    );
  };
  // TMDB の検索はあいまいで、入力した文字を含まない作品（グラビアなどの映像作品を含む）も返してくる。
  // 作品名・原題に入力が含まれない候補は、評価数が20件以上ある有名な作品（英語の題名で探した邦画など）だけ残す
  const keep = (m) => rankOf(q, m) < 3 || (m.votes || 0) >= 20;
  const res = [...byId.values()]
    .filter(keep)
    .map((m, i) => [score(m), i, m])
    .sort((a, b) => b[0] - a[0] || a[1] - b[1])
    .map((x) => x[2])
    .slice(0, 8);
  cache.set(q, res);
  return res;
}
/* ===== 話題作TOP10（日本で上映中＋公開予定を人気順に） ===== */
let trendList = null;
async function getTrending() {
  if (trendList) return trendList;
  // 1. GitHub Actions が毎日作る data/trending.json（トークン不要・誰でも見られる）
  try {
    const r = await fetch("data/trending.json"); // 先読み（preload）したものをそのまま使う
    if (r.ok) {
      const j = await r.json();
      if (j.items?.length) {
        // 詳しい情報が入っていれば先に置いておき、公開日などの行を待たずに出す（画面のずれを防ぐ）
        // 英語のあらすじしかない作品は、中継サーバーで日本語に機械翻訳したものを使うため、ここでは置かない
        for (const m of j.items)
          if (m.info?.overviewLang === "ja" && !infoCache.has(m.id))
            infoCache.set(m.id, Promise.resolve(m.info));
        trendList = j.items.map(fixT);
        return trendList;
      }
    }
  } catch (e) {}
  // 2. ファイルが読めないときは中継サーバーから
  const r = await fetch(TMDB_PROXY.replace(/search$/, "trending"));
  if (!r.ok) throw new Error(r.status);
  trendList = (await r.json()).map(fixT);
  return trendList;
}
let lastPick = null;
async function showTrending() {
  const before = $("#q").value;
  try {
    const list = await getTrending();
    if ($("#q").value !== before) return; // 読み込み中に入力されたら上書きしない
    if (list.length) {
      const pool = list.length > 1 ? list.filter((m) => m.id !== lastPick) : list; // 同じ作品が連続しないように
      const m = pool[Math.floor(Math.random() * pool.length)];
      lastPick = m.id;
      setQ();
      nextRing = "top";
      render(m.title, "trend", m);
      return;
    }
  } catch (e) {}
  if ($("#q").value === before) {
    setQ();
    renderEmpty();
  }
}
let trendOpen = store.get("cl_trendOpen", false);
let topTab = store.get("cl_topTab", "top"); // 「いま話題の映画」の中のタブ：top＝人気TOP10、rel＝公開日順
/* 公開日の前後2週間の作品（data/releases.json。GitHub Actions が毎日作る）。公開日順のタブを開いたときに読む */
let relData = null,
  relLoading = null,
  relFailed = false;
function getReleases() {
  if (relData) return Promise.resolve(relData);
  return (relLoading ??= fetch("data/releases.json")
    .then((r) => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    })
    .then((j) => {
      j.items = (j.items || []).map(fixT);
      relData = j;
      return j;
    })
    .catch((e) => {
      relLoading = null;
      relFailed = true;
      throw e;
    }));
}
const isUpcoming = (d) => d && d > new Date().toISOString().slice(0, 10);
/* TOP10を閉じるアニメーション：高さを0に縮めながら薄くし、終わったら details を閉じる */
function collapseTop() {
  const d = $("#top"),
    ol = d?.querySelector(".tbody");
  if (!d || !d.open) return;
  if (!ol || !ol.animate || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    d.open = false;
    return;
  }
  ol.style.overflow = "hidden";
  const a = ol.animate(
    [
      { height: ol.offsetHeight + "px", opacity: 1, marginTop: "8px" },
      { height: "0px", opacity: 0, marginTop: "0px" },
    ],
    { duration: 320, delay: 120, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" },
  ); // 選んだ行の色が一瞬見えてから閉じる
  a.onfinish = () => {
    d.open = false;
    a.cancel();
    ol.style.overflow = "";
  };
}
/* TOP10 の一覧の出典（TMDB の上映中一覧）。下の data/trending.json は日本で上映中＋公開予定を人気順に並べたもの */
const TOP_SOURCE = "https://www.themoviedb.org/movie/now-playing?language=ja-JP";
let trendFailed = false;
function trendHTML() {
  // 閉じた details の中身は隠れるので、リンクは details の外（外枠の右上）に置く
  const link = `<a class="toplink" href="${TOP_SOURCE}" target="_blank" rel="noopener" aria-label="TMDBの上映中の映画一覧を開く" title="TMDBの上映中の映画一覧"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg></a>`;
  const tab = (id, label) =>
    `<button type="button" role="tab" data-ttab="${id}" aria-selected="${topTab === id}">${label}</button>`;
  const head = `<aside class="topwrap" aria-label="いま話題の映画">${link}<details class="top" id="top"${trendOpen ? " open" : ""}><summary>いま話題の映画</summary><div class="tbody"><div class="ttabs" role="tablist" aria-label="一覧の種類">${tab("top", "人気TOP10")}${tab("rel", "公開日順")}</div>`;
  const tail = `</div></details></aside>`;
  const skel = (n) =>
    `<ol aria-busy="true">${'<li><div class="sk"><span class="rk"></span><span class="noimg"></span><span><i></i><i></i></span></div></li>'.repeat(n)}</ol>`;
  const row = (m, left, note) =>
    `<li><button type="button" data-tid="${m.id}"${cur && cur[0] === m.title ? ' class="on" aria-current="true"' : ""}><span class="rk">${left}</span>${m.poster ? `<img src="${IMG}${esc(m.poster)}" alt="" loading="lazy" width="32" height="48">` : '<span class="noimg"></span>'}<span style="min-width:0"><span class="tt">${esc(m.title)}</span><small>${note}</small></span></button></li>`;
  const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
  if (topTab === "rel") {
    // 公開日順：金曜〜翌木曜を1週として、週ごとに見出しを付ける（日本の新作はたいてい金曜公開）。
    // 見出しはどの週も「m/d〜 公開」。「今週末」「公開中」は、曜日の感じ方や上映終了の作品があって紛らわしいので使わない。
    // 今日を含む週（直前の金曜から）の見出しだけ色を付ける
    if (!relData)
      return (
        head +
        (relFailed
          ? '<ol><li class="msg">読み込めませんでした。時間をおいて開き直してください。</li></ol>'
          : skel(6)) +
        tail
      );
    const D = 864e5,
      now = fakeDay ? new Date(fakeDay + "T12:00") : new Date(),
      today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
      dw = now.getDay();
    const thisWk = today - ((dw - 5 + 7) % 7) * D,
      weekend = dw >= 5 ? thisWk : thisWk + 7 * D; // weekend：その日の朝の更新が作る範囲の計算に使う
    const wkOf = (d) => {
      const t = Date.parse(d),
        dow = new Date(t).getUTCDay();
      return t - ((dow - 5 + 7) % 7) * D;
    };
    // 週ごとに <li> でまとめる。見出しはその週の中でだけ上に留まるので、次の週の見出しが来ると押し出される（重ならない）
    let last = null,
      h = "";
    // 日付を模擬しているときは、その日に毎朝の更新が作る範囲（fetch-releases.mjs と同じ計算）に絞る
    const fr = today - ((dw - 5 + 7) % 7) * D - 14 * D,
      to = weekend + 20 * D,
      ymd = (t) => new Date(t).toISOString().slice(0, 10);
    for (const m of fakeDay
      ? relData.items.filter((m) => m.date >= ymd(fr) && m.date <= ymd(to))
      : relData.items) {
      const w = wkOf(m.date);
      if (w !== last) {
        h += last === null ? "" : "</ol></li>";
        last = w;
        const r = Math.round((w - thisWk) / (7 * D));
        h += `<li class="wkg"><div class="wk${r === 0 ? " cur" : r === -1 ? " prev" : ""}">${md(new Date(w).toISOString())}〜<span>公開</span></div><ol>`;
      }
      h += `<li><button type="button" data-tid="${m.id}"${cur && cur[0] === m.title ? ' class="on" aria-current="true"' : ""}>${m.poster ? `<img src="${IMG}${esc(m.poster)}" alt="" loading="lazy" width="24" height="36">` : '<span class="noimg"></span>'}<span class="tt">${esc(m.title)}</span></button></li>`;
    }
    if (h) h += "</ol></li>";
    return (
      head + `<div class="relbox"><ol class="rel">${h || '<li class="msg">該当する作品がありません。</li>'}</ol></div>` + tail
    );
  }
  // 読み込み前も同じ高さの仮の行を出しておき、届いたときに下の内容がずれないようにする
  if (!trendList?.length)
    return (
      head +
      (trendFailed
        ? '<ol><li class="msg">読み込めませんでした。時間をおいて開き直してください。</li></ol>'
        : skel(10)) +
      tail
    );
  return (
    head +
    `<ol>${trendList.map((m, i) => row(m, i + 1, isUpcoming(m.date) ? `公開予定${+m.date.slice(5, 7)}月${+m.date.slice(8, 10)}日` : "上映中")).join("")}</ol>` +
    tail
  );
}

function showSug(html) {
  const s = $("#sug");
  s.innerHTML = html;
  s.hidden = !html;
  $("#q").setAttribute("aria-expanded", String(!!html));
  if (html) fitSug();
}
// 候補の一覧の高さ：画面に見えている範囲（スマホではキーボードを除いた部分）の下端までに収める
function fitSug() {
  const s = $("#sug");
  if (s.hidden) return;
  const vv = window.visualViewport,
    bottom = vv ? vv.offsetTop + vv.height : innerHeight;
  const top = s.getBoundingClientRect().top;
  s.style.setProperty("--sugmax", Math.max(140, Math.floor(bottom - top - 12)) + "px");
}
window.visualViewport?.addEventListener("resize", fitSug);
function hideSug() {
  showSug("");
  items = [];
  active = -1;
}
function drawSug() {
  showSug(
    items
      .map(
        (m, i) => `<li role="option" id="opt${i}" data-i="${i}" aria-selected="${i === active}">
    ${m.poster ? `<img src="${IMG}${esc(m.poster)}" alt="" loading="lazy" width="36" height="54">` : '<span class="noimg"></span>'}
    <span style="min-width:0"><span class="t">${esc(m.title)}</span><span class="o">${m.date ? m.date.slice(0, 4) + "年" : "公開年不明"}${m.original && m.original !== m.title ? "・" + esc(m.original) : ""}</span></span></li>`,
      )
      .join(""),
  );
  $("#q").setAttribute("aria-activedescendant", active >= 0 ? "opt" + active : "");
}
function onType() {
  const q = clean($("#q").value);
  clearTimeout(timer);
  if (q.length < 1) {
    hideSug();
    return;
  }
  timer = setTimeout(async () => {
    try {
      const r = await searchTMDB(q);
      if (clean($("#q").value) !== q) return;
      items = r;
      active = -1;
      r.length
        ? drawSug()
        : showSug('<li class="msg">候補にありません。Enterでそのまま検索できます。</li>');
    } catch (e) {
      if (e.name === "AbortError") return;
      items = [];
      showSug('<li class="msg">候補を取得できませんでした。そのまま検索できます。</li>');
    }
  }, 250);
}
function pick(m) {
  setQ();
  hideSug();
  remember(m.title);
  saveMeta(m.title, m);
  render(m.title, false, m);
  collapseTop();
  $("#q").blur();
}

/* ===== 画面 ===== */
function remember(q) {
  hist = [q, ...hist.filter((x) => x !== q)].slice(0, 8);
  store.set("cl_hist", hist);
  renderHist();
}
function renderHist() {
  $("#hist").hidden = !hist.length;
  $("#hist").innerHTML = hist.length
    ? '<p class="lbl" id="hist-lbl">最近</p><ul class="hl">' +
      hist
        .map(
          (h) =>
            `<li class="hc${cur && cur[0] === h ? " on" : ""}"${cur && cur[0] === h ? ' aria-current="true"' : ""}><button type="button" data-q="${esc(h)}">${esc(h)}</button><button type="button" class="x" data-del="${esc(h)}" aria-label="「${esc(h)}」を履歴から削除">×</button></li>`,
        )
        .join("") +
      '</ul><button type="button" class="delall" id="delall" aria-label="履歴をすべて削除" title="履歴をすべて削除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg><span class="dl" aria-hidden="true">全削除</span></button>'
    : "";
}
function saveHist() {
  store.set("cl_hist", hist);
  renderHist();
}
let delTimer = null;
let cur = null;
const TOP_TITLE = "Cinemaladder - 映画の評判を、はしごする"; // トップの URL のときのタブの題名
function renderEmpty() {
  cur = null;
  document.title = TOP_TITLE;
  setMeta("", false);
  $("#out").classList.remove("boot");
  $("#out").innerHTML =
    '<section class="emptyst"><h1>観たい映画の名前を入れてください</h1><p>レビューサイト、チケット、SNS、配信サービスの検索結果へ移動できます。</p></section>';
}
/* 作品名から TMDB の情報を、手元にない場合に取りに行く。
   1. 作品一覧（data/titles.json） 2. 中継サーバーで検索し、タイトルが完全に一致したもの */
async function lookupMovie(q) {
  try {
    await loadTitles();
    const m = findMovie(q);
    if (m) return m;
  } catch (e) {}
  try {
    const r = await fetch(TMDB_PROXY + "?q=" + E(q));
    if (r.ok) {
      const list = (await r.json()).map?.(fixT);
      if (Array.isArray(list)) {
        cache.set(q, list);
        return (
          list.find((m) => m.title === q) || list.find((m) => norm(m.title) === norm(q)) || null
        );
      }
    }
  } catch (e) {}
  return null;
}
/* 作品名を、区切りの記号（・／ 空白 ： 〜 など）の後ろでだけ改行できるまとまりに分けて <span class="w"> で包む。
   「ディスクロージャー・デイ」が「ディスクロー／ジャー・デイ」のように語の途中で切れるのを防ぐ。
   まとまり自体が1行に入らないときは中で折り返す（Chrome は word-break:auto-phrase で文節ごとに折り返す） */
function wrapWords(t) {
  const parts = t.split(/(?<=[・･／/\s：:〜~！!？?、。）)」』】])|(?=[（(「『【])/).filter(Boolean); // ハイフンは「ゴジラ-0.0」のように名前の一部なので区切らない
  return parts.map((w) => `<span class="w">${esc(w)}</span>`).join("");
}
/* ===== 作品情報（あらすじ・公開日・上映時間・ジャンル・監督・出演・製作国） ===== */
const infoCache = new Map();
let infoOpen = store.get("cl_infoOpen", false);
function loadInfo(id) {
  if (!id) return Promise.resolve(null);
  if (!infoCache.has(id))
    infoCache.set(
      id,
      fetch(TMDB_PROXY.replace(/search$/, "movie") + "?id=" + E(id))
        .then((r) => {
          if (!r.ok) throw new Error(r.status);
          return r.json();
        })
        .then(fixT)
        .catch((e) => {
          infoCache.delete(id);
          throw e;
        }),
    );
  return infoCache.get(id);
}
const regionJa =
  typeof Intl !== "undefined" && Intl.DisplayNames
    ? new Intl.DisplayNames(["ja"], { type: "region" })
    : null;
const ymd = (d) => (d ? `${+d.slice(0, 4)}年${+d.slice(5, 7)}月${+d.slice(8, 10)}日` : "");
// 見出しの中に出す1行：公開日・上映時間・ジャンル（ネタバレにならないので常に表示）
const GENRE_SHORT = {
  サイエンスフィクション: "SF",
  アニメーション: "アニメ",
  ドキュメンタリー: "ドキュメンタリー",
  履歴: "歴史", // TMDB の誤訳。中継（worker）は番号から直すようにしたが、1日分のキャッシュが残るあいだの保険
}; // 長いジャンル名を短く（1行に収めるため）
function metaText(d) {
  const date = d.jpDate || d.date;
  const items = [
    date ? ymd(date) + "公開" : "",
    d.runtime ? `${d.runtime}分` : "",
    ...d.genres.slice(0, 2).map((g) => GENRE_SHORT[g] || g),
  ].filter(Boolean); // ジャンルは2つまで
  return items
    .map((x, i) => esc(x) + (i < items.length - 1 ? (i >= 2 ? "／" : "・") : ""))
    .join("");
}
function infoHTML(st, d) {
  let body;
  if (st === "ok") {
    const rows = [
      ["監督", d.directors.join("、")],
      ["出演", d.cast.join("、")],
      ["製作国", d.countries.map((c) => regionJa?.of(c) || c).join("・")],
    ].filter((r) => r[1]);
    body = `${d.tagline ? `<p class="tag">${esc(d.tagline)}</p>` : ""}${d.overview ? `<p class="ov">${esc(d.overview)}</p>${d.overviewLang === "en" ? '<p class="lang">日本語のあらすじが未登録のため、英語のあらすじを表示しています。</p>' : d.overviewLang === "mt" ? '<p class="lang">日本語のあらすじが未登録のため、英語のあらすじを機械翻訳して表示しています。</p>' : ""}` : '<p class="lang">あらすじは未登録です。</p>'}<dl class="cr">${rows.map((r) => `<dt>${r[0]}</dt><dd>${esc(r[1])}</dd>`).join("")}<dt class="src">情報</dt><dd class="src"><a href="https://www.themoviedb.org/movie/${E(d.id)}?language=ja-JP" target="_blank" rel="noopener">TMDB</a></dd></dl>`;
  } else
    body = `<p class="lang${st === "loading" ? " ld" : ""}">${st === "none" ? "この作品の情報は見つかりませんでした。" : st === "err" ? "作品情報を読み込めませんでした。時間をおいて開き直してください。" : "読み込み中…"}</p>`;
  return `<section class="info" id="info" aria-label="あらすじ・キャスト"${infoOpen ? "" : " hidden"}><div class="body">${body}</div></section>`;
}
function setInfo(st, d) {
  const el = $("#info");
  if (!el) return;
  if (st === "none") {
    el.hidden = true;
    const b = $("#itg");
    if (b) b.hidden = true;
    const m = $("#imeta");
    if (m) m.innerHTML = "";
    return;
  } // 一致する作品がないときは、中身のない開閉を出さない
  const t = document.createElement("div");
  t.innerHTML = infoHTML(st, d);
  const n = t.firstElementChild;
  n.hidden = !infoOpen;
  el.replaceWith(n);
  // 詳しい情報が届いたら「公開日・上映時間・ジャンル」に差し替える。届かなければ公開年だけを残す
  const m = $("#imeta");
  if (m) {
    if (st === "ok") m.innerHTML = `<span class="in">${metaText(d)}</span>`;
    else if (st !== "loading") {
      const y = cur?.[2]?.date?.slice(0, 4);
      m.innerHTML = y ? `<span class="in">${y}年</span>` : "";
    } // 取れなかったときは分かる範囲（公開年）だけ
    m.classList.toggle("more", m.scrollWidth > m.clientWidth + 1); // 続きがあるときだけ右端を薄くする
  }
  if (st === "ok") setLD(d);
}
// 表示中の作品の情報を取りに行き、届いたら作品情報の欄だけ差し替える
function fetchInfoFor(q, m) {
  if (!m?.id) return;
  loadInfo(m.id)
    .then((d) => {
      if (cur && cur[0] === q) setInfo("ok", d);
    })
    .catch(() => {
      if (cur && cur[0] === q) setInfo("err");
    });
}
/* 検索エンジン向けの作品データ（schema.org の Movie） */
function setLD(d) {
  let el = document.getElementById("ld");
  if (!d) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("script");
    el.type = "application/ld+json";
    el.id = "ld";
    document.head.append(el);
  }
  const o = {
    "@context": "https://schema.org",
    "@type": "Movie",
    name: d.title,
    url: new URL("?q=" + E(d.title), SITE).href,
  };
  if (d.original && d.original !== d.title) o.alternateName = d.original;
  if (d.jpDate || d.date) o.datePublished = d.jpDate || d.date;
  if (d.overview && d.overviewLang === "ja") o.description = d.overview;
  if (d.poster) o.image = "https://image.tmdb.org/t/p/w500" + d.poster;
  if (d.runtime) o.duration = "PT" + d.runtime + "M";
  if (d.genres.length) o.genre = d.genres;
  if (d.directors.length) o.director = d.directors.map((n) => ({ "@type": "Person", name: n }));
  if (d.cast.length) o.actor = d.cast.map((n) => ({ "@type": "Person", name: n }));
  if (d.countries.length)
    o.countryOfOrigin = d.countries.map((c) => ({ "@type": "Country", name: c }));
  el.textContent = JSON.stringify(o);
}
let picked = null; // Enter で候補から自動で選んだとき：{q:打った文字, id:選んだ作品}
function pickedHTML(movie) {
  if (!picked || !movie || picked.id !== movie.id) return "";
  return `<p class="picked" id="picked"><span>「${esc(picked.q)}」の候補から選びました</span><button type="button" id="rawq" aria-label="入力どおりに検索し直す" title="入力どおりに検索">戻す</button></p>`;
}
/* ===== 話題作・公開日順をめぐる =====
   話題作（ランダム表示か人気TOP10から選んだとき）は TOP10 の中を、公開日順から選んだときは公開日順の中を、
   見出しの左右スワイプ（PC は ‹ › ボタンや ← → キー）で前後にめぐる。端まで行くと反対の端に戻る。
   自分で検索した作品・履歴から開いた作品では使わない。めくった作品は「最近」に入れず、ブラウザの戻る履歴も増やさない */
let ring = null, // いまめぐっている一覧："top"＝人気TOP10、"rel"＝公開日順、null＝使わない
  nextRing = null, // 次の render でめぐる一覧（render のたびに ring に移して空にする。何も入れなければ ring は null になる）
  swipeDir = 0; // めくった向き（1＝次、-1＝前）。見出しを横から出すのに使う
const ringList = () => (ring === "top" ? trendList : ring === "rel" ? relData?.items : null) || [];
function ringPos(movie) {
  const list = ringList();
  const i = movie ? list.findIndex((x) => x.id === movie.id) : -1;
  return i < 0 || list.length < 2 ? null : { i, n: list.length, list };
}
// 表示中の作品が TOP10 か公開日順に入っていれば、どこから来た作品でもめぐれるようにする。
// 両方に入っているときは「いま話題の映画」で最後に選んでいたタブの一覧にする
function autoRing(movie) {
  if (!movie?.id) return null;
  const inTop = !!trendList?.some((x) => x.id === movie.id),
    inRel = !!relData?.items?.some((x) => x.id === movie.id);
  if (inTop && inRel) return topTab === "rel" ? "rel" : "top";
  if (inTop && topTab === "rel" && !relData && !relFailed) return null; // 公開日順を選んでいたなら、その一覧が届くまで決めない
  return inTop ? "top" : inRel ? "rel" : null;
}
// 一覧や作品の情報があとから届いたときに、めぐれるようになったら「‹ › 」を足す（画面全体は描き直さない）
function refreshRing() {
  if (!cur || ring) return;
  ring = autoRing(cur[2]);
  const share = $("#out .now #share");
  if (!ring || !share || $("#out .now .ringnav")) return;
  share.insertAdjacentHTML("beforebegin", ringNavHTML(cur[2]));
  preloadRing();
}
function ringNavHTML(movie) {
  const p = ringPos(movie);
  if (!p) return "";
  return `<span class="ringnav" aria-label="${ring === "top" ? "人気TOP10" : "公開日順"}の中で前後の作品へ"><button type="button" data-ring="-1" aria-label="前の作品">‹</button><span class="pos">${p.i + 1} / ${p.n}</span><button type="button" data-ring="1" aria-label="次の作品">›</button></span>`;
}
function goRing(dir) {
  const p = ringPos(cur?.[2]);
  if (!p) return;
  const m = p.list[(p.i + dir + p.n) % p.n];
  nextRing = ring;
  swipeDir = dir;
  // めくった一覧のタブを「いま話題の映画」でも選んでおく（開いたときに、めくっている一覧と現在の作品が見えるように）
  if (topTab !== ring) {
    topTab = ring;
    store.set("cl_topTab", topTab);
  }
  navMode = "replace"; // めくるたびに戻る履歴を増やさない（URL は表示中の作品に置き換える）
  setQ();
  render(m.title, cur[1] === "trend" ? "trend" : false, m);
}
// 前後の作品のポスターと作品情報を先に読んでおき、めくったときの待ち時間を減らす
function preloadRing() {
  const p = ringPos(cur?.[2]);
  if (!p) return;
  for (const d of [1, -1]) {
    const m = p.list[(p.i + d + p.n) % p.n];
    if (m.poster) new Image().src = IMG + m.poster;
    if (m.id) loadInfo(m.id).catch(() => {});
  }
}
// 引っ張っている間に左右からのぞかせる、前後の作品（ポスターと作品名・公開日）
function peekHTML(m, side) {
  const d = m.date ? ymd(m.date) + "公開" : "";
  return `<div class="peek ${side}" aria-hidden="true"><figure class="ph">${m.poster ? `<img src="${IMG}${esc(m.poster)}" alt="" width="54" height="80" onload="this.classList.add('ok')">` : ""}</figure><div><p class="pt">${esc(m.title)}</p><p class="pm">${d}</p></div></div>`;
}
function nowHTML(q, isExample, movie) {
  return `<header class="now">${isExample === "trend" ? '<p class="k">いま話題の作品から表示中<button type="button" class="kl" id="shuffle">ほかの話題作</button></p>' : ""}<figure class="ph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/></svg>${movie?.poster ? `<img src="${IMG}${esc(movie.poster)}" alt="${esc(q)} のポスター" width="54" height="80" decoding="async" onload="this.classList.add('ok')">` : ""}</figure><div><p class="vh">検索中の作品</p><h1 id="mt">${wrapWords(q)}</h1><p class="ex meta" id="imeta"><span class="sk" aria-label="読み込み中"></span></p><div class="irow"><button type="button" class="itg" id="itg" aria-expanded="${infoOpen}" aria-controls="info">あらすじ・キャスト</button>${ringNavHTML(movie)}<button type="button" class="share" id="share" aria-label="この作品のページのリンクを共有" title="リンクを共有"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg></button></div>${isExample && isExample !== "trend" ? '<p class="ex">例として表示しています。上の欄に観たい作品名を入れてください。</p>' : ""}</div></header>`;
}
/* ===== 作品ごとの URL（?q=作品名&id=TMDBの番号）とページタイトル =====
   クエリ文字列で作品を表す。ブックマーク・共有・戻るボタンに対応。共有のプレビューや検索エンジン向けの題名は、
   functions/index.js がサーバー側で作品名入りに書き換える（ここでは画面を開いたあとのタブの題名を変える）。
   navMode："push"＝利用者が選んだ（履歴を1つ進める）、"replace"＝URL を置き換える、"none"＝URL はそのまま */
let navMode = "none";
const slim = (m) =>
  m ? { id: m.id, title: m.title, original: m.original, date: m.date, poster: m.poster } : null;
function urlFor(q, movie) {
  const u = new URL(location.href);
  u.search = "";
  u.hash = "";
  u.searchParams.set("q", q);
  if (movie?.id) u.searchParams.set("id", movie.id);
  return u.toString();
}
const DESC = document.querySelector('meta[name="description"]').content;
function setMeta(q, isExample) {
  const desc =
    q && !isExample
      ? `「${q}」について、Filmarks、映画.com、Yahoo!など各サイトの検索結果へ移動できます。チケット、SNS、配信サービスの検索結果も開けます。`
      : DESC;
  document.querySelector('meta[name="description"]').content = desc;
  document.querySelector('meta[property="og:description"]').content = desc;
  document.querySelector('meta[property="og:title"]').content = document.title;
  // 作品ページは自分自身を正規URLに、おすすめ表示のトップはトップを正規URLにする
  // 正規URLは常に本番の独自ドメインにする（cinemaladder.pages.dev など別の住所で開かれても、検索エンジンには本番を伝える）
  const canon = new URL(SITE);
  if (q && !isExample) canon.searchParams.set("q", q);
  document.querySelector('link[rel="canonical"]').href = canon.href;
  document.querySelector('meta[property="og:url"]').content = canon.href;
}
function syncNav(q, isExample, movie) {
  const st = { q, isExample, movie: slim(movie) };
  try {
    if (isExample || navMode === "none")
      history.replaceState(st, "", location.href); // おすすめ表示などは URL を変えない
    else if (navMode === "push" && new URL(location.href).searchParams.get("q") !== q)
      history.pushState(st, "", urlFor(q, movie));
    else history.replaceState(st, "", urlFor(q, movie));
  } catch (e) {}
  navMode = "push";
  // タブの題名は URL に合わせる。作品の URL（?q=）のときだけ作品名を出し、トップの URL のまま
  // 話題作や前回の作品を表示しているときはトップの題名にする（ブックマークや共有で題名がばらつかないように）
  let onMovie = false;
  try {
    onMovie = !!new URL(location.href).searchParams.get("q");
  } catch (e) {}
  document.title = q && onMovie ? `${q} - Cinemaladder` : TOP_TITLE;
  setMeta(onMovie ? q : "", isExample); // 説明文・正規URLも URL に合わせる
}
function shareUrl() {
  return cur?.[0] ? urlFor(cur[0], cur[2]) : location.href;
} // 共有ボタンは、いつも表示中の作品のページを渡す
let toastTimer = null;
let toastSwap = null;
function toast(msg) {
  let t = $("#toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.className = "toast";
    t.setAttribute("role", "status");
    document.body.append(t);
    t.getBoundingClientRect();
  } // 置いた直後に一度描画させ、最初の1回もフェードで出す
  clearTimeout(toastTimer);
  clearTimeout(toastSwap);
  const show = () => {
    t.textContent = msg;
    t.classList.add("on");
    toastTimer = setTimeout(() => t.classList.remove("on"), 2600);
  };
  // すでに別のお知らせが出ていたら、いったん消してから入れ替える
  if (t.classList.contains("on") && t.textContent !== msg && !reduceMotion.matches) {
    t.classList.remove("on");
    toastSwap = setTimeout(show, 300);
  } else show();
}
async function share() {
  const url = shareUrl(),
    title = cur?.[0] ? `${cur[0]} - Cinemaladder` : document.title;
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return;
    } catch (e) {
      if (e.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast("リンクをコピーしました");
  } catch (e) {
    prompt?.("このリンクをコピーしてください", url);
  }
}
/* 作品名：区切りでの改行で2行に収まらなければ、区切りの指定を外して普通に折り返す */
function fitTitle() {
  const h = $("#mt");
  if (!h || h.classList.contains("long")) return;
  const lh = parseFloat(getComputedStyle(h).lineHeight) || 30;
  if (h.offsetHeight > lh * 2 + 2) {
    h.textContent = h.textContent;
    h.classList.add("long");
  }
}
/* あとから TMDB の情報が分かったとき、画面全体は描き直さず、見出しとリンクだけ差し替える
   （切り替えアニメーションを途中で止めないため） */
function fillMovie(m) {
  fetchInfoFor(cur[0], m);
  const [q, isExample] = cur;
  cur[2] = m;
  if (hist.includes(q)) saveMeta(q, m);
  if (!ring) ring = autoRing(m); // 作品が分かった時点で、めぐれるか決め直す（このあと見出しを描き直すときに「‹ ›」が入る）
  const now = $("#out .now");
  if (now) {
    const t = document.createElement("div");
    t.innerHTML = nowHTML(q, isExample, m);
    now.replaceWith(t.firstElementChild);
    fitTitle();
  }
  const links = [...document.querySelectorAll("#out a.go")],
    all = GROUPS.flatMap((g) => g.items);
  links.forEach((a, i) => {
    if (all[i]) a.href = all[i].u(fixRad(q), m);
  });
  try {
    const p = new URL(location.href).searchParams;
    if (p.get("q") === q && !p.get("id") && m.id)
      history.replaceState({ q, isExample, movie: slim(m) }, "", urlFor(q, m));
    else history.replaceState({ ...(history.state || {}), movie: slim(m) }, "");
  } catch (e) {}
}
/* X の除外語の編集パネル（チップの × で削除、入力欄で追加） */
let ngOpen = false;
function ngHTML() {
  return `<details class="ng" id="ng"${ngOpen ? " open" : ""}><summary>Xで除外する言葉 <span class="cnt">${ngWords.length}語</span></summary>
  <div class="ngbody">${ngWords.length ? `<ul class="chips" aria-label="除外する言葉">${ngWords.map((w) => `<li class="chip">${esc(w)}<button type="button" data-ngdel="${esc(w)}" aria-label="「${esc(w)}」を除外しない">×</button></li>`).join("")}</ul>` : '<p class="ngnone">除外する言葉はありません</p>'}
  <form class="ngadd" id="ngadd"><input id="ngin" type="text" maxlength="20" placeholder="言葉を追加（例：泣ける）" autocomplete="off" enterkeyhint="done" aria-label="除外する言葉"><button type="submit">追加</button></form>
  <button type="button" class="ngreset" id="ngreset">初期設定に戻す</button></div></details>`;
}
// 除外語を変えたら、パネルと X のリンクだけ更新する
function refreshNg(keepFocus) {
  const d = $("#ng");
  if (!d) return;
  const t = document.createElement("div");
  t.innerHTML = ngHTML();
  d.replaceWith(t.firstElementChild);
  if (cur) {
    const all = GROUPS.flatMap((g) => g.items);
    [...document.querySelectorAll("#out a.go")].forEach((a, i) => {
      if (all[i]?.ic === "x") a.href = all[i].u(fixRad(cur[0]), cur[2]);
    });
  }
  if (keepFocus) $("#ngin")?.focus();
}
/* 作品の切り替えアニメーション：見出しと各グループが少しずつずれて、下からふわっと出る */
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
function playSwap() {
  if (reduceMotion.matches || !Element.prototype.animate) return;
  const els = [...document.querySelectorAll("#out .movie > *")];
  // 作品の見出し（いちばん上）は動かさずに薄く出すだけにする。文字を動かすと、止まった瞬間に
  // 小数点以下の位置が画面の画素にそろえ直され、1pxほど跳ねて見えるため。下のグループは少し下から出す
  els.forEach((el, i) =>
    el.animate(
      el.classList.contains("now")
        ? swipeDir // めくったときは、めくった向きから見出しを入れる
          ? [
              { opacity: 0, transform: `translateX(${swipeDir * 48}px)` },
              { opacity: 1, transform: "none" },
            ]
          : [{ opacity: 0 }, { opacity: 1 }]
        : [
            { opacity: 0, transform: "translateY(10px)" },
            { opacity: 1, transform: "none" },
          ],
      {
        duration: 280,
        delay: Math.min(i, 5) * 45,
        easing: "cubic-bezier(.2,.7,.3,1)",
        fill: "backwards",
      },
    ),
  );
  const h1 = document.querySelector("#out h1");
  if (h1)
    h1.animate([{ color: "var(--accent)" }, { color: "var(--fg)" }], {
      duration: 900,
      easing: "ease-out",
    });
}
/* 作品名から TMDB の情報（原題・ポスター・公開日）を探す。履歴から開いたときなどに使う */
function findMovie(q) {
  if (meta[q]) return meta[q];
  // まず完全一致、なければ全角半角・記号の違いを無視して一致するものを探す
  const k = norm(q);
  for (const pass of [(m) => m.title === q, (m) => norm(m.title) === k]) {
    for (const m of trendList || []) if (pass(m)) return m;
    for (const list of cache.values()) for (const m of list || []) if (pass(m)) return m;
    for (const m of titles || []) if (pass(m)) return m;
  }
  return null;
}
function render(q, isExample, movie) {
  if (!movie && q) {
    movie = findMovie(q);
    // 見つからなければ作品一覧を読み込んでもう一度探す（IMDb の原題検索とポスター表示のため）
    if (!movie)
      lookupMovie(q).then((m) => {
        settleQ(q, !!m);
        // 履歴に入れるのは作品に一致した検索だけ。一致しなかったら、残っていた分も消す
        if (m) remember(q);
        else if (hist.includes(q)) {
          hist = hist.filter((h) => h !== q);
          saveHist();
        }
        if (!cur || cur[0] !== q || cur[2]) return;
        if (m) fillMovie(m);
        else setInfo("none");
      });
  }
  if (movie && hist.includes(q)) saveMeta(q, movie);
  const changed = !cur || cur[0] !== q; // 作品が変わったときだけ切り替えのアニメーションを付ける
  ring = nextRing ?? autoRing(movie);
  nextRing = null;
  cur = [q, isExample, movie];
  store.set("cl_last", isExample ? "" : q); // 次に開いたとき、同じ作品を出すかどうかの判断に使う
  syncNav(q, isExample, movie);
  setLD(null);
  let h =
    trendHTML() +
    `<article class="movie" aria-labelledby="mt">` +
    nowHTML(q, isExample, movie) +
    pickedHTML(movie) +
    infoHTML("loading");
  GROUPS.forEach((gr, i) => {
    const hd = `<h2 id="g${i}">${gr.h}</h2>`;
    h += `<section class="grp" aria-labelledby="g${i}">${gr.note ? `<hgroup>${hd}<p>${gr.note}</p></hgroup>` : hd}<ul class="grid">${gr.items
      .map(
        (it) =>
          `<li><a class="go" href="${esc(it.u(fixRad(q), movie))}" target="_blank" rel="${it.pr?.() ? "noopener sponsored" : "noopener"}" data-q="${esc(q)}"><span class="n"><span class="fav fav-${it.ic}" aria-hidden="true"></span><span class="nm">${it.n}</span></span><span class="d">${it.pr?.() ? '<span class="pr">PR</span>' : ""}${it.d}</span></a></li>`,
      )
      .join("")}</ul>${gr.items.some((it) => it.ic === "x") ? ngHTML() : ""}</section>`;
    // 広告枠：AdSense の審査に通ったら、ここに広告ユニットを置く（それまでは仮の枠を出さない）
  });
  $("#out").innerHTML = h + `</article>`;
  $("#out").classList.remove("boot");
  fitTitle();
  if (changed) playSwap();
  swipeDir = 0;
  if (movie?.id) fetchInfoFor(q, movie);
  preloadRing();
  bindTop();
  scrollRelToNow();
  renderHist(); // 見ている作品の履歴チップに色を付ける
  const raw = $("#rawq");
  if (raw) {
    const p = picked;
    raw.onclick = () => {
      // 選び間違いのときは、打った文字のまま検索し直す
      hist = hist.filter((h) => h !== movie.title);
      saveHist();
      searchRaw(p.q);
    };
  }
  picked = null; // 一言は、そのとき1回だけ
}
function bindTop() {
  const d = $("#top");
  if (d)
    d.addEventListener("toggle", () => {
      trendOpen = d.open;
      store.set("cl_trendOpen", trendOpen);
      if (d.open) scrollRelToNow();
    });
}
function updateTop() {
  const d = $("#top");
  if (!d) return;
  const t = document.createElement("div");
  t.innerHTML = trendHTML();
  const n = t.firstElementChild,
    w = d.closest(".topwrap");
  if (n && w) {
    n.querySelector("details").open = d.open;
    w.replaceWith(n);
    bindTop();
    scrollRelToNow();
  }
  refreshRing();
}
/* 公開日順の一覧のスクロール位置。前回いちばん上に見えていた作品を覚えておき、次に開いたときもそこから見せる。
   一覧が新しい週に切り替わったとき（金曜）や、その作品が一覧から外れたときは、
   今日を含む週の1つ前の週の見出しが一番上に来るようにする（すぐ下に今日を含む週が見える） */
/* 一覧の高さを画面に合わせる。ページをいちばん上まで戻したときに、一覧の下端が画面の下から96px上で終わる高さにする。
   iPhoneのSafariは画面下にアドレスバーが重なるので、その分をあけておく（最小240px・最大520px） */
function fitRel() {
  const ol = $("#top .rel");
  if (!ol) return;
  const y = ol.getBoundingClientRect().top + scrollY;
  ol.style.maxHeight = Math.round(Math.max(240, Math.min(520, innerHeight - y - 96))) + "px";
}
addEventListener("resize", () => {
  clearTimeout(fitRel.t);
  fitRel.t = setTimeout(fitRel, 150);
});
function scrollRelToNow() {
  const ol = $("#top .rel");
  if (!ol) return;
  fitRel();
  const sv = store.get("cl_relPos", null),
    top = (el) => el.offsetTop - ol.offsetTop;
  const el =
    sv &&
    sv.anchor === relData?.anchor &&
    ol.querySelector(`[data-tid="${+sv.id}"]`)?.closest("li");
  // 公開日順をめくっているときは、表示中の作品が一覧のまんなかに来るようにする
  const now = ring === "rel" && cur?.[2] && ol.querySelector(`[data-tid="${+cur[2].id}"]`)?.closest("li");
  if (now) ol.scrollTop = top(now) - (ol.clientHeight - now.offsetHeight) / 2;
  else if (el) ol.scrollTop = top(el) + (sv.off || 0);
  else {
    const wk = ol.querySelector(".wk.prev") || ol.querySelector(".wk.cur");
    if (wk) ol.scrollTop = top(wk);
  }
  if (ol.dataset.watch) return;
  ol.dataset.watch = "1"; // 覚える処理は一覧ごとに1回だけ付ける
  let t = null;
  ol.addEventListener(
    "scroll",
    () => {
      clearTimeout(t);
      t = setTimeout(() => {
        // スクロールが止まったら、いちばん上に見えている作品を覚える
        const li = [...ol.querySelectorAll("li:has(>[data-tid])")].find(
          (li) => top(li) + li.offsetHeight > ol.scrollTop,
        );
        if (li)
          store.set("cl_relPos", {
            anchor: relData?.anchor,
            id: +li.querySelector("[data-tid]").dataset.tid,
            off: Math.round(ol.scrollTop - top(li)),
          });
      }, 200);
    },
    { passive: true },
  );
}

/* ===== イベント ===== */
addEventListener("touchstart", () => {}, { passive: true }); // iPhoneのSafariは、これがないと押している間の色（:active）が付かない
$("#q").addEventListener("input", onType);
$("#q").addEventListener("keydown", (e) => {
  if ($("#sug").hidden || !items.length) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    active = (active + 1) % items.length;
    drawSug();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    active = (active - 1 + items.length) % items.length;
    drawSug();
  } else if (e.key === "Enter" && active >= 0) {
    e.preventDefault();
    pick(items[active]);
  } else if (e.key === "Escape") {
    hideSug();
  }
});
$("#sug").addEventListener("mousedown", (e) => {
  const li = e.target.closest("li[data-i]");
  if (li) {
    e.preventDefault();
    pick(items[+li.dataset.i]);
  }
});
$("#q").addEventListener("blur", () => setTimeout(hideSug, 120));
/* Enter（スマホの「検索」「決定」）を押したとき、候補から1つに決まるならその作品を選んだことにする。
   ・一番上の候補が入力と完全に一致（記号・表記の違いは無視）
   ・入力した言葉がすべて入っている候補が、ちょうど1つだけ（言葉が1つだけなら、作品名の先頭と一致するか、作品名の半分以上を占めるとき）
   それ以外（「検索」→「ダークウェブ 検索できない…」のような途中一致など）は、打った文字のまま検索する */
async function autoPick(q) {
  let list = cache.get(q);
  if (!list) {
    try {
      list = await Promise.race([
        searchTMDB(q),
        new Promise((r) => setTimeout(() => r(null), 1500)),
      ]);
    } catch (e) {
      list = null;
    }
  } // 候補がまだなら少しだけ待つ
  if (!list?.length) return null;
  if (rankOf(q, list[0]) === 0) return list[0]; // ① 作品名と完全に一致
  // ② 入力した言葉がすべて入っている候補が、ちょうど1つだけなら選ぶ（順番・間の言葉は問わない）
  const words = q.split(" ").map(norm).filter(Boolean);
  const has = (m) => {
    const t = norm(m.title),
      o = m.original ? norm(m.original) : "";
    return words.every((w) => t.includes(w)) || words.every((w) => o.includes(w));
  };
  const hits = list.filter(has);
  if (hits.length === 1) {
    const m = hits[0];
    if (words.length >= 2) return m; // 「ウルトラマン 仮面」→ ウルトラマンVS仮面ライダー
    if (rankOf(q, m) === 1 || norm(q).length * 2 >= norm(m.title).length) return m; // 1語なら先頭一致か、作品名の半分以上
  }
  return null;
}
$("#f").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = clean($("#q").value);
  if (!q) return;
  clearTimeout(timer);
  hideSug();
  const m = await autoPick(q);
  if (clean($("#q").value) !== q) return; // 待っている間に打ち直していたら何もしない
  if (m) {
    if (rankOf(q, m) !== 0) picked = { q, id: m.id };
    pick(m);
    return;
  } // 完全一致でなければ「候補から選びました」を出す
  searchRaw(q);
});
function searchRaw(q) {
  if (findMovie(q)) remember(q); // 一致が分からなければ、確かめてから履歴に入れる
  if (findMovie(q)) setQ();
  else {
    $("#q").value = q;
    keepQ = q;
  } // 一致する作品が手元にあれば空に、なければ結果を待つ
  render(q);
  collapseTop();
  $("#q").blur();
}
$("#clr").onclick = () => {
  setQ();
  hideSug();
  $("#q").focus();
}; // 入力欄だけ空にして、画面はそのまま
/* 表示中の作品を履歴から消したら、URL をトップに戻す。
   画面はそのままにし、次に開き直したとき（リロード）は話題作からランダムに選ぶ */
function forgetShown() {
  if (!cur || cur[1] || hist.includes(cur[0])) return;
  try {
    history.replaceState(null, "", location.pathname);
  } catch (e) {}
  document.title = TOP_TITLE;
  setMeta("", false);
}
$("#hist").addEventListener("click", (e) => {
  const x = e.target.closest("[data-del]");
  if (x) {
    hist = hist.filter((h) => h !== x.dataset.del);
    saveHist();
    forgetShown();
    return;
  }
  const all = e.target.closest("#delall");
  if (all) {
    // 誤タップ防止：1回目で確認表示、3秒以内にもう1回押すと削除
    if (all.classList.contains("warn")) {
      clearTimeout(delTimer);
      toast("履歴を削除しました");
      const h = $("#hist");
      h.classList.add("out"); // ふわっと消してから空にする
      setTimeout(
        () => {
          hist = [];
          saveHist();
          forgetShown();
          h.classList.remove("out");
        },
        reduceMotion.matches ? 0 : 250,
      );
      return;
    }
    // ボタン自体は短い表示にし、説明は画面下のお知らせで出す（狭い画面でも見切れないように）
    all.classList.add("warn");
    toast("もう一度押すと履歴をすべて消します");
    delTimer = setTimeout(() => all.classList.remove("warn"), 3000);
    return;
  }
  const b = e.target.closest("[data-q]");
  if (!b) return;
  setQ();
  remember(b.dataset.q);
  render(b.dataset.q);
  collapseTop();
});
$("#q").addEventListener("focus", () => $("#q").select()); // タップで全選択し、すぐ打ち替えられるように
$("#out").addEventListener("click", (e) => {
  if (e.target.closest("#share")) share();
  const itg = e.target.closest("#itg"); // 「あらすじ・キャスト」の開閉。開いているかは次の作品でも引き継ぐ
  if (itg) {
    infoOpen = !infoOpen;
    store.set("cl_infoOpen", infoOpen);
    itg.setAttribute("aria-expanded", infoOpen);
    const p = $("#info");
    if (p) p.hidden = !infoOpen;
  }
});
// 戻る・進む：保存しておいた状態から描き直す（URL は変えない）
addEventListener("popstate", (e) => {
  const st = e.state;
  hideSug();
  if (st?.q) {
    navMode = "none";
    setQ();
    if (!st.movie && !findMovie(st.q)) keepQ = st.q;
    render(st.q, st.isExample, st.movie);
    collapseTop();
  } else {
    const q = new URL(location.href).searchParams.get("q");
    if (q) {
      navMode = "none";
      setQ();
      render(q);
    } else showTrending();
  }
});
$("#out").addEventListener(
  "toggle",
  (e) => {
    if (e.target.id === "ng") ngOpen = e.target.open;
  },
  true,
); // 除外語の欄を開いているかは、作品を替えても引き継ぐ
$("#out").addEventListener("submit", (e) => {
  if (e.target.id !== "ngadd") return;
  e.preventDefault();
  const words = $("#ngin")
    .value.split(/[,、，]/)
    .map((w) => w.normalize("NFKC").trim())
    .filter(Boolean);
  for (const w of words) if (!ngWords.includes(w) && ngWords.length < 40) ngWords.push(w);
  saveNg();
  refreshNg(true);
});
$("#out").addEventListener("click", (e) => {
  const del = e.target.closest("[data-ngdel]");
  if (del) {
    ngWords = ngWords.filter((w) => w !== del.dataset.ngdel);
    saveNg();
    refreshNg();
    return;
  }
  if (e.target.id === "ngreset") {
    ngWords = DEFAULT_NG.slice();
    saveNg();
    refreshNg();
  }
});
$("#out").addEventListener("click", (e) => {
  if (e.target.id === "shuffle") {
    showTrending();
    return;
  }
  const rb = e.target.closest("[data-ring]");
  if (rb) {
    goRing(+rb.dataset.ring);
    return;
  }
  const tb = e.target.closest("[data-ttab]");
  if (tb) {
    topTab = tb.dataset.ttab;
    store.set("cl_topTab", topTab);
    const back = () => {
      updateTop();
      $(`[data-ttab="${topTab}"]`)?.focus();
    };
    back();
    if (topTab === "rel" && !relData)
      getReleases()
        .catch(() => {})
        .finally(back);
    return;
  }
  const t = e.target.closest("[data-tid]");
  if (t) {
    const m =
      (trendList || []).find((x) => x.id === +t.dataset.tid) ||
      relData?.items.find((x) => x.id === +t.dataset.tid);
    if (m) {
      setQ();
      remember(m.title);
      nextRing = t.closest(".rel") ? "rel" : "top";
      render(m.title, false, m);
      collapseTop();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    return;
  }
  const a = e.target.closest("a.go");
  if (a && findMovie(a.dataset.q)) remember(a.dataset.q);
}); // リンクを開いた作品は履歴に残す（作品に一致しない検索は入れない）

/* 見出しの左右スワイプ。縦のスクロールはそのまま（CSS の touch-action: pan-y）。
   画面の左右の端から始めた指は、Safari の「戻る・進む」のスワイプなので反応しない */
{
  let sx = 0,
    sy = 0,
    st = 0,
    el = null,
    horiz = null,
    peeked = false,
    fade = null,
    lx = 0; // 最後に指があった横の位置
  const EDGE = 24;
  // 横に動かし始めたら、前後の作品を見出しの左右に置き、画面の左右の端を背景色で薄くする
  const addPeek = (h) => {
    const p = ringPos(cur?.[2]);
    if (!p) return;
    const ph = h.querySelector(".ph"),
      top = ph ? ph.offsetTop : 0;
    for (const [d, side] of [[1, "next"], [-1, "prev"]]) {
      const t = document.createElement("div");
      t.innerHTML = peekHTML(p.list[(p.i + d + p.n) % p.n], side);
      t.firstElementChild.style.top = top + "px";
      h.append(t.firstElementChild);
    }
    const r = h.getBoundingClientRect();
    fade = document.createElement("div");
    fade.className = "swipefade";
    fade.style.top = r.top + "px";
    fade.style.height = r.height + "px";
    document.body.append(fade);
  };
  const clearPeek = (h) => {
    h?.querySelectorAll(".peek").forEach((x) => x.remove());
    fade?.remove();
    fade = null;
  };
  $("#out").addEventListener(
    "touchstart",
    (e) => {
      el = null;
      const h = e.target.closest(".now");
      if (!h || !ringPos(cur?.[2]) || e.touches.length > 1) return;
      const t = e.touches[0];
      if (t.clientX < EDGE || t.clientX > innerWidth - EDGE) return;
      el = h;
      peeked = false;
      sx = lx = t.clientX;
      sy = t.clientY;
      st = Date.now();
      horiz = null;
    },
    { passive: true },
  );
  $("#out").addEventListener(
    "touchmove",
    (e) => {
      if (!el) return;
      const t = e.touches[0],
        dx = t.clientX - sx,
        dy = t.clientY - sy;
      lx = t.clientX;
      if (horiz === null && Math.hypot(dx, dy) > 8) horiz = Math.abs(dx) > Math.abs(dy) * 1.2;
      if (!horiz) return;
      if (!peeked) {
        peeked = true;
        addPeek(el);
      }
      el.style.transition = "none";
      el.style.transform = `translateX(${dx}px)`; // 指についてくる
    },
    { passive: true },
  );
  const end = (e) => {
    if (!el) return;
    const h = el;
    el = null;
    const dx = lx - sx,
      fast = Math.abs(dx) > 30 && Date.now() - st < 250;
    if (horiz && (Math.abs(dx) > 60 || fast)) {
      clearPeek(h);
      goRing(dx < 0 ? 1 : -1);
    } else {
      h.style.transition = "transform .2s ease"; // 足りなければ元の位置に戻す
      h.style.transform = "";
      setTimeout(() => clearPeek(h), 200);
    }
  };
  $("#out").addEventListener("touchend", end);
  $("#out").addEventListener("touchcancel", end);
}
// PC：← → キーでも前後へ（入力欄で文字を打っているときは除く）
addEventListener("keydown", (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;
  if (!ringPos(cur?.[2])) return;
  e.preventDefault();
  goRing(e.key === "ArrowRight" ? 1 : -1);
});

/* ===== ヘッダーの縮小 =====
   下にスクロールし始めたら縮め、上端に戻ったら広げる。境目でちらつかないよう、縮める位置と広げる位置を少しずらす */
const hdr = document.querySelector("body > header");
const folds = hdr.querySelectorAll(".fold");
function measureHeader() {
  if (document.documentElement.classList.contains("compact")) return;
  const st = document.documentElement.style,
    h = hdr.offsetHeight,
    b = folds[0].offsetHeight,
    t = folds[1].offsetHeight;
  st.setProperty("--hh", h + "px"); // 広げたときの高さ（本文の開始位置）
  st.setProperty("--brandh", b + "px"); // 隠すサイト名の行の高さ（その分だけ上へずらす）
  st.setProperty("--hc", h - b - t + "px"); // 縮めたときの背景の高さ
}
new ResizeObserver(measureHeader).observe(hdr);
let ticking = false;
function checkCompact() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    const y = scrollY,
      c = document.documentElement.classList.contains("compact");
    // 広がったままスクロールすると本文がヘッダーの下に潜るので、動き始めてすぐ縮め、上端に戻ったら広げる
    if (!c && y > 8) {
      hideSug();
      document.documentElement.classList.add("compact");
    } else if (c && y < 2) {
      document.documentElement.classList.remove("compact");
    }
  });
}
addEventListener("scroll", checkCompact, { passive: true });
// ページの高さが変わったとき（「いま話題の映画」の開閉、作品の切り替えなど）も確かめ直す。
// ブラウザがスクロール位置を自動で直したときに scroll が届かず、広がったヘッダーの下に本文が潜ったままになることがあるため
new ResizeObserver(checkCompact).observe(document.body);
$("#affnote").hidden = !(AFF.amazonTag || AFF.unext || AFF.mvtk);
$("#amznote").hidden = !AFF.amazonTag;
$("#envbadge").hidden = !IS_DEV;
if (IS_DEV) {
  // テスト用：右下の日付で、公開日順をその日として表示する（コンソールなら cl.today("2026-11-08")、空で解除）
  if (fakeDay)
    try {
      sessionStorage.setItem("cl_fakeDay", fakeDay);
    } catch {}
  const fd = $(".envbadge .fd"),
    show = (v) => {
      fd.classList.toggle("set", !!v);
      $("#fdtxt").textContent = v
        ? v.replace(/-/g, "/") + "（" + "日月火水木金土"[new Date(v + "T12:00").getDay()] + "）"
        : "今日";
    };
  show(fakeDay);
  window.cl = {
    today(v) {
      fakeDay = v || null;
      try {
        v ? sessionStorage.setItem("cl_fakeDay", v) : sessionStorage.removeItem("cl_fakeDay");
      } catch {}
      show(v);
      updateTop();
      return fakeDay || "解除しました";
    },
  };
  fd.addEventListener("click", (e) => {
    const b = e.target.closest("[data-fd]");
    if (!b) return;
    const n = +b.dataset.fd;
    if (!n) return cl.today("");
    const d = fakeDay ? new Date(fakeDay + "T12:00") : new Date();
    d.setDate(d.getDate() + n);
    cl.today(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    );
  });
}
renderHist();
// 前回最後に見ていた作品。履歴から消されていたら、話題作からランダムに選ぶ（記録がない古い利用者は履歴の先頭）
function lastShown() {
  let l = store.get("cl_last", null);
  if (l) l = fixRad(l);
  return l == null ? hist[0] : hist.includes(l) ? l : null;
}
const startQ = (() => {
  try {
    return clean(new URL(location.href).searchParams.get("q") || "");
  } catch (e) {
    return "";
  }
})();
if (startQ) {
  // 共有・ブックマークされた URL から開いたとき
  const id = +new URL(location.href).searchParams.get("id") || 0;
  setQ();
  if (findMovie(startQ)) remember(startQ);
  else keepQ = startQ;
  navMode = "replace"; // 一致しない作品の URL なら、分かった時点で文字を戻す
  render(startQ, false, id && meta[startQ]?.id === id ? meta[startQ] : null);
  getTrending()
    .catch(() => {
      trendFailed = true;
    })
    .finally(updateTop);
} else if (lastShown()) {
  setQ();
  navMode = "none";
  render(lastShown());
  getTrending()
    .catch(() => {
      trendFailed = true;
    })
    .finally(updateTop);
} // TOP10リストだけ後から差し替える（画面全体は描き直さない）
else {
  $("#out").innerHTML = '<p class="emptyst">いま話題の映画を読み込み中…</p>';
  showTrending();
}
if (topTab === "rel")
  getReleases()
    .catch(() => {})
    .finally(updateTop); // 前回「公開日順」を開いていたら、その一覧も読む
// それ以外は、最初の表示が終わってから公開日順の一覧を裏で読む（表示中の作品が入っていれば、めぐれるようにするため）
else
  (window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(() =>
    getReleases()
      .then(refreshRing)
      .catch(() => {}),
  );
