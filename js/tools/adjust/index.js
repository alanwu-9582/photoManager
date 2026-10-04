// js/tools/adjust/index.js — 調整（參考 Lightroom 的「基本 / 色彩混合 / 效果」與
// iPhone 的「攝影風格」, 從桌面版 tools/adjust 移植）。
//
// 版面照《介面設計規範》§6.3「畫布 + 設定欄」: 左邊深色畫布, 右邊分頁 + 參數列滑桿。
// 計算全部在 Web Worker 裡（規範 §9.1）: 拖曳中只算草稿, 放開才算正式的預覽,
// 所以滑桿一路拉下去畫面不會卡。
//
// 照片不會離開這台電腦。

import { el, icon } from "../../utils/utils.js";
import { button, actions, status, segmented } from "../kit.js";
import { paramSlider, pad2d, sectionTitle } from "../widgets.js";
import { notify } from "../../ui/notifications.js";
import { photoPicker } from "../../app/photo-picker.js";
import { state } from "../../app/state.js";
import * as D from "./develop.js";
import * as ST from "./styles.js";
import { createScopes } from "./scopes.js";

export const meta = { title: "調整" };
export const styles = new URL("./adjust.css", import.meta.url).href;

/** 正式預覽的長邊。再大看不出差別, 只是每放開一次滑桿就多算一倍的像素。 */
const PREVIEW_EDGE = 1280;
/** 拖曳中的草稿長邊 —— 要在一個影格裡算完。 */
const DRAFT_EDGE = 460;

const evFmt = (v) => (v > 0 ? "+" : "") + v.toFixed(2);
const pctFmt = (v) => (v > 0 ? "+" : "") + Math.round(v);
const degFmt = (v) => Math.round(v) + "°";

const safeName = (name) =>
  String(name || "photo").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "-").trim() || "photo";

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** 色相 → 給漸層軌道用的色碼。 */
function hueHex(deg) {
  const [r, g, b] = D.hueRgb(deg).map((v) => Math.round((0.25 + 0.75 * v) * 255));
  return `rgb(${r}, ${g}, ${b})`;
}

