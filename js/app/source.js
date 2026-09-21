// js/app/source.js — 照片來源列（外殼的一部分）。
//
// 選資料夾、選檔案、拖曳、清除、進度列都在這裡。來源是跨頁共用的狀態,
// 所以這一整塊只在啟動時綁一次, 換頁不會重來；頁面則透過 onLibraryChange()
// 知道照片換了要重畫。

import { escapeHtml } from "../utils/utils.js";
import { notify } from "../ui/notifications.js";
import { confirmDialog, alertDialog } from "./dialog.js";
import { state, Marks, fmtBytes, emitLibraryChange } from "./state.js";

const $ = (id) => document.getElementById(id);

/* ---------- 進度列 ---------- */
export function showProgress(done, total, label) {
  $("progressWrap").classList.add("active");
  const pct = total ? Math.round((done / total) * 100) : 0;
  $("progressFill").style.width = pct + "%";
  $("progressLabel").textContent = `${label || "處理中"}… ${done} / ${total}（${pct}%）`;
}

export function showProgressText(text) {
  $("progressWrap").classList.add("active");
  $("progressFill").style.width = "100%";
  $("progressLabel").textContent = text;
}

export function hideProgress() {
  $("progressWrap").classList.remove("active");
  $("progressFill").style.width = "0%";
}

/** 換來源前先把畫面上的 <img> 清掉, 否則舊的 objectURL 被回收後瀏覽器會去撈已失效的 blob。 */
function detachImages() {
  for (const sel of ["#grid", "#manageGrid", "#previewWrap"]) {
    const node = document.querySelector(sel);
    if (node) node.innerHTML = "";
  }
}

/* ---------- 來源資訊 ---------- */
export function renderSourceInfo() {
  const info = $("sourceInfo");
  if (!info) return;
  const s = PMLibrary.stats();
  if (!PMLibrary.mode) {
    info.textContent = "尚未選擇";
    info.classList.remove("ok");
  } else if (PMLibrary.mode === "folder") {
    info.innerHTML = `📁 <b>${escapeHtml(PMLibrary.rootName)}</b> · ${s.total} 張 · ${fmtBytes(s.bytes)}${s.bytes ? "＋" : ""}`;
    info.classList.add("ok");
  } else {
    info.innerHTML = `📄 ${s.total} 張 · ${fmtBytes(s.bytes)}`;
    info.classList.add("ok");
  }
  $("rescanBtn").hidden = PMLibrary.mode !== "folder";
}

function afterSourceChanged() {
  const restored = Marks.restore();
  state.selectedId = PMLibrary.photos.length ? PMLibrary.photos[0].id : null;
  state.editorPhoto = null;
  state.photosPage = 0;
  hideProgress();
  renderSourceInfo();
  emitLibraryChange();
  if (restored) notify.info(`已還原 ${restored} 張標記`);
}

async function openFolder() {
  try {
    detachImages();
    showProgressText("掃描中…");
    const skip = new Set(PMCategories.all().map((c) => c.folder));
    await PMLibrary.pickFolder({
      recursive: $("recursiveChk").checked,
      skipFolders: $("recursiveChk").checked ? skip : new Set(),
      onProgress: (n) => showProgressText(`掃描中… ${n} 張`),
    });
    afterSourceChanged();
  } catch (err) {
    hideProgress();
    if (err && err.name === "AbortError") return;
    await alertDialog({ title: "無法開啟資料夾", message: err?.message || String(err), tone: "danger" });
  }
}

async function rescanFolder() {
  if (PMLibrary.mode !== "folder") return;
  try {
    detachImages();
    showProgressText("掃描中…");
    const skip = new Set(PMCategories.all().map((c) => c.folder));
    await PMLibrary.rescan({
      skipFolders: $("recursiveChk").checked ? skip : new Set(),
      onProgress: (n) => showProgressText(`掃描中… ${n} 張`),
    });
    afterSourceChanged();
  } catch (err) {
    hideProgress();
    await alertDialog({ title: "重新掃描失敗", message: err?.message || String(err), tone: "danger" });
  }
}

