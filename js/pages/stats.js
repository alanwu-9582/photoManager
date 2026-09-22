// js/pages/stats.js — 統計數據: 這批照片的拍攝參數分佈。
//
// 圖表挑過型別, 不是全部都用長條:
//   直方圖   焦段、ISO —— 值本身有順序, 看的是分佈的形狀
//   甜甜圈   光圈、白平衡、創意風格、格式 —— 看的是誰佔多少比例
//   橫條     相機、鏡頭、快門 —— 名稱很長, 橫著排才讀得完
//
// 全部用行內 SVG 畫, 沒有圖表函式庫。

import { escapeHtml } from "../utils/utils.js";
import { onLibraryChange } from "../app/state.js";
import { showProgress, hideProgress, renderSourceInfo } from "../app/source.js";

const $ = (id) => document.getElementById(id);

/** 甜甜圈的配色。深色底上這幾個色相彼此分得開。 */
const SLICE_COLORS = [
  "var(--cffy-theme-primary-a20)",
  "var(--cffy-theme-info-a0)",
  "var(--cffy-theme-success-a0)",
  "var(--cffy-theme-warning-a0)",
  "var(--cffy-theme-danger-a0)",
  "var(--cffy-theme-primary-a40)",
  "var(--cffy-theme-surface-a50)",
];

