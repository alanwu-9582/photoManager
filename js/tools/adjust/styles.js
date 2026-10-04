// js/tools/adjust/styles.js — 攝影風格（從桌面版 tools/adjust/styles.py 移植）。
//
// 參考 iPhone 16 之後的相機「攝影風格」, 分兩類:
//   膚色基調: 標準、琥珀色、金色、玫瑰金色、中性、冷玫瑰色 —— 主要改膚色與中間調的色溫色調
//   氛圍:     鮮明、自然、明亮、戲劇效果、寧靜、溫馨、空靈、柔和 / 強烈黑白 —— 改整體明暗與飽和
//
// 每個風格再用一塊方形控制板微調: 上下是「色調」（往上陰影變亮、比較柔；往下陰影變深、
// 對比強）, 左右是「色彩」（往左淡、往右濃）；「色盤」滑桿控制這個風格的顏色有多強。
//
// 這是依 Apple 公開的效果描述做的近似, 不是原始演算法。全部在 sRGB 上逐像素計算,
// 所以預覽與原尺寸輸出一致。

const STYLES = {
  standard: {},
  amber: { cast: [0.050, 0.014, -0.050], sat: 1.04, contrast: 0.05 },
  gold: { cast: [0.040, 0.030, -0.070], sat: 1.08, bright: 0.04, hi: [1.0, 0.86, 0.48] },
  rose_gold: { cast: [0.052, -0.012, -0.012], sat: 1.0, hi: [1.0, 0.76, 0.72] },
  neutral: { cast: [-0.026, 0.0, 0.024], sat: 0.94 },
  cool_rose: { cast: [0.018, -0.024, 0.042], sat: 1.0 },
  vibrant: { sat: 1.32, contrast: 0.12 },
  natural: { sat: 1.06, contrast: -0.06, bright: 0.02 },
  luminous: { bright: 0.12, contrast: -0.10, sat: 1.10, fade: 0.015 },
  dramatic: { contrast: 0.36, bright: -0.10, sat: 0.88, cast: [-0.010, 0.0, 0.020] },
  quiet: { contrast: -0.28, fade: 0.07, sat: 0.72, cast: [0.016, 0.008, -0.010], bright: 0.03 },
  cozy: { cast: [0.056, 0.020, -0.046], bright: -0.07, contrast: 0.10, sat: 1.04 },
  ethereal: {
    bright: 0.10, contrast: -0.30, fade: 0.05, sat: 0.78,
    cast: [0.020, -0.010, 0.036], hi: [1.0, 0.86, 0.96],
  },
  muted_bw: { bw: true, contrast: -0.18, fade: 0.04 },
  stark_bw: { bw: true, contrast: 0.46, bright: -0.04 },
};

export const UNDERTONES = [
  ["standard", "標準"], ["amber", "琥珀色"], ["gold", "金色"],
  ["rose_gold", "玫瑰金色"], ["neutral", "中性"], ["cool_rose", "冷玫瑰色"],
];

export const MOODS = [
  ["vibrant", "鮮明"], ["natural", "自然"], ["luminous", "明亮"], ["dramatic", "戲劇效果"],
  ["quiet", "寧靜"], ["cozy", "溫馨"], ["ethereal", "空靈"],
  ["muted_bw", "柔和黑白"], ["stark_bw", "強烈黑白"],
];

export const NAMES = Object.fromEntries([...UNDERTONES, ...MOODS]);

export const DEFAULT = { name: "standard", tone: 0, color: 0, palette: 100 };

const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

export function isIdentity(st) {
  if (!st) return true;
  return (st.name || "standard") === "standard"
    && Math.abs(st.tone || 0) < 1e-9
    && Math.abs(st.color || 0) < 1e-9;
}

