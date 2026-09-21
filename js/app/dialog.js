// js/app/dialog.js — 訊息與確認對話框。
//
// 照片整理有幾個不可逆的動作（搬檔案、重設分類）, 那些地方需要的是「問一句再做」,
// 而不是 toast。這裡把 ui/modal.js 包成一個回傳 Promise<boolean> 的小函式,
// 呼叫端就可以 `if (!await confirmDialog(...)) return;` 一行寫完。

import { openModal, closeModal } from "../ui/modal.js";
import { el } from "../utils/utils.js";

/**
 * @param {{title:string, message:string, tone?:"info"|"success"|"danger",
 *          confirm?:boolean, confirmText?:string}} cfg
 * @returns {Promise<boolean>} 按下確定才是 true
 */
export function confirmDialog({ title, message, tone = "info", confirm = false, confirmText = "確定" }) {
  return new Promise((resolve) => {
    let answer = false;
    const ok = el("button", {
      type: "button",
      class: `btn ${tone === "danger" ? "btn-danger" : "btn-primary"}`,
      onclick: () => { answer = true; closeModal(); },
    }, confirmText);
    const cancel = el("button", {
      type: "button",
      class: "btn btn-ghost",
      onclick: () => closeModal(),
    }, "取消");

    openModal({
      title,
      className: `dialog-${tone}`,
      maxWidth: "480px",
      body: el("p", { class: "dialog-text" }, message),
      footer: el("div", { class: "dialog-actions" }, confirm ? cancel : null, ok),
      onClose: () => resolve(answer),
    });
    ok.focus();
  });
}

/** 只是要說一句話, 不需要回答。 */
export function alertDialog(cfg) {
  return confirmDialog({ ...cfg, confirm: false });
}
