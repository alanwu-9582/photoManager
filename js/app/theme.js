// js/app/theme.js — 淺色 / 深色。
//
// 三種選擇: 跟著系統、固定淺色、固定深色。桌面版也是這三種。
// 實際的色票在 css/theme.css；這裡只負責把 data-theme 放到 <html> 上, 並記住選擇。

const KEY = "pm.appearance";
const MODES = ["auto", "light", "dark"];

let mode = "auto";
const listeners = new Set();

function media() {
  return window.matchMedia("(prefers-color-scheme: dark)");
}

/** 目前實際用的是哪一套（auto 的話問系統）。 */
export function resolved() {
  if (mode === "auto") return media().matches ? "dark" : "light";
  return mode;
}

export function appearance() {
  return mode;
}

function paint() {
  const root = document.documentElement;
  if (mode === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
  // 瀏覽器的網址列、系統 UI 跟著走。
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", resolved() === "dark" ? "#1c1c1e" : "#f5f5f7");
  listeners.forEach((fn) => { try { fn(resolved()); } catch (err) { console.error(err); } });
}

export function setAppearance(next) {
  mode = MODES.includes(next) ? next : "auto";
  try { localStorage.setItem(KEY, mode); } catch { /* 無痕模式寫不進去就算了 */ }
  paint();
}

/** 在三種之間輪流（側邊欄那顆按鈕）。 */
export function cycleAppearance() {
  setAppearance(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);
  return mode;
}

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function initTheme() {
  try {
    const saved = localStorage.getItem(KEY);
    if (MODES.includes(saved)) mode = saved;
  } catch { /* 讀不到就用 auto */ }
  paint();
  // 跟著系統走的時候, 系統換了要立刻跟上。
  media().addEventListener("change", () => { if (mode === "auto") paint(); });
}
