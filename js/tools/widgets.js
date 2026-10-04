// js/tools/widgets.js — 照《介面設計規範》§4 做的控制項。
//
// 值的型別決定用哪一個（規範 §5）:
//   連續的值 → 參數列滑桿        有級距、有順序 → 步進器
//   2–5 個互斥選項 → 分段控制     6 個以上 → 下拉選單
//   開 / 關 → 開關               兩個相關的連續值 → 二維控制板
//
// 桌面版對應 photomanager/ui/widgets.py。長相在 css/controls.css。

import { el, icon } from "../utils/utils.js";

/**
 * 步進器（規範 §4.3）。有級距、有順序的值用這個 ——
 * 滑桿拖不準, 也看不出有幾級。
 * @param {{items:Array<{value:any,label:string}>, value:any, onChange:Function, wide?:boolean}} cfg
 */
export function stepper({ items, value, onChange, wide = true } = {}) {
  let index = Math.max(0, items.findIndex((it) => it.value === value));

  const prev = el("button", {
    type: "button", class: "stepper-arrow is-prev", "aria-label": "上一個",
    html: icon("arrow-right", { size: "13px" }),
  });
  const next = el("button", {
    type: "button", class: "stepper-arrow", "aria-label": "下一個",
    html: icon("arrow-right", { size: "13px" }),
  });
  const valueBtn = el("button", { type: "button", class: "stepper-value" });

  const host = el("div", {
    class: "stepper" + (wide ? " is-wide" : ""),
    role: "spinbutton", tabindex: "0",
  }, prev, valueBtn, next);

  const paint = () => {
    valueBtn.textContent = items[index] ? items[index].label : "";
    prev.disabled = index <= 0;
    next.disabled = index >= items.length - 1;
    host.setAttribute("aria-valuenow", String(items[index] ? items[index].value : ""));
  };

  const go = (delta) => {
    const at = Math.min(Math.max(index + delta, 0), items.length - 1);
    if (at === index) return;
    index = at;
    paint();
    onChange?.(items[index].value);
  };

  prev.addEventListener("click", () => go(-1));
  next.addEventListener("click", () => go(1));
  // 點中間就往下一個；到底了就繞回第一個（選項不多時比開選單快）。
  valueBtn.addEventListener("click", () => go(index >= items.length - 1 ? -index : 1));
  host.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); go(-1); }
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); go(1); }
  });

  paint();
  host.setValue = (v) => {
    const at = items.findIndex((it) => it.value === v);
    if (at >= 0) { index = at; paint(); }
  };
  return host;
}

/** 開 / 關（規範 §4.5）。只放圖示時一定要有 title。 */
export function toggle(label, { checked = false, onChange, iconName, title, wide = false } = {}) {
  const iconOnly = !!iconName && !label;
  const node = el("button", {
    type: "button",
    class: "switch" + (checked ? " is-on" : "") + (wide ? " is-wide" : "") + (iconOnly ? " is-icon" : ""),
    "aria-pressed": String(!!checked),
    title: title || null,
    "aria-label": iconOnly ? (title || "") : null,
  },
  iconName ? el("span", { class: "switch-ico", html: icon(iconName, { size: "17px" }) }) : null,
  label ? el("span", {}, label) : null,
  );
  let on = !!checked;
  node.addEventListener("click", () => {
    on = !on;
    node.classList.toggle("is-on", on);
    node.setAttribute("aria-pressed", String(on));
    onChange?.(on);
  });
  node.setChecked = (v) => {
    on = !!v;
    node.classList.toggle("is-on", on);
    node.setAttribute("aria-pressed", String(on));
  };
  return node;
}

/**
 * 參數列滑桿（規範 §4.4 B）。一列一個參數: 名稱 ─ 軌道 ─ 數值。
 *
 * 點軌道的任何位置直接跳到那個值, 而且可以不放開接著拖；雙擊回預設值；
 * 拖曳中發 onInput、放開才發 onChange —— 計算慢的效果只接後者（規範 §9.1）。
 *
 * @param {{label:string, min:number, max:number, step?:number, value:number,
 *          defaultValue?:number, format?:Function, gradient?:string[],
 *          bipolar?:boolean, onInput:Function, onChange?:Function}} cfg
 */
