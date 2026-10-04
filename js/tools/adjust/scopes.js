// js/tools/adjust/scopes.js — 照片參數（從桌面版 ui/scopes.py 移植）。
//
//   直方圖  R / G / B 三個色版疊在一起 + 亮度線；兩邊的三角形亮起來代表有死白 / 死黑
//   波形    每一直條是照片的那一欄, 越上面越亮 —— 看得出哪個區域過曝
//   顏色    向量示波器: 離中心越遠越飽和、角度是色相; 下面是代表色
//   曝光    平均 / 中間調亮度、動態範圍、溢出比例、色偏
//
// 全部在長邊 EDGE 的縮圖上算, 換一次預覽只要幾毫秒。
// 疊在深色畫布上, 所以顏色跟主題無關（規範 §8.2）。

import { el } from "../../utils/utils.js";

export const TABS = [
  { value: "hist", label: "直方圖" },
  { value: "wave", label: "波形" },
  { value: "color", label: "顏色" },
  { value: "expo", label: "曝光" },
];

const EDGE = 360;
const CHART_W = 300;
const CHART_H = 140;

function smallPixels(rgba, W, H) {
  const step = Math.max(1, Math.ceil(Math.max(W, H) / EDGE));
  const w = Math.ceil(W / step);
  const h = Math.ceil(H / step);
  const out = new Uint8ClampedArray(w * h * 3);
  let d = 0;
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      const s = (y * W + x) * 4;
      out[d++] = rgba[s];
      out[d++] = rgba[s + 1];
      out[d++] = rgba[s + 2];
    }
  }
  return { data: out, w, h };
}

