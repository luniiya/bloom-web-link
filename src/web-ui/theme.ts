export type Theme = "auto" | "light" | "dark";

export function normalizeTheme(value: string | null): Theme {
  return value === "light" || value === "dark" ? value : "auto";
}

export function savedTheme(): Theme {
  return normalizeTheme(localStorage.getItem("bwl-theme"));
}

/** Apply a theme to the page; with persist, remember it ("auto" clears the saved choice). */
export function applyTheme(theme: Theme, persist = true) {
  document.documentElement.dataset.theme = theme;
  if (!persist) return;
  if (theme === "auto") localStorage.removeItem("bwl-theme");
  else localStorage.setItem("bwl-theme", theme);
}
