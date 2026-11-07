/* Google AdSense のプログラムは大きいので、作品の表示を邪魔しないよう後から読み込む。
   画面を触ったとき（スクロール・タップ・キー操作）か、読み込み完了から数秒たって手が空いたときの早いほう */
(() => {
  let done = false;
  const load = () => {
    if (done) return;
    done = true;
    const s = document.createElement("script");
    s.async = true;
    s.crossOrigin = "anonymous";
    s.src =
      "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9484498289210970";
    document.head.append(s);
  };
  for (const ev of ["scroll", "pointerdown", "keydown", "touchstart"])
    addEventListener(ev, load, { once: true, passive: true });
  addEventListener("load", () =>
    setTimeout(
      () =>
        "requestIdleCallback" in window ? requestIdleCallback(load, { timeout: 3000 }) : load(),
      3500,
    ),
  );
})();
