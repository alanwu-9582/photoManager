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

/**
 * 問一個字串。取消回傳 null, 確定回傳去掉前後空白的字。
 * 主要動作在必要欄位填好之前是停用的（規範 §4.12）, 不另外跳錯誤訊息。
 * @param {{title:string, label?:string, value?:string, placeholder?:string, confirmText?:string}} cfg
 * @returns {Promise<string|null>}
 */
export function promptDialog({ title, label, value = "", placeholder = "", confirmText = "確定" }) {
  return new Promise((resolve) => {
    let answer = null;
    const input = el("input", { type: "text", class: "tool-input", value, placeholder, spellcheck: "false" });
    const ok = el("button", {
      type: "button", class: "btn btn-primary",
      onclick: () => { answer = input.value.trim(); closeModal(); },
    }, confirmText);
    const sync = () => { ok.disabled = !input.value.trim(); };
    input.addEventListener("input", sync);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && input.value.trim()) { e.preventDefault(); ok.click(); }
    });
    sync();

    openModal({
      title,
      maxWidth: "440px",
      body: el("div", { class: "field" },
        label ? el("span", { class: "field-label" }, label) : null, input),
      footer: el("div", { class: "dialog-actions" },
        el("button", { type: "button", class: "btn btn-ghost", onclick: () => closeModal() }, "取消"),
        ok),
      onClose: () => resolve(answer),
    });
    input.focus();
    input.select();
  });
}
