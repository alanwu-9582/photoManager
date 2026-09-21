// js/pages/organize.js — 整理分類: 左邊大圖、右邊縮圖側欄, 鍵盤一路標記下去。
//
// 標記只是存在記憶體與 localStorage 裡的一個 catId；真正動到硬碟上的檔案
// 只有按下「套用整理」那一刻（folder 模式）, 或打包成 zip（相容模式）。

import { escapeHtml, paintRange } from "../utils/utils.js";
import { confirmDialog, alertDialog } from "../app/dialog.js";
import {
  state, fmtBytes, saveMarks, Marks, onLibraryChange, attachThumb, renderPagination,
} from "../app/state.js";
import { showProgress, hideProgress } from "../app/source.js";

const $ = (id) => document.getElementById(id);

/** 照片資訊那一塊是開是合。預設收起來, 展開之後換照片也維持展開。 */
let infoOpen = false;

function manageList() {
  return state.hideDone ? PMLibrary.photos.filter((p) => !p.catId) : PMLibrary.photos;
}

function selectedIndexIn(list) {
  const i = list.findIndex((p) => p.id === state.selectedId);
  return i < 0 ? 0 : i;
}

function currentPhotoId() {
  const list = manageList();
  const p = list[selectedIndexIn(list)];
  return p ? p.id : null;
}

/** 整理頁主動換照片時，編輯工具的共用照片也切回資料庫選取。 */
function selectManagedPhoto(id) {
  state.selectedId = id || null;
  state.editorPhoto = null;
}

/* ============================================================
   分類圖例
   ============================================================ */
function renderCatLegend() {
  const wrap = $("catLegend");
  if (!wrap) return;
  wrap.innerHTML = "";
  const cats = PMCategories.all();
  if (!cats.length) {
    wrap.innerHTML = '<span class="dim">尚無分類</span>';
    return;
  }
  const counts = new Map();
  PMLibrary.photos.forEach((p) => { if (p.catId) counts.set(p.catId, (counts.get(p.catId) || 0) + 1); });

  cats.forEach((cat) => {
    const item = document.createElement("button");
    item.className = "legend-item";
    item.title = cat.name;
    item.innerHTML = `
      <span class="legend-key" style="background:${cat.color}">${escapeHtml(cat.key || "·")}</span>
      <span class="legend-name">${escapeHtml(cat.name)}</span>
      <span class="legend-count">${counts.get(cat.id) || 0}</span>
      <span class="legend-action">${escapeHtml(PMCategories.actionLabel(cat.action))}</span>`;
    item.onclick = () => markCurrent(cat);
    wrap.appendChild(item);
  });

  const clearItem = document.createElement("button");
  clearItem.className = "legend-item ghost";
  clearItem.innerHTML = '<span class="legend-key plain">⌫</span><span class="legend-name">清除</span>';
  clearItem.onclick = () => clearCurrentMark();
  wrap.appendChild(clearItem);
}

/* ============================================================
   標記
   ============================================================ */
function markCurrent(cat) {
  const list = manageList();
  const i = selectedIndexIn(list);
  const photo = list[i];
  if (!photo || photo.organized) return;   // 已經搬過的就不再改
  photo.catId = photo.catId === cat.id ? null : cat.id;
  saveMarks();

  const after = manageList();
  const nextIdx = state.hideDone ? Math.min(i, after.length - 1) : Math.min(i + 1, after.length - 1);
  selectManagedPhoto(after[nextIdx] ? after[nextIdx].id : null);
  renderManage();
  renderCatLegend();
  renderApplyHint();
}

function clearCurrentMark() {
  const list = manageList();
  const photo = list[selectedIndexIn(list)];
  if (!photo) return;
  photo.catId = null;
  saveMarks();
  renderManage();
  renderCatLegend();
  renderApplyHint();
}

function moveSelection(delta) {
  const list = manageList();
  if (!list.length) return;
  const i = selectedIndexIn(list);
  const next = Math.min(Math.max(i + delta, 0), list.length - 1);
  selectManagedPhoto(list[next].id);
  renderManage();
}

