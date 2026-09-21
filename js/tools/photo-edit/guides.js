// js/tools/photo-edit/guides.js — 構圖格線。
//
// 每一種格線就是一個函式: 拿到裁切框在畫面上的實際寬高, 回傳一段 SVG 內容。
// 直接用畫面像素算, 不用 viewBox 縮放 —— 那樣線條粗細會跟著裁切框比例被拉扁。
//
// variant 是「方向」: 螺旋與三角構圖有四個角可以起頭, 按一下換一個。

export const GUIDES = [
  { value: "none", label: "無" },
  { value: "thirds", label: "九宮格" },
  { value: "golden", label: "黃金比例" },
  { value: "spiral", label: "黃金螺旋" },
  { value: "triangles", label: "黃金三角" },
  { value: "diagonal", label: "對角線法" },
  { value: "grid", label: "細格線" },
  { value: "center", label: "中心十字" },
];

/** 這些格線有四個方向可以換。 */
export const DIRECTIONAL = new Set(["golden", "spiral", "triangles", "diagonal"]);

const PHI_SMALL = 0.3819660112501051;   // 1 - 1/φ
const PHI_BIG = 0.6180339887498949;     // 1/φ

const line = (x1, y1, x2, y2, cls = "g-line") =>
  `<line class="${cls}" x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"/>`;

function thirds(w, h) {
  const out = [];
  for (const t of [1 / 3, 2 / 3]) {
    out.push(line(w * t, 0, w * t, h));
    out.push(line(0, h * t, w, h * t));
  }
  return out.join("");
}

/**
 * 一路從矩形上切下最大的正方形, 記下每一刀。
 * 黃金分割圖與黃金螺旋長在同一組正方形上, 所以只算一次。
 */
function subdivide(w, h, steps = 12) {
  let r = { x: 0, y: 0, w, h };
  const cuts = [];
  for (let i = 0; i < steps; i++) {
    const s = Math.min(r.w, r.h);
    if (s < 1.5) break;
    const d = i % 4;
    let sq;
    let rest;
    if (d === 0) { sq = { x: r.x, y: r.y, s }; rest = { x: r.x + s, y: r.y, w: r.w - s, h: r.h }; }
    else if (d === 1) { sq = { x: r.x, y: r.y, s }; rest = { x: r.x, y: r.y + s, w: r.w, h: r.h - s }; }
    else if (d === 2) { sq = { x: r.x + r.w - s, y: r.y, s }; rest = { x: r.x, y: r.y, w: r.w - s, h: r.h }; }
    else { sq = { x: r.x, y: r.y + r.h - s, s }; rest = { x: r.x, y: r.y, w: r.w, h: r.h - s }; }
    cuts.push({ d, sq, rect: r });
    r = rest;
  }
  return cuts;
}

/** 每一刀在畫面上就是一條線: 把正方形跟剩下的矩形分開。 */
function cutLines(cuts, cls) {
  return cuts.map(({ d, sq, rect }) => {
    const s = sq.s;
    if (d === 0) return line(sq.x + s, rect.y, sq.x + s, rect.y + rect.h, cls);
    if (d === 1) return line(rect.x, sq.y + s, rect.x + rect.w, sq.y + s, cls);
    if (d === 2) return line(sq.x, rect.y, sq.x, rect.y + rect.h, cls);
    return line(rect.x, sq.y, rect.x + rect.w, sq.y, cls);
  }).join("");
}

/** 依方向把整組圖形鏡射過去, 不必重算。 */
function oriented(inner, w, h, variant) {
  const sx = variant === 1 || variant === 2 ? -1 : 1;
  const sy = variant === 2 || variant === 3 ? -1 : 1;
  const tx = sx < 0 ? w : 0;
  const ty = sy < 0 ? h : 0;
  return `<g transform="translate(${tx} ${ty}) scale(${sx} ${sy})">${inner}</g>`;
}

/**
 * 黃金分割: 一個正方形加一個小一號的黃金矩形, 一直切下去。
 * 裁切比例設成 1.618:1 時, 每一刀都會落在黃金分割點上。
 */
