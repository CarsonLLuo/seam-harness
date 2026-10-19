// 主题：跟随系统 / 浅色 / 深色。实际生效的颜色由 <html data-theme> 决定（见 styles.css）。
// index.html 里有一段同样逻辑的内联脚本，在页面渲染前先设置好，避免闪一下另一种颜色。
export type ThemePref = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "seam.theme";

export function resolveTheme(pref: ThemePref, systemDark: boolean): "light" | "dark" {
  return pref === "system" ? (systemDark ? "dark" : "light") : pref;
}

export function loadThemePref(): ThemePref {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  return saved === "light" || saved === "dark" ? saved : "system";
}

const systemQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

/** 应用主题；跟随系统时监听系统变化。返回取消监听的函数 */
export function applyTheme(pref: ThemePref): () => void {
  const apply = () => {
    document.documentElement.dataset.theme = resolveTheme(pref, systemQuery().matches);
  };
  apply();
  if (pref !== "system") return () => {};
  const query = systemQuery();
  query.addEventListener("change", apply);
  return () => query.removeEventListener("change", apply);
}
