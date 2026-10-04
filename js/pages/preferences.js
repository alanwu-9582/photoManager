// js/pages/preferences.js — 設定: 外觀、照片檢視的預設值、本機資料、關於。
//
// 對應桌面版的「設定」頁（photomanager/pages/settings.py）。
// 桌面版的設定頁裡有一條網頁版的連結, 這邊反過來放桌面版的連結。

import { el, icon } from "../utils/utils.js";
import { groupBox, field, stepper, toggle } from "../tools/widgets.js";
import { segmented } from "../tools/kit.js";
import { notify } from "../ui/notifications.js";
import { confirmDialog } from "../app/dialog.js";
import { state, Marks, onLibraryChange, emitLibraryChange } from "../app/state.js";
import { appearance, setAppearance } from "../app/theme.js";
import { forgetFolder } from "../app/recent-folder.js";

const DESKTOP_URL = "https://github.com/alanwu-9582/PhotoManagerDesktop";
const WEB_REPO_URL = "https://github.com/wayne-1211/photoManager";

const PAGE_SIZES = [30, 50, 100, 200];

/** 一行設定: 左邊說明、右邊控制項。 */
function line(main, sub, control) {
  return el("div", { class: "setting-line" },
    el("div", { class: "setting-text" },
      el("div", { class: "setting-text-main" }, main),
      sub ? el("div", { class: "setting-text-sub" }, sub) : null),
    control);
}

function linkButton(label, href) {
  return el("a", {
    class: "btn btn-sm btn-ghost", href, target: "_blank", rel: "noopener noreferrer",
  }, el("span", { class: "btn-ico", html: icon("external", { size: "14px" }) }), label);
}

export function mountPage() {
  const host = document.getElementById("prefStack");
  if (!host) return undefined;

  /* ---------------- 外觀 ---------------- */
  const appearanceSeg = segmented([
    { value: "auto", label: "跟著系統" },
    { value: "light", label: "淺色" },
    { value: "dark", label: "深色" },
  ], { value: appearance(), onChange: (v) => setAppearance(v) });
  appearanceSeg.classList.add("is-wide");

  const look = groupBox("外觀",
    field("主題", appearanceSeg));

  /* ---------------- 照片檢視 ---------------- */
  const pageSize = stepper({
    items: PAGE_SIZES.map((n) => ({ value: n, label: `${n} 張` })),
    value: state.pageSize,
    onChange: (v) => { state.pageSize = v; state.photosPage = 0; emitLibraryChange(); },
  });

  const recursive = toggle("含子資料夾", {
    checked: document.getElementById("recursiveChk")?.checked ?? true,
    wide: true,
    title: "開啟資料夾時, 連同裡面的子資料夾一起讀入",
    onChange: (on) => {
      const chk = document.getElementById("recursiveChk");
      if (chk) chk.checked = on;
    },
  });

  const browsing = groupBox("照片檢視",
    el("div", { class: "field-row" },
      field("每頁張數", pageSize),
      field("開啟資料夾", recursive)));

  /* ---------------- 本機資料 ---------------- */
  const markCount = el("span", { class: "setting-text-sub" });
  const paintMarks = () => {
    const n = PMLibrary.photos.filter((p) => p.catId).length;
    markCount.textContent = PMLibrary.rootName
      ? `${PMLibrary.rootName} · 目前 ${n} 張有標記`
      : "尚未開啟資料夾";
  };
  paintMarks();

  const data = groupBox("本機資料",
    line("上次開啟的資料夾", "記在 IndexedDB 裡, 下次進來會自動接回",
      el("button", {
        type: "button", class: "btn btn-sm btn-ghost",
        onclick: async () => {
          await forgetFolder();
          const btn = document.getElementById("recentBtn");
          if (btn) btn.hidden = true;
          notify.success("已忘記上次的資料夾");
        },
      }, "忘記")),
    line("分類標記", markCount.textContent,
      el("button", {
        type: "button", class: "btn btn-sm btn-ghost btn-danger-ghost",
        onclick: async () => {
          if (!PMLibrary.rootName) { notify.info("尚未開啟資料夾"); return; }
          const ok = await confirmDialog({
            title: `清除「${PMLibrary.rootName}」的分類標記？`,
            message: "只會清掉這台電腦上記住的標記, 硬碟上的照片不會被動到。",
            tone: "danger", confirm: true, confirmText: "清除標記",
          });
          if (!ok) return;
          PMLibrary.photos.forEach((p) => { if (!p.organized) p.catId = null; });
          Marks.write();
          emitLibraryChange();
          notify.success("已清除標記");
        },
      }, "清除")),
  );

  /* ---------------- 關於 ---------------- */
  const about = groupBox("關於",
    line("桌面版", DESKTOP_URL, linkButton("前往", DESKTOP_URL)),
    line("原始碼", WEB_REPO_URL, linkButton("前往", WEB_REPO_URL)),
    line("照片", "全部在這個瀏覽器裡處理, 不會上傳到任何伺服器", null),
  );

  host.replaceChildren(look, browsing, data, about);

  const off = onLibraryChange(() => {
    paintMarks();
    const sub = data.querySelectorAll(".setting-text-sub")[1];
    if (sub) sub.textContent = markCount.textContent;
    pageSize.setValue(state.pageSize);
  });
  return off;
}
