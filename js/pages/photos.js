// js/pages/photos.js — 照片檢視: 縮圖牆 + 每張卡片下面的 EXIF 欄位。

import { escapeHtml, paintRange, icon } from "../utils/utils.js";
import { routeTo } from "../core/router.js";
import { notify } from "../ui/notifications.js";
import {
  state, FIELD_DEFS, onLibraryChange, attachThumb, renderPagination,
} from "../app/state.js";

const $ = (id) => document.getElementById(id);

/** 卡片上的快捷: 這張照片可以直接送去哪幾個編輯工具。 */
const EDIT_TARGETS = [
  { route: "edit", icon: "crop", label: "裁切旋轉" },
  { route: "frame", icon: "frame", label: "EXIF 相框" },
  { route: "palette", icon: "palette", label: "照片色卡" },
];

/**
 * 把這張照片設成「目前編輯中的照片」, 然後換到那個工具。
 * 工具掛載時會自己還原這張（photo-picker 的 restoreCurrent）, 所以這裡不必再傳一次。
 */
async function openIn(route, photo) {
  try {
    const file = await PMLibrary.getFile(photo);
    state.selectedId = photo.id;
    state.editorPhoto = { file, photoId: photo.id };
    routeTo(route);
  } catch (err) {
    console.error(err);
    notify.danger(`讀取失敗: ${err.message}`);
  }
}

/**
 * 疊在縮圖上的快捷列。
 * 絕對定位, 所以不管顯示與否都不會動到卡片的大小;
 * 滑鼠移過去、鍵盤 focus 進去、或在觸控上點一下卡片才會浮出來。
 */
function buildCardActions(photo) {
  const row = document.createElement("div");
  row.className = "card-actions";
  EDIT_TARGETS.forEach((target) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "card-action";
    btn.title = target.label;
    btn.setAttribute("aria-label", `${photo.name} → ${target.label}`);
    btn.innerHTML = icon(target.icon, { size: "16px" });
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openIn(target.route, photo);
    });
    row.appendChild(btn);
  });
  return row;
}

function fillExifList(photo, listEl) {
  listEl.innerHTML = "";
  let any = false;
  if (photo.info) {
    FIELD_DEFS.forEach((f) => {
      if (!state.fields.get(f.key)) return;
      const val = photo.info[f.key];
      if (val === null || val === undefined) return;
      any = true;
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `<span class="k">${escapeHtml(f.label)}</span><span class="v">${escapeHtml(val)}</span>`;
      listEl.appendChild(row);
    });
  }
  if (!any) {
    const e = document.createElement("div");
    e.className = "exif-empty";
    e.textContent = photo.infoState === "idle" ? "讀取中…" : "無 EXIF";
    listEl.appendChild(e);
  }
}

/** 開著的欄位數。標題旁邊那個數字, 收合的時候也看得到現在選了幾個。 */
function paintFieldCount() {
  const label = $("fieldCount");
  if (!label) return;
  const on = FIELD_DEFS.filter((f) => state.fields.get(f.key)).length;
  label.textContent = `${on} / ${FIELD_DEFS.length}`;
}

function initChips() {
  const row = $("chipRow");
  row.innerHTML = "";
  FIELD_DEFS.forEach((f) => {
    const chip = document.createElement("button");
    chip.type = "button";
    const on = state.fields.get(f.key);
    chip.className = "chip" + (on ? " on" : "");
    chip.setAttribute("aria-pressed", String(!!on));
    chip.textContent = f.label;
    chip.onclick = () => {
      const next = !state.fields.get(f.key);
      state.fields.set(f.key, next);
      chip.classList.toggle("on", next);
      chip.setAttribute("aria-pressed", String(next));
      paintFieldCount();
      renderGrid();
    };
    row.appendChild(chip);
  });
  paintFieldCount();
}

function renderGrid() {
  const grid = $("grid");
  if (!grid) return;
  const empty = $("emptyState");
  const photos = PMLibrary.photos;
  grid.innerHTML = "";

  if (photos.length === 0) {
    empty.style.display = "block";
    $("photoCount").textContent = "—";
    renderPagination($("photosPagination"), 0, 0, () => {});
    return;
  }
  empty.style.display = "none";
  $("photoCount").textContent = photos.length + " 張";

  const totalPages = Math.max(1, Math.ceil(photos.length / state.pageSize));
  state.photosPage = Math.min(Math.max(state.photosPage, 0), totalPages - 1);
  const start = state.photosPage * state.pageSize;

  photos.slice(start, start + state.pageSize).forEach((p) => {
    const card = document.createElement("div");
    card.className = "card";

    const thumbWrap = document.createElement("div");
    thumbWrap.className = "thumb-wrap";
    const img = document.createElement("img");
    img.alt = p.name;
    thumbWrap.appendChild(img);
    thumbWrap.appendChild(buildCardActions(p));

    // 沒有滑鼠的時候（手機、平板）: 點一下卡片把快捷叫出來, 一次只留一張開著。
    thumbWrap.addEventListener("click", (e) => {
      if (e.target.closest(".card-action")) return;
      const open = card.classList.contains("is-open");
      grid.querySelectorAll(".card.is-open").forEach((c) => c.classList.remove("is-open"));
      card.classList.toggle("is-open", !open);
    });

    if (p.catId) {
      const cat = PMCategories.byId(p.catId);
      if (cat) {
        const dot = document.createElement("span");
        dot.className = "card-cat-dot";
        dot.style.background = cat.color;
        dot.title = cat.name;
        dot.textContent = cat.key;
        thumbWrap.appendChild(dot);
      }
    }
    card.appendChild(thumbWrap);

    const body = document.createElement("div");
    body.className = "card-body";
    const fname = document.createElement("div");
    fname.className = "card-fname";
    fname.textContent = p.relPath;
    fname.title = p.relPath;
    body.appendChild(fname);

    const list = document.createElement("div");
    list.className = "exif-list";
    body.appendChild(list);
    card.appendChild(body);
    grid.appendChild(card);

    fillExifList(p, list);
    attachThumb(img, p, () => fillExifList(p, list));
  });

  renderPagination($("photosPagination"), state.photosPage, totalPages, (newPage) => {
    state.photosPage = newPage;
    renderGrid();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

export function mountPage() {
  const colSlider = $("colSlider");
  const grid = $("grid");
  colSlider.value = String(state.columns);
  paintRange(colSlider);
  $("colCount").textContent = String(state.columns);
  grid.style.gridTemplateColumns = `repeat(${state.columns},1fr)`;
  colSlider.addEventListener("input", (e) => {
    state.columns = parseInt(e.target.value, 10) || 4;
    paintRange(colSlider);
    $("colCount").textContent = e.target.value;
    grid.style.gridTemplateColumns = `repeat(${state.columns},1fr)`;
  });

  const pageSize = $("pageSizeSelect");
  pageSize.value = String(state.pageSize);
  pageSize.addEventListener("change", (e) => {
    state.pageSize = parseInt(e.target.value, 10) || 50;
    state.photosPage = 0;
    renderGrid();
  });

  initChips();
  renderGrid();
  return onLibraryChange(renderGrid);
}
