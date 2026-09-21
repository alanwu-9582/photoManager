// js/pages/home.js — 首頁: 目前載入了什麼, 以及所有功能的入口。

import { ROUTES } from "../core/router.js";
import { el, icon } from "../utils/utils.js";
import { onLibraryChange, fmtBytes } from "../app/state.js";

function card(name, route) {
  return el("a", { class: "entry-card", href: `#/${name}` },
    el("h3", { class: "entry-card-title" },
      el("span", { class: "entry-card-ico", html: icon(route.icon, { size: "16px" }) }),
      route.label),
  );
}

function renderCards() {
  const groups = { "照片管理": document.getElementById("homeManage"), "照片編輯": document.getElementById("homeEdit") };
  for (const host of Object.values(groups)) host?.replaceChildren();
  for (const [name, route] of Object.entries(ROUTES)) {
    const host = groups[route.group];
    if (!route.nav || !host) continue;
    host.appendChild(card(name, route));
  }
}

function renderStats() {
  const host = document.getElementById("homeStats");
  if (!host) return;
  const s = PMLibrary.stats();
  const cells = [
    ["來源", PMLibrary.mode === "folder" ? PMLibrary.rootName : (PMLibrary.mode === "files" ? "檔案" : "—")],
    ["張數", s.total ? `${s.total}` : "—"],
    ["EXIF", s.total ? `${s.analysed} / ${s.total}` : "—"],
    ["已標記", s.total ? `${s.marked}` : "—"],
    ["容量", s.bytes ? fmtBytes(s.bytes) : "—"],
  ];
  host.replaceChildren(...cells.map(([label, value]) => el("div", { class: "home-stat" },
    el("div", { class: "home-stat-value" }, value),
    el("div", { class: "home-stat-label" }, label),
  )));
}

export function mountPage() {
  renderCards();
  renderStats();
  return onLibraryChange(renderStats);
}
