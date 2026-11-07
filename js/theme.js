/* 表示の切り替え。「自動」は OS の設定に合わせる。選んだものはこの端末に保存する */
(() => {
  const root = document.documentElement,
    metas = document.querySelectorAll('meta[name="theme-color"]');
  const show = (t) => {
    for (const b of document.querySelectorAll("[data-theme-set]"))
      b.setAttribute("aria-pressed", String(b.dataset.themeSet === t));
  };
  const apply = (t) => {
    if (t === "light" || t === "dark") {
      root.dataset.theme = t;
      for (const m of metas) m.content = t === "dark" ? "#111115" : "#FFFFFF";
    } else {
      t = "auto";
      delete root.dataset.theme;
      metas[0].content = "#FFFFFF";
      metas[1].content = "#111115";
    } // OS の設定に合わせて切り替わる元の値
    try {
      t === "auto"
        ? localStorage.removeItem("cl_theme")
        : localStorage.setItem("cl_theme", JSON.stringify(t));
    } catch (e) {}
    show(t);
  };
  show(root.dataset.theme || "auto");
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-theme-set]");
    if (b) apply(b.dataset.themeSet);
  });
})();
