// js/tools/palette-card/index.js — 照片色卡明信片。
//
// 丟一張照片進來, 取出它的代表色, 排成一張可以存下來的明信片。
//
// 照片不會離開這台電腦: 從 File 直接解碼成 ImageBitmap, 畫在 canvas 上,
// 存檔也是 canvas.toBlob。沒有任何上傳。
//
// 卡片是直接操作的: 拖色卡面板換位置、拖照片調構圖。吸附線畫在另一張疊在
// 上面的 canvas, 不會進到匯出的圖裡 —— 匯出的永遠只有卡片本身。

import {
  panel, row, field, textInput, select, segmented, button, actions,
  status, subhead, copyButton, el,
} from "../kit.js";
import { notify } from "../../ui/notifications.js";
import { photoPicker } from "../../app/photo-picker.js";
import { copyText } from "../../utils/clipboard.js";
import { extractPalette } from "./palette.js";
import { renderCard, geometry, photoSlack, snapPanel, SIZES, LAYOUTS, parseSize } from "./card.js";

export const meta = { title: "照片色卡" };
export const styles = new URL("./palette-card.css", import.meta.url).href;

/** 取色用的縮圖邊長。再大對結果沒有幫助, 只是白算。 */
const SAMPLE_EDGE = 160;
/** 照片先縮到這個長邊再拿去畫。手機拍的原圖動輒四千像素, 存著只是佔記憶體。 */
const PHOTO_EDGE = 2400;

const COUNTS = [4, 5, 6, 8];
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

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
  String(name || "palette").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "-").trim() || "palette";

/** 縮到長邊不超過 maxEdge。回傳的可能是 canvas, drawImage 一樣吃。 */
function fit(bitmap, maxEdge) {
  const longest = Math.max(bitmap.width, bitmap.height);
  if (longest <= maxEdge) return bitmap;
  const scale = maxEdge / longest;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas;
}

