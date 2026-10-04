// js/tools/adjust/develop.js — 「調整」的計算（從桌面版 tools/adjust/develop.py 移植）。
//
// 順序跟 Lightroom 差不多:
//   線性光:   白平衡 → 曝光
//   感知亮度: 去朦朧 → 攝影風格 → 亮部 / 陰影 / 白色 / 黑色 → 對比 → 清晰度 / 紋理
//   顏色:     自然飽和度 / 飽和度 → 色彩混合（HSL）→ 顏色分級
//   最後:     暈影 → 顆粒
//
// 會看「附近」的那幾項（亮部 / 陰影的區域亮度、清晰度、去朦朧）先在長邊 MAP_EDGE
// 的縮圖上算成一張平滑的圖, 再內插回原尺寸 —— 所以預覽（長邊一千多）與輸出（原尺寸）
// 看起來一樣, 原尺寸也可以一段一段處理, 不會整張吃進記憶體。
//
// 全部用 Float32Array 自己算: canvas 的 filter 只有固定那幾種, 做不出這些。

import * as ST from "./styles.js";

export const MAP_EDGE = 640;

/** 色彩混合的八個色相（度）。 */
export const BANDS = [
  ["red", 0], ["orange", 30], ["yellow", 60], ["green", 120],
  ["aqua", 180], ["blue", 240], ["purple", 270], ["magenta", 300],
];

export const BAND_NAMES = {
  red: "紅", orange: "橙", yellow: "黃", green: "綠",
  aqua: "青", blue: "藍", purple: "紫", magenta: "洋紅",
};

export function defaults() {
  return {
    temp: 0, tint: 0,
    exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
    texture: 0, clarity: 0, dehaze: 0, vibrance: 0, saturation: 0,
    hsl: Object.fromEntries(BANDS.map(([b]) => [b, [0, 0, 0]])),
    grade: { sh_hue: 220, sh_sat: 0, hi_hue: 40, hi_sat: 0, balance: 0 },
    vignette: 0, vig_mid: 50, vig_feather: 50,
    grain: 0, grain_size: 25,
    style: { ...ST.DEFAULT },
  };
}

const SCALARS = [
  "temp", "tint", "exposure", "contrast", "highlights", "shadows", "whites", "blacks",
  "texture", "clarity", "dehaze", "vibrance", "saturation", "vignette", "grain",
];

export function isIdentity(p) {
  if (SCALARS.some((k) => Math.abs(p[k]) > 1e-9)) return false;
  if (!ST.isIdentity(p.style)) return false;
  if (Object.values(p.hsl).some((vals) => vals.some((x) => Math.abs(x) > 1e-9))) return false;
  return !p.grade.sh_sat && !p.grade.hi_sat;
}

export function clone(p) {
  return {
    ...p,
    hsl: Object.fromEntries(Object.entries(p.hsl).map(([k, v]) => [k, v.slice()])),
    grade: { ...p.grade },
    style: { ...p.style },
  };
}

/* ============================================================
   小工具
   ============================================================ */
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / Math.max(e1 - e0, 1e-6)));
  return t * t * (3 - 2 * t);
}

/** sRGB ↔ 線性光。用 2.2 次方（跟桌面版一致, 比分段式快很多）。 */
function toLinear(v) { return Math.pow(Math.max(v, 0), 2.2); }
function toGamma(v) { return Math.pow(Math.max(v, 0), 1 / 2.2); }

/** 超過 knee 的部分用 tanh 壓回 1 以內: 提亮時亮部慢慢飽和, 不會整片死白。 */
function softClip(x, knee = 0.88) {
  if (x <= knee) return x;
  const k = 1 - knee;
  return knee + k * Math.tanh((x - knee) / k);
}

export function hueRgb(hueDeg) {
  const h = ((hueDeg % 360) + 360) % 360 / 60;
  const x = 1 - Math.abs((h % 2) - 1);
  const table = [[1, x, 0], [x, 1, 0], [0, 1, x], [0, x, 1], [x, 0, 1], [1, 0, x]];
  return table[Math.floor(h) % 6];
}

