// js/tools/exif-frame/frame.js — 相框的版面計算與繪製。
//
// 版面只認「照片要畫多寬」這一個尺寸, 其他（邊框、資訊列、字級）全部按比例算出來,
// 所以同一份設定用在畫面預覽（縮到 1400px）與匯出（原尺寸）會長得一模一樣。

export const MODES = [
  { value: "bottom", label: "下框" },
  { value: "top", label: "上框" },
  { value: "both", label: "上下框" },
  { value: "full", label: "全框" },
  { value: "polaroid", label: "拍立得" },
];

/** 切換樣式時順手換掉邊框寬度: 每種樣式的預設長相才會有差別。 */
export const MODE_PAD = { bottom: 0, top: 0, both: 0, full: 0.03, polaroid: 0.025 };

export const FONTS = {
  sans: '"IBM Plex Sans JP", "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, Consolas, monospace',
};

export const DEFAULTS = {
  mode: "bottom",
  pad: 0,             // 邊框寬度, 短邊的比例
  barScale: 1,        // 資訊列高度倍率
  showBar: true,
  align: "split",     // split | center
  bg: "#ffffff",
  textColor: "#121212",
  subColor: "#8a8a8a",
  accent: "#121212",
  fontScale: 1,
  font: "sans",
  radius: 0,          // 外框圓角, 短邊比例
  photoRadius: 0,
  shadow: false,
  separator: true,
  title: "",
  model: "",
  date: "",
  brand: "",
  params: "",
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * 算出整張圖的版面。
 * @param {number} w 照片畫出來的寬
 * @param {number} h 照片畫出來的高
 */
export function layout(w, h, o) {
  const base = Math.min(w, h);
  const pad = Math.round(base * clamp(o.pad, 0, 0.15));
  const bar = o.showBar ? Math.round(base * 0.13 * clamp(o.barScale, 0.4, 2.4)) : 0;

  let top = pad;
  let bottom = pad;
  const side = pad;

  switch (o.mode) {
    case "top": top = pad + bar; break;
    case "both": top = pad + Math.round(bar * 0.62); bottom = pad + bar; break;
    case "polaroid": bottom = pad + Math.round(bar * 1.9); break;
    default: bottom = pad + bar; break;   // bottom / full
  }

  const W = w + side * 2;
  const H = h + top + bottom;
  const photo = { x: side, y: top, w, h };
  // 資訊列: 上框樣式放上面, 其他都放下面。
  const info = o.mode === "top"
    ? { x: 0, y: 0, w: W, h: top }
    : { x: 0, y: top + h, w: W, h: bottom };
  // 上下框樣式的上面那條, 拿來放標題。
  const title = o.mode === "both" ? { x: 0, y: 0, w: W, h: top } : null;

  return { W, H, photo, info, title, pad, bar, unit: bar || Math.round(base * 0.1) };
}

function roundRectPath(ctx, x, y, w, h, r) {
  if (r <= 0) { ctx.rect(x, y, w, h); return; }
  const rr = Math.min(r, w / 2, h / 2);
  if (typeof ctx.roundRect === "function") { ctx.roundRect(x, y, w, h, rr); return; }
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** 量一段文字的寬度, 順便把字型設定好。 */
function setFont(ctx, o, size, weight = 400) {
  ctx.font = `${weight} ${Math.round(size)}px ${FONTS[o.font] || FONTS.sans}`;
}

/** 左側: 相機型號 + 拍攝時間。回傳實際佔掉的寬度。 */
function drawLeftBlock(ctx, o, x, cy, unit) {
  const big = unit * 0.30 * o.fontScale;
  const small = unit * 0.205 * o.fontScale;
  const gap = big * 0.34;
  const hasSub = !!o.date;
  const totalH = hasSub ? big + gap + small : big;
  let y = cy - totalH / 2;

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  if (o.model) {
    setFont(ctx, o, big, 700);
    ctx.fillStyle = o.textColor;
    ctx.fillText(o.model, x, y);
  }
  y += big + gap;
  if (hasSub) {
    setFont(ctx, o, small, 400);
    ctx.fillStyle = o.subColor;
    ctx.fillText(o.date, x, y);
  }
}

/** 右側: 品牌（文字或 logo）＋分隔線＋曝光參數。從右往左排。 */
function drawRightBlock(ctx, o, right, cy, unit, logo) {
  const brandSize = unit * 0.30 * o.fontScale;
  const paramSize = unit * 0.26 * o.fontScale;
  const gap = unit * 0.16;

  ctx.textBaseline = "middle";
  ctx.textAlign = "right";

  let x = right;
  if (o.params) {
    setFont(ctx, o, paramSize, 700);
    ctx.fillStyle = o.textColor;
    ctx.fillText(o.params, x, cy);
    x -= ctx.measureText(o.params).width + gap;
  }

  const hasBrand = logo || o.brand;
  if (hasBrand && o.separator && o.params) {
    const halfH = unit * 0.26;
    ctx.save();
    ctx.strokeStyle = o.subColor;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.max(1, unit * 0.015);
    ctx.beginPath();
    ctx.moveTo(x, cy - halfH);
    ctx.lineTo(x, cy + halfH);
    ctx.stroke();
    ctx.restore();
    x -= gap;
  }

  if (logo) {
    const logoH = unit * 0.42 * o.fontScale;
    const logoW = logoH * (logo.width / logo.height);
    ctx.drawImage(logo, x - logoW, cy - logoH / 2, logoW, logoH);
  } else if (o.brand) {
    setFont(ctx, o, brandSize, 700);
    ctx.fillStyle = o.accent;
    ctx.fillText(o.brand, x, cy);
  }
}

/** 置中版: 上面一行主要資訊, 下面一行次要資訊。 */
function drawCentered(ctx, o, rect, unit, logo) {
  const big = unit * 0.28 * o.fontScale;
  const small = unit * 0.21 * o.fontScale;
  const cx = rect.x + rect.w / 2;
  const line1 = [o.brand, o.model].filter(Boolean).join(" ");
  const line2 = [o.params, o.date].filter(Boolean).join("　");
  const gap = big * 0.42;
  const totalH = (line1 ? big : 0) + (line1 && line2 ? gap : 0) + (line2 ? small : 0);
  let y = rect.y + rect.h / 2 - totalH / 2;

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  if (logo && line1) {
    const logoH = big * 1.25;
    const logoW = logoH * (logo.width / logo.height);
    ctx.drawImage(logo, cx - logoW / 2, y - logoH * 0.1, logoW, logoH);
    y += logoH + gap;
  } else if (line1) {
    setFont(ctx, o, big, 700);
    ctx.fillStyle = o.textColor;
    ctx.fillText(line1, cx, y);
    y += big + gap;
  }
  if (line2) {
    setFont(ctx, o, small, 400);
    ctx.fillStyle = o.subColor;
    ctx.fillText(line2, cx, y);
  }
}

/**
 * 把照片與相框畫成一張 canvas。
 * @param {ImageBitmap|HTMLCanvasElement} bitmap 已經轉正的照片
 * @param {object} opts DEFAULTS 的同款設定
 * @param {number} targetWidth 照片本身要畫多寬（不含邊框）
 * @param {ImageBitmap|null} logo 自訂品牌圖
 */
export function renderFrame(bitmap, opts, targetWidth, logo = null) {
  const o = { ...DEFAULTS, ...opts };
  const w = Math.max(1, Math.round(targetWidth));
  const h = Math.max(1, Math.round((bitmap.height / bitmap.width) * w));
  const L = layout(w, h, o);

  const canvas = document.createElement("canvas");
  canvas.width = L.W;
  canvas.height = L.H;
  const ctx = canvas.getContext("2d");

  // 外框底色
  ctx.fillStyle = o.bg;
  ctx.beginPath();
  roundRectPath(ctx, 0, 0, L.W, L.H, Math.round(Math.min(L.W, L.H) * clamp(o.radius, 0, 0.08)));
  ctx.fill();

  // 照片
  ctx.save();
  if (o.shadow && L.pad > 0) {
    ctx.shadowColor = "rgba(0,0,0,0.28)";
    ctx.shadowBlur = L.pad * 0.7;
    ctx.shadowOffsetY = L.pad * 0.16;
  }
  ctx.beginPath();
  roundRectPath(ctx, L.photo.x, L.photo.y, L.photo.w, L.photo.h,
    Math.round(Math.min(L.photo.w, L.photo.h) * clamp(o.photoRadius, 0, 0.08)));
  ctx.closePath();
  ctx.fillStyle = o.bg;
  ctx.fill();               // 陰影要有東西擋著才畫得出來
  ctx.shadowColor = "transparent";
  ctx.clip();
  ctx.drawImage(bitmap, L.photo.x, L.photo.y, L.photo.w, L.photo.h);
  ctx.restore();

  if (!o.showBar) return canvas;

  const inset = Math.max(L.pad, L.unit * 0.42);
  if (o.align === "center" || o.mode === "polaroid") {
    drawCentered(ctx, o, L.info, L.unit, logo);
  } else {
    const cy = L.info.y + L.info.h / 2 + (o.mode === "top" ? 0 : L.pad * 0.1);
    drawLeftBlock(ctx, o, L.info.x + inset, cy, L.unit);
    drawRightBlock(ctx, o, L.info.x + L.info.w - inset, cy, L.unit, logo);
  }

  if (L.title && o.title) {
    setFont(ctx, o, L.unit * 0.26 * o.fontScale, 600);
    ctx.fillStyle = o.textColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(o.title, L.title.x + L.title.w / 2, L.title.y + L.title.h / 2 + L.pad * 0.2);
  }

  return canvas;
}