function handleFiles(files) {
  if (PMLibrary.mode !== "files") detachImages();   // 從資料夾模式切過來時會清空舊來源
  const added = PMLibrary.addFiles(files);
  if (!added.length) return;
  if (!state.selectedId) {
    state.selectedId = PMLibrary.photos[0].id;
    state.editorPhoto = null;
  }
  renderSourceInfo();
  emitLibraryChange();
}

/* ---------- 綁定（只做一次） ---------- */
export function initSourceBar() {
  $("pickFolderBtn").addEventListener("click", openFolder);
  $("rescanBtn").addEventListener("click", rescanFolder);

  $("fileInput").addEventListener("change", (e) => {
    handleFiles(e.target.files);
    e.target.value = "";
  });

  $("clearBtn").addEventListener("click", async () => {
    if (!PMLibrary.photos.length) return;
    const ok = await confirmDialog({
      title: `清除 ${PMLibrary.photos.length} 張照片？`,
      message: "只清畫面與標記, 不會刪檔案。",
      tone: "danger", confirm: true, confirmText: "清除畫面",
    });
    if (!ok) return;
    detachImages();
    PMLibrary.clear();
    state.selectedId = null;
    state.editorPhoto = null;
    state.photosPage = 0;
    renderSourceInfo();
    emitLibraryChange();
  });

  /* 拖曳: 整個視窗都可以放（支援直接拖資料夾） */
  let dragDepth = 0;
  window.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dragDepth++;
    document.body.classList.add("dragging");
  });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) document.body.classList.remove("dragging");
  });
  window.addEventListener("drop", async (e) => {
    // 提示一定要收掉, 不管這次的檔案是誰接走的。
    dragDepth = 0;
    document.body.classList.remove("dragging");
    // 工具頁自己的拖放區已經處理過的（它會先 preventDefault）, 這裡就不要再搶。
    if (e.defaultPrevented) return;
    e.preventDefault();

    // DataTransfer 在 handler 結束後就失效, 必須先同步取出
    const items = Array.from(e.dataTransfer.items || []);
    const files = Array.from(e.dataTransfer.files || []);
    const handlePromises = (PMLibrary.supportsFolder() && items.length
      && typeof items[0].getAsFileSystemHandle === "function")
      ? items.map((it) => it.getAsFileSystemHandle())
      : null;

    if (handlePromises) {
      try {
        const handles = await Promise.all(handlePromises);
        const dir = handles.find((h) => h && h.kind === "directory");
        if (dir) {
          detachImages();
          showProgressText("掃描中…");
          await PMLibrary.openFolderHandle(dir, {
            recursive: $("recursiveChk").checked,
            skipFolders: new Set(PMCategories.all().map((c) => c.folder)),
            onProgress: (n) => showProgressText(`掃描中… ${n} 張`),
          });
          afterSourceChanged();
          return;
        }
      } catch (err) {
        console.warn("拖曳資料夾失敗, 改用檔案模式: ", err);
        hideProgress();
      }
    }
    if (files.length) handleFiles(files);
  });

  /* 不支援 File System Access API 時的說明 */
  if (!PMLibrary.supportsFolder()) {
    $("pickFolderBtn").disabled = true;
    $("recursiveChk").disabled = true;
    const warn = $("fsWarn");
    warn.dataset.message = "1";
    // 這一句是功能受限的提示, 不是說明 —— 沒有它會變成「按了沒反應」。
    warn.textContent = location.protocol === "file:"
      ? "file:// 無法讀取資料夾, 請用本機伺服器開啟。"
      : "這個瀏覽器不支援資料夾模式（需要 Chrome / Edge）。";
  }

  renderSourceInfo();
}
