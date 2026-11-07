try {
  if (JSON.parse(localStorage.getItem("cl_hist") || "[]").length)
    document.documentElement.classList.add("hashist");
} catch (e) {}