/** 取色只需要一張縮圖的像素。存起來, 之後改顏色數量就不必重新解碼照片。 */
function sampleOf(image) {
  const longest = Math.max(image.width, image.height);
  const scale = Math.min(1, SAMPLE_EDGE / longest);
  const w = Math.max(1, Math.round(image.width * scale));
  const h = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  // 關掉平滑, 縮圖就是直接抽樣原圖的像素。開著的話邊界會被內插出原圖裡
  // 根本不存在的顏色 —— 紅色物件疊在藍色背景上會生出一圈紫色, 然後這個
  // 工具就會告訴你「這張照片的代表色有紫色」。
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

async function decode(file) {
  return PMImage.decodeBitmap(file, { imageOrientation: "from-image" });
}

export function mount(host) {
  const state = {
    image: null,
    sample: null,
    fileName: "",
    colors: [],
    layout: "glass",
    size: SIZES[0],
    count: 6,
    snap: false,
    background: "auto",
    title: "",
    subtitle: "",
    /** 面板中心在卡片裡的相對位置。null = 還沒拖過, 用預設的靠下置中。 */
    panel: null,
    /** 照片平移, 每軸 -1…1, 相對於 cover 溢出的那一半。 */
    pan: { x: 0, y: 0 },
    /** 照片縮放, 1 = 剛好填滿。平移存的是比例, 所以放大時構圖不會跳掉。 */
    zoom: 1,
  };

  let timer = null;
  let disposed = false;
  let drag = null;
  /** 同時按著的指頭。兩根就是縮放, 一根是拖曳。 */
  const pointers = new Map();
  let pinch = null;

  /* ---------------- 介面 ---------------- */

  const canvas = el("canvas", { class: "pc-canvas" });
  const guideLayer = el("canvas", { class: "pc-guides" });
  // 照片區的大小固定: 有沒有照片、卡片是直是橫, 整個框都不會變大變小。
  const frame = el("div", { class: "pc-frame", hidden: true }, canvas, guideLayer);
  const stage = el("div", { class: "tool-stage" },
    el("p", { class: "tool-placeholder pc-placeholder" }, "選擇照片"));
  const picker = photoPicker({ onPick: (file) => load(file) });
  picker.attach(stage);

  const chips = el("div", { class: "pc-chips" });
  const stat = status();

  const layoutPicker = segmented(LAYOUTS, {
    value: state.layout,
    onChange: (value) => { state.layout = value; schedule(); },
  });
  const sizePicker = select({
    options: SIZES.map((s) => ({ value: s.value, label: s.label })),
    value: state.size.value,
    onChange: (e) => { state.size = parseSize(e.target.value); schedule(); },
  });
  const countPicker = select({
    options: COUNTS.map((n) => ({ value: String(n), label: `${n} 色` })),
    value: String(state.count),
    onChange: (e) => { state.count = Number(e.target.value); recolor(); },
  });
  const snapPicker = segmented(
    [{ value: "raw", label: "原色" }, { value: "snap", label: "整齊色碼" }],
    { value: "raw", onChange: (value) => { state.snap = value === "snap"; recolor(); } },
  );
  const bgPicker = segmented(
    [
      { value: "auto", label: "自動" },
      { value: "light", label: "淺" },
      { value: "dark", label: "深" },
      { value: "none", label: "無" },
    ],
    { value: state.background, onChange: (value) => { state.background = value; schedule(); } },
  );
  bgPicker.classList.add("pc-background-picker");
  const titleInput = textInput({
    placeholder: "Title",
    onInput: (e) => { state.title = e.target.value; schedule(); },
  });
  const subtitleInput = textInput({
    placeholder: "Subtitle",
    onInput: (e) => { state.subtitle = e.target.value; schedule(); },
  });

  const toolbar = actions(
    copyButton(() => state.colors.map((c) => c.hex).join("\n"), { label: "複製色碼" }),
    button("重設位置", { onClick: resetPlacement }),
    button("下載 PNG", { variant: "primary", iconName: "check", onClick: save }),
  );

  // 左邊是結果, 右邊是控制項。預覽會釘在上面, 所以改任何一個設定都看得到
  // 它對卡片做了什麼, 不必上下捲。
  const previewCol = el("div", { class: "tool-side" },
    stage,
    picker,
    el("div", { class: "tool-preview-meta pc-meta" }, chips, stat),
    toolbar,
  );
  const controlsCol = el("div", { class: "tool-controls" },
    subhead("版型"),
    layoutPicker,
    row(
      field("尺寸", sizePicker),
      field("顏色數量", countPicker),
    ),
    row(
      field("色碼", snapPicker),
      field("底色", bgPicker),
    ),
    row(
      field("標題", titleInput),
      field("副標", subtitleInput),
    ),
  );

  host.appendChild(panel(
    el("div", { class: "tool-board" },
      el("div", { class: "tool-shell" }, previewCol, controlsCol)),
  ));

  /* ---------------- 繪製 ---------------- */

  function schedule() {
    if (disposed) return;
    // 用 setTimeout 而不是 rAF: 分頁在背景時 rAF 不會跑, 使用者切回來會看到
    // 一張還沒更新的卡片。
    if (timer) clearTimeout(timer);
    timer = setTimeout(paint, 50);
  }

  /**
   * 兩張 canvas 的像素尺寸必須一樣, 版面才會把它們算成同一個大小、疊在一起。
   * 只在畫吸附線的時候才同步是不夠的 —— 那之前吸附線那張還是預設的 300x150,
   * 比例不對, 會以一個矮胖的形狀壓在卡片上面。
   */
  function syncGuideSize() {
    if (guideLayer.width === canvas.width && guideLayer.height === canvas.height) return;
    guideLayer.width = canvas.width;
    guideLayer.height = canvas.height;
  }

  function paint() {
    timer = null;
    if (disposed || !state.image) return;
    try {
      renderCard(canvas, state);
      syncGuideSize();
    } catch (err) {
      console.error(err);
      stat.set(`畫不出來: ${err.message}`, "error");
    }
  }

  /**
   * 吸附參考線。
   *
   * 畫在疊在上面的另一張 canvas, 不是卡片本身 —— 卡片那張要保持「看到的就是
   * 存下來的」, 參考線混進去的話, 拖曳中按下載就會把輔助線一起存出去。
   */
  function paintGuides(hits) {
    syncGuideSize();
    const ctx = guideLayer.getContext("2d");
    ctx.clearRect(0, 0, guideLayer.width, guideLayer.height);
    if (!hits?.length) return;

    const { card, W } = geometry(state);
    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
    ctx.lineWidth = Math.max(2, W * 0.003);
    ctx.setLineDash([W * 0.014, W * 0.012]);
    ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
    ctx.shadowBlur = W * 0.006;
    for (const hit of hits) {
      ctx.beginPath();
      if (hit.axis === "x") {
        ctx.moveTo(hit.at, card.y);
        ctx.lineTo(hit.at, card.y + card.h);
      } else {
        ctx.moveTo(card.x, hit.at);
        ctx.lineTo(card.x + card.w, hit.at);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function paintChips() {
    chips.replaceChildren(...state.colors.map((color) => {
      const node = el("button", {
        type: "button",
        class: "pc-chip",
        title: `複製 ${color.hex}`,
        onclick: async () => {
          if (await copyText(color.hex)) notify.success(`已複製 ${color.hex}`);
          else notify.danger("複製失敗, 請手動選取。");
        },
      },
      el("span", { class: "pc-chip-dot" }),
      el("span", { class: "pc-chip-hex" }, color.hex),
      );
      node.querySelector(".pc-chip-dot").style.background = color.hex;
      return node;
    }));
  }

  function recolor() {
    if (!state.sample) return;
    state.colors = extractPalette(state.sample, { count: state.count, snap: state.snap });
    paintChips();
    if (state.colors.length < state.count) {
      stat.set(`只挑得出 ${state.colors.length} 色`, "warn");
    } else {
      stat.set("");
    }
    schedule();
  }

  function resetPlacement() {
    state.panel = null;
    state.pan = { x: 0, y: 0 };
    state.zoom = 1;
    paintGuides([]);
    paint();
  }

  async function load(file) {
    if (!file) return;
    // 只看 file.type 會把資料夾裡的 .heic 擋掉（那邊常常沒有 MIME）, 所以走共用的判斷。
    if (!PMImage.isImageFile(file)) {
      stat.set("不是圖片檔", "error");
      return;
    }
    stat.set("讀取中…");
    try {
      const bitmap = await decode(file);
      if (disposed) { bitmap.close?.(); return; }
      state.image = fit(bitmap, PHOTO_EDGE);
      state.sample = sampleOf(state.image);
      state.fileName = file.name;
      // 換照片等於換構圖, 舊的平移與縮放對新的照片沒有意義。
      state.pan = { x: 0, y: 0 };
      state.zoom = 1;
      stage.replaceChildren(frame);
      frame.hidden = false;
      recolor();
    } catch (err) {
      console.error(err);
      stat.set(`讀取失敗: ${err.message}`, "error");
    }
  }

  async function save() {
    if (!state.image) { notify.warning("還沒有照片"); return; }
    // 存檔前先確定畫的是最新的狀態 —— 使用者可能在防抖動還沒到期時就按了。
    if (timer) { clearTimeout(timer); paint(); }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) { stat.set("匯出失敗", "error"); return; }
    saveBlob(blob, `${safeName(state.fileName)}-${state.layout}.png`);
    notify.success("已下載");
  }

  /* ---------------- 直接拖 ---------------- */

  /** 畫面座標 → 畫布座標。canvas 是被 CSS 縮小顯示的, 兩者不是 1:1。 */
  function toCanvas(event) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: 0, y: 0 };
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  const inside = (point, box) =>
    box && point.x >= box.x && point.x <= box.x + box.w
    && point.y >= box.y && point.y <= box.y + box.h;

  const spread = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const onPointerDown = (event) => {
    if (!state.image || (event.pointerType === "mouse" && event.button !== 0)) return;
    const point = toCanvas(event);
    pointers.set(event.pointerId, point);
    // 指標已經被放掉時會丟 NotFoundError, 捕捉失敗不影響拖曳本身。
    try { canvas.setPointerCapture(event.pointerId); } catch { /* 沒抓到就算了 */ }

    // 兩根指頭就是縮放, 這時候放掉單指的拖曳, 免得照片一邊縮一邊被拉走。
    if (pointers.size === 2) {
      drag = null;
      pinch = { spread: spread(), zoom: state.zoom };
      event.preventDefault();
      return;
    }
    const geo = geometry(state);
    if (inside(point, geo.panel)) {
      drag = {
        kind: "panel",
        from: point,
        card: geo.card,
        center: {
          x: (geo.panel.x + geo.panel.w / 2 - geo.card.x) / geo.card.w,
          y: (geo.panel.y + geo.panel.h / 2 - geo.card.y) / geo.card.h,
        },
      };
    } else {
      const slack = photoSlack(state);
      if (!slack.x && !slack.y) return;   // 照片剛好貼齊, 沒有可以拖的餘裕
      drag = { kind: "photo", from: point, pan: { ...state.pan }, slack };
    }
    canvas.classList.add("is-dragging");
    event.preventDefault();
  };

  const onPointerMove = (event) => {
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, toCanvas(event));

    if (pinch && pointers.size === 2) {
      const now = spread();
      if (pinch.spread > 0) {
        state.zoom = clamp(pinch.zoom * (now / pinch.spread), 1, 4);
        paint();
      }
      event.preventDefault();
      return;
    }

    if (!drag) {
      if (!state.image) return;
      const geo = geometry(state);
      canvas.classList.toggle("is-over-panel", inside(toCanvas(event), geo.panel));
      return;
    }
    const point = toCanvas(event);
    if (drag.kind === "panel") {
      const wanted = {
        x: drag.card.x + drag.center.x * drag.card.w + (point.x - drag.from.x),
        y: drag.card.y + drag.center.y * drag.card.h + (point.y - drag.from.y),
      };
      const { center, guides } = snapPanel(state, wanted);
      state.panel = center;
      paint();
      paintGuides(guides);
    } else {
      state.pan = {
        x: drag.slack.x ? clamp(drag.pan.x + (point.x - drag.from.x) / drag.slack.x, -1, 1) : 0,
        y: drag.slack.y ? clamp(drag.pan.y + (point.y - drag.from.y) / drag.slack.y, -1, 1) : 0,
      };
      paint();
    }
  };

  const onPointerUp = (event) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!drag) return;
    drag = null;
    canvas.classList.remove("is-dragging");
    try { canvas.releasePointerCapture?.(event.pointerId); } catch { /* 同上 */ }
    paintGuides([]);
    paint();
  };

  /**
   * 滾輪縮放。
   *
   * 這裡要 preventDefault 把頁面捲動吃掉 —— 滑鼠停在卡片上就是要操作卡片。
   * 所以監聽必須是 passive: false, 預設的 passive 監聽不能 preventDefault。
   */
  const onWheel = (event) => {
    if (!state.image) return;
    event.preventDefault();
    const step = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    const next = clamp(state.zoom * step, 1, 4);
    if (next === state.zoom) return;
    state.zoom = next;
    paint();
  };

  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("lostpointercapture", onPointerUp);

  /* ---------------- 拖放與貼上 ---------------- */

  const stopDefault = (event) => { event.preventDefault(); };
  const onDragOver = (event) => {
    if (!event.dataTransfer?.types?.includes("Files")) return;
    event.preventDefault();
    host.classList.add("is-dropping");
  };
  const onDragLeave = (event) => {
    if (event.relatedTarget && host.contains(event.relatedTarget)) return;
    host.classList.remove("is-dropping");
  };
  const onDrop = (event) => {
    if (event.defaultPrevented) return;
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    event.preventDefault();
    host.classList.remove("is-dropping");
    picker.take(file);
  };
  const onPaste = (event) => {
    const item = [...(event.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    if (!item) return;
    event.preventDefault();
    picker.take(item.getAsFile());
  };

  host.addEventListener("dragover", onDragOver);
  host.addEventListener("dragenter", stopDefault);
  host.addEventListener("dragleave", onDragLeave);
  host.addEventListener("drop", onDrop);
  document.addEventListener("paste", onPaste);

  /* ---------------- 字型 ---------------- */

  // 字還沒下載完就畫的話, canvas 會拿系統預設字頂替, 而且不會自己重畫。
  // 等字到齊再補一次。
  if (document.fonts) {
    Promise.all([
      document.fonts.load('700 40px "JetBrains Mono"'),
      document.fonts.load('700 40px "TASA Explorer"'),
      document.fonts.ready,
    ]).then(() => schedule()).catch(() => { /* 沒有就用備援字型, 不影響功能 */ });
  }

  // 從整理分類／其他編輯工具延續目前選取的資料庫照片。
  picker.restoreCurrent();

  return () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    host.removeEventListener("dragover", onDragOver);
    host.removeEventListener("dragenter", stopDefault);
    host.removeEventListener("dragleave", onDragLeave);
    host.removeEventListener("drop", onDrop);
    document.removeEventListener("paste", onPaste);
    state.image?.close?.();
  };
}
