// js/tools/palette-card/card.js — 把明信片畫到 canvas 上。
//
// 預覽跟輸出是同一個函式、同一張 canvas: 畫面上看到的就是存下來的那張圖,
// 只是被 CSS 縮小顯示而已。不這樣做的話, 毛玻璃、陰影、字距這些東西在
// 「HTML 預覽」與「canvas 輸出」兩套實作下一定會慢慢長歪。
//
// 所有尺寸都以畫布寬度為單位寫成比例, 所以同一份版型在 1080 或 2160 下
// 長得一模一樣, 只是解析度不同。
//
// 面板位置與照片平移都存成「相對值」而不是像素: 換尺寸、換版型、改顏色數量
// 之後, 使用者拖出來的構圖才會跟著等比例走, 而不是突然跑掉。

import { blur } from "./blur.js";
import { toHex, contrast, shade, luminance } from "./palette.js";

const SANS = '"TASA Explorer", "TASA Orbiter", "IBM Plex Sans JP", sans-serif';
/** 標題用等寬, 但中文要能退回無襯線 —— JetBrains Mono 沒有中文字。 */
const TITLE_FONT = `"JetBrains Mono", ${SANS}`;
const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export const SIZES = [
  { value: "1080x1350", label: "4:5 直式", w: 1080, h: 1350 },
  { value: "1080x1440", label: "3:4 明信片", w: 1080, h: 1440 },
  { value: "1080x1080", label: "1:1 方形", w: 1080, h: 1080 },
  { value: "1080x1920", label: "9:16 限時動態", w: 1080, h: 1920 },
];

export const LAYOUTS = [
  { value: "glass", label: "玻璃色卡" },
  { value: "caption", label: "標題留白" },
  { value: "strip", label: "底部色條" },
];

export const parseSize = (value) => SIZES.find((s) => s.value === value) || SIZES[0];

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/* ============================ 畫布小工具 ============================ */

function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

const css = ([r, g, b], alpha = 1) => `rgba(${r}, ${g}, ${b}, ${alpha})`;

/**
 * 照片在框裡有多少可以移動的餘裕。
 *
 * cover 一定有一邊超出框外, 超出去的那一半就是可以拖的範圍。另一邊剛好貼齊,
 * 餘裕是 0 —— 那個方向拖不動, 硬拖會露出背景。
 *
 * 所以只有平移是不夠用的: 直式手機照片放進 4:5 的卡片, 兩邊比例太接近,
 * 只溢出百分之三, 等於拖不動。zoom 把照片再放大一點, 才生得出可以拖的空間。
 */
function slackOf(img, box, zoom = 1) {
  const iw = img?.width || img?.naturalWidth || 0;
  const ih = img?.height || img?.naturalHeight || 0;
  if (!iw || !ih) return { x: 0, y: 0, dw: 0, dh: 0 };
  const scale = Math.max(box.w / iw, box.h / ih) * Math.max(1, zoom || 1);
  const dw = iw * scale;
  const dh = ih * scale;
  return { x: (dw - box.w) / 2, y: (dh - box.h) / 2, dw, dh };
}

/** 等比填滿一個框（等同 CSS 的 object-fit: cover）, pan 為 -1…1 的平移。 */
function drawCover(ctx, img, box, pan = { x: 0, y: 0 }, zoom = 1) {
  const { x: slackX, y: slackY, dw, dh } = slackOf(img, box, zoom);
  if (!dw) return;
  ctx.drawImage(img,
    box.x - slackX + clamp(pan.x, -1, 1) * slackX,
    box.y - slackY + clamp(pan.y, -1, 1) * slackY,
    dw, dh);
}

/**
 * 照片只填滿指定的那一塊。
 *
 * cover 一定會有一邊超出框外 —— 那正是它填滿的方式。照片只佔卡片的一部分時
 * 一定要再夾一層矩形把溢出的裁掉, 否則直式照片會從下半部一路長到標題上面去。
 * clip 是相交的, 所以卡片的圓角仍然留著。
 */
function photoIn(ctx, image, box, pan, zoom) {
  if (!image) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  drawCover(ctx, image, box, pan, zoom);
  ctx.restore();
}

/**
 * 逐字畫, 好控制字距。
 *
 * canvas 有 letterSpacing 屬性, 但不是每個瀏覽器都有, 而且加了字距之後
 * measureText 量到的寬度會不會含最後一個字的間距各家不一樣 —— 置中就會偏。
 * 自己排就沒有這個問題。
 */