/* ============================================================
   大圖預覽
   ============================================================ */
function renderPreview() {
  const wrap = $("previewWrap");
  if (!wrap) return;
  const oldImg = wrap.querySelector(".preview-image-box img");
  if (oldImg && oldImg._ro) oldImg._ro.disconnect();
  wrap.innerHTML = "";

  const list = manageList();
  const photo = list[selectedIndexIn(list)];
  if (!photo) {
    wrap.innerHTML = '<p class="stat-empty">—</p>';
    return;
  }

  const box = document.createElement("div");
  box.className = "preview-image-box";
  const img = document.createElement("img");
  if (photo.thumbUrl) img.src = photo.thumbUrl;   // 先用縮圖頂著, 原圖載完再換
  box.appendChild(img);
  wrap.appendChild(box);

  // 照片資訊預設收起來: 這一頁的主角是照片本身, 需要細節才展開。
  // open 狀態記在模組層, 所以換照片、重畫都不會又闔回去。
  const info = document.createElement("details");
  info.className = "preview-info";
  info.open = infoOpen;
  info.addEventListener("toggle", () => { infoOpen = info.open; });
  const summary = document.createElement("summary");
  const summaryName = document.createElement("span");
  summaryName.className = "preview-summary-name";
  summaryName.textContent = photo.name;
  summary.appendChild(summaryName);
  info.appendChild(summary);
  // 資訊層放在照片框內並錨定底部；展開時覆蓋照片向上長，不再擠小照片。
  box.appendChild(info);

  const infoBody = document.createElement("div");
  infoBody.className = "preview-info-body";
  info.appendChild(infoBody);

  const meta = document.createElement("div");
  meta.className = "preview-meta";
  meta.textContent = fmtBytes(photo.size || 0);
  infoBody.appendChild(meta);

  if (photo.organized) {
    const done = document.createElement("div");
    done.className = "preview-cat-badge done";
    done.textContent = `✓ 已${photo.organized.action === "copy" ? "複製" : "移動"}到 ${photo.organized.folder}`;
    infoBody.appendChild(done);
  } else if (photo.catId) {
    const cat = PMCategories.byId(photo.catId);
    if (cat) {
      const badge = document.createElement("div");
      badge.className = "preview-cat-badge";
      badge.style.background = cat.color;
      badge.textContent = `${cat.name} → ${cat.action === "keep" ? "不移動" : cat.folder}`;
      infoBody.appendChild(badge);
    }
  }

  const exifWrap = document.createElement("div");
  exifWrap.className = "preview-exif";
  infoBody.appendChild(exifWrap);

  const sideFields = [
    ["dateTimeOriginal", "拍攝時間"], ["model", "相機型號"], ["lensModel", "鏡頭"],
    ["focalLength", "焦段"], ["fNumber", "光圈"], ["exposureTime", "快門"], ["iso", "ISO"],
    ["creativeStyle", "創意風格"],
  ];
  const fillSide = () => {
    exifWrap.innerHTML = "";
    let any = false;
    if (photo.info) {
      sideFields.forEach(([k, label]) => {
        const val = photo.info[k];
        if (val === null || val === undefined) return;
        any = true;
        const row = document.createElement("div");
        row.className = "row";
        row.innerHTML = `<span class="k">${escapeHtml(label)}</span><span class="v">${escapeHtml(val)}</span>`;
        exifWrap.appendChild(row);
      });
    }
    if (!any) {
      exifWrap.innerHTML = `<p class="exif-empty">${photo.infoState === "idle" ? "讀取中…" : "無 EXIF"}</p>`;
    }
  };
  fillSide();

  // 原圖與 EXIF（縮圖流程順便把 EXIF 讀好）
  PMLibrary.ensureThumb(photo).then(() => { if (currentPhotoId() === photo.id) fillSide(); });
  PMLibrary.fullUrl(photo).then((url) => {
    if (!url || currentPhotoId() !== photo.id || !img.isConnected) return;
    img.src = url;
    PMExif.applyOrientation(img, photo.info ? photo.info.orientation : null, true);
  }).catch((err) => console.warn("讀取原圖失敗: ", photo.name, err));

  PMExif.applyOrientation(img, photo.info ? photo.info.orientation : null, true);

  PMLibrary.preloadAround(PMLibrary.photos.indexOf(photo), 4, 2);
}