/** 以 0.46 為支點的 S 曲線；c > 0 加對比、c < 0 變柔。 */
function contrastCurve(L, c) {
  if (Math.abs(c) < 1e-6) return L;
  const k = Math.max(-0.8, c * 1.1);
  const piv = 0.46;
  const x = Math.min(1, Math.max(0, L));
  const curved = x < piv
    ? piv * Math.pow(x / piv, 1 + k)
    : 1 - (1 - piv) * Math.pow(Math.max((1 - x) / (1 - piv), 0), 1 + k);
  return curved + (L - x);
}

/**
 * 就地把攝影風格套到一塊 sRGB（Float32Array, 每像素三個值, 0..1 可能略超過）。
 * @param {Float32Array} buf
 * @param {number} n 像素數
 */
export function apply(buf, n, st) {
  if (isIdentity(st)) return buf;
  const S = STYLES[st.name || "standard"] || {};
  const pal = (st.palette === undefined ? 100 : st.palette) / 100;
  const tone = (st.tone || 0) / 100;
  const col = (st.color || 0) / 100;

  const bright = S.bright || 0;
  const contrast = (S.contrast || 0) - 0.32 * tone;
  const fade = S.fade || 0;
  const bw = !!S.bw;
  const cast = S.cast;
  const hi = S.hi;

  let sat = 1 + ((S.sat === undefined ? 1 : S.sat) - 1) * pal;
  sat *= 1 + (col > 0 ? 0.65 * col : 0.85 * col);
  sat = Math.max(sat, 0);

  let hiTint = null;
  if (hi) {
    const lum = hi[0] * LUMA_R + hi[1] * LUMA_G + hi[2] * LUMA_B;
    hiTint = [hi[0] - lum, hi[1] - lum, hi[2] - lum];
  }
  const castAmt = pal * (1 + 0.6 * col);

  for (let i = 0; i < n * 3; i += 3) {
    let r = buf[i];
    let g = buf[i + 1];
    let b = buf[i + 2];

    /* 1. 明暗: 亮度、對比（含「色調」軸）、陰影 */
    const L = r * LUMA_R + g * LUMA_G + b * LUMA_B;
    let L2 = L * (1 + bright);
    L2 = contrastCurve(L2, contrast);
    if (tone) {
      const c = Math.min(1, Math.max(0, 1 - Math.min(1, Math.max(0, L2))));
      L2 += (tone > 0 ? 0.09 : 0.06) * tone * c * c * c;
    }
    const ratio = (Math.max(L2, 0) + 0.02) / (Math.max(L, 0) + 0.02);
    r *= ratio; g *= ratio; b *= ratio;
    if (fade) {
      r = fade + r * (1 - fade);
      g = fade + g * (1 - fade);
      b = fade + b * (1 - fade);
    }

    /* 2. 顏色 */
    const gray = r * LUMA_R + g * LUMA_G + b * LUMA_B;
    if (bw) {
      // 黑白: 色盤調低會留一點原本的顏色。
      const keep = (1 - pal) * 0.6;
      buf[i] = gray + (r - gray) * keep;
      buf[i + 1] = gray + (g - gray) * keep;
      buf[i + 2] = gray + (b - gray) * keep;
      continue;
    }
    r = gray + (r - gray) * sat;
    g = gray + (g - gray) * sat;
    b = gray + (b - gray) * sat;

    if (cast) {
      // 膚色多半在中間調, 主要改中間調。
      const Lc = Math.min(1, Math.max(0, r * LUMA_R + g * LUMA_G + b * LUMA_B));
      const w = Math.min(1, Math.max(0, 4 * Lc * (1 - Lc) * 1.25));
      r += cast[0] * castAmt * w;
      g += cast[1] * castAmt * w;
      b += cast[2] * castAmt * w;
    }
    if (hiTint) {
      const Lc = Math.min(1, Math.max(0, r * LUMA_R + g * LUMA_G + b * LUMA_B));
      const whi = Math.pow(Math.min(1, Math.max(0, (Lc - 0.55) / 0.45)), 2);
      r += whi * hiTint[0] * 0.10 * pal;
      g += whi * hiTint[1] * 0.10 * pal;
      b += whi * hiTint[2] * 0.10 * pal;
    }

    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
  }
  return buf;
}
