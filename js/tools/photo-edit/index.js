// js/tools/photo-edit/index.js — 裁切與旋轉。
//
// 拉框裁切、拉桿轉正, 上面可以疊九宮格、黃金比例、黃金螺旋等構圖格線。
// 格線只畫在畫面上, 不會進到輸出的檔案裡。
//
// 照片不會離開這台電腦: 解碼與輸出都在 canvas 上做完, 沒有任何上傳。

import {
  panel, row, field, select, segmented, button, actions,
  status, subhead, rangeField, flag, colorInput, stickyTop, el,
} from "../kit.js";
import { notify } from "../../ui/notifications.js";
import { photoPicker } from "../../app/photo-picker.js";
import { GUIDES, DIRECTIONAL, guideSvg } from "./guides.js";
import {
  ASPECTS, rotatedSize, largestInnerRect, renderWork, cropCanvas, fitCrop,
} from "./transform.js";

export const meta = { title: "裁切旋轉" };
export const styles = new URL("./photo-edit.css", import.meta.url).href;

/** 預覽用的工作畫布長邊。夠看細節, 又不會每拉一下都重畫一張原尺寸。 */
const PREVIEW_EDGE = 1400;
const MIN_PX = 28;

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

export async function mount(host) {
  const o = {
    rotate: 0,        // = turn + fine, 實際拿去轉的角度
    turn: 0,          // 90 度的整轉
    fine: 0,          // -45~45 的微調
    flipH: false,
    flipV: false,
    bg: "#000000",
    transparent: false,
    aspect: "free",
    portrait: false,
    guide: "thirds",
    variant: 0,
    autoInner: true,
  };
  let bitmap = null;
  let work = null;                                   // 預覽用的工作畫布
  let crop = { x: 0, y: 0, w: 1, h: 1 };             // 0~1, 相對於工作畫布
  let sourceName = "photo";
  let disposed = false;

  /* ============================================================
     畫面
     ============================================================ */
  const canvas = el("canvas", { class: "edit-canvas" });
  const guideSvgNode = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  guideSvgNode.setAttribute("class", "crop-guides");
  const cropBox = el("div", { class: "crop-box" });
  cropBox.appendChild(guideSvgNode);
  for (const dir of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
    cropBox.appendChild(el("div", { class: `crop-handle h-${dir}`, dataset: { dir } }));
  }
  const overlay = el("div", { class: "edit-overlay" }, cropBox);
  const frame = el("div", { class: "edit-frame" }, canvas, overlay);
  // 照片區的大小固定, 有沒有照片、照片是直是橫都不會改變整個框。
  const stage = el("div", { class: "tool-stage" },
    el("p", { class: "tool-placeholder edit-placeholder" }, "選擇照片"));
  const state = status();
  const sizeOut = el("div", { class: "edit-size" });

  /* ---------- 比例 ---------- */
  function aspectValue() {
    if (o.aspect === "free") return null;
    if (o.aspect === "source") {
      if (!bitmap) return null;
      const r = bitmap.width / bitmap.height;
      return o.portrait ? 1 / r : r;
    }
    const r = Number(o.aspect);
    if (!r) return null;
    return o.portrait ? 1 / r : r;
  }

  /** 旋轉後仍完全在照片裡的那塊（0~1）, 用來避開四角的留白。 */
  function innerBox() {
    if (!bitmap || !work) return { x: 0, y: 0, w: 1, h: 1 };
    const outer = rotatedSize(bitmap.width, bitmap.height, o.rotate);
    const inner = largestInnerRect(bitmap.width, bitmap.height, o.rotate);
    const w = clamp(inner.w / outer.w, 0.05, 1);
    const h = clamp(inner.h / outer.h, 0.05, 1);
    return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
  }

  /** 把裁切框收進「不含留白」的範圍裡。 */
  function snapInside() {
    if (!work) return;
    crop = fitCrop(work.width, work.height, aspectValue(), innerBox());
  }

  function resetCrop() {
    if (!work) return;
    const limit = o.autoInner ? innerBox() : null;
    crop = fitCrop(work.width, work.height, aspectValue(), limit);
    paintCrop();
  }

  /**
   * 工作畫布換尺寸之後要重接一次裁切框。
   * 裁切框存的是 0~1 的比例, 一旦畫布的長寬比變了（轉了一點角度就會）,
   * 同一組比例對應到的實際形狀就跟著變 —— 鎖死的比例會偷偷跑掉。
   */
  function refitCrop() {
    if (!work) return;
    if (o.autoInner) { snapInside(); return; }
    const aspect = aspectValue();
    if (!aspect) return;
    const cx = crop.x + crop.w / 2;
    const cy = crop.y + crop.h / 2;
    let wpx = crop.w * work.width;
    let hpx = wpx / aspect;
    if (hpx > work.height) { hpx = work.height; wpx = hpx * aspect; }
    if (wpx > work.width) { wpx = work.width; hpx = wpx / aspect; }
    const w = wpx / work.width;
    const h = hpx / work.height;
    crop = { w, h, x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h) };
  }

  /* ---------- 重畫 ---------- */
  // 用 setTimeout 而不是 requestAnimationFrame 收斂連續的操作:
  // rAF 在分頁被切到背景時完全不會跑, 回到前景就會看到一張沒跟上設定的預覽。
  let workId = 0;
  function rebuildWork() {
    if (!bitmap) return;
    if (workId) return;
    workId = setTimeout(() => {
      workId = 0;
      if (disposed || !bitmap) return;
      work = renderWork(bitmap, o, Math.min(PREVIEW_EDGE, Math.max(bitmap.width, bitmap.height)));
      showWork();
      refitCrop();
      paintCrop();
    }, 16);
  }

  /**
   * 外框的大小 = 照片整張縮進照片區之後的大小, 直接用像素算出來。
   *
   * 這裡不用 CSS 的百分比上限: 照片區的高度是 grid 分配的（height: auto）,
   * 對 auto 高度的父層來說 max-height: 100% 等於沒設, 直幅照片就會頂出去。
   * 自己算一次反而單純, 而且外框永遠剛好等於照片 —— 疊在上面的裁切層
   * 才能用 inset: 0 精準對齊。
   */
  function fitFrame() {
    if (!work) return;
    const cs = getComputedStyle(stage);
    const availW = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availH = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (!(availW > 0 && availH > 0)) return;
    const scale = Math.min(availW / work.width, availH / work.height);
    frame.style.width = `${Math.floor(work.width * scale)}px`;
    frame.style.height = `${Math.floor(work.height * scale)}px`;
  }

  /** 把工作畫布搬上畫面。 */
  function showWork() {
    if (!work) return;
    canvas.width = work.width;
    canvas.height = work.height;
    canvas.getContext("2d").drawImage(work, 0, 0);
    fitFrame();
  }

  function paintCrop() {
    // 鎖了比例就只留四個角: 拉邊在鎖比例下沒有直覺的行為。
    cropBox.classList.toggle("is-locked", !!aspectValue());
    cropBox.style.left = `${crop.x * 100}%`;
    cropBox.style.top = `${crop.y * 100}%`;
    cropBox.style.width = `${crop.w * 100}%`;
    cropBox.style.height = `${crop.h * 100}%`;
    paintGuides();
    paintSize();
  }

  function paintGuides() {
    const rect = cropBox.getBoundingClientRect();
    guideSvgNode.setAttribute("viewBox", `0 0 ${rect.width || 1} ${rect.height || 1}`);
    guideSvgNode.innerHTML = guideSvg(o.guide, rect.width, rect.height, o.variant);
  }

  /** 右下角的輸出尺寸: 直接用原尺寸的工作畫布算, 不是預覽的那張。 */
  function paintSize() {
    if (!bitmap) { sizeOut.textContent = ""; return; }
    const outer = rotatedSize(bitmap.width, bitmap.height, o.rotate);
    const w = Math.round(crop.w * outer.w);
    const h = Math.round(crop.h * outer.h);
    const ratio = h ? (w / h).toFixed(3) : "—";
    sizeOut.textContent = `輸出 ${w} × ${h} px · 比例 ${ratio}`;
  }

  /* ============================================================
     拖曳裁切框
     ============================================================ */
  function beginDrag(e) {
    if (!work) return;
    const dir = e.target.dataset?.dir || null;
    const rect = overlay.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const base = { ...crop };
    const startX = e.clientX;
    const startY = e.clientY;
    const aspect = aspectValue();
    e.preventDefault();
    e.target.setPointerCapture?.(e.pointerId);

    const move = (ev) => {
      const dx = (ev.clientX - startX) / rect.width;
      const dy = (ev.clientY - startY) / rect.height;
      crop = dir
        ? resizeCrop(dir, dx, dy, base, aspect, rect.width, rect.height)
        : moveCrop(dx, dy, base);
      paintCrop();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function moveCrop(dx, dy, base) {
    return {
      x: clamp(base.x + dx, 0, 1 - base.w),
      y: clamp(base.y + dy, 0, 1 - base.h),
      w: base.w,
      h: base.h,
    };
  }

  /**
   * 拉邊 / 拉角。比例鎖上時只留四個角（邊上的把手會收起來）,
   * 對角固定不動, 另一邊跟著比例走, 撞到邊界就整塊縮小而不是變形。
   */
  function resizeCrop(dir, dxN, dyN, base, aspect, pxW, pxH) {
    const west = dir.includes("w");
    const east = dir.includes("e");
    const north = dir.includes("n");
    const south = dir.includes("s");

    let L = base.x * pxW;
    let T = base.y * pxH;
    let R = (base.x + base.w) * pxW;
    let B = (base.y + base.h) * pxH;
    const dx = dxN * pxW;
    const dy = dyN * pxH;

    if (aspect) {
      // 對角當錨點, 寬度說了算, 高度跟著比例。
      const ax = west ? R : L;
      const ay = north ? B : T;
      const px = clamp((west ? L : R) + dx, 0, pxW);
      let w = Math.abs(px - ax);
      const maxW = west ? ax : pxW - ax;
      const maxH = north ? ay : pxH - ay;
      w = clamp(w, MIN_PX, Math.min(maxW, maxH * aspect));
      const h = w / aspect;
      L = west ? ax - w : ax;
      R = west ? ax : ax + w;
      T = north ? ay - h : ay;
      B = north ? ay : ay + h;
    } else {
      if (west) L = clamp(L + dx, 0, R - MIN_PX);
      if (east) R = clamp(R + dx, L + MIN_PX, pxW);
      if (north) T = clamp(T + dy, 0, B - MIN_PX);
      if (south) B = clamp(B + dy, T + MIN_PX, pxH);
    }

    return { x: L / pxW, y: T / pxH, w: (R - L) / pxW, h: (B - T) / pxH };
  }

  cropBox.addEventListener("pointerdown", beginDrag);

  /* ============================================================
     讀圖
     ============================================================ */
  async function loadFile(file) {
    state.set("讀取中…", "ok");
    try {
      const next = await PMImage.decodeBitmap(file, { imageOrientation: "from-image" });
      bitmap?.close?.();
      bitmap = next;
      sourceName = safeName(file.name);
      o.rotate = 0;
      o.turn = 0;
      o.fine = 0;
      rotateField.set(0);
      stage.replaceChildren(frame);
      work = renderWork(bitmap, o, Math.min(PREVIEW_EDGE, Math.max(bitmap.width, bitmap.height)));
      showWork();
      resetCrop();
      state.set(`${bitmap.width}×${bitmap.height}`, "ok");
    } catch (err) {
      console.error(err);
      state.set(`讀取失敗: ${err.message}`, "error");
    }
  }

  const picker = photoPicker({ onPick: (file) => loadFile(file) });
  picker.attach(stage);

  /* ============================================================
     控制項
     ============================================================ */
  const rotateField = rangeField("旋轉微調", {
    min: -45, max: 45, step: 0.1, value: 0,
    format: (v) => `${v.toFixed(1)}°`,
    onInput: (v) => {
      o.fine = v;
      o.rotate = o.turn + o.fine;
      // 轉完才知道新的工作畫布多大, 裁切框由 rebuildWork() 收尾。
      rebuildWork();
    },
  });

  /** 90 度整轉與微調分開記, 轉完 90 度滑桿還是停在原本的微調值。 */
  function turn(delta) {
    o.turn = (((o.turn + delta) % 360) + 360) % 360;
    o.rotate = o.turn + o.fine;
    rebuildWork();
    resetCrop();
  }

  const guideSelect = select({
    value: o.guide,
    options: GUIDES,
    onChange: (e) => {
      o.guide = e.target.value;
      variantBtn.disabled = !DIRECTIONAL.has(o.guide);
      paintGuides();
    },
  });

  const variantBtn = button("換方向", {
    iconName: "rotate",
    onClick: () => { o.variant = (o.variant + 1) % 4; paintGuides(); },
  });

  const aspectSelect = select({
    value: o.aspect,
    options: ASPECTS,
    onChange: (e) => { o.aspect = e.target.value; resetCrop(); },
  });

  const portraitTabs = segmented(
    [{ value: "landscape", label: "橫" }, { value: "portrait", label: "直" }],
    { value: "landscape", onChange: (v) => { o.portrait = v === "portrait"; resetCrop(); } },
  );

  const autoInnerFlag = flag("自動避開留白", {
    checked: o.autoInner,
    onChange: (on) => { o.autoInner = on; if (on) resetCrop(); },
  });

  const bgColor = colorInput({ value: o.bg, onInput: (v) => { o.bg = v; rebuildWork(); } });

  const formatSelect = select({
    value: "image/jpeg",
    options: [
      { value: "image/jpeg", label: "JPEG" },
      { value: "image/png", label: "PNG" },
    ],
    onChange: (e) => {
      transparentFlag.input.disabled = e.target.value !== "image/png";
      if (e.target.value !== "image/png" && transparentFlag.input.checked) {
        transparentFlag.input.checked = false;
        o.transparent = false;
        rebuildWork();
      }
    },
  });

  const transparentFlag = flag("留白透明", {
    checked: false,
    onChange: (on) => { o.transparent = on; rebuildWork(); },
  });
  transparentFlag.input.disabled = true;

  const qualityField = rangeField("JPEG 品質", {
    min: 60, max: 100, step: 1, value: 92, format: (v) => `${v}%`,
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
      const type = formatSelect.value;
      const quality = Number(qualityField.input.value) / 100;
      const scale = Number(scaleSelect.value) || 1;
      state.set("輸出中…", "ok");
      try {
        const outer = rotatedSize(bitmap.width, bitmap.height, o.rotate);
        const full = renderWork(bitmap, o, Math.round(Math.max(outer.w, outer.h) * scale));
        const out = cropCanvas(full, crop);
        const blob = await new Promise((resolve, reject) => {
          out.toBlob((b) => (b ? resolve(b) : reject(new Error("輸出失敗"))), type, quality);
        });
        saveBlob(blob, `${sourceName}_crop.${type === "image/png" ? "png" : "jpg"}`);
        state.set(`已輸出 ${out.width}×${out.height}`, "ok");
      } catch (err) {
        console.error(err);
        state.set(`輸出失敗: ${err.message}`, "error");
      }
    },
  });

  /* ============================================================
     組裝
     ============================================================ */
  const side = el("div", { class: "tool-side" },
    stage,
    picker,
    el("div", { class: "tool-preview-meta edit-foot" }, state, sizeOut),
    actions(downloadBtn),
  );

  const controls = el("div", { class: "tool-controls" },
    subhead("旋轉"),
    row(rotateField),
    row(
      field("整圈", el("div", { class: "ctl-row" },
        button("", { iconName: "rotate-left", title: "向左 90°", onClick: () => turn(-90) }),
        button("", { iconName: "rotate-right", title: "向右 90°", onClick: () => turn(90) }),
        button("重設", {
          title: "角度歸零",
          onClick: () => {
            o.turn = 0; o.fine = 0; o.rotate = 0;
            rotateField.set(0);
            rebuildWork();
            resetCrop();
          },
        }),
      )),
      field("翻轉", el("div", { class: "ctl-row" },
        flag("水平翻轉", {
          iconName: "flip-h", checked: false,
          onChange: (on) => { o.flipH = on; rebuildWork(); },
        }),
        flag("垂直翻轉", {
          iconName: "flip-v", checked: false,
          onChange: (on) => { o.flipV = on; rebuildWork(); },
        }),
      )),
    ),

    subhead("裁切"),
    row(
      field("比例", aspectSelect),
      field("方向", portraitTabs),
    ),
    row(
      field("裁切框", el("div", { class: "ctl-row" },
        button("填滿", { onClick: () => { o.autoInner = false; autoInnerFlag.input.checked = false; resetCrop(); } }),
        button("貼齊照片", { onClick: () => { snapInside(); paintCrop(); } }),
      )),
      field("留白", el("div", { class: "ctl-row" }, autoInnerFlag)),
      field("底色", bgColor),
    ),

    subhead("格線"),
    row(
      field("格線", guideSelect),
      field("方向", el("div", { class: "ctl-row" }, variantBtn)),
    ),

    subhead("匯出"),
    row(
      field("格式", formatSelect),
      field("尺寸", scaleSelect),
      field("透明", el("div", { class: "ctl-row" }, transparentFlag)),
    ),
    row(qualityField),
  );

  host.appendChild(panel(
    el("div", { class: "tool-board" },
      el("div", { class: "tool-shell" }, side, controls)),
  ));

  variantBtn.disabled = !DIRECTIONAL.has(o.guide);

  const unstick = stickyTop(host);
  // 照片區的大小會跟著視窗與側邊欄變。裁切框是用百分比定位的不會跑掉,
  // 但外框要重新量一次, 格線也要照新的像素尺寸重畫。
  const ro = new ResizeObserver(() => { fitFrame(); paintGuides(); });
  ro.observe(stage);
  ro.observe(overlay);
  // 從整理分類／其他編輯工具延續目前選取的資料庫照片。
  picker.restoreCurrent();

  return () => {
    disposed = true;
    unstick();
    if (workId) clearTimeout(workId);
    ro.disconnect();
    bitmap?.close?.();
  };
}