/* ============================================================
   縮圖側欄
   ============================================================ */
function renderManage() {
  const grid = $("manageGrid");
  if (!grid) return;
  const empty = $("manageEmpty");
  const list = manageList();
  const all = PMLibrary.stats();
  grid.innerHTML = "";

  $("mgmtPhotoCount").textContent = all.total
    ? `${all.total} · 標記 ${all.marked} · 整理 ${all.organized}`
    : "—";

  if (!list.length) {
    empty.style.display = "block";
    empty.querySelector("p").textContent = all.total ? "沒有符合的照片" : "尚未載入照片";
    renderPagination($("managePagination"), 0, 0, () => {});
    renderPreview();
    return;
  }
  empty.style.display = "none";

  if (!state.selectedId || !list.some((p) => p.id === state.selectedId)) selectManagedPhoto(list[0].id);
  const selIdx = selectedIndexIn(list);

  const totalPages = Math.max(1, Math.ceil(list.length / state.pageSize));
  const page = Math.floor(selIdx / state.pageSize);
  const start = page * state.pageSize;

  list.slice(start, start + state.pageSize).forEach((p, localIdx) => {
    const i = start + localIdx;
    const card = document.createElement("div");
    card.className = "thumb-card" + (i === selIdx ? " selected" : "") + (p.organized ? " organized" : "");

    const img = document.createElement("img");
    img.alt = p.name;
    card.appendChild(img);

    const fnameTag = document.createElement("div");
    fnameTag.className = "fname-tag";
    fnameTag.textContent = p.name;
    card.appendChild(fnameTag);

    if (p.organized) {
      const badge = document.createElement("div");
      badge.className = "cat-badge done";
      badge.textContent = "✓ " + p.organized.folder;
      card.appendChild(badge);
    } else if (p.catId) {
      const cat = PMCategories.byId(p.catId);
      if (cat) {
        const badge = document.createElement("div");
        badge.className = "cat-badge";
        badge.style.background = cat.color;
        badge.textContent = cat.name;
        card.appendChild(badge);
      }
    }

    card.addEventListener("click", () => {
      selectManagedPhoto(p.id);
      renderManage();
    });

    grid.appendChild(card);
    attachThumb(img, p);
  });

  renderPagination($("managePagination"), page, totalPages, (newPage) => {
    const idx = Math.min(Math.max(newPage * state.pageSize, 0), list.length - 1);
    selectManagedPhoto(list[idx].id);
    renderManage();
  });

  renderPreview();
  renderApplyHint();

  const selectedEl = grid.querySelector(".thumb-card.selected");
  if (selectedEl) selectedEl.scrollIntoView({ block: "nearest" });
}

/* ============================================================
   套用整理 / ZIP 打包
   ============================================================ */
function renderApplyHint() {
  const hint = $("applyHint");
  if (!hint) return;
  const applyBtn = $("applyBtn");
  const exportBtn = $("exportBtn");

  if (PMLibrary.mode === "files") {
    applyBtn.hidden = true;
    exportBtn.hidden = false;
    const marked = PMLibrary.photos
      .filter((p) => p.catId && (PMCategories.byId(p.catId) || {}).action !== "keep").length;
    hint.innerHTML = `可打包 <b>${marked}</b> 張`;
    exportBtn.disabled = marked === 0;
    return;
  }

  applyBtn.hidden = false;
  exportBtn.hidden = true;

  if (PMLibrary.mode !== "folder") {
    hint.textContent = "尚未選擇資料夾";
    applyBtn.disabled = true;
    return;
  }

  const p = PMOrganize.plan(PMLibrary.photos);
  applyBtn.disabled = p.total === 0;
  if (p.total === 0) {
    hint.textContent = "沒有待整理的照片";
    return;
  }
  const lines = p.byFolder
    .sort((a, b) => b.count - a.count)
    .map((b) => `<span class="plan-row"><b>${b.count}</b> 張 → <code>${escapeHtml(b.folder)}/</code> <span class="dim">${PMCategories.actionLabel(b.action)}</span></span>`)
    .join("");
  hint.innerHTML = `<b>${p.total}</b> 張 → <code>${escapeHtml(PMLibrary.rootName)}</code>${lines}`;
}