function tracked(ctx, text, cx, y, tracking) {
  const chars = Array.from(String(text));
  if (!chars.length) return 0;
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + tracking * (chars.length - 1);
  let x = cx - total / 2;
  const previous = ctx.textAlign;
  ctx.textAlign = "left";
  chars.forEach((ch, i) => {
    ctx.fillText(ch, x, y);
    x += widths[i] + tracking;
  });
  ctx.textAlign = previous;
  return total;
}

/**
 * 毛玻璃。
 *
 * 取一塊已經畫好的畫面、模糊、再貼回被圓角裁切的範圍裡。取的時候往外多要
 * 一圈: 只取面板本身的話, 模糊到邊緣沒有東西可以取樣, 會沿著四邊糊出一圈
 * 和裡面不連續的色帶。
 *
 * 模糊之前先縮小。半徑 28 的模糊直接做要動到幾百萬個像素, 拖曳面板時每一幀
 * 都做一次會頓; 縮到五分之一再用五分之一的半徑做, 工作量少 25 倍, 放大回去
 * 的插值本身又是一層平滑, 看起來沒有差別。
 */
function frost(ctx, rect, radius, { sigma, alpha = 0.18, rim = 0.5 }) {
  const canvas = ctx.canvas;
  const grab = Math.ceil(sigma * 1.5);
  const x0 = Math.max(0, Math.floor(rect.x) - grab);
  const y0 = Math.max(0, Math.floor(rect.y) - grab);
  const x1 = Math.min(canvas.width, Math.ceil(rect.x + rect.w) + grab);
  const y1 = Math.min(canvas.height, Math.ceil(rect.y + rect.h) + grab);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 2 || h < 2) return;

  const shrink = clamp(Math.round(sigma / 6), 1, 8);
  const sw = Math.max(2, Math.round(w / shrink));
  const sh = Math.max(2, Math.round(h / shrink));

  const stage = document.createElement("canvas");
  stage.width = sw;
  stage.height = sh;
  const sctx = stage.getContext("2d", { willReadFrequently: true });
  sctx.drawImage(canvas, x0, y0, w, h, 0, 0, sw, sh);
  const snapshot = sctx.getImageData(0, 0, sw, sh);
  blur(snapshot.data, sw, sh, sigma / shrink);
  sctx.putImageData(snapshot, 0, 0);

  ctx.save();
  roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, radius);
  ctx.clip();
  ctx.drawImage(stage, 0, 0, sw, sh, x0, y0, w, h);
  // 打亮一層, 上緣比下緣亮 —— 真正的玻璃就是這樣反光的。
  const sheen = ctx.createLinearGradient(0, rect.y, 0, rect.y + rect.h);
  sheen.addColorStop(0, `rgba(255, 255, 255, ${alpha * 1.6})`);
  sheen.addColorStop(0.45, `rgba(255, 255, 255, ${alpha * 0.75})`);
  sheen.addColorStop(1, `rgba(255, 255, 255, ${alpha * 1.1})`);
  ctx.fillStyle = sheen;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.restore();

  roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, radius);
  ctx.strokeStyle = `rgba(255, 255, 255, ${rim})`;
  ctx.lineWidth = Math.max(1, canvas.width * 0.0016);
  ctx.stroke();
}

/* ============================ 配色決定 ============================ */

/** 底色: 自動就用占比最大的色 —— 亮照片得到亮底、夜景得到深底。 */
function backgroundColor(colors, mode) {
  if (!colors.length) return [224, 224, 224];
  if (mode === "light") return colors.slice().sort((a, b) => luminance(b.rgb) - luminance(a.rgb))[0].rgb;
  if (mode === "dark") return colors.slice().sort((a, b) => luminance(a.rgb) - luminance(b.rgb))[0].rgb;
  return colors[0].rgb;
}

/** 在這組色裡挑一個放在 base 上最看得清楚的。都不夠清楚就退回黑或白。 */
function readableOn(colors, base) {
  let best = null;
  let bestRatio = 0;
  for (const { rgb } of colors) {
    const ratio = contrast(rgb, base);
    if (ratio > bestRatio) { bestRatio = ratio; best = rgb; }
  }
  if (bestRatio >= 4) return best;
  return luminance(base) > 0.4 ? [32, 32, 32] : [240, 240, 240];
}

/* ============================ 版面計算 ============================ */

/**
 * 卡片外框。
 *
 * 底色關掉時卡片就是整張畫布 —— 沒有留白自然也不該有圓角, 圓角後面會露出
 * 什麼都沒有的地方。
 */
