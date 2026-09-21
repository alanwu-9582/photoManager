// js/tools/palette-card/palette.js — 從一張照片挑出幾個代表色。
//
// 用的是中位切分（median cut）: 把所有像素當成 RGB 空間裡的一團點, 反覆挑
// 「最胖」的那一盒沿最長邊切一半, 切到夠多盒為止, 每盒取平均色。比 k-means
// 穩定（不隨機、同一張圖永遠同一組色）, 也比「取最常出現的顏色」聰明 ——
// 後者在一張天空佔一半的照片上會給你六個幾乎一樣的灰。
//
// 兩個後處理是這個工具的重點:
//
//   對齊   每個通道取 16 的倍數, 於是色碼永遠長成 #B06040 這種整齊的樣子。
//          這不是為了省位元, 是為了好看 —— 明信片上印的是色碼本身。
//   去重   切出來的盒子常常鄰居很近。用 redmean 距離（比純 RGB 接近人眼）
//          把太像的併掉, 再從後面補一個進來, 六個顏色才會真的有六種感覺。

/** 取樣上限。整張圖逐像素跑沒必要, 抽樣到這個量就夠穩定了。 */
const MAX_SAMPLES = 24000;

/** 兩色差多少以內算「同一個色」。redmean 距離, 大約是肉眼分不太出來的程度。 */
const MERGE_DISTANCE = 48;

/** 對齊的格子大小。16 → 色碼第二位永遠是 0。 */
const SNAP_STEP = 16;

/* ---------------- 色值 ---------------- */

