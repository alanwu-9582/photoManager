// js/tools/photo-edit/transform.js — 旋轉、翻轉與裁切的幾何。
//
// 流程只有兩步: 先把照片轉正成一張「工作畫布」（旋轉後的外接矩形, 四角會留白）,
// 再從工作畫布上切一塊出來。預覽與匯出用同一套算式, 差別只有工作畫布畫多大,
// 所以畫面上看到的框框, 匯出後就是那一塊。

export const ASPECTS = [
  { value: "free", label: "自由" },
  { value: "source", label: "原圖比例" },
  { value: "1", label: "1:1" },
  { value: "1.25", label: "5:4" },
  { value: "1.3333333", label: "4:3" },
  { value: "1.5", label: "3:2" },
  { value: "1.6180339", label: "黃金比例 1.618:1" },
  { value: "1.7777778", label: "16:9" },
  { value: "2", label: "2:1" },
];

const rad = (deg) => (deg * Math.PI) / 180;

/** 旋轉之後的外接矩形有多大。 */
export function rotatedSize(w, h, deg) {
  const c = Math.abs(Math.cos(rad(deg)));
  const s = Math.abs(Math.sin(rad(deg)));
  return { w: w * c + h * s, h: w * s + h * c };
}

/**
 * 旋轉後仍然完全落在照片內、面積最大的那塊矩形（跟照片同方向, 不含留白）。
 * 拉完角度按「貼齊照片」就是用這個。
 */
export function largestInnerRect(w, h, deg) {
  const angle = Math.abs(rad(deg)) % Math.PI;
  const a = angle > Math.PI / 2 ? Math.PI - angle : angle;
  const sin = Math.sin(a);
  const cos = Math.cos(a);
  const widthIsLonger = w >= h;
  const longSide = widthIsLonger ? w : h;
  const shortSide = widthIsLonger ? h : w;

  if (shortSide <= 2 * sin * cos * longSide || Math.abs(sin - cos) < 1e-10) {
    // 角度很斜的時候, 最大內接矩形只剩下半邊長決定的那一塊。
    const x = 0.5 * shortSide;
    return widthIsLonger
      ? { w: x / sin, h: x / cos }
      : { w: x / cos, h: x / sin };
  }
  const cos2a = cos * cos - sin * sin;
  return { w: (w * cos - h * sin) / cos2a, h: (h * cos - w * sin) / cos2a };
}

/**
 * 把照片旋轉／翻轉後畫成工作畫布。
 * @param {ImageBitmap} bitmap
 * @param {{rotate:number, flipH:boolean, flipV:boolean, bg:string, transparent:boolean}} o
 * @param {number} longEdge 工作畫布的長邊要多少像素
 */
export function renderWork(bitmap, o, longEdge) {
  const size = rotatedSize(bitmap.width, bitmap.height, o.rotate);
  const scale = longEdge / Math.max(size.w, size.h);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(size.w * scale));
  canvas.height = Math.max(1, Math.round(size.h * scale));

  const ctx = canvas.getContext("2d");
  if (!o.transparent) {
    ctx.fillStyle = o.bg || "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(rad(o.rotate));
  ctx.scale(o.flipH ? -1 : 1, o.flipV ? -1 : 1);
  const dw = bitmap.width * scale;
  const dh = bitmap.height * scale;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
  return canvas;
}

/**
 * 從工作畫布切出裁切框那一塊。
 * @param {HTMLCanvasElement} work
 * @param {{x:number,y:number,w:number,h:number}} crop 0~1 的比例
 */
export function cropCanvas(work, crop) {
  const sx = Math.round(crop.x * work.width);
  const sy = Math.round(crop.y * work.height);
  const sw = Math.max(1, Math.round(crop.w * work.width));
  const sh = Math.max(1, Math.round(crop.h * work.height));
  const out = document.createElement("canvas");
  out.width = sw;
  out.height = sh;
  out.getContext("2d").drawImage(work, sx, sy, sw, sh, 0, 0, sw, sh);
  return out;
}

/** 置中、在畫布內最大、且符合指定比例的裁切框（0~1）。 */
export function fitCrop(canvasW, canvasH, aspect, limit = null) {
  const box = limit || { x: 0, y: 0, w: 1, h: 1 };
  const maxW = box.w * canvasW;
  const maxH = box.h * canvasH;
  let w = maxW;
  let h = maxH;
  if (aspect) {
    if (maxW / maxH > aspect) w = maxH * aspect;
    else h = maxW / aspect;
  }
  return {
    x: box.x + (maxW - w) / 2 / canvasW,
    y: box.y + (maxH - h) / 2 / canvasH,
    w: w / canvasW,
    h: h / canvasH,
  };
}