export function paramSlider({
  label, min = -100, max = 100, step = 1, value = 0, defaultValue,
  format, gradient, bipolar, onInput, onChange,
} = {}) {
  const base = defaultValue === undefined ? 0 : defaultValue;
  const twoWay = bipolar === undefined ? (min < 0 && max > 0) : bipolar;
  let current = value;

  const nameEl = el("span", { class: "pslider-name", title: label }, label);
  const valueEl = el("span", { class: "pslider-value" });
  const rail = el("span", { class: "pslider-rail" });
  const fill = el("span", { class: "pslider-fill" });
  const thumb = el("span", { class: "pslider-thumb" });
  const track = el("div", {
    class: "pslider-track", tabindex: "0", role: "slider", "aria-label": label,
  }, rail, twoWay ? el("span", { class: "pslider-mid" }) : null, fill, thumb);
  const host = el("div", { class: "pslider" }, nameEl, track, valueEl);

  // 數值本身就是一個色彩方向時, 軌道直接畫成那個漸層, 不另外填色（規範 §4.4）。
  if (gradient) {
    rail.style.background = "linear-gradient(to right, " + gradient.join(", ") + ")";
    fill.style.display = "none";
  }

  const ratio = (v) => (v - min) / (max - min);

  const paint = () => {
    const r = ratio(current);
    thumb.style.left = (r * 100) + "%";
    if (!gradient) {
      const from = twoWay ? ratio(0) : 0;
      const lo = Math.min(from, r);
      fill.style.left = (lo * 100) + "%";
      fill.style.width = (Math.abs(r - from) * 100) + "%";
    }
    valueEl.textContent = format ? format(current) : String(Math.round(current));
    host.classList.toggle("is-set", Math.abs(current - base) > 1e-9);
    track.setAttribute("aria-valuenow", String(current));
  };

  const quantise = (v) => {
    const snapped = Math.round(v / step) * step;
    return Math.min(max, Math.max(min, Number(snapped.toFixed(6))));
  };

  const setValue = (v, opts) => {
    const o = opts || {};
    const next = quantise(v);
    const changed = next !== current;
    current = next;
    paint();
    if (o.emit !== false && changed) onInput?.(current);
    if (o.settle) onChange?.(current);
  };

  const fromEvent = (e) => {
    const r = track.getBoundingClientRect();
    return min + ((e.clientX - r.left) / Math.max(1, r.width)) * (max - min);
  };

  let dragging = false;
  track.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    track.classList.add("is-dragging");
    try { track.setPointerCapture(e.pointerId); } catch { /* 沒這個指標就算了 */ }
    setValue(fromEvent(e));
    track.focus({ preventScroll: true });
  });
  track.addEventListener("pointermove", (e) => { if (dragging) setValue(fromEvent(e)); });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    track.classList.remove("is-dragging");
    onChange?.(current);
  };
  track.addEventListener("pointerup", end);
  track.addEventListener("pointercancel", end);
  track.addEventListener("dblclick", () => setValue(base, { settle: true }));
  track.addEventListener("keydown", (e) => {
    const big = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      setValue(current - step * big, { settle: true });
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      setValue(current + step * big, { settle: true });
    }
  });

  track.setAttribute("aria-valuemin", String(min));
  track.setAttribute("aria-valuemax", String(max));
  paint();
  host.setValue = (v) => setValue(v, { emit: false });
  host.getValue = () => current;
  return host;
}

/**
 * 二維控制板（規範 §4.8.1）。兩個互相關聯的連續值用一塊方板, 不拆成兩條滑桿。
 * @param {{x:number, y:number, axes:object, onInput:Function, onChange?:Function}} cfg
 *        x / y 都是 -100…100, y 正是往上。
 */
export function pad2d({ x = 0, y = 0, axes = {}, onInput, onChange } = {}) {
  const dot = el("div", { class: "pad2d-dot" });
  const host = el("div", { class: "pad2d", tabindex: "0", role: "application" },
    el("div", { class: "pad2d-grid" }),
    axes.top ? el("span", { class: "pad2d-axis is-top" }, axes.top) : null,
    axes.bottom ? el("span", { class: "pad2d-axis is-bottom" }, axes.bottom) : null,
    axes.left ? el("span", { class: "pad2d-axis is-left" }, axes.left) : null,
    axes.right ? el("span", { class: "pad2d-axis is-right" }, axes.right) : null,
    dot);

  let cx = x;
  let cy = y;
  const paint = () => {
    dot.style.left = ((cx + 100) / 2) + "%";
    dot.style.top = ((100 - cy) / 2) + "%";
  };

  const set = (nx, ny, settle) => {
    cx = Math.min(100, Math.max(-100, Math.round(nx)));
    cy = Math.min(100, Math.max(-100, Math.round(ny)));
    paint();
    onInput?.(cx, cy);
    if (settle) onChange?.(cx, cy);
  };

  const fromEvent = (e) => {
    const r = host.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 200 - 100, 100 - ((e.clientY - r.top) / r.height) * 200];
  };

  let dragging = false;
  host.addEventListener("pointerdown", (e) => {
    dragging = true;
    try { host.setPointerCapture(e.pointerId); } catch { /* 略 */ }
    const at = fromEvent(e);
    set(at[0], at[1]);
  });
  host.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const at = fromEvent(e);
    set(at[0], at[1]);
  });
  const end = () => { if (dragging) { dragging = false; onChange?.(cx, cy); } };
  host.addEventListener("pointerup", end);
  host.addEventListener("pointercancel", end);
  // 雙擊回中心（規範 §4.8.1: 沒有另外的歸零按鈕）。
  host.addEventListener("dblclick", () => set(0, 0, true));

  paint();
  host.setValue = (nx, ny) => { cx = nx; cy = ny; paint(); };
  return host;
}

/** 群組框（規範 §4.11）。只有標題, 沒有說明段落。 */
export function groupBox(title, ...children) {
  return el("div", { class: "groupbox" },
    title ? el("h3", {}, title) : null,
    el("div", { class: "groupbox-body" }, ...children.flat()));
}

/** 欄位 = 上方標題 + 下方控制項（規範 §6.4）。 */
export function field(label, control) {
  return el("div", { class: "field" },
    label ? el("span", { class: "field-label" }, label) : null, control);
}

/** 區段標題（設定欄裡分組用）。 */
export function sectionTitle(text) {
  return el("p", { class: "section-title" }, text);
}