async function applyOrganize() {
  const plan = PMOrganize.plan(PMLibrary.photos);
  if (!plan.total) return;

  const summary = plan.byFolder
    .map((b) => `  ${b.folder}/  ${b.count} 張（${PMCategories.actionLabel(b.action)}）`).join("\n");
  const ok = await confirmDialog({
    title: `整理 ${plan.total} 張照片？`,
    message: `即將在資料夾「${PMLibrary.rootName}」內整理:\n\n${summary}\n\n「移動」會真的改變檔案在硬碟上的位置（不會經過資源回收筒）。`,
    tone: "danger", confirm: true, confirmText: "開始整理",
  });
  if (!ok) return;

  const btn = $("applyBtn");
  btn.disabled = true;
  const original = btn.textContent;
  try {
    const result = await PMOrganize.run(plan.items, (done, total) => {
      showProgress(done, total, "整理中");
      btn.textContent = `整理中… ${done}/${total}`;
    });
    hideProgress();
    Marks.write();

    const box = $("applyResult");
    box.hidden = false;
    box.className = "apply-result" + (result.failed.length ? " has-error" : " ok");
    box.innerHTML = `移動 <b>${result.moved}</b> · 複製 <b>${result.copied}</b>`
      + (result.failed.length
        ? `<br>失敗 <b>${result.failed.length}</b>:<br>` + result.failed.slice(0, 8)
          .map((f) => `<code>${escapeHtml(f.name)}</code> — ${escapeHtml(f.message)}`).join("<br>")
        : "");
  } catch (err) {
    hideProgress();
    await alertDialog({ title: "整理失敗", message: err?.message || String(err), tone: "danger" });
  } finally {
    btn.textContent = original;
    renderCatLegend();
    renderManage();
  }
}

/** 相容模式: 把標記好的照片打包成 zip。JSZip 用到才載。 */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("載入 " + src + " 失敗"));
    document.head.appendChild(s);
  });
}

