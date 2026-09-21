// js/tools/exif-frame/index.js — EXIF 相框。
//
// 丟一張 JPEG 進來, 讀出相機、鏡頭與曝光參數, 排成相框再存回去。
// 相框可以只有下面一條、只有上面、上下、四邊全框, 或是拍立得那種下面特別寬的。
//
// 照片不會離開這台電腦: 解碼、排版、輸出全部在 canvas 上做完, 沒有任何上傳。

import {
  panel, row, field, textInput, select, segmented, button, actions,
  status, subhead, rangeField, flag, colorInput, stickyTop, el,
} from "../kit.js";
import { notify } from "../../ui/notifications.js";
import { photoPicker } from "../../app/photo-picker.js";
import { MODES, MODE_PAD, DEFAULTS, renderFrame } from "./frame.js";

export const meta = { title: "EXIF 相框" };
export const styles = new URL("./exif-frame.css", import.meta.url).href;

/** 預覽時照片畫多寬。再大看不出差別, 只是每拉一下滑桿就多算一次。 */
const PREVIEW_WIDTH = 1400;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

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

const safeName = (name) =>
  String(name || "photo").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "-").trim() || "photo";

/** 相對亮度, 用來決定框上的字要黑的還是白的。 */
function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** EXIF 的 "2024:05:16 12:33:21" → "2024-05-16 12:33"。 */
function formatDate(raw) {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/.exec(String(raw || "").trim());
  if (!m) return String(raw || "").trim();
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
}

/** 從 EXIF 組出四個欄位的預設文字。 */
function fieldsFromExif(info) {
  if (!info) return { model: "", date: "", brand: "", params: "" };
  const make = (info.make || "").trim();
  let model = (info.model || "").trim();
  // 有些機身把廠牌也寫進型號（"NIKON D750"）, 兩邊都顯示就重複了。
  if (make && model.toUpperCase().startsWith(make.toUpperCase())) {
    model = model.slice(make.length).trim() || model;
  }
  const params = [
    info.focalLength ? String(info.focalLength).replace(/\s+/g, "") : null,
    info.fNumber || null,
    info.exposureTime ? String(info.exposureTime).replace(/\s+/g, "") : null,
    info.iso != null ? `ISO${info.iso}` : null,
  ].filter(Boolean).join(" ");

  return { model, date: formatDate(info.dateTimeOriginal || info.dateTime), brand: make, params };
}

