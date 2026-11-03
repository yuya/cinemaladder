// 各サイトのファビコンを icons/<名前>.png に保存する。すでにあるものは取り直さない。
// 訪問者のブラウザから外部サービスに問い合わせないよう、リポジトリに置いて配信する。
// note.png（白地に黒の「n」に薄いグレーの縁を付け、ライト・ダークのどちらでも見えるように）と
// hatenaparks.png（周りの白を透明に）は、取得したあと手で加工している。
// 取り直すと元の見た目に戻るので、消さないこと。
import { writeFile, mkdir, access } from "node:fs/promises";

const SITES = {
  filmarks: "filmarks.com", eiga: "eiga.com", moviewalker: "moviewalker.jp", eigaland: "eigaland.com",
  kinenote: "kinenote.com", imdb: "imdb.com", yahoo: "yahoo.co.jp", google: "google.com", mvtk: "mvtk.jp",
  x: "x.com", instagram: "instagram.com", hatenaparks: "p.hatena.ne.jp", note: "note.com", unext: "unext.jp", primevideo: "primevideo.com", netflix: "netflix.com",
};
await mkdir("icons", { recursive: true });
for (const [name, domain] of Object.entries(SITES)) {
  const file = `icons/${name}.png`;
  try { await access(file); continue; } catch {}
  try {
    const r = await fetch(`https://www.google.com/s2/favicons?domain=${domain}&sz=32`);
    if (!r.ok) throw new Error("HTTP " + r.status);
    await writeFile(file, Buffer.from(await r.arrayBuffer()));
    console.log("取得:", file);
  } catch (e) { console.warn("失敗:", domain, e.message); }
}