/* ---------------- 單通道的平面運算 ---------------- */
/** 水平 + 垂直的方框模糊（半徑 r），用前綴和所以跟半徑無關, 都是 O(n)。 */
function box2(src, w, h, r) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const win = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += src[row + Math.min(w - 1, Math.max(0, i))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / win;
      sum += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += tmp[Math.min(h - 1, Math.max(0, i)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / win;
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/** 三次方框模糊 ≈ 高斯。 */
function gauss(a, w, h, sigma) {
  const r = Math.max(1, Math.round(sigma * 0.94));
  let out = a;
  for (let i = 0; i < 3; i++) out = box2(out, w, h, r);
  return out;
}

/** 紋理用的模糊。sigma 很小時直接原樣回去 —— 最小的方框是 3x3, 硬做會把
    該保留的細節一起洗掉（桌面版這條路走的是真正的高斯核, 小 sigma 幾乎等於沒做）。 */
function blurDetail(a, w, h, sigma) {
  return sigma < 0.5 ? a : gauss(a, w, h, sigma);
}

/** 引導濾波: 輸出跟著 I 的邊緣走、內容來自 p。亮部 / 陰影靠它才不會長出光暈。 */
function guided(I, p, w, h, r, eps) {
  const n = w * h;
  const Ip = new Float32Array(n);
  const II = new Float32Array(n);
  for (let i = 0; i < n; i++) { Ip[i] = I[i] * p[i]; II[i] = I[i] * I[i]; }
  const mI = box2(I, w, h, r);
  const mp = box2(p, w, h, r);
  const mIp = box2(Ip, w, h, r);
  const mII = box2(II, w, h, r);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const cov = mIp[i] - mI[i] * mp[i];
    const varI = mII[i] - mI[i] * mI[i];
    a[i] = cov / (varI + eps);
    b[i] = mp[i] - a[i] * mI[i];
  }
  const ma = box2(a, w, h, r);
  const mb = box2(b, w, h, r);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = ma[i] * I[i] + mb[i];
  return out;
}

/** 方形最小值濾波（侵蝕）。去朦朧的暗通道要用。 */
function minFilter(src, w, h, r) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = Infinity;
      for (let i = -r; i <= r; i++) m = Math.min(m, src[y * w + Math.min(w - 1, Math.max(0, x + i))]);
      tmp[y * w + x] = m;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = Infinity;
      for (let i = -r; i <= r; i++) m = Math.min(m, tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x]);
      out[y * w + x] = m;
    }
  }
  return out;
}

