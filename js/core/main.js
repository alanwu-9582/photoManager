// js/core/main.js — 啟動整個前端。
//
// 照片引擎（PMExif / PMCategories / PMLibrary / PMOrganize）是 index.html 用一般
// <script> 載進來的全域物件, 這裡只負責把外殼組起來: 側邊欄、來源列、路由。

import { initSidebarToggle } from "../ui/sidebar.js";
import { startRouter, renderNavigation } from "./router.js";
import { initSourceBar } from "../app/source.js";
import { emitLibraryChange, saveMarks } from "../app/state.js";
import { notify } from "../ui/notifications.js";

initSidebarToggle();
renderNavigation();

PMCategories.onChange(() => {
  // 匯入或重設之後, 指向已不存在分類的標記要清掉, 否則會變成數得到卻整理不到的幽靈標記。
  let dropped = 0;
  PMLibrary.photos.forEach((p) => {
    if (p.catId && !PMCategories.byId(p.catId)) { p.catId = null; dropped++; }
  });
  if (dropped) saveMarks();
  emitLibraryChange();
});

// 分類要先讀進來, 頁面才畫得出圖例與設定表。
PMCategories.init()
  .catch((err) => {
    console.error(err);
    notify.warning("分類設定載入失敗, 先用預設值。");
  })
  .finally(() => {
    initSourceBar();
    startRouter();
  });