function frameOf(state) {
  const size = state.size || SIZES[0];
  const W = size.w;
  const H = size.h;
  const bleed = state.background === "none";
  const pad = bleed ? 0 : W * 0.042;
  return {
    W, H, bleed,
    card: { x: pad, y: pad, w: W - pad * 2, h: H - pad * 2 },
    radius: bleed ? 0 : W * 0.032,
  };
}

function columnsFor(n) {
  if (n <= 3) return Math.max(1, n);
  if (n === 4) return 2;
  if (n <= 6) return 3;
  return 4;
}

/**
 * 面板的所有尺寸。比例是照著參考的明信片量出來的:
 * 面板寬 = 卡片寬的 88.8%, 圓的直徑 = 一格的一半, 色碼字級 = 圓直徑的 21%。
 */
function panelMetrics(card, count) {
  const w = card.w * 0.888;
  const padX = w * 0.025;
  const cols = columnsFor(count);
  const rows = Math.ceil(count / cols);
  const cell = (w - padX * 2) / cols;
  const circle = cell * 0.5;
  const label = circle * 0.21;
  const labelGap = circle * 0.31;
  const rowGap = circle * 0.2;
  const padY = circle * 0.26;
  const rowH = circle + labelGap + label;
  return {
    w,
    h: padY * 2 + rows * rowH + (rows - 1) * rowGap,
    padX, padY, cols, rows, cell, circle, label, labelGap, rowGap, rowH,
  };
}

/** 面板貼齊卡片邊緣時留的空隙, 也是吸附的基準。 */
const panelMargin = (card) => card.w * 0.045;

/**
 * 把面板放到位置上。state.panel 是面板中心在卡片裡的相對座標;
 * 還沒拖過（null）就用預設的「靠下置中」, 也就是參考明信片的位置。
 */
function placePanel(panel, card, wanted) {
  const margin = panelMargin(card);
  const cx = wanted ? card.x + wanted.x * card.w : card.x + card.w / 2;
  const cy = wanted ? card.y + wanted.y * card.h : card.y + card.h - margin - panel.h / 2;
  panel.x = clamp(cx - panel.w / 2, card.x, card.x + card.w - panel.w);
  panel.y = clamp(cy - panel.h / 2, card.y, card.y + card.h - panel.h);
  return panel;
}

/** 各版型的照片框。 */
function photoBox(state, card) {
  if (state.layout === "caption") {
    const splitY = card.y + card.h * 0.45;
    return { x: card.x, y: splitY, w: card.w, h: card.y + card.h - splitY };
  }
  if (state.layout === "strip") {
    return { x: card.x, y: card.y, w: card.w, h: card.h * 0.875 };
  }
  return { ...card };
}

/**
 * 拖曳與吸附要用到的幾何。index.js 靠這個做命中判斷, 不必自己重算一份。
 */
export function geometry(state) {
  const frame = frameOf(state);
  const panel = state.layout === "glass"
    ? placePanel(panelMetrics(frame.card, (state.colors || []).length), frame.card, state.panel)
    : null;
  return { ...frame, panel, photo: photoBox(state, frame.card) };
}

/** 照片在目前版型下每個方向可以拖多少（畫布像素）。0 代表那個方向拖不動。 */
export function photoSlack(state) {
  const { photo } = geometry(state);
  const { x, y } = slackOf(state.image, photo, state.zoom);
  return { x, y };
}

/**
 * 面板吸附。
 *
 * 吸附點只有真正有意義的那幾個: 水平置中, 以及貼上緣、正中、貼下緣。
 * 回傳吸好的相對中心, 外加命中的參考線讓介面可以畫出來 —— 沒有回饋的磁吸
 * 會讓人以為是自己手抖或程式卡住。
 */
export function snapPanel(state, center) {
  const { W, card, panel } = geometry(state);
  if (!panel) return { center: state.panel, guides: [] };

  const margin = panelMargin(card);
  const tolerance = W * 0.018;
  const guides = [];

  const stick = (value, targets, axis) => {
    let best = value;
    let bestGap = tolerance;
    for (const target of targets) {
      const gap = Math.abs(value - target);
      if (gap < bestGap) { bestGap = gap; best = target; }
    }
    if (best !== value) guides.push({ axis, at: best });
    return best;
  };

  const cx = stick(center.x, [card.x + card.w / 2], "x");
  const cy = stick(center.y, [
    card.y + margin + panel.h / 2,
    card.y + card.h / 2,
    card.y + card.h - margin - panel.h / 2,
  ], "y");

  return {
    center: {
      x: clamp((cx - card.x) / card.w, 0, 1),
      y: clamp((cy - card.y) / card.h, 0, 1),
    },
    guides,
  };
}