/** 把小圖（mw×mh）雙線性取樣到大圖座標 (x, y)。 */
function sampleAt(map, mw, mh, W, H, x, y) {
  const fx = Math.min(mw - 1, Math.max(0, (x + 0.5) * mw / W - 0.5));
  const fy = Math.min(mh - 1, Math.max(0, (y + 0.5) * mh / H - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(mw - 1, x0 + 1);
  const y1 = Math.min(mh - 1, y0 + 1);
  const wx = fx - x0;
  const wy = fy - y0;
  const a = map[y0 * mw + x0] * (1 - wx) + map[y0 * mw + x1] * wx;
  const b = map[y1 * mw + x0] * (1 - wx) + map[y1 * mw + x1] * wx;
  return a * (1 - wy) + b * wy;
}

/* ============================================================
   把一塊 RGB 縮小成 Float32（0..1）
   ============================================================ */
function downscale(rgba, W, H, edge) {
  const k = Math.min(1, edge / Math.max(W, H));
  const mw = Math.max(8, Math.round(W * k));
  const mh = Math.max(8, Math.round(H * k));
  const out = new Float32Array(mw * mh * 3);
  for (let y = 0; y < mh; y++) {
    const sy = Math.min(H - 1, Math.floor((y + 0.5) * H / mh));
    for (let x = 0; x < mw; x++) {
      const sx = Math.min(W - 1, Math.floor((x + 0.5) * W / mw));
      const si = (sy * W + sx) * 4;
      const di = (y * mw + x) * 3;
      out[di] = rgba[si] / 255;
      out[di + 1] = rgba[si + 1] / 255;
      out[di + 2] = rgba[si + 2] / 255;
    }
  }
  return { data: out, w: mw, h: mh };
}

/* ============================================================
   線性光的部分
   ============================================================ */
function wbGains(p) {
  const t = p.temp / 100;
  const m = p.tint / 100;
  const g = [Math.pow(2, 0.55 * t), Math.pow(2, -0.45 * m), Math.pow(2, -0.55 * t)];
  // 亮度不變, 只換顏色。
  const lum = g[0] * LUMA_R + g[1] * LUMA_G + g[2] * LUMA_B;
  return [g[0] / lum, g[1] / lum, g[2] / lum];
}

/** 原地把一塊 sRGB（0..1）做完白平衡與曝光, 回到 sRGB。 */
function stageLinear(buf, n, p) {
  const useWb = p.temp || p.tint;
  const gains = useWb ? wbGains(p) : null;
  const ev = p.exposure ? Math.pow(2, p.exposure) : 1;
  if (!useWb && ev === 1) return;
  for (let i = 0; i < n * 3; i += 3) {
    for (let c = 0; c < 3; c++) {
      let v = toLinear(buf[i + c]);
      if (gains) v *= gains[c];
      v *= ev;
      buf[i + c] = toGamma(v);
    }
  }
}

/* ============================================================
   在縮圖上先算好的平滑圖
   ============================================================ */
function dehazeApply(buf, n, amt, A, t, tAt) {
  for (let i = 0, px = 0; i < n * 3; i += 3, px++) {
    const tt = tAt(px);
    for (let c = 0; c < 3; c++) {
      const g = buf[i + c];
      if (amt > 0) {
        const d = Math.max(1 - amt * 0.95 * (1 - tt), 0.1);
        buf[i + c] = Math.min(1.2, (g - A[c]) / d + A[c]);
      } else {
        const a = -amt * 0.7;
        buf[i + c] = g + (A[c] - g) * (a * (0.35 + 0.65 * (1 - tt)));
      }
    }
  }
}

/**
 * 在長邊 MAP_EDGE 的縮圖上算「附近」類調整要用的平滑圖。
 * 回傳 { w, h, base, band?, A?, t? }。
 */
export function prepare(rgba, W, H, p) {
  const small = downscale(rgba, W, H, MAP_EDGE);
  const { w: mw, h: mh } = small;
  const n = mw * mh;
  const g = small.data;

  stageLinear(g, n, p);

  const maps = { w: mw, h: mh };

  if (p.dehaze) {
    // 暗通道先驗（He et al. 2009）: 霧越濃, 三個色版裡最暗的那個越亮。
    const r = Math.max(1, Math.round(Math.max(mw, mh) / 70));
    const dark = new Float32Array(n);
    for (let i = 0, px = 0; i < n * 3; i += 3, px++) {
      dark[px] = Math.min(g[i], g[i + 1], g[i + 2]);
    }
    const eroded = minFilter(dark, mw, mh, r);
    // 最亮的 0.1% 當成大氣光。
    const sorted = Array.from(eroded).map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
    const take = Math.max(1, Math.floor(n / 1000));
    const A = [0, 0, 0];
    for (let k = 0; k < take; k++) {
      const px = sorted[k][1] * 3;
      A[0] += g[px]; A[1] += g[px + 1]; A[2] += g[px + 2];
    }
    for (let c = 0; c < 3; c++) A[c] = Math.min(1, Math.max(0.35, A[c] / take));

    const dn = new Float32Array(n);
    for (let i = 0, px = 0; i < n * 3; i += 3, px++) {
      dn[px] = Math.min(g[i] / A[0], g[i + 1] / A[1], g[i + 2] / A[2]);
    }
    const dn2 = minFilter(dn, mw, mh, r);
    const gray = new Float32Array(n);
    for (let i = 0, px = 0; i < n * 3; i += 3, px++) {
      gray[px] = g[i] * LUMA_R + g[i + 1] * LUMA_G + g[i + 2] * LUMA_B;
    }
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) raw[i] = 1 - dn2[i];
    const t = guided(gray, raw, mw, mh, Math.max(2, Math.round(Math.max(mw, mh) / 40)), 1e-3);
    for (let i = 0; i < n; i++) t[i] = Math.min(1, Math.max(0.05, t[i]));
    maps.A = A;
    maps.t = t;
    dehazeApply(g, n, p.dehaze / 100, A, t, (px) => t[px]);
  }

  ST.apply(g, n, p.style);

  const L = new Float32Array(n);
  for (let i = 0, px = 0; i < n * 3; i += 3, px++) {
    L[px] = Math.min(1, Math.max(0, g[i] * LUMA_R + g[i + 1] * LUMA_G + g[i + 2] * LUMA_B));
  }
  const edge = Math.max(mw, mh);
  // 亮部 / 陰影看的是「這一帶」的亮度, 用保邊的引導濾波, 邊界才不會長出光暈。
  const base = guided(L, L, mw, mh, Math.max(2, Math.round(edge / 30)), 0.02);
  for (let i = 0; i < n; i++) base[i] = Math.min(1, Math.max(0, base[i]));
  maps.base = base;

  if (p.clarity) {
    const a = gauss(L, mw, mh, edge / 400);
    const b = gauss(L, mw, mh, edge / 70);
    const band = new Float32Array(n);
    for (let i = 0; i < n; i++) band[i] = a[i] - b[i];
    maps.band = band;
  }
  return maps;
}

/* ============================================================
   逐像素的色調與顏色
   ============================================================ */
function toneCurve(L, base, p) {
  let out = L;
  if (p.shadows) {
    const w = 1 - smoothstep(0, 0.55, base);
    out *= Math.pow(2, (p.shadows / 100) * 1.25 * w);
  }
  if (p.highlights) {
    const w = smoothstep(0.4, 1, base);
    out *= Math.pow(2, (p.highlights / 100) * 0.85 * w);
  }
  if (p.whites) {
    const c = Math.min(1.2, Math.max(0, out));
    out += (p.whites / 100) * 0.35 * c * c * c;
  }
  if (p.blacks) {
    const c = Math.min(1, Math.max(0, 1 - out));
    out += (p.blacks / 100) * 0.18 * c * c * c;
  }
  if (p.contrast) {
    const k = Math.max(-0.8, (p.contrast / 100) * 1.1);
    const piv = 0.46;
    const x = Math.min(1, Math.max(0, out));
    const curved = x < piv
      ? piv * Math.pow(x / piv, 1 + k)
      : 1 - (1 - piv) * Math.pow(Math.max((1 - x) / (1 - piv), 0), 1 + k);
    out = curved + (out - x);
  }
  return out;
}

/** 色相（度）。用對立色空間的角度, 跟 HSV 幾乎一樣但只要一次 atan2。 */
function hueOf(r, g, b) {
  const a = r - 0.5 * (g + b);
  const bb = 0.8660254 * (g - b);
  return (Math.atan2(bb, a) * 180 / Math.PI + 360) % 360;
}

const HUE_X = BANDS.map(([, deg]) => deg).concat([360]);

function bandInterp(h, vals) {
  const table = vals.concat([vals[0]]);
  for (let i = 0; i < HUE_X.length - 1; i++) {
    if (h >= HUE_X[i] && h <= HUE_X[i + 1]) {
      const t = (h - HUE_X[i]) / (HUE_X[i + 1] - HUE_X[i]);
      return table[i] * (1 - t) + table[i + 1] * t;
    }
  }
  return table[0];
}

/** 繞著灰軸轉色相（Rodrigues）, 亮度不變。 */
function rotateHue(rgb, L, deg) {
  const th = deg * Math.PI / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const k = 0.57735027;
  const v = [rgb[0] - L, rgb[1] - L, rgb[2] - L];
  const kxv = [k * (v[2] - v[1]), k * (v[0] - v[2]), k * (v[1] - v[0])];
  const kdv = k * (v[0] + v[1] + v[2]);
  for (let i = 0; i < 3; i++) rgb[i] = v[i] * c + kxv[i] * s + k * kdv * (1 - c) + L;
  return rgb;
}

/**
 * 顆粒用的固定雜訊: 同一個格子每次都算出同一個值, 所以預覽與輸出對得起來;
 * 格子之間雙線性內插, 放大看才不會是一塊一塊的。
 */
function grainHash(gx, gy) {
  let s = (Math.imul(gx | 0, 374761393) + Math.imul(gy | 0, 668265263)) | 0;
  s = Math.imul(s ^ (s >>> 13), 1274126177) | 0;
  return ((s >>> 8) / 8388608) - 1;
}

function grainAt(fx, fy) {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const a = grainHash(x0, y0) * (1 - tx) + grainHash(x0 + 1, y0) * tx;
  const b = grainHash(x0, y0 + 1) * (1 - tx) + grainHash(x0 + 1, y0 + 1) * tx;
  return a * (1 - ty) + b * ty;
}

/* ============================================================
   套用到一塊像素
   ============================================================ */
/**
 * 把 rgba（Uint8ClampedArray, 就地改）套上調整。
 * @param {{x0:number,y0:number,w:number,h:number}} box 這一塊在整張（W×H）裡的位置
 */
export function applyTo(rgba, box, W, H, p, maps) {
  const { x0, y0, w, h } = box;
  const n = w * h;
  const buf = new Float32Array(n * 3);
  for (let i = 0, j = 0; i < n * 4; i += 4, j += 3) {
    buf[j] = rgba[i] / 255;
    buf[j + 1] = rgba[i + 1] / 255;
    buf[j + 2] = rgba[i + 2] / 255;
  }

  stageLinear(buf, n, p);

  const mw = maps.w;
  const mh = maps.h;
  const at = (map, px) => {
    const x = x0 + (px % w);
    const y = y0 + Math.floor(px / w);
    return sampleAt(map, mw, mh, W, H, x, y);
  };

  if (p.dehaze && maps.t) dehazeApply(buf, n, p.dehaze / 100, maps.A, maps.t, (px) => at(maps.t, px));

  // 攝影風格當成「底片」先套, 後面的滑桿在它上面微調（跟 iPhone 拍完再修圖一樣）。
  ST.apply(buf, n, p.style);

  // 紋理要看鄰近像素, 先把亮度平面拉出來做一次模糊。
  let detail = null;
  if (p.texture) {
    const Lplane = new Float32Array(n);
    for (let i = 0, px = 0; i < n * 3; i += 3, px++) {
      Lplane[px] = buf[i] * LUMA_R + buf[i + 1] * LUMA_G + buf[i + 2] * LUMA_B;
    }
    const blurred = blurDetail(Lplane, w, h, Math.max(W, H) / 900);
    detail = new Float32Array(n);
    for (let i = 0; i < n; i++) detail[i] = Lplane[i] - blurred[i];
  }

  const hsl = p.hsl;
  const hslOn = Object.values(hsl).some((vals) => vals.some((x) => Math.abs(x) > 1e-9));
  const names = BANDS.map(([nm]) => nm);
  const dH = names.map((nm) => hsl[nm][0] / 100 * 30);
  const dS = names.map((nm) => hsl[nm][1] / 100);
  const dL = names.map((nm) => hsl[nm][2] / 100);
  const anyH = dH.some((v) => v);
  const anyS = dS.some((v) => v);
  const anyL = dL.some((v) => v);

  const gr = p.grade;
  const gradeOn = gr.sh_sat || gr.hi_sat;
  let shTint = null;
  let hiTint = null;
  if (gradeOn) {
    const mk = (hue) => {
      const t = hueRgb(hue);
      const lum = t[0] * LUMA_R + t[1] * LUMA_G + t[2] * LUMA_B;
      return [t[0] - lum, t[1] - lum, t[2] - lum];
    };
    shTint = mk(gr.sh_hue);
    hiTint = mk(gr.hi_hue);
  }

  const vig = p.vignette;
  const vigMid = 0.15 + 0.7 * p.vig_mid / 100;
  const vigFe = 0.05 + 0.8 * p.vig_feather / 100;
  const diag = Math.SQRT2;

  const grainAmt = p.grain / 100 * 0.07;
  // 顆粒的大小跟著照片長邊走, 所以預覽與原尺寸的顆粒感一樣。
  const grainCell = Math.max(1, Math.round(Math.max(W, H) / (1.2 + p.grain_size / 100 * 4)));

  const rgb = [0, 0, 0];
  for (let px = 0; px < n; px++) {
    const i = px * 3;
    rgb[0] = buf[i]; rgb[1] = buf[i + 1]; rgb[2] = buf[i + 2];

    const L = rgb[0] * LUMA_R + rgb[1] * LUMA_G + rgb[2] * LUMA_B;
    let L2 = toneCurve(L, at(maps.base, px), p);

    if (p.clarity && maps.band) {
      const c = Math.min(1, Math.max(0, L2));
      const mid = Math.pow(Math.min(1, Math.max(0, 4 * c * (1 - c))), 0.6);
      L2 += (p.clarity / 100) * 1.6 * at(maps.band, px) * mid;
    }
    if (detail) L2 += (p.texture / 100) * 1.4 * detail[px];

    const ratio = (Math.max(L2, 0) + 0.02) / (Math.max(L, 0) + 0.02);
    rgb[0] *= ratio; rgb[1] *= ratio; rgb[2] *= ratio;

    /* ---- 顏色 ---- */
    if (p.vibrance || p.saturation) {
      const mx = Math.max(rgb[0], rgb[1], rgb[2]);
      const mn = Math.min(rgb[0], rgb[1], rgb[2]);
      const sat = mx - mn;
      let f = 1 + p.saturation / 100;
      if (p.vibrance) {
        const v = p.vibrance / 100;
        const room = 1 - Math.min(1, Math.max(0, sat));
        f += v > 0 ? v * room * room : v;
      }
      f = Math.max(f, 0);
      for (let c = 0; c < 3; c++) rgb[c] = L2 + (rgb[c] - L2) * f;
    }

    if (hslOn) {
      const h = hueOf(rgb[0], rgb[1], rgb[2]);
      const mx = Math.max(rgb[0], rgb[1], rgb[2]);
      const mn = Math.min(rgb[0], rgb[1], rgb[2]);
      // 越灰的像素受影響越少。
      const chroma = Math.min(1, Math.max(0, (mx - mn) / Math.max(mx, 1e-3)));
      if (anyH) {
        const Lg = rgb[0] * LUMA_R + rgb[1] * LUMA_G + rgb[2] * LUMA_B;
        rotateHue(rgb, Lg, bandInterp(h, dH) * chroma);
      }
      if (anyS) {
        const Lg = rgb[0] * LUMA_R + rgb[1] * LUMA_G + rgb[2] * LUMA_B;
        const f = Math.max(1 + bandInterp(h, dS), 0);
        for (let c = 0; c < 3; c++) rgb[c] = Lg + (rgb[c] - Lg) * f;
      }
      if (anyL) {
        const f = Math.pow(2, bandInterp(h, dL) * 1.1 * chroma);
        for (let c = 0; c < 3; c++) rgb[c] *= f;
      }
    }

    if (gradeOn) {
      const bal = gr.balance / 100;
      const Lc = Math.min(1, Math.max(0, L2));
      const wsh = 1 - smoothstep(0, 0.6 + 0.3 * bal, Lc);
      const whi = smoothstep(0.35 + 0.3 * bal, 1, Lc);
      if (gr.sh_sat) {
        const k = wsh * (gr.sh_sat / 100) * 0.25;
        for (let c = 0; c < 3; c++) rgb[c] += shTint[c] * k;
      }
      if (gr.hi_sat) {
        const k = whi * (gr.hi_sat / 100) * 0.25;
        for (let c = 0; c < 3; c++) rgb[c] += hiTint[c] * k;
      }
    }

    if (vig) {
      // 像素中心, 不是左上角 —— 差半個像素, 整圈的位置就會偏。
      const xn = ((x0 + (px % w) + 0.5) / W - 0.5) * 2;
      const yn = ((y0 + Math.floor(px / w) + 0.5) / H - 0.5) * 2;
      const rr = Math.sqrt(xn * xn + yn * yn) / diag;
      const m = smoothstep(vigMid - vigFe / 2, vigMid + vigFe / 2, rr);
      if (vig < 0) {
        const f = Math.pow(2, 1.8 * (vig / 100) * m);
        for (let c = 0; c < 3; c++) rgb[c] *= f;
      } else {
        const k = (vig / 100) * 0.85 * m;
        for (let c = 0; c < 3; c++) rgb[c] += (1 - rgb[c]) * k;
      }
    }

    if (p.grain) {
      const fx = (x0 + (px % w)) / grainCell;
      const fy = (y0 + Math.floor(px / w)) / grainCell;
      const noise = grainAt(fx, fy);
      const Lc = Math.min(1, Math.max(0, rgb[0] * LUMA_R + rgb[1] * LUMA_G + rgb[2] * LUMA_B));
      const amp = grainAmt * (0.35 + 0.65 * 4 * Lc * (1 - Lc));
      for (let c = 0; c < 3; c++) rgb[c] += noise * amp;
    }

    const o = px * 4;
    rgba[o] = softClip(rgb[0]) * 255;
    rgba[o + 1] = softClip(rgb[1]) * 255;
    rgba[o + 2] = softClip(rgb[2]) * 255;
  }
  return rgba;
}

/** 整張（或一張預覽）跑完。rgba 會被就地改寫。 */
export function render(rgba, W, H, p, maps) {
  if (isIdentity(p)) return rgba;
  const m = maps || prepare(rgba, W, H, p);
  applyTo(rgba, { x0: 0, y0: 0, w: W, h: H }, W, H, p, m);
  return rgba;
}

/* ============================================================
   自動色調
   ------------------------------------------------------------
   不猜公式, 直接在小圖上套用、量結果、再修正。
   原則是「補足」而不是「壓平」: 中間調只往 0.42 拉一部分（本來就偏亮 / 偏暗的
   照片保留氣氛）, 對比只會加不會減 —— 減對比加上壓亮部、提陰影, 照片就會灰白霧霧的。
   ============================================================ */
function percentile(sorted, q) {
  const i = Math.min(sorted.length - 1, Math.max(0, (sorted.length - 1) * q));
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] * (1 - (i - lo)) + sorted[hi] * (i - lo);
}