async function exportZip() {
  const btn = $("exportBtn");
  const groups = new Map();
  PMLibrary.photos.forEach((p) => {
    if (!p.catId) return;
    const cat = PMCategories.byId(p.catId);
    if (!cat || cat.action === "keep") return;
    const arr = groups.get(cat.folder) || [];
    arr.push(p);
    groups.set(cat.folder, arr);
  });
  let count = 0;
  groups.forEach((arr) => { count += arr.length; });
  if (!count) {
    await alertDialog({ title: "沒有可打包的照片", message: "先標記需要移動或複製的分類。" });
    return;
  }

  btn.disabled = true;
  const original = btn.textContent;
  try {
    if (typeof JSZip === "undefined") {
      btn.textContent = "載入打包工具…";
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js");
    }
    const zip = new JSZip();
    const used = new Set();
    groups.forEach((arr, folder) => {
      arr.forEach((p) => {
        let name = p.name;
        let key = folder + "/" + name;
        let n = 1;
        while (used.has(key)) {
          const dot = name.lastIndexOf(".");
          const base = dot > 0 ? p.name.slice(0, dot) : p.name;
          const ext = dot > 0 ? p.name.slice(dot) : "";
          name = `${base}_${n++}${ext}`;
          key = folder + "/" + name;
        }
        used.add(key);
        zip.folder(folder).file(name, p.file);
      });
    });

    btn.textContent = "打包中…";
    const blob = await zip.generateAsync({ type: "blob", compression: "STORE" }, (meta) => {
      btn.textContent = `打包中… ${Math.round(meta.percent)}%`;
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Photo_Manager_Export.zip";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) {
    console.error(err);
    await alertDialog({ title: "打包失敗", message: err?.message || String(err), tone: "danger" });
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

/* ============================================================
   掛載
   ============================================================ */
/**
 * 讓整理頁自己填滿視窗: 版面的高度 = 視窗高度減掉它上面那些東西。
 * 這樣捲動只會發生在右邊的縮圖欄裡, 左邊的大圖一直留在原地 ——
 * 標記照片的時候, 大圖不該跟著捲走。
 */
function fitLayoutHeight() {
  const layout = $("manageLayout");
  if (!layout) return;
  // 窄螢幕是上下疊的單欄, 這時候就讓它照一般的方式捲。
  if (window.innerWidth <= 900) { layout.style.height = ""; return; }
  const top = layout.getBoundingClientRect().top + window.scrollY;
  // 主內容區自己還有一段下內距, 不扣掉的話整頁還是會多出那一小段可以捲。
  const main = document.querySelector(".main");
  const bottom = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
  layout.style.height = `max(320px, calc(100dvh - ${Math.round(top + bottom + 4)}px))`;
}

export function mountPage() {
  // 每次進入整理分類頁都從收合狀態開始；同一次操作中換照片則保留使用者選擇。
  infoOpen = false;
  // 同步方向以整理分類為準；進入本頁後，下一個編輯工具會採用這裡的目前照片。
  state.editorPhoto = null;
  const grid = $("manageGrid");
  const slider = $("mgmtColSlider");
  slider.value = String(state.manageColumns);
  paintRange(slider);
  $("mgmtColCount").textContent = String(state.manageColumns);
  grid.style.gridTemplateColumns = `repeat(${state.manageColumns},1fr)`;
  slider.addEventListener("input", (e) => {
    state.manageColumns = parseInt(e.target.value, 10) || 3;
    paintRange(slider);
    $("mgmtColCount").textContent = e.target.value;
    grid.style.gridTemplateColumns = `repeat(${state.manageColumns},1fr)`;
  });

  const hideDone = $("hideDoneChk");
  hideDone.checked = state.hideDone;
  hideDone.addEventListener("change", (e) => {
    state.hideDone = e.target.checked;
    renderManage();
  });

  $("applyBtn").addEventListener("click", applyOrganize);
  $("exportBtn").addEventListener("click", exportZip);

  /* 鍵盤: 這一頁才綁, 離開就解掉 */
  const onKey = (e) => {
    const tag = document.activeElement ? document.activeElement.tagName : "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector(".modal-overlay.open")) return;
    if (!PMLibrary.photos.length) return;

    const cols = state.manageColumns;
    switch (e.key) {
      case "ArrowRight": e.preventDefault(); moveSelection(1); return;
      case "ArrowLeft": e.preventDefault(); moveSelection(-1); return;
      case "ArrowDown": e.preventDefault(); moveSelection(cols); return;
      case "ArrowUp": e.preventDefault(); moveSelection(-cols); return;
      case "Backspace":
      case "Delete": e.preventDefault(); clearCurrentMark(); return;
      default: break;
    }
    const cat = PMCategories.byKey(e.key);
    if (cat) {
      e.preventDefault();
      markCurrent(cat);
    }
  };
  document.addEventListener("keydown", onKey);

  renderCatLegend();
  renderManage();
  fitLayoutHeight();

  window.addEventListener("resize", fitLayoutHeight);
  const off = onLibraryChange(() => {
    renderCatLegend();
    renderManage();
    // 圖例可能換行, 版面的起點會跟著變。
    fitLayoutHeight();
  });
  return () => {
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", fitLayoutHeight);
    off();
  };
}