export const toHex = ([r, g, b]) =>
  `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

export function fromHex(hex) {
  const m = String(hex).trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 對齊到 16 的倍數。上限是 240, 所以最亮的色碼是 #F0F0F0。 */
const snapChannel = (v) => Math.min(15, Math.round(v / SNAP_STEP)) * SNAP_STEP;
export const snapRgb = (rgb) => rgb.map(snapChannel);

/**
 * redmean 色差: 便宜、而且比直接算 RGB 歐氏距離貼近人眼。
 * 深色區的藍差被放大、亮色區的紅差被放大, 正好對上視覺的敏感度。
 */
export function distance(a, b) {
  const rmean = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt((2 + rmean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rmean) / 256) * db * db);
}

/** sRGB 相對亮度（WCAG）。 */
export function luminance([r, g, b]) {
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 對比度, 1（一樣）到 21（黑對白）。 */
export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 往白或黑推一點。amount 為正變亮、為負變暗。 */
export function shade(rgb, amount) {
  const target = amount >= 0 ? 255 : 0;
  const k = Math.abs(amount);
  return rgb.map((v) => Math.round(v + (target - v) * k));
}

/* ---------------- 中位切分 ---------------- */

function boxOf(colors) {
  let rMin = 255; let rMax = 0;
  let gMin = 255; let gMax = 0;
  let bMin = 255; let bMax = 0;
  for (const [r, g, b] of colors) {
    if (r < rMin) rMin = r;
    if (r > rMax) rMax = r;
    if (g < gMin) gMin = g;
    if (g > gMax) gMax = g;
    if (b < bMin) bMin = b;
    if (b > bMax) bMax = b;
  }
  const sides = [rMax - rMin, gMax - gMin, bMax - bMin];
  const longest = sides.indexOf(Math.max(...sides));
  return { colors, longest, span: sides[longest] };
}

/** 沿最長邊, 從中位數切成兩盒。 */
function split(box) {
  const sorted = box.colors.slice().sort((a, b) => a[box.longest] - b[box.longest]);
  const half = sorted.length >> 1;
  return [boxOf(sorted.slice(0, half)), boxOf(sorted.slice(half))];
}

/**
 * 切到 wanted 盒。
 *
 * 每次挑「最長邊 × 像素數」最大的那一盒 —— 只看像素數的話, 一大片天空會被
 * 一直切下去（它很大但顏色幾乎一樣）; 只看邊長的話, 畫面角落一撮雜色會搶走
 * 所有名額。兩個相乘才會挑到「又大又雜」的地方。
 */
function medianCut(colors, wanted) {
  let boxes = [boxOf(colors)];
  while (boxes.length < wanted) {
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < boxes.length; i += 1) {
      if (boxes[i].colors.length < 2 || boxes[i].span === 0) continue;
      const score = boxes[i].span * boxes[i].colors.length;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) break;
    boxes = boxes.flatMap((box, i) => (i === best ? split(box) : [box]));
  }
  return boxes;
}

function average(colors) {
  const sum = [0, 0, 0];
  for (const c of colors) { sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2]; }
  return sum.map((v) => Math.round(v / colors.length));
}

/* ---------------- 取樣 ---------------- */

/**
 * 從 ImageData 抽出要參與計算的像素。
 * @param {{data: Uint8ClampedArray|number[], width: number, height: number}} image
 */
export function samplePixels(image) {
  const { data, width, height } = image;
  const total = width * height;
  // 用質數當步長, 避免剛好踩在圖案的週期上（磁磚、柵欄那種）只採到同一種色。
  const stride = Math.max(1, Math.floor(total / MAX_SAMPLES));
  const step = stride % 2 === 0 ? stride + 1 : stride;

  const out = [];
  for (let i = 0; i < total; i += step) {
    const p = i * 4;
    if (data[p + 3] < 128) continue;   // 透明的不算
    out.push([data[p], data[p + 1], data[p + 2]]);
  }
  return out;
}

/* ---------------- 對外 ---------------- */

/**
 * 每個選色實際代表了照片的多少。
 *
 * 不能直接拿盒子的大小當占比: 中位切分是從中位數切的, 不保證切在顏色的
 * 交界上, 所以同一個顏色常常被拆進兩個盒子。拿其中一盒的大小去排序, 就會
 * 出現「佔 4% 的顏色排在佔 6% 的前面」這種事。把所有取樣像素各自歸給最接近
 * 的選色再數一次, 得到的才是真的比例。
 */
function assignWeights(pixels, picked) {
  const counts = new Array(picked.length).fill(0);
  for (const pixel of pixels) {
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < picked.length; i += 1) {
      const d = distance(pixel, picked[i].rgb);
      if (d < bestDistance) { bestDistance = d; best = i; }
    }
    counts[best] += 1;
  }
  return picked
    .map((color, i) => ({ ...color, weight: counts[i] / pixels.length }))
    .sort((a, b) => b.weight - a.weight);
}

/**
 * 取色。
 * @param {{data: Uint8ClampedArray|number[], width: number, height: number}} image
 * @param {{count?: number, snap?: boolean}} options
 * @returns {Array<{rgb: number[], hex: string, weight: number}>} 由多到少, weight 是占比 0–1
 */
export function extractPalette(image, { count = 6, snap = true } = {}) {
  const pixels = samplePixels(image);
  if (!pixels.length) return [];

  // 切得比要的多: 去重會刷掉一些, 後面才有東西可以補。
  const candidates = medianCut(pixels, count * 4)
    .filter((box) => box.colors.length)
    .map((box) => ({ rgb: average(box.colors), size: box.colors.length }))
    .sort((a, b) => b.size - a.size);

  // 門檻逐步放寬: 先求每個都夠不一樣, 真的湊不滿再退讓。
  // 這裡的順序只決定「誰被選上」, 最後的排序由 assignWeights 重算。
  for (const threshold of [MERGE_DISTANCE, MERGE_DISTANCE / 2, MERGE_DISTANCE / 4, 0]) {
    const picked = [];
    for (const candidate of candidates) {
      const rgb = snap ? snapRgb(candidate.rgb) : candidate.rgb;
      if (picked.some((chosen) => distance(chosen.rgb, rgb) <= threshold)) continue;
      picked.push({ rgb, hex: toHex(rgb) });
      if (picked.length === count) return assignWeights(pixels, picked);
    }
    if (threshold === 0) return assignWeights(pixels, picked);
  }
  return [];
}