export function autoTone(rgba, W, H, p) {
  const small = downscale(rgba, W, H, 400);
  const n = small.w * small.h;
  const src = new Uint8ClampedArray(n * 4);
  for (let i = 0, j = 0; i < n * 3; i += 3, j += 4) {
    src[j] = small.data[i] * 255;
    src[j + 1] = small.data[i + 1] * 255;
    src[j + 2] = small.data[i + 2] * 255;
    src[j + 3] = 255;
  }

  const q = clone(p);
  Object.assign(q, {
    exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
    dehaze: 0, texture: 0, clarity: 0, vignette: 0, grain: 0,
  });

  const measure = () => {
    const buf = new Uint8ClampedArray(src);
    render(buf, small.w, small.h, q);
    const L = new Float64Array(n);
    let clipped = 0;
    let satSum = 0;
    for (let i = 0, px = 0; i < n * 4; i += 4, px++) {
      const r = buf[i] / 255;
      const g = buf[i + 1] / 255;
      const b = buf[i + 2] / 255;
      L[px] = r * LUMA_R + g * LUMA_G + b * LUMA_B;
      const mx = Math.max(r, g, b);
      if (mx >= 0.995) clipped++;
      satSum += mx - Math.min(r, g, b);
    }
    const sorted = Array.from(L).sort((a, b) => a - b);
    return {
      lo: percentile(sorted, 0.005), p5: percentile(sorted, 0.05), p10: percentile(sorted, 0.10),
      med: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), hi: percentile(sorted, 0.995),
      clip: clipped / n, sat: satSum / n,
    };
  };

  let m = measure();
  // 1. 曝光: 只修正一部分的差距, 而且有上下限。
  const ev = 0.6 * 2.2 * Math.log2(0.42 / Math.max(m.med, 0.02));
  q.exposure = Math.abs(ev) > 0.12 ? Math.min(1.5, Math.max(-1.5, ev)) : 0;
  m = measure();
  while (q.exposure > 0 && m.clip > 0.02) {       // 提亮不能把亮部燒掉
    q.exposure = Math.max(0, q.exposure - 0.25);
    m = measure();
  }
  // 2. 黑色被抬起來（霧、逆光）: 先去朦朧。
  if (m.lo > 0.12) {
    q.dehaze = Math.min(60, Math.max(0, (m.lo - 0.05) * 220));
    m = measure();
  }
  // 3. 亮部已經溢出才壓。死白的地方救不回來, 壓太多只會變成一片灰。
  if (m.clip > 0.01) {
    q.highlights = -Math.min(35, Math.max(12, m.clip * 500));
    m = measure();
  }
  // 4. 黑點、白點: 反覆量幾次, 拉到接近純黑 / 純白。
  for (let i = 0; i < 3; i++) {
    if (m.lo > 0.035 || m.lo < 0.008) {
      q.blacks = Math.min(25, Math.max(-70, q.blacks + (0.02 - m.lo) / 0.0018 * 0.8));
    }
    if (m.hi < 0.9 || m.hi > 0.985) {
      const denom = Math.max(0.0035 * Math.pow(m.hi, 3), 0.001);
      q.whites = Math.min(45, Math.max(-40, q.whites + (0.95 - m.hi) / denom * 0.8));
    }
    m = measure();
  }
  // 5. 對比只加不減: 中間 90% 的範圍太窄（平淡）才加。
  const spread = m.p95 - m.p5;
  if (spread < 0.6) {
    q.contrast = Math.min(30, Math.max(0, (0.68 - spread) * 90));
    m = measure();
  }
  // 6. 暗部整片看不見才稍微提一點陰影。
  if (m.p10 < 0.05 && m.med < 0.38) {
    q.shadows = Math.min(30, Math.max(0, (0.05 - m.p10) * 500));
  }
  // 7. 顏色太淡補一點細節飽和度。
  const vib = m.sat < 0.13 ? Math.min(20, Math.max(0, (0.13 - m.sat) * 200)) : 0;

  return {
    exposure: Math.round(q.exposure * 100) / 100,
    contrast: Math.round(q.contrast),
    highlights: Math.round(q.highlights),
    shadows: Math.round(q.shadows),
    whites: Math.round(q.whites),
    blacks: Math.round(q.blacks),
    dehaze: Math.round(q.dehaze),
    vibrance: Math.round(vib),
  };
}