/* ============================ 色票面板 ============================ */

function drawSwatchPanel(ctx, colors, panel, W) {
  frost(ctx, panel, W * 0.028, { sigma: W * 0.026, alpha: 0.18 });

  const left = panel.x + panel.padX;
  const top = panel.y + panel.padY;
  ctx.font = `700 ${panel.label}px ${MONO}`;
  ctx.textBaseline = "alphabetic";

  colors.forEach((color, i) => {
    const col = i % panel.cols;
    const row = Math.floor(i / panel.cols);
    const cx = left + panel.cell * (col + 0.5);
    const rowTop = top + row * (panel.rowH + panel.rowGap);

    ctx.beginPath();
    ctx.arc(cx, rowTop + panel.circle / 2, panel.circle / 2, 0, Math.PI * 2);
    ctx.fillStyle = toHex(color.rgb);
    ctx.fill();

    // 面板下面可能是很亮的照片, 白字會糊掉 —— 給一層淡陰影保底。
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
    ctx.shadowBlur = panel.label * 0.4;
    ctx.shadowOffsetY = panel.label * 0.04;
    ctx.fillStyle = "#ffffff";
    tracked(ctx, color.hex, cx, rowTop + panel.circle + panel.labelGap + panel.label * 0.8, 0);
    ctx.restore();
  });
}

/* ============================ 標題 ============================ */