export function mount(host) {
  const p = D.defaults();
  let source = null;        // { rgba, W, H, name }
  let token = 0;
  let jobId = 0;
  let pendingFull = null;
  let showOriginal = false;

  /* ---------------- 畫布 ---------------- */
  const canvas = el("canvas", { class: "adj-canvas" });
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const scopes = createScopes();
  const badge = el("span", { class: "adj-badge", hidden: true }, "計算中…");
  const origTag = el("span", { class: "adj-orig", hidden: true }, "原始");
  const frame = el("div", { class: "adj-frame", hidden: true }, canvas, scopes.node, badge, origTag);
  const stage = el("div", { class: "tool-stage adj-stage" },
    el("p", { class: "tool-placeholder" }, "選擇照片"), frame);

  const picker = photoPicker({ onPick: (file) => load(file) });
  picker.attach(stage);

  const stat = status();

  /* ---------------- Worker ---------------- */
  const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  let exportJob = null;
  let autoJob = null;

  worker.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === "done") {
      // 比目前這一筆舊的就丟掉: 只顯示最新參數的結果（規範 §9.1）。
      if (msg.id !== jobId) return;
      const img = new ImageData(new Uint8ClampedArray(msg.rgba), msg.w, msg.h);
      draw(img);
      if (!msg.draft) {
        badge.hidden = true;
        scopes.update(img.data, msg.w, msg.h);
      }
      return;
    }
    if (msg.type === "progress" && exportJob && msg.id === exportJob.id) {
      exportJob.onProgress(msg.done, msg.total);
      return;
    }
    if (msg.type === "exported" && exportJob && msg.id === exportJob.id) {
      const job = exportJob;
      exportJob = null;
      job.resolve(new ImageData(new Uint8ClampedArray(msg.rgba), msg.w, msg.h));
      return;
    }
    if (msg.type === "auto" && autoJob && msg.id === autoJob.id) {
      const job = autoJob;
      autoJob = null;
      job.resolve(msg.values);
      return;
    }
    if (msg.type === "error") {
      badge.hidden = true;
      notify.danger(msg.message);
    }
  };

  function draw(img) {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.putImageData(img, 0, 0);
  }

  /** 草稿（拖曳中）與正式（放開後）兩段式預覽。 */
  function request(draft) {
    if (!source) return;
    jobId++;
    if (!draft) badge.hidden = false;
    worker.postMessage({
      type: "render", id: jobId, token, draft,
      edge: draft ? DRAFT_EDGE : PREVIEW_EDGE,
      params: showOriginal ? D.defaults() : D.clone(p),
    });
  }

  let draftTimer = null;
  /** 拖曳中: 先給草稿（規範 §9.1 兩段式預覽）。 */
  function live() {
    clearTimeout(pendingFull);
    if (draftTimer) return;
    draftTimer = setTimeout(() => { draftTimer = null; request(true); }, 16);
  }

  /** 放開滑桿: 算正式的。 */
  function settle() {
    clearTimeout(pendingFull);
    pendingFull = setTimeout(() => request(false), 90);
  }

  /* ---------------- 載入照片 ---------------- */
  async function load(file) {
    if (!file) return;
    stat.set("讀取中…");
    try {
      const bitmap = await PMImage.decodeBitmap(file, { imageOrientation: "from-image" });
      const W = bitmap.width;
      const H = bitmap.height;
      const off = new OffscreenCanvas(W, H);
      const octx = off.getContext("2d");
      octx.drawImage(bitmap, 0, 0);
      bitmap.close?.();
      const full = octx.getImageData(0, 0, W, H);

      source = { W, H, name: file.name, file };
      token++;
      // 換一張照片, 調整值歸零（規範 §9.2）—— 不然上一張的曝光會疊到這一張。
      Object.assign(p, D.defaults());
      syncControls();

      worker.postMessage({ type: "load", token, rgba: full.data.buffer, W, H }, [full.data.buffer]);
      frame.hidden = false;
      stage.querySelector(".tool-placeholder")?.remove();
      stat.set(`${W} × ${H}`);
      request(false);
    } catch (err) {
      console.error(err);
      stat.set(`讀取失敗: ${err.message}`, "error");
    }
  }

  /* ---------------- 設定欄 ---------------- */
  const sliders = new Map();

  function slider(key, label, opts = {}) {
    const node = paramSlider({
      label,
      min: opts.min ?? -100,
      max: opts.max ?? 100,
      step: opts.step ?? 1,
      value: p[key],
      defaultValue: D.defaults()[key],
      format: opts.format,
      gradient: opts.gradient,
      onInput: (v) => { p[key] = v; live(); },
      onChange: settle,
    });
    sliders.set(key, node);
    return node;
  }

  function syncControls() {
    sliders.forEach((node, key) => node.setValue(p[key]));
    hslSliders.forEach((node, name) => node.setValue(p.hsl[name][hslMode]));
    gradeSliders.forEach((node, key) => node.setValue(p.grade[key]));
    stylePad.setValue(p.style.color, p.style.tone);
    paletteSlider.setValue(p.style.palette);
    paintStyleGrid();
  }

  /* ----- 基本 ----- */
  const autoBtn = button("自動", {
    title: "依直方圖自動調整曝光、亮部、陰影、白色、黑色",
    onClick: async () => {
      if (!source) return;
      autoBtn.disabled = true;
      badge.hidden = false;
      try {
        const values = await new Promise((resolve) => {
          autoJob = { id: ++jobId, resolve };
          worker.postMessage({ type: "auto", id: autoJob.id, token, params: D.clone(p) });
        });
        Object.assign(p, values);
        syncControls();
        request(false);
        notify.success("已自動調整");
      } finally {
        autoBtn.disabled = false;
      }
    },
  });

  const resetBtn = button("全部重設", {
    iconName: "reset",
    title: "所有調整回到預設值",
    onClick: () => {
      Object.assign(p, D.defaults());
      syncControls();
      request(false);
    },
  });

  const basic = el("div", { class: "adj-pane" },
    sectionTitle("白平衡"),
    slider("temp", "色溫", { gradient: ["#3b78d8", "#d8d8d8", "#e2b23c"] }),
    slider("tint", "色調", { gradient: ["#3fae49", "#d8d8d8", "#c74bc5"] }),
    el("div", { class: "adj-head" }, sectionTitle("色調"), el("span", { class: "adj-spacer" }), autoBtn, resetBtn),
    slider("exposure", "曝光", { min: -5, max: 5, step: 0.05, format: evFmt }),
    slider("contrast", "對比", { format: pctFmt }),
    slider("highlights", "亮部", { format: pctFmt }),
    slider("shadows", "陰影", { format: pctFmt }),
    slider("whites", "白色", { format: pctFmt }),
    slider("blacks", "黑色", { format: pctFmt }),
    sectionTitle("外觀"),
    slider("texture", "紋理", { format: pctFmt }),
    slider("clarity", "清晰度", { format: pctFmt }),
    slider("dehaze", "去朦朧", { format: pctFmt }),
    slider("vibrance", "細節飽和度", { format: pctFmt }),
    slider("saturation", "飽和度", { format: pctFmt }),
  );

  /* ----- 風格 ----- */
  const styleGrid = el("div", { class: "adj-styles" });
  const styleCells = new Map();

  function paintStyleGrid() {
    styleCells.forEach((cell, name) => cell.classList.toggle("is-active", p.style.name === name));
  }

  function addStyleGroup(title, list) {
    styleGrid.appendChild(el("p", { class: "section-title" }, title));
    const grid = el("div", { class: "adj-style-grid" });
    list.forEach(([name, label]) => {
      const cell = el("button", {
        type: "button", class: "adj-style", title: label,
        onclick: () => { p.style.name = name; paintStyleGrid(); request(false); },
      },
      el("span", { class: `adj-style-swatch is-${name}` }),
      el("span", { class: "adj-style-label" }, label));
      styleCells.set(name, cell);
      grid.appendChild(cell);
    });
    styleGrid.appendChild(grid);
  }

  addStyleGroup("膚色基調", ST.UNDERTONES);
  addStyleGroup("氛圍", ST.MOODS);

  // 兩個互相關聯的連續值用一塊方板（規範 §4.8.1）: 上下是色調、左右是色彩。
  const stylePad = pad2d({
    x: p.style.color,
    y: p.style.tone,
    axes: { top: "柔和", bottom: "強烈", left: "淡", right: "濃" },
    onInput: (x, y) => { p.style.color = x; p.style.tone = y; live(); },
    onChange: settle,
  });

  const paletteSlider = paramSlider({
    label: "色盤", min: 0, max: 100, step: 1, value: p.style.palette, defaultValue: 100,
    onInput: (v) => { p.style.palette = v; live(); },
    onChange: settle,
  });

  const stylePane = el("div", { class: "adj-pane" },
    styleGrid,
    sectionTitle("微調"),
    el("div", { class: "adj-pad-wrap" }, stylePad),
    paletteSlider,
  );

  /* ----- 色彩 ----- */
  let hslMode = 0;
  const hslSliders = new Map();
  const hslSeg = segmented([
    { value: "0", label: "色相" }, { value: "1", label: "飽和度" }, { value: "2", label: "明亮度" },
  ], {
    value: "0",
    onChange: (v) => {
      hslMode = Number(v);
      hslSliders.forEach((node, name) => node.setValue(p.hsl[name][hslMode]));
    },
  });
  hslSeg.classList.add("is-wide");

  const hslRows = D.BANDS.map(([name]) => {
    const node = paramSlider({
      label: D.BAND_NAMES[name], min: -100, max: 100, step: 1, value: 0, defaultValue: 0,
      format: pctFmt,
      onInput: (v) => { p.hsl[name][hslMode] = v; live(); },
      onChange: settle,
    });
    hslSliders.set(name, node);
    return node;
  });

  const gradeSliders = new Map();
  const spectrum = Array.from({ length: 13 }, (_, i) => hueHex(i * 30));
  function gradeSlider(key, label, kind) {
    const node = paramSlider({
      label,
      min: kind === "hue" ? 0 : (kind === "balance" ? -100 : 0),
      max: kind === "hue" ? 360 : 100,
      step: 1,
      value: p.grade[key],
      defaultValue: D.defaults().grade[key],
      format: kind === "hue" ? degFmt : pctFmt,
      gradient: kind === "hue" ? spectrum : null,
      onInput: (v) => { p.grade[key] = v; live(); },
      onChange: settle,
    });
    gradeSliders.set(key, node);
    return node;
  }

  const colorPane = el("div", { class: "adj-pane" },
    sectionTitle("色彩混合"),
    hslSeg,
    ...hslRows,
    sectionTitle("顏色分級"),
    gradeSlider("sh_hue", "陰影色相", "hue"),
    gradeSlider("sh_sat", "陰影飽和", "sat"),
    gradeSlider("hi_hue", "亮部色相", "hue"),
    gradeSlider("hi_sat", "亮部飽和", "sat"),
    gradeSlider("balance", "平衡", "balance"),
  );

  /* ----- 效果 ----- */
  const effectPane = el("div", { class: "adj-pane" },
    sectionTitle("暈影"),
    slider("vignette", "總量", { format: pctFmt }),
    slider("vig_mid", "中點", { min: 0, max: 100 }),
    slider("vig_feather", "羽化", { min: 0, max: 100 }),
    sectionTitle("顆粒"),
    slider("grain", "總量", { min: 0, max: 100 }),
    slider("grain_size", "大小", { min: 0, max: 100 }),
  );

  /* ---------------- 分頁 ---------------- */
  const panes = { basic, style: stylePane, color: colorPane, effects: effectPane };
  const paneHost = el("div", { class: "adj-panes" }, basic);
  const tabs = segmented([
    { value: "basic", label: "基本" }, { value: "style", label: "風格" },
    { value: "color", label: "色彩" }, { value: "effects", label: "效果" },
  ], { value: "basic", onChange: (v) => paneHost.replaceChildren(panes[v]) });
  tabs.classList.add("is-wide");

  /* ---------------- 動作 ---------------- */
  const stashBtn = button("暫存", {
    title: "把目前的結果留在記憶體裡, 切到其他編輯工具會接著用（不會寫檔）",
    onClick: () => stash(),
  });

  const saveBtn = button("下載", {
    variant: "primary", iconName: "download",
    title: "用原尺寸輸出調整後的照片",
    onClick: () => exportFull(),
  });

  async function renderFull(onProgress) {
    return new Promise((resolve) => {
      exportJob = { id: ++jobId, resolve, onProgress };
      worker.postMessage({ type: "export", id: exportJob.id, token, params: D.clone(p) });
    });
  }

  async function toBlob(img, type, quality) {
    const off = new OffscreenCanvas(img.width, img.height);
    off.getContext("2d").putImageData(img, 0, 0);
    return off.convertToBlob({ type, quality });
  }

  async function exportFull() {
    if (!source) { notify.warning("還沒有照片"); return; }
    saveBtn.disabled = true;
    try {
      const img = await renderFull((done, total) => {
        stat.set(`輸出中… ${Math.round(done / total * 100)}%`);
      });
      const blob = await toBlob(img, "image/jpeg", 0.92);
      saveBlob(blob, `${safeName(source.name)}_adjust.jpg`);
      stat.set(`已輸出 ${img.width}×${img.height}`);
    } catch (err) {
      console.error(err);
      stat.set(`輸出失敗: ${err.message}`, "error");
    } finally {
      saveBtn.disabled = false;
    }
  }

  /** 暫存: 結果留在記憶體裡, 換一個編輯工具就接著用（規範 §9.2）。 */
  async function stash() {
    if (!source) { notify.warning("還沒有照片"); return; }
    stashBtn.disabled = true;
    try {
      const img = await renderFull((done, total) => {
        stat.set(`暫存中… ${Math.round(done / total * 100)}%`);
      });
      const blob = await toBlob(img, "image/png");
      const file = new File([blob], `${safeName(source.name)}_adjust.png`, { type: "image/png" });
      state.editorPhoto = {
        file,
        photoId: state.editorPhoto?.photoId ?? null,
        stashed: true,
        source: "調整",
        // 記住原始檔, 下一個工具才有辦法「改回原始」。
        originFile: state.editorPhoto?.originFile || source.file || null,
      };
      stat.set("已暫存, 切到其他編輯工具會接著用");
      notify.success("已暫存");
    } finally {
      stashBtn.disabled = false;
    }
  }

  /* ---------------- 按住空白鍵看原圖 ---------------- */
  const onKeyDown = (e) => {
    if (e.code !== "Space" || e.repeat) return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    e.preventDefault();
    if (!source || showOriginal) return;
    showOriginal = true;
    origTag.hidden = false;
    request(false);
  };
  const onKeyUp = (e) => {
    if (e.code !== "Space" || !showOriginal) return;
    showOriginal = false;
    origTag.hidden = true;
    request(false);
  };
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);

  /* ---------------- 組起來 ---------------- */
  host.replaceChildren(
    el("div", { class: "tool-board" },
      el("div", { class: "tool-shell" },
        el("div", { class: "tool-side" }, stage, picker, stat.node),
        el("div", { class: "tool-controls adj-controls" },
          tabs,
          paneHost,
          actions(stashBtn, saveBtn)))),
  );

  // 從別的頁面送過來的那一張（照片檢視的工具清單、或上一個工具暫存的結果）。
  picker.restoreCurrent();

  return () => {
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("keyup", onKeyUp);
    clearTimeout(pendingFull);
    clearTimeout(draftTimer);
    worker.terminate();
  };
}