function bucketCount(values, formatter) {
  const map = new Map();
  values.forEach((v) => {
    if (v === null || v === undefined || Number.isNaN(v)) return;
    const key = formatter(v);
    map.set(key, (map.get(key) || 0) + 1);
  });
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

/* ============================================================
   圖表
   ============================================================ */
function card(title, sub, body) {
  const wrap = document.createElement("div");
  wrap.className = "stat-card";
  const head = document.createElement("div");
  head.className = "stat-title";
  head.innerHTML = `${escapeHtml(title)}${sub ? ` <span class="sub">${escapeHtml(sub)}</span>` : ""}`;
  wrap.appendChild(head);
  if (!body) {
    const e = document.createElement("div");
    e.className = "stat-empty";
    e.textContent = "—";
    wrap.appendChild(e);
  } else {
    wrap.appendChild(body);
  }
  return wrap;
}

/** 橫條: 名稱長的用這個, 一列一項。 */
function bars(entries, maxBars = 10) {
  if (!entries.length) return null;
  const host = document.createElement("div");
  host.className = "bar-list";
  const max = Math.max(...entries.map((e) => e[1]));
  entries.slice(0, maxBars).forEach(([label, count]) => {
    const row = document.createElement("div");
    row.className = "bar-row";
    row.innerHTML = `
      <div class="bar-label" title="${escapeHtml(label)}">${escapeHtml(label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(count / max * 100).toFixed(1)}%"></div></div>
      <div class="bar-count">${count}</div>`;
    host.appendChild(row);
  });
  return host;
}

/**
 * 直方圖: 值本身有順序（焦段、ISO）, 直著排才看得出分佈往哪邊偏。
 * @param {Array<[string, number]>} entries 已經照順序排好
 */
function columns(entries) {
  if (!entries.length) return null;
  const max = Math.max(...entries.map((e) => e[1]));
  const n = entries.length;
  const W = Math.max(280, n * 34);
  const H = 150;
  const padBottom = 26;
  const gap = W / n * 0.22;
  const barW = W / n - gap;
  // 刻度太密就跳著標, 免得字疊在一起。
  const step = Math.ceil(n / 8);

  const parts = entries.map(([label, count], i) => {
    const h = Math.max(2, (count / max) * (H - padBottom - 6));
    const x = (i * W) / n + gap / 2;
    const y = H - padBottom - h;
    const tick = i % step === 0
      ? `<text class="col-tick" x="${(x + barW / 2).toFixed(1)}" y="${H - 8}">${escapeHtml(label)}</text>`
      : "";
    return `<rect class="col-bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}"`
      + ` height="${h.toFixed(1)}" rx="3"><title>${escapeHtml(label)}: ${count}</title></rect>${tick}`;
  }).join("");

  const host = document.createElement("div");
  host.className = "chart-scroll";
  host.innerHTML = `<svg class="chart-columns" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"
      role="img" aria-label="分佈圖">
      <line class="col-axis" x1="0" y1="${H - padBottom}" x2="${W}" y2="${H - padBottom}"/>
      ${parts}
    </svg>`;
  return host;
}

/** 極座標 → 直角座標。 */
function polar(cx, cy, r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

/** 甜甜圈: 看誰佔多少。超過 6 種就把尾巴併成「其他」, 不然圖會碎掉。 */
function donut(entries, maxSlices = 6) {
  if (!entries.length) return null;
  const total = entries.reduce((sum, e) => sum + e[1], 0);
  const head = entries.slice(0, maxSlices);
  const rest = entries.slice(maxSlices).reduce((sum, e) => sum + e[1], 0);
  const slices = rest ? [...head, ["其他", rest]] : head;

  const size = 132;
  const cx = size / 2;
  const cy = size / 2;
  const outer = size / 2 - 2;
  const inner = outer * 0.62;

  let at = 0;
  const paths = slices.map(([label, count], i) => {
    const sweep = (count / total) * 360;
    // 只有一種值的時候畫不出扇形, 直接補一個整圈。
    const a0 = at;
    const a1 = at + (sweep >= 359.9 ? 359.9 : sweep);
    at = a1;
    const [x0, y0] = polar(cx, cy, outer, a0);
    const [x1, y1] = polar(cx, cy, outer, a1);
    const [x2, y2] = polar(cx, cy, inner, a1);
    const [x3, y3] = polar(cx, cy, inner, a0);
    const large = sweep > 180 ? 1 : 0;
    const d = `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${outer} ${outer} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
      + ` L ${x2.toFixed(2)} ${y2.toFixed(2)} A ${inner} ${inner} 0 ${large} 0 ${x3.toFixed(2)} ${y3.toFixed(2)} Z`;
    return `<path d="${d}" fill="${SLICE_COLORS[i % SLICE_COLORS.length]}">`
      + `<title>${escapeHtml(label)}: ${count}</title></path>`;
  }).join("");

  const legend = slices.map(([label, count], i) => `
    <li>
      <span class="legend-swatch" style="background:${SLICE_COLORS[i % SLICE_COLORS.length]}"></span>
      <span class="legend-name" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
      <span class="legend-value">${Math.round((count / total) * 100)}%</span>
    </li>`).join("");

  const host = document.createElement("div");
  host.className = "chart-donut";
  host.innerHTML = `
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="比例圖">
      ${paths}
      <text class="donut-total" x="${cx}" y="${cy + 5}" text-anchor="middle">${total}</text>
    </svg>
    <ul class="chart-legend">${legend}</ul>`;
  return host;
}

/* ============================================================
   頁面
   ============================================================ */
function renderStats() {
  const container = $("statsGrid");
  if (!container) return;
  const s = PMLibrary.stats();
  $("statsProgress").textContent = s.total ? `${s.analysed} / ${s.total}` : "—";
  $("scanAllBtn").disabled = !s.total || s.analysed >= s.total;

  const infos = PMLibrary.photos.map((p) => p.info).filter(Boolean);

  const focal = bucketCount(infos.map((i) => i.focalLengthRaw), (v) => {
    const lower = Math.floor(v / 10) * 10;
    return `${lower}-${lower + 9}`;
  }).sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10));

  const iso = bucketCount(infos.map((i) => i.iso), (v) => String(v))
    .sort((a, b) => Number(a[0]) - Number(b[0]));

  const aperture = bucketCount(infos.map((i) => (i.fNumber ? parseFloat(i.fNumber.replace("f/", "")) : null)), (v) => "f/" + v);
  const shutter = bucketCount(infos.map((i) => i.exposureTimeRaw), (v) => PMExif.fmtShutter(v));
  const wb = bucketCount(infos.map((i) => i.whiteBalanceRaw), (v) => (PMExif.WHITE_BALANCE_STD[v] ?? ("代碼 " + v)));
  const cameras = bucketCount(infos.map((i) => i.model), (v) => v);
  const lenses = bucketCount(infos.map((i) => i.lensModel), (v) => v);
  const styles = bucketCount(infos.map((i) => i.creativeStyle), (v) => v);
  const formats = bucketCount(
    PMLibrary.photos.map((p) => {
      const dot = p.name.lastIndexOf(".");
      return dot > 0 ? p.name.slice(dot + 1).toUpperCase() : null;
    }),
    (v) => v,
  );

  container.replaceChildren(
    card("焦段", "mm", columns(focal)),
    card("ISO", "", columns(iso)),
    card("光圈", "", donut(aperture)),
    card("快門", "", bars(shutter)),
    card("白平衡", "", donut(wb)),
    card("檔案格式", "", donut(formats)),
    card("相機", "", bars(cameras)),
    card("鏡頭", "", bars(lenses)),
    card("創意風格", "Sony", donut(styles)),
  );
}

export function mountPage() {
  let scanTask = null;

  $("scanAllBtn").addEventListener("click", async () => {
    if (!PMLibrary.photos.length || scanTask) return;
    $("scanAllBtn").disabled = true;
    scanTask = PMLibrary.scanAllInfo((done, total) => {
      showProgress(done, total, "分析 EXIF");
      const label = $("statsProgress");
      if (label) label.textContent = `${done} / ${total}`;
      renderSourceInfo();
    });
    await scanTask.promise;
    scanTask = null;
    hideProgress();
    renderSourceInfo();
    renderStats();
  });

  renderStats();
  const off = onLibraryChange(renderStats);
  return () => {
    // 離開這一頁就沒必要再掃下去, 掃到一半的結果已經存在各張照片上了。
    scanTask?.abort();
    hideProgress();
    off();
  };
}