/** 一塊區域的平均色。跳著取樣就夠了, 這只是拿來決定字要白的還是深的。 */
function averageOf(ctx, box) {
  const x = Math.max(0, Math.floor(box.x));
  const y = Math.max(0, Math.floor(box.y));
  const w = Math.min(ctx.canvas.width - x, Math.ceil(box.w));
  const h = Math.min(ctx.canvas.height - y, Math.ceil(box.h));
  if (w < 1 || h < 1) return [128, 128, 128];
  const { data } = ctx.getImageData(x, y, w, h);
  let r = 0; let g = 0; let b = 0; let n = 0;
  for (let i = 0; i < data.length; i += 4 * 17) {
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n += 1;
  }
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

/**
 * 標題。
 *
 * 疊在照片上時字色是看著照片決定的 —— 寫死白字在晴天的天空上幾乎看不見,
 * 寫死深色在夜景上也一樣。先量一下標題要放的那塊平均有多亮, 亮就用照片裡
 * 最深的那個色, 暗就用白色, 再配一層反向的陰影把邊緣撐出來。
 */
function drawHeadline(ctx, state, box, { colors, base, onPhoto, W }) {
  const title = String(state.title || "").trim();
  const subtitle = String(state.subtitle || "").trim();
  if (!title && !subtitle) return;
  if (box.h < W * 0.08) return;   // 面板拖到快貼邊時就別硬塞了

  const backdrop = onPhoto ? averageOf(ctx, box) : base;
  const light = luminance(backdrop) > 0.42;
  const color = onPhoto
    ? (light ? readableOn(colors, backdrop) : [255, 255, 255])
    : readableOn(colors, base);
  const shadow = onPhoto
    ? (light ? "rgba(255, 255, 255, 0.55)" : "rgba(0, 0, 0, 0.45)")
    : null;

  const titleSize = W * 0.034;
  const subSize = W * 0.024;
  const gap = titleSize * 1.6;
  const blockH = (title ? titleSize : 0) + (title && subtitle ? gap : 0) + (subtitle ? subSize : 0);
  const cx = box.x + box.w / 2;
  let y = box.y + (box.h - blockH) / 2 + titleSize * 0.8;

  ctx.save();
  ctx.fillStyle = toHex(color);
  if (shadow) {
    ctx.shadowColor = shadow;
    ctx.shadowBlur = titleSize * 0.7;
    ctx.shadowOffsetY = titleSize * 0.08;
  }
  ctx.textBaseline = "alphabetic";
  if (title) {
    ctx.font = `700 ${titleSize}px ${TITLE_FONT}`;
    tracked(ctx, title, cx, y, titleSize * 0.06);
    y += gap;
  }
  if (subtitle) {
    ctx.font = `700 ${subSize}px ${TITLE_FONT}`;
    tracked(ctx, subtitle, cx, title ? y : y - titleSize * 0.8 + subSize * 0.8, subSize * 0.14);
  }
  ctx.restore();
}

/* ============================ 版型 ============================ */

function layoutGlass(ctx, state, g) {
  const { card, radius, W, panel } = g;

  ctx.save();
  roundRectPath(ctx, card.x, card.y, card.w, card.h, radius);
  ctx.clip();
  drawCover(ctx, state.image, card, state.pan, state.zoom);
  ctx.restore();

  drawSwatchPanel(ctx, state.colors, panel, W);

  // 標題放在面板留下的比較大的那一塊。把面板拖到上面, 標題就自己跑到下面。
  const above = { x: card.x, y: card.y, w: card.w, h: panel.y - card.y };
  const belowY = panel.y + panel.h;
  const below = { x: card.x, y: belowY, w: card.w, h: card.y + card.h - belowY };
  drawHeadline(ctx, state, above.h >= below.h ? above : below,
    { colors: state.colors, onPhoto: true, W });
}

function layoutCaption(ctx, state, g) {
  const { card, radius, W, base, photo } = g;
  ctx.save();
  roundRectPath(ctx, card.x, card.y, card.w, card.h, radius);
  ctx.clip();
  ctx.fillStyle = toHex(base);
  ctx.fillRect(card.x, card.y, card.w, card.h);
  photoIn(ctx, state.image, photo, state.pan, state.zoom);
  ctx.restore();

  drawHeadline(ctx, state, { x: card.x, y: card.y, w: card.w, h: photo.y - card.y },
    { colors: state.colors, base, onPhoto: false, W });
}

function layoutStrip(ctx, state, g) {
  const { card, radius, W, photo } = g;
  const colors = state.colors;

  ctx.save();
  roundRectPath(ctx, card.x, card.y, card.w, card.h, radius);
  ctx.clip();
  photoIn(ctx, state.image, photo, state.pan, state.zoom);

  const bandY = photo.y + photo.h;
  const bandH = card.y + card.h - bandY;
  const cellW = card.w / Math.max(1, colors.length);
  ctx.font = `700 ${W * 0.018}px ${MONO}`;
  ctx.textBaseline = "alphabetic";
  colors.forEach((color, i) => {
    const x = card.x + cellW * i;
    ctx.fillStyle = toHex(color.rgb);
    // 每格多畫一點點, 免得相鄰兩塊之間因為次像素而露出一條背景。
    ctx.fillRect(x, bandY, cellW + 1, bandH);
    ctx.fillStyle = luminance(color.rgb) > 0.45 ? "rgba(0, 0, 0, 0.72)" : "rgba(255, 255, 255, 0.92)";
    tracked(ctx, color.hex, x + cellW / 2, bandY + bandH / 2 + W * 0.007, 0);
  });
  ctx.restore();

  drawHeadline(ctx, state, { x: card.x, y: card.y, w: card.w, h: photo.h },
    { colors: state.colors, onPhoto: true, W });
}

const LAYOUT_FN = {
  glass: layoutGlass,
  caption: layoutCaption,
  strip: layoutStrip,
};

/* ============================ 對外 ============================ */

/**
 * 把整張明信片畫到 canvas 上。預覽與匯出走的是這同一條路。
 * @param {HTMLCanvasElement} canvas
 * @param {object} state image / colors / layout / size / title / subtitle
 *                       / background / panel / pan
 */
export function renderCard(canvas, state) {
  const g = geometry(state);
  const { W, H, card, radius, bleed } = g;
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }

  const ctx = canvas.getContext("2d", { alpha: false });
  const colors = state.colors || [];
  const base = backgroundColor(colors, state.background);

  if (bleed) {
    // 沒有外框, 卡片就是整張畫布。照片自己會填滿, 底下鋪一層只是保險。
    ctx.fillStyle = toHex(base);
    ctx.fillRect(0, 0, W, H);
  } else {
    // 外框底色: 由上往下一點點漸層, 平塗會顯得死。
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, toHex(shade(base, 0.07)));
    bg.addColorStop(1, toHex(shade(base, -0.1)));
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 卡片的陰影。先鋪一塊底色再畫內容, 沒有照片時也才不會是透明的。
    ctx.save();
    ctx.shadowColor = css(shade(base, -0.65), 0.3);
    ctx.shadowBlur = W * 0.03;
    ctx.shadowOffsetY = W * 0.008;
    roundRectPath(ctx, card.x, card.y, card.w, card.h, radius);
    ctx.fillStyle = toHex(shade(base, luminance(base) > 0.5 ? -0.06 : 0.08));
    ctx.fill();
    ctx.restore();
  }

  (LAYOUT_FN[state.layout] || layoutGlass)(ctx, { ...state, colors }, { ...g, base });
  return canvas;
}
