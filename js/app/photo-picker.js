// js/app/photo-picker.js — 編輯類工具共用的「挑一張照片」。
//
// 三種來源, 同一個回呼: 拖進來、從檔案選、或是從已經載入的那批照片裡挑。
// 最後一種是這個工具箱跟單機網頁工具的差別 —— 剛整理完的那批照片就在手邊,
// 不必再去檔案總管找一次。

import { el, icon } from "../utils/utils.js";
import { openModal, closeModal } from "../ui/modal.js";
import { notify } from "../ui/notifications.js";
import { attachThumb, state } from "./state.js";

const ACCEPT = "image/*,.heic,.heif";

/** 從已載入的照片裡挑一張，回傳 File 與來源照片（取消則不呼叫）。 */
export function pickFromLibrary(onPick) {
  const photos = PMLibrary.photos;
  if (!photos.length) {
    notify.info("尚未載入照片");
    return;
  }
  // 一次最多列 240 張: 再多就是捲不完的牆, 而且每一格都要讀縮圖。
  const shown = photos.slice(0, 240);
  const grid = el("div", { class: "pick-grid" });
  shown.forEach((photo) => {
    const img = el("img", { alt: photo.name });
    const cell = el("button", { type: "button", class: "pick-cell", title: photo.relPath },
      img, el("span", { class: "pick-name" }, photo.name));
    cell.addEventListener("click", async () => {
      closeModal();
      try {
        onPick(await PMLibrary.getFile(photo), { source: "library", photo });
      } catch (err) {
        notify.danger(`讀取失敗: ${err.message}`);
      }
    });
    grid.appendChild(cell);
    attachThumb(img, photo);
  });

  openModal({ title: `已載入的照片（${shown.length}）`, maxWidth: "760px", body: grid });
}

/**
 * 兩顆按鈕。照片區自己當拖放目標, 用 `node.attach(stage)` 接上去。
 * @param {{onPick:(file:File, origin:{source:string, photo?:object})=>void}} cfg
 */
export function photoPicker({ onPick }) {
  const input = el("input", { type: "file", class: "picker-file", accept: ACCEPT });

  const take = (file, origin = { source: "external" }) => {
    if (!file) return;
    if (!PMImage.isImageFile(file)) {
      notify.warning("不是圖片檔");
      return;
    }
    // 編輯工具的選圖只在編輯工具之間同步；整理分類的 selectedId 維持單向來源。
    state.editorPhoto = {
      file,
      photoId: origin.source === "library" ? origin.photo?.id || null : null,
    };
    onPick(file, origin);
  };

  input.addEventListener("change", () => { take(input.files[0]); input.value = ""; });

  const node = el("div", { class: "picker" },
    el("button", {
      type: "button", class: "btn btn-sm btn-ghost", onclick: () => input.click(),
    }, el("span", { class: "btn-ico", html: icon("upload", { size: "14px" }) }), "選擇照片"),
    el("button", {
      type: "button", class: "btn btn-sm btn-ghost", onclick: () => pickFromLibrary(take),
    }, el("span", { class: "btn-ico", html: icon("image", { size: "14px" }) }), "已載入的照片"),
    input,
  );

  node.choose = () => input.click();
  node.library = () => pickFromLibrary(take);
  node.take = (file) => take(file, { source: "external" });
  node.restoreCurrent = async () => {
    if (state.editorPhoto?.file) {
      const photo = state.editorPhoto.photoId
        ? PMLibrary.photos.find((item) => item.id === state.editorPhoto.photoId)
        : null;
      take(state.editorPhoto.file, photo ? { source: "library", photo } : { source: "external" });
      return true;
    }
    const photo = PMLibrary.photos.find((item) => item.id === state.selectedId);
    if (!photo) return false;
    try {
      take(await PMLibrary.getFile(photo), { source: "library", photo });
      return true;
    } catch (err) {
      notify.danger(`讀取失敗: ${err.message}`);
      return false;
    }
  };

  /** 把照片區接成拖放目標: 拖檔案進來或直接點它都可以換照片。 */
  node.attach = (zone) => {
    zone.classList.add("is-drop-zone");
    zone.addEventListener("click", (e) => {
      // 畫布上的操作（拖裁切框之類）不算「點空白處換照片」。
      if (e.target.closest("canvas, button, .edit-overlay")) return;
      input.click();
    });
    // 這裡要自己 preventDefault, 否則會被外殼的「拖資料夾進來載入照片」接走。
    zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("is-over"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("is-over"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("is-over");
      take(e.dataTransfer.files?.[0]);
    });
  };

  return node;
}
