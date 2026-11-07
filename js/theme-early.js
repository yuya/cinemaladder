/* 表示（自動／ライト／ダーク）。選んだものを読み込みの最初に当て、一瞬だけ違う色が見えないようにする */
try {
  const t = JSON.parse(localStorage.getItem("cl_theme"));
  if (t === "light" || t === "dark") {
    document.documentElement.dataset.theme = t;
    for (const m of document.querySelectorAll('meta[name="theme-color"]'))
      m.content = t === "dark" ? "#111115" : "#FFFFFF";
  }
} catch (e) {}
