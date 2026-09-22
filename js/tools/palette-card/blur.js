// js/tools/palette-card/blur.js — 毛玻璃用的模糊。
//
// 為什麼自己寫而不用 CSS 的 backdrop-filter: 預覽跟輸出必須是同一條路。
// backdrop-filter 只存在於畫面上, canvas 匯出時它不會跟著出現, 於是預覽好看、
// 存下來卻是一塊沒模糊的死板方框。這裡整張卡片（含預覽）都是畫在 canvas 上,
// 模糊就得自己算。
//
// 方法是三次方框模糊。單次方框模糊很醜（會有明顯的方形暈）, 但連做三次的
// 結果和高斯模糊幾乎分不出來, 而且每個像素只要加一次、減一次 —— 跟半徑
// 無關, 半徑 60 跟半徑 5 一樣快。

/** 三次方框模糊要達到某個高斯 sigma, 單次該用的半徑。 */
const boxRadius = (sigma) => Math.max(1, Math.round(sigma * 0.94));

/**
 * 一維方框模糊, 橫豎共用。
 *
 * 用 lineStep／pixStep 表示「走到下一條線」與「走到線上的下一點」要跳多少,
 * 橫的就是 (寬*4, 4)、豎的就是 (4, 寬*4), 於是同一段程式碼兩個方向都能跑。
 */
function blurLines(src, dst, lines, len, lineStep, pixStep, radius) {
  const span = radius * 2 + 1;
  for (let line = 0; line < lines; line += 1) {
    const base = line * lineStep;
    const last = base + (len - 1) * pixStep;

    // 起始視窗。超出邊界的部分拿邊緣像素補 —— 補 0 的話邊緣會透出一圈黑。
    let r = 0; let g = 0; let b = 0; let a = 0;
    for (let i = -radius; i <= radius; i += 1) {
      const p = base + Math.min(len - 1, Math.max(0, i)) * pixStep;
      r += src[p]; g += src[p + 1]; b += src[p + 2]; a += src[p + 3];
    }

    for (let i = 0; i < len; i += 1) {
      const q = base + i * pixStep;
      dst[q] = r / span;
      dst[q + 1] = g / span;
      dst[q + 2] = b / span;
      dst[q + 3] = a / span;

      const out = i - radius <= 0 ? base : base + (i - radius) * pixStep;
      const into = i + radius + 1 >= len ? last : base + (i + radius + 1) * pixStep;
      r += src[into] - src[out];
      g += src[into + 1] - src[out + 1];
      b += src[into + 2] - src[out + 2];
      a += src[into + 3] - src[out + 3];
    }
  }
}

/**
 * 就地模糊一塊 RGBA 像素。
 *
 * 中間過程用 Float32 存, 只有最後才寫回 8 位元。橫豎各三次總共六趟, 每趟都
 * 四捨五入回 0–255 的話, 誤差會累積成看得出來的東西: 對稱的輸入會得到不對稱
 * 的輸出（先橫後豎與先豎後橫的捨入方向不同）, 大半徑下平坦區還會出現條紋。
 *
 * @param {Uint8ClampedArray} data 會被直接改寫
 * @param {number} sigma 想要的高斯半徑
 */
export function blur(data, width, height, sigma, passes = 3) {
  const radius = boxRadius(sigma);
  if (radius < 1 || width < 2 || height < 2) return data;

  const a = Float32Array.from(data);
  const b = new Float32Array(data.length);
  for (let i = 0; i < passes; i += 1) {
    blurLines(a, b, height, width, width * 4, 4, radius);
    blurLines(b, a, width, height, 4, width * 4, radius);
  }
  data.set(a);   // 寫進 Uint8ClampedArray 時自動四捨五入並夾在 0–255
  return data;
}