function golden(w, h, variant) {
  return oriented(cutLines(subdivide(w, h), "g-line"), w, h, variant);
}

function grid(w, h) {
  const out = [];
  const cols = 6;
  const rows = Math.max(3, Math.round(cols * (h / w)));
  for (let i = 1; i < cols; i++) out.push(line((w * i) / cols, 0, (w * i) / cols, h, "g-line is-faint"));
  for (let i = 1; i < rows; i++) out.push(line(0, (h * i) / rows, w, (h * i) / rows, "g-line is-faint"));
  return out.join("");
}

function center(w, h) {
  return line(w / 2, 0, w / 2, h) + line(0, h / 2, w, h / 2);
}

/**
 * 對角線法: 從四個角各畫一條 45°。
 * 兩條線的交點就是「主體放這裡最穩」的位置。
 */
function diagonal(w, h) {
  const d = Math.max(w, h);
  return [
    line(0, 0, d, d),
    line(w, 0, w - d, d),
    line(0, h, d, h - d),
    line(w, h, w - d, h - d),
  ].join("");
}

/**
 * 黃金三角: 一條主對角線, 加上另外兩角垂直落在它上面的線。
 * variant 決定主對角線是哪一條。
 */
function triangles(w, h, variant) {
  const flip = variant % 2 === 1;
  // 主對角線的兩端
  const [ax, ay, bx, by] = flip ? [w, 0, 0, h] : [0, 0, w, h];
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  // 另外兩個角
  const corners = flip ? [[0, 0], [w, h]] : [[w, 0], [0, h]];
  const out = [line(ax, ay, bx, by)];
  for (const [cx, cy] of corners) {
    const t = ((cx - ax) * dx + (cy - ay) * dy) / len2;   // 垂足在對角線上的位置
    out.push(line(cx, cy, ax + dx * t, ay + dy * t));
  }
  return out.join("");
}

/**
 * 黃金螺旋: 在每個正方形裡畫一段四分之一圓弧, 底下墊上淡淡的分割線。
 * 裁切框剛好是 1.618:1 時, 弧與弧會接得完全連續（所以比例選單裡有一個黃金比例）。
 */
function spiral(w, h, variant) {
  const cuts = subdivide(w, h);
  const arcs = [];
  let start = null;

  for (const { d, sq } of cuts) {
    const s = sq.s;
    // 每段弧都是以正方形的某個角為圓心, 連接相鄰兩角。
    const corner = {
      0: [[sq.x, sq.y + s], [sq.x + s, sq.y]],           // 圓心左上: 左下 → 右上
      1: [[sq.x, sq.y], [sq.x + s, sq.y + s]],           // 圓心右上: 左上 → 右下
      2: [[sq.x + s, sq.y], [sq.x, sq.y + s]],           // 圓心右下: 右上 → 左下
      3: [[sq.x + s, sq.y + s], [sq.x, sq.y]],           // 圓心左下: 右下 → 左上
    }[d];
    if (!start) start = corner[0];
    arcs.push(`A ${s.toFixed(2)} ${s.toFixed(2)} 0 0 0 ${corner[1][0].toFixed(2)} ${corner[1][1].toFixed(2)}`);
  }

  if (!start) return "";
  const path = `M ${start[0].toFixed(2)} ${start[1].toFixed(2)} ${arcs.join(" ")}`;
  return oriented(
    cutLines(cuts, "g-line is-faint") + `<path class="g-line" d="${path}" fill="none"/>`,
    w, h, variant,
  );
}

const RENDERERS = { thirds, golden, grid, center, diagonal, triangles, spiral };

/**
 * @param {string} kind GUIDES 裡的 value
 * @param {number} w 裁切框在畫面上的寬（CSS px）
 * @param {number} h 裁切框在畫面上的高
 * @param {number} variant 方向 0..3
 */
export function guideSvg(kind, w, h, variant = 0) {
  const draw = RENDERERS[kind];
  if (!draw || w < 4 || h < 4) return "";
  return draw(w, h, variant);
}