export async function mount(host) {
  const o = { ...DEFAULTS };
  let bitmap = null;      // 已轉正的照片
  let logo = null;        // 自訂品牌圖
  let sourceName = "photo";
  let disposed = false;

  /* ---------- 預覽 ---------- */
  // 照片區的大小固定, 有沒有照片、照片是直是橫都不會改變整個框。
  const placeholder = el("p", { class: "tool-placeholder frame-placeholder" }, "選擇照片");
  // 相框畫在 .stage-fill 這一層裡: 那一層是絕對定位、大小確定的,
  // canvas 才有辦法用百分比撐滿再 object-fit 縮進去（見 tools.css）。
  const canvasLayer = el("div", { class: "stage-fill" });
  const canvasWrap = el("div", { class: "tool-stage" }, placeholder, canvasLayer);
  const state = status();

  // 連續拉滑桿時只重畫一次。這裡用 setTimeout 而不是 requestAnimationFrame:
  // rAF 在分頁被切到背景時完全不會跑, 回到前景就會看到一張沒跟上設定的預覽。
  let frameId = 0;
  function paint() {
    if (frameId) return;
    frameId = setTimeout(() => {
      frameId = 0;
      if (disposed || !bitmap) return;
      const canvas = renderFrame(bitmap, o, Math.min(PREVIEW_WIDTH, bitmap.width), logo);
      canvas.className = "frame-canvas";
      canvasLayer.replaceChildren(canvas);
      placeholder.hidden = true;
    }, 16);
  }

  /* ---------- 讀圖 ---------- */
  async function loadFile(file) {
    state.set("讀取中…", "ok");
    try {
      // imageOrientation: EXIF 轉向直接交給瀏覽器處理, 直幅照片才不會躺著。
      const next = await PMImage.decodeBitmap(file, { imageOrientation: "from-image" });
      bitmap?.close?.();
      bitmap = next;
      sourceName = safeName(file.name);

      let info = null;
      try { info = (await PMExif.extractExif(file, { wantThumb: false })).info; }
      catch { info = null; }
      applyExif(info);
      state.set(info ? `${bitmap.width}×${bitmap.height}` : `${bitmap.width}×${bitmap.height} · 無 EXIF`,
        info ? "ok" : "warn");
      paint();
    } catch (err) {
      console.error(err);
      state.set(`讀取失敗: ${err.message}`, "error");
    }
  }

  function applyExif(info) {
    const next = fieldsFromExif(info);
    o.model = next.model;
    o.date = next.date;
    o.brand = next.brand;
    o.params = next.params;
    modelInput.value = o.model;
    dateInput.value = o.date;
    brandInput.value = o.brand;
    paramsInput.value = o.params;
  }

  const picker = photoPicker({ onPick: (file) => loadFile(file) });
  picker.attach(canvasWrap);

  /* ---------- 相框設定 ---------- */
  const modeTabs = segmented(MODES, {
    value: o.mode,
    onChange: (value) => {
      o.mode = value;
      o.pad = MODE_PAD[value] ?? 0;
      padField.set(Math.round(o.pad * 1000) / 10);
      paint();
    },
  });

  const padField = rangeField("邊框寬度", {
    min: 0, max: 12, step: 0.5, value: o.pad * 100,
    format: (v) => `${v}%`,
    onInput: (v) => { o.pad = v / 100; paint(); },
  });

  const barField = rangeField("資訊列高度", {
    min: 0.5, max: 2.2, step: 0.05, value: o.barScale,
    format: (v) => `${v.toFixed(2)}×`,
    onInput: (v) => { o.barScale = v; paint(); },
  });

  const fontField = rangeField("字級", {
    min: 0.6, max: 1.6, step: 0.05, value: o.fontScale,
    format: (v) => `${v.toFixed(2)}×`,
    onInput: (v) => { o.fontScale = v; paint(); },
  });

  const radiusField = rangeField("外框圓角", {
    min: 0, max: 6, step: 0.5, value: o.radius * 100,
    format: (v) => `${v}%`,
    onInput: (v) => { o.radius = v / 100; paint(); },
  });

  const photoRadiusField = rangeField("照片圓角", {
    min: 0, max: 6, step: 0.5, value: o.photoRadius * 100,
    format: (v) => `${v}%`,
    onInput: (v) => { o.photoRadius = v / 100; paint(); },
  });

  /* ---------- 顏色 ---------- */
  const textColorInput = colorInput({ value: o.textColor, onInput: (v) => { o.textColor = v; paint(); } });
  const subColorInput = colorInput({ value: o.subColor, onInput: (v) => { o.subColor = v; paint(); } });
  const accentInput = colorInput({ value: o.accent, onInput: (v) => { o.accent = v; paint(); } });

  /** 底色換成深色時, 文字要跟著翻白, 不然什麼都看不到。 */
  function autoTextColors() {
    const dark = luminance(o.bg) < 0.45;
    o.textColor = dark ? "#ffffff" : "#121212";
    o.subColor = dark ? "#b4b4b4" : "#8a8a8a";
    o.accent = o.textColor;
    textColorInput.set(o.textColor);
    subColorInput.set(o.subColor);
    accentInput.set(o.accent);
  }

  const autoColorFlag = flag("自動", {
    checked: true,
    onChange: (on) => { if (on) { autoTextColors(); paint(); } },
  });

  const bgInput = colorInput({
    value: o.bg,
    onInput: (v) => {
      o.bg = v;
      if (autoColorFlag.input.checked) autoTextColors();
      paint();
    },
  });

  const bgPresets = el("div", { class: "ctl-row frame-swatches" },
    ...["#ffffff", "#f5f1e8", "#121212", "#1c1f26"].map((hex) => el("button", {
      type: "button", class: "frame-swatch", style: `background:${hex}`, title: hex,
      onclick: () => {
        o.bg = hex;
        bgInput.set(hex);
        if (autoColorFlag.input.checked) autoTextColors();
        paint();
      },
    })),
  );

  /* ---------- 文字 ---------- */
  const modelInput = textInput({ placeholder: "X-T4", onInput: (e) => { o.model = e.target.value; paint(); } });
  const dateInput = textInput({ placeholder: "2024-05-16 12:33", onInput: (e) => { o.date = e.target.value; paint(); } });
  const brandInput = textInput({ placeholder: "FUJIFILM", onInput: (e) => { o.brand = e.target.value; paint(); } });
  const paramsInput = textInput({
    placeholder: "53mm f/3.2 1/5800s ISO640",
    onInput: (e) => { o.params = e.target.value; paint(); },
  });
  const titleInput = textInput({
    placeholder: "上下框樣式才會用到",
    onInput: (e) => { o.title = e.target.value; paint(); },
  });

  /* ---------- 品牌 logo ---------- */
  const logoInput = el("input", {
    type: "file", accept: "image/*,.heic,.heif", class: "picker-file",
  });
  logoInput.addEventListener("change", async () => {
    const file = logoInput.files[0];
    logoInput.value = "";
    if (!file) return;
    try {
      logo?.close?.();
      logo = await PMImage.decodeBitmap(file);
      logoBtn.textContent = "更換";
      logoClear.hidden = false;
      paint();
    } catch (err) {
      notify.danger(`讀取失敗: ${err.message}`);
    }
  });
  const logoBtn = button("上傳", { onClick: () => logoInput.click(), iconName: "upload" });
  const logoClear = button("移除", {
    onClick: () => {
      logo?.close?.();
      logo = null;
      logoBtn.textContent = "上傳";
      logoClear.hidden = true;
      paint();
    },
  });
  logoClear.hidden = true;

  /* ---------- 匯出 ---------- */
  const formatSelect = select({
    value: "image/jpeg",
    options: [
      { value: "image/jpeg", label: "JPEG" },
      { value: "image/png", label: "PNG" },
    ],
  });
  const qualityField = rangeField("JPEG 品質", {
    min: 60, max: 100, step: 1, value: 92,
    format: (v) => `${v}%`,
  });
  const scaleSelect = select({
    value: "1",
    options: [
      { value: "1", label: "原尺寸" },
      { value: "0.75", label: "75%" },
      { value: "0.5", label: "50%" },
      { value: "0.25", label: "25%" },
    ],
  });

  const downloadBtn = button("下載", {
    variant: "primary",
    iconName: "download",
    onClick: async () => {
      if (!bitmap) { notify.warning("還沒有照片"); return; }
      const scale = Number(scaleSelect.value) || 1;
      const type = formatSelect.value;
      const quality = Number(qualityField.input.value) / 100;
      state.set("輸出中…", "ok");
      try {
        const canvas = renderFrame(bitmap, o, Math.round(bitmap.width * scale), logo);
        const blob = await new Promise((resolve, reject) => {
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("輸出失敗"))), type, quality);
        });
        saveBlob(blob, `${sourceName}_frame.${type === "image/png" ? "png" : "jpg"}`);
        state.set(`已輸出 ${canvas.width}×${canvas.height}`, "ok");
      } catch (err) {
        console.error(err);
        state.set(`輸出失敗: ${err.message}`, "error");
      }
    },
  });

  /* ---------- 組裝: 左邊照片、右邊設定 ---------- */
  const side = el("div", { class: "tool-side" },
    canvasWrap,
    picker,
    el("div", { class: "tool-preview-meta" }, state),
    actions(downloadBtn),
  );

  const controls = el("div", { class: "tool-controls" },
    subhead("相框"),
    row(
      field("樣式", modeTabs),
      field("文字", segmented(
        [{ value: "split", label: "左右" }, { value: "center", label: "置中" }],
        { value: o.align, onChange: (v) => { o.align = v; paint(); } },
      )),
    ),
    row(padField, barField),
    row(fontField, radiusField, photoRadiusField),
    row(field("開關", el("div", { class: "ctl-row" },
      flag("資訊列", { checked: o.showBar, onChange: (on) => { o.showBar = on; paint(); } }),
      flag("分隔線", { checked: o.separator, onChange: (on) => { o.separator = on; paint(); } }),
      flag("陰影", { checked: o.shadow, onChange: (on) => { o.shadow = on; paint(); } }),
    ))),

    subhead("顏色"),
    row(
      field("底色", bgInput),
      field("常用", bgPresets),
      field("自動配色", el("div", { class: "ctl-row" }, autoColorFlag)),
    ),
    row(
      field("主要文字", textColorInput),
      field("次要文字", subColorInput),
      field("品牌", accentInput),
    ),
    row(
      field("字體", select({
        value: o.font,
        options: [{ value: "sans", label: "無襯線" }, { value: "mono", label: "等寬" }],
        onChange: (e) => { o.font = e.target.value; paint(); },
      })),
      field("品牌圖", el("div", { class: "ctl-row" }, logoBtn, logoClear, logoInput)),
    ),

    subhead("文字"),
    row(
      field("型號", modelInput),
      field("時間", dateInput),
    ),
    row(
      field("品牌", brandInput),
      field("參數", paramsInput),
    ),
    row(field("標題", titleInput)),

    subhead("匯出"),
    row(
      field("格式", formatSelect),
      field("尺寸", scaleSelect),
    ),
    row(qualityField),
  );

  host.appendChild(panel(
    el("div", { class: "tool-board" },
      el("div", { class: "tool-shell" }, side, controls)),
  ));

  const unstick = stickyTop(host);
  // 從整理分類／其他編輯工具延續目前選取的資料庫照片。
  picker.restoreCurrent();

  return () => {
    disposed = true;
    unstick();
    if (frameId) clearTimeout(frameId);
    bitmap?.close?.();
    logo?.close?.();
  };
}