/** 一次掃完, 四張圖表要的統計都在這裡算好。 */
export function analyse(rgba, W, H) {
  const { data, w, h } = smallPixels(rgba, W, H);
  const n = w * h;

  const hist = [new Float32Array(256), new Float32Array(256), new Float32Array(256)];
  const histL = new Float32Array(256);
  // 波形: 每一欄 × 64 段亮度
  const waveW = Math.min(w, 256);
  const wave = new Float32Array(waveW * 64);
  // 向量示波器: 128×128 的格子
  const vec = new Float32Array(128 * 128);

  let sumL = 0;
  let clipHi = 0;
  let clipLo = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  const lums = new Float32Array(n);

  for (let px = 0; px < n; px++) {
    const i = px * 3;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    hist[0][r]++; hist[1][g]++; hist[2][b]++;
    const L = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
    histL[Math.min(255, Math.round(L * 255))]++;
    lums[px] = L;
    sumL += L;
    sumR += r; sumG += g; sumB += b;
    const mx = Math.max(r, g, b);
    if (mx >= 254) clipHi++;
    if (mx <= 2) clipLo++;

    const col = Math.floor((px % w) * waveW / w);
    wave[Math.min(63, Math.floor(L * 63)) * waveW + col]++;

    // U / V（BT.709 的色差）→ 向量示波器的座標
    const u = (-0.1146 * r - 0.3854 * g + 0.5 * b) / 255;
    const v = (0.5 * r - 0.4542 * g - 0.0458 * b) / 255;
    const vx = Math.min(127, Math.max(0, Math.round((u + 0.5) * 127)));
    const vy = Math.min(127, Math.max(0, Math.round((0.5 - v) * 127)));
    vec[vy * 128 + vx]++;
  }

  const sorted = Float32Array.from(lums).sort();
  const pct = (q) => sorted[Math.min(n - 1, Math.max(0, Math.round((n - 1) * q)))];

  // 代表色: 量化成 16×16×16 的格子。只看數量的話暗部與灰色會把位子全佔掉,
  // 所以鮮豔一點、亮一點的格子加權, 挑出來的才像是「這張照片的顏色」。
  const bucket = new Map();
  for (let px = 0; px < n; px++) {
    const i = px * 3;
    const key = (data[i] >> 4) * 256 + (data[i + 1] >> 4) * 16 + (data[i + 2] >> 4);
    const b = bucket.get(key) || [0, 0, 0, 0];
    b[0] += data[i]; b[1] += data[i + 1]; b[2] += data[i + 2]; b[3]++;
    bucket.set(key, b);
  }
  const scored = [...bucket.entries()].map(([key, b]) => {
    const qr = (key >> 8) & 15;
    const qg = (key >> 4) & 15;
    const qb = key & 15;
    const qmax = Math.max(qr, qg, qb);
    const chroma = (qmax - Math.min(qr, qg, qb)) / 15;
    return {
      score: b[3] * (0.25 + chroma * 1.5) * (0.4 + 0.6 * (qmax / 15)),
      rgb: [Math.round(b[0] / b[3]), Math.round(b[1] / b[3]), Math.round(b[2] / b[3])],
    };
  }).sort((a, b) => b.score - a.score);

  // 彼此差得不夠遠的就跳過, 免得六格看起來是同一個顏色。
  const picks = [];
  for (const c of scored) {
    if (picks.length >= 6) break;
    const far = picks.every((q) =>
      Math.abs(q[0] - c.rgb[0]) + Math.abs(q[1] - c.rgb[1]) + Math.abs(q[2] - c.rgb[2]) > 60);
    if (far) picks.push(c.rgb);
  }
  const swatches = picks.map((c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`);

  return {
    hist, histL, wave, waveW, vec, swatches, n,
    mean: sumL / n,
    median: pct(0.5),
    lo: pct(0.005),
    hi: pct(0.995),
    clipHi: clipHi / n,
    clipLo: clipLo / n,
    cast: [sumR / n, sumG / n, sumB / n],
  };
}

/* ============================================================
   畫圖
   ============================================================ */
function canvas() {
  const c = el("canvas", { class: "sc-chart" });
  c.width = CHART_W * 2;
  c.height = CHART_H * 2;
  c.style.width = CHART_W + "px";
  c.style.height = CHART_H + "px";
  return c;
}

function drawHistogram(ctx, s) {
  const W = CHART_W * 2;
  const H = CHART_H * 2;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(0, 0, W, H);

  // 兩端的 0 與 255 常常爆量, 高度上限設在「其他地方的最高點」, 圖才不會被壓扁。
  let peak = 0;
  for (let c = 0; c < 3; c++) for (let i = 2; i < 254; i++) peak = Math.max(peak, s.hist[c][i]);
  for (let i = 2; i < 254; i++) peak = Math.max(peak, s.histL[i]);
  if (!peak) return;

  // 參考線（規範 §8.2: 白色 12–27%）
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 2;
  for (let i = 1; i < 4; i++) {
    const x = (i / 4) * W;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }

  // 三個色版用「相加」混合, 重疊處自然變灰白。
  ctx.globalCompositeOperation = "lighter";
  const colors = ["rgba(255,70,70,0.41)", "rgba(70,255,120,0.41)", "rgba(90,140,255,0.41)"];
  for (let c = 0; c < 3; c++) {
    ctx.fillStyle = colors[c];
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let i = 0; i < 256; i++) {
      const v = Math.pow(Math.min(1, s.hist[c][i] / peak), 0.45);
      ctx.lineTo((i / 255) * W, H - v * (H - 6));
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";

  // 亮度線
  const peakL = peak;
  ctx.strokeStyle = "rgba(255,255,255,0.78)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < 256; i++) {
    const v = Math.pow(Math.min(1, s.histL[i] / peakL), 0.45);
    const x = (i / 255) * W;
    const y = H - v * (H - 6);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // 死黑 / 死白的三角形: 有問題時白色, 沒問題時 20% 白。
  const tri = (x, dir, on) => {
    ctx.fillStyle = on ? "#ffffff" : "rgba(255,255,255,0.2)";
    ctx.beginPath();
    ctx.moveTo(x, 8);
    ctx.lineTo(x + 14 * dir, 8);
    ctx.lineTo(x + 7 * dir, 24);
    ctx.closePath();
    ctx.fill();
  };
  tri(6, 1, s.clipLo > 0.002);
  tri(W - 6, -1, s.clipHi > 0.002);
}

function drawWaveform(ctx, s) {
  const W = CHART_W * 2;
  const H = CHART_H * 2;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(0, 0, W, H);

  let peak = 0;
  for (let i = 0; i < s.wave.length; i++) peak = Math.max(peak, s.wave[i]);
  if (!peak) return;

  const img = ctx.createImageData(s.waveW, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < s.waveW; x++) {
      // log 壓一下, 少的地方也看得到。
      const v = Math.log1p(s.wave[(63 - y) * s.waveW + x]) / Math.log1p(peak);
      const a = Math.min(255, Math.pow(v, 0.7) * 255);
      const o = (y * s.waveW + x) * 4;
      img.data[o] = 255; img.data[o + 1] = 255; img.data[o + 2] = 255; img.data[o + 3] = a;
    }
  }
  // createImageData 的大小固定, 先畫到暫存再拉開。
  const tmp = new OffscreenCanvas(s.waveW, 64);
  tmp.getContext("2d").putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tmp, 0, 0, W, H);

  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 2;
  for (const f of [0.25, 0.5, 0.75]) {
    ctx.beginPath();
    ctx.moveTo(0, H * f);
    ctx.lineTo(W, H * f);
    ctx.stroke();
  }
}

function drawVector(ctx, s) {
  const W = CHART_W * 2;
  const H = CHART_H * 2;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(0, 0, W, H);

  const size = Math.min(W, H) - 8;
  const cx = W / 2;
  const cy = H / 2;

  let peak = 0;
  for (let i = 0; i < s.vec.length; i++) peak = Math.max(peak, s.vec[i]);
  if (peak) {
    const img = ctx.createImageData(128, 128);
    for (let i = 0; i < s.vec.length; i++) {
      const v = Math.log1p(s.vec[i]) / Math.log1p(peak);
      img.data[i * 4] = 255;
      img.data[i * 4 + 1] = 255;
      img.data[i * 4 + 2] = 255;
      img.data[i * 4 + 3] = Math.min(255, Math.pow(v, 0.7) * 255);
    }
    const tmp = new OffscreenCanvas(128, 128);
    tmp.getContext("2d").putImageData(img, 0, 0);
    ctx.drawImage(tmp, cx - size / 2, cy - size / 2, size, size);
  }

  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 2;
  for (const r of [0.33, 0.66, 1]) {
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2 * r, 0, Math.PI * 2);
    ctx.stroke();
  }
  // 膚色線（約 123°）
  ctx.strokeStyle = "rgba(255,210,170,0.45)";
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  const ang = (123 * Math.PI) / 180;
  ctx.lineTo(cx + Math.cos(-ang) * size / 2, cy + Math.sin(-ang) * size / 2);
  ctx.stroke();
}

function expoRows(s) {
  const ev = (v) => (v <= 0 ? "—" : (Math.log2(v / 0.18)).toFixed(2) + " EV");
  const pct = (v) => (v * 100).toFixed(v >= 0.01 ? 1 : 2) + "%";
  const [r, g, b] = s.cast;
  const avg = (r + g + b) / 3 || 1;
  const cast = Math.abs(r - avg) + Math.abs(b - avg) > avg * 0.06
    ? (r > b ? "偏暖" : "偏冷")
    : "中性";
  return [
    ["平均亮度", s.mean.toFixed(3) + "  " + ev(s.mean)],
    ["中間調", s.median.toFixed(3) + "  " + ev(s.median)],
    ["動態範圍", `${s.lo.toFixed(3)} – ${s.hi.toFixed(3)}`],
    ["死白", pct(s.clipHi)],
    ["死黑", pct(s.clipLo)],
    ["色偏", cast],
  ];
}

/* ============================================================
   面板
   ============================================================ */
/**
 * 疊在畫布左下角的「照片參數」。收起時是一顆膠囊, 點了展開。
 * 展開狀態與目前的分頁會記住（規範 §7.2）。
 */
export function createScopes() {
  let open = false;
  let tab = "hist";
  let stats = null;

  const chart = canvas();
  const table = el("div", { class: "sc-rows" });
  const swatches = el("div", { class: "sc-swatches" });
  const body = el("div", { class: "sc-body" }, chart, swatches, table);

  const tabsRow = el("div", { class: "sc-tabs", role: "tablist" });
  const tabButtons = new Map();
  TABS.forEach((t) => {
    const btn = el("button", {
      type: "button", class: "sc-tab", role: "tab",
      onclick: () => { tab = t.value; paint(); },
    }, t.label);
    tabButtons.set(t.value, btn);
    tabsRow.appendChild(btn);
  });

  const caret = el("span", { class: "sc-caret" }, "▸");
  const head = el("button", { type: "button", class: "sc-head" }, caret, el("span", {}, "照片參數"));
  const host = el("div", { class: "sc-panel" }, head, el("div", { class: "sc-inner" }, tabsRow, body));

  function paint() {
    host.classList.toggle("is-open", open);
    caret.textContent = open ? "▾" : "▸";
    head.setAttribute("aria-expanded", String(open));
    tabButtons.forEach((btn, key) => btn.classList.toggle("is-active", key === tab));
    if (!open || !stats) return;

    const showChart = tab !== "expo";
    chart.hidden = !showChart;
    swatches.hidden = tab !== "color";
    table.hidden = tab !== "expo";

    const ctx = chart.getContext("2d");
    if (tab === "hist") drawHistogram(ctx, stats);
    else if (tab === "wave") drawWaveform(ctx, stats);
    else if (tab === "color") drawVector(ctx, stats);

    if (tab === "color") {
      swatches.replaceChildren(...stats.swatches.map((c) =>
        el("span", { class: "sc-swatch", style: `background:${c}`, title: c })));
    }
    if (tab === "expo") {
      table.replaceChildren(...expoRows(stats).flatMap(([k, v]) => [
        el("span", { class: "sc-k" }, k),
        el("span", { class: "sc-v" }, v),
      ]));
    }
  }

  head.addEventListener("click", () => { open = !open; paint(); });

  paint();
  return {
    node: host,
    /** 餵新的預覽進來。沒展開就只記著, 展開時才畫。 */
    update(rgba, w, h) {
      stats = analyse(rgba, w, h);
      if (open) paint();
    },
    clear() { stats = null; paint(); },
  };
}
