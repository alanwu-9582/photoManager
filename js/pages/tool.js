// js/pages/tool.js — 工具頁的外框。
//
// 一個工具一個資料夾, 外面只認 js/tools/<id>/index.js:
//
//     export const meta = { title: "照片色卡" };                       // 選填
//     export const styles = new URL("./x.css", import.meta.url).href;  // 選填
//     export function mount(host, { options }) { … }                   // 回傳 cleanup（選填）
//
// 工具頁只有標題與工具本體, 沒有任何說明文字 —— 要看的是操作介面, 不是說明書。

import { escapeHtml } from "../utils/utils.js";

/** id 直接參與模組路徑, 只放行安全字元。 */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** 已經插進 <head> 的工具樣式, 每個網址只載一次。 */
const styleLinks = new Map();

/**
 * 載入工具自己的樣式表, 並等它真的下載完 ——
 * 不等的話, 工具已經掛上去了樣式還沒到, 會先閃一下沒排版的樣子。
 */
function ensureStyles(href) {
  if (!href) return Promise.resolve();
  if (styleLinks.has(href)) return styleLinks.get(href);
  const pending = new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.toolStyle = "1";
    // 樣式載不到就照樣掛工具 —— 難看總比整個不能用好。
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener("error", () => resolve(), { once: true });
    document.head.appendChild(link);
  });
  styleLinks.set(href, pending);
  return pending;
}

export async function mountPage({ route }) {
  const host = document.getElementById("toolHost");
  const id = String(route.tool || "").trim();
  document.getElementById("toolTitle").textContent = route.label;

  if (!ID_PATTERN.test(id)) {
    host.innerHTML = `<div class="banner banner-danger" role="alert">工具 id 不合法: ${escapeHtml(id)}</div>`;
    return;
  }

  host.innerHTML = '<div class="state-block" role="status"><div class="spinner" aria-hidden="true"></div>載入工具…</div>';
  try {
    const module = await import(`../tools/${id}/index.js`);
    if (typeof module.mount !== "function") throw new Error("模組沒有 export mount()");
    await Promise.all([module.styles].flat().filter(Boolean).map(ensureStyles));
    host.replaceChildren();
    if (module.meta?.title) document.getElementById("toolTitle").textContent = module.meta.title;
    const cleanup = await module.mount(host, { options: {} });
    return typeof cleanup === "function" ? cleanup : undefined;
  } catch (err) {
    console.error(err);
    host.innerHTML =
      `<div class="banner banner-danger" role="alert">工具「${escapeHtml(id)}」載入失敗: ${escapeHtml(err.message)}</div>`;
  }
}
