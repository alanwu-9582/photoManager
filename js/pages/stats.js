// js/pages/stats.js — 統計數據: 這批照片的拍攝參數分佈。

import { escapeHtml } from "../utils/utils.js";
import { onLibraryChange } from "../app/state.js";
import { showProgress, hideProgress } from "../app/source.js";

const $ = (id) => document.getElementById(id);

function bucketCount(values, formatter) {
  const map = new Map();
  values.forEach((v) => {
    if (v === null || v === undefined || Number.isNaN(v)) return;
    const key = formatter(v);
    map.set(key, (map.get(key) || 0) + 1);
  });
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function renderStatCard(title, sub, entries, maxBars = 10) {
  const wrap = document.createElement("div");
  wrap.className = "stat-card";
  const h = document.createElement("div");
  h.className = "stat-title";
  h.innerHTML = `${escapeHtml(title)} <span class="sub">${escapeHtml(sub)}</span>`;
  wrap.appendChild(h);
  if (entries.length === 0) {
    const e = document.createElement("div");
    e.className = "stat-empty";
    e.textContent = "—";
    wrap.appendChild(e);
    return wrap;
  }
  const max = Math.max(...entries.map((e) => e[1]));
  entries.slice(0, maxBars).forEach(([label, count]) => {
    const row = document.createElement("div");
    row.className = "bar-row";
    row.innerHTML = `
      <div class="bar-label">${escapeHtml(label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(count / max * 100).toFixed(1)}%"></div></div>
      <div class="bar-count">${count}</div>`;
    wrap.appendChild(row);
  });
  return wrap;
}

function renderStats() {
  const container = $("statsGrid");
  if (!container) return;
  container.innerHTML = "";
  const s = PMLibrary.stats();
  $("statsProgress").textContent = s.total ? `${s.analysed} / ${s.total}` : "—";
  $("scanAllBtn").disabled = !s.total || s.analysed >= s.total;

  const infos = PMLibrary.photos.map((p) => p.info).filter(Boolean);

  const focal = bucketCount(infos.map((i) => i.focalLengthRaw), (v) => {
    const lower = Math.floor(v / 10) * 10;
    return lower + "-" + (lower + 9) + "mm";
  });
  focal.sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10));
  const aperture = bucketCount(infos.map((i) => (i.fNumber ? parseFloat(i.fNumber.replace("f/", "")) : null)), (v) => "f/" + v);
  const shutter = bucketCount(infos.map((i) => i.exposureTimeRaw), (v) => PMExif.fmtShutter(v));
  const iso = bucketCount(infos.map((i) => i.iso), (v) => "ISO " + v);
  const wb = bucketCount(infos.map((i) => i.whiteBalanceRaw), (v) => (PMExif.WHITE_BALANCE_STD[v] ?? ("代碼 " + v)));
  const cameras = bucketCount(infos.map((i) => i.model), (v) => v);
  const lenses = bucketCount(infos.map((i) => i.lensModel), (v) => v);
  const styles = bucketCount(infos.map((i) => i.creativeStyle), (v) => v);

  container.append(
    renderStatCard("焦段", "", focal, 20),
    renderStatCard("光圈", "", aperture),
    renderStatCard("快門", "", shutter),
    renderStatCard("ISO", "", iso),
    renderStatCard("白平衡", "", wb),
    renderStatCard("相機", "", cameras),
    renderStatCard("鏡頭", "", lenses),
    renderStatCard("創意風格", "Sony", styles),
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
    });
    await scanTask.promise;
    scanTask = null;
    hideProgress();
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
