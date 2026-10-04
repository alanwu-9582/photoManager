// js/app/shell.js — 外殼上那些不屬於任何一頁的東西。
//
//   側邊欄最下面的外觀切換（跟著系統 / 淺色 / 深色）
//   視窗底部的狀態列文字（來源 · 數量 · 狀態）
//   Ctrl + 數字 換頁（順序就是側邊欄的順序）
//
// 都照桌面版的《介面設計規範》§6.1 與 §9.3。

import { icon } from "../utils/utils.js";
import { ROUTES, routeTo } from "../core/router.js";
import { onLibraryChange, fmtBytes } from "./state.js";
import { appearance, cycleAppearance, onThemeChange } from "./theme.js";

const $ = (id) => document.getElementById(id);

const APPEARANCE_LABELS = {
  auto: { label: "跟著系統", ico: "monitor" },
  light: { label: "淺色", ico: "sun" },
  dark: { label: "深色", ico: "moon" },
};

/* ============================================================
   外觀切換
   ============================================================ */
function paintAppearance() {
  const btn = $("appearanceBtn");
  if (!btn) return;
  const info = APPEARANCE_LABELS[appearance()] || APPEARANCE_LABELS.auto;
  btn.querySelector(".nav-foot-label").textContent = info.label;
  btn.querySelector(".svg-icon").className = `svg-icon icon-${info.ico}`;
  btn.title = `外觀: ${info.label}`;
}

function initAppearanceButton() {
  const btn = $("appearanceBtn");
  if (!btn) return;
  btn.addEventListener("click", () => { cycleAppearance(); paintAppearance(); });
  onThemeChange(paintAppearance);
  paintAppearance();
}

/* ============================================================
   狀態列
   ============================================================ */
/** 左半邊: 來源 · 數量 · 狀態。進度在右半邊, 由 source.js 控制。 */
export function renderStatus() {
  const host = $("statusText");
  if (!host) return;
  if (!PMLibrary.mode) {
    host.textContent = "尚未載入照片";
    return;
  }
  const s = PMLibrary.stats();
  const parts = [
    PMLibrary.mode === "folder" ? PMLibrary.rootName : "選擇的檔案",
    `${s.total.toLocaleString("en-US")} 張`,
  ];
  if (s.analysed < s.total) parts.push(`EXIF ${s.analysed} / ${s.total}`);
  if (s.marked) parts.push(`已標記 ${s.marked}`);
  if (s.organized) parts.push(`已整理 ${s.organized}`);
  if (s.bytes) parts.push(fmtBytes(s.bytes));
  host.textContent = parts.join(" · ");
}

/* ============================================================
   Ctrl + 數字換頁
   ============================================================ */
function navOrder() {
  return Object.entries(ROUTES).filter(([, r]) => r.nav).map(([name]) => name);
}

function initPageShortcuts() {
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    if (!/^[1-9]$/.test(e.key)) return;
    const target = navOrder()[Number(e.key) - 1];
    if (!target) return;
    e.preventDefault();
    routeTo(target);
  });
}

export function initShell() {
  initAppearanceButton();
  initPageShortcuts();
  renderStatus();
  onLibraryChange(renderStatus);
}
