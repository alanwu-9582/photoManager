// js/pages/settings.js — 分類設定: 名稱、顏色、快捷鍵與動作。
//
// 這一頁刻意不訂閱 onLibraryChange: 每個輸入框都是即時儲存, 若跟著全域事件
// 重建整張表格, 正在打字的 input 會被換掉而失去焦點。表格重畫由各操作自己決定。

import { confirmDialog, alertDialog } from "../app/dialog.js";
import { notify } from "../ui/notifications.js";
import { debounce, saveMarks } from "../app/state.js";

const $ = (id) => document.getElementById(id);

function renderCatTable() {
  const wrap = $("catTable");
  if (!wrap) return;
  wrap.innerHTML = "";

  const head = document.createElement("div");
  head.className = "cat-row head";
  head.innerHTML = "<div>快捷鍵</div><div>分類名稱</div><div>目標資料夾</div><div>顏色</div><div>動作</div><div></div>";
  wrap.appendChild(head);

  const cats = PMCategories.all();
  if (!cats.length) {
    const e = document.createElement("div");
    e.className = "stat-empty";
    e.textContent = "尚無分類";
    wrap.appendChild(e);
    return;
  }

  cats.forEach((cat, idx) => {
    const row = document.createElement("div");
    row.className = "cat-row";

    const keyInput = document.createElement("input");
    keyInput.className = "key-input";
    keyInput.type = "text";
    keyInput.maxLength = 1;
    keyInput.value = cat.key;
    keyInput.readOnly = true;
    keyInput.title = cat.isTrash ? "廢片快捷鍵固定為 q" : "快捷鍵會依分類順序自動調整";
    keyInput.style.borderColor = cat.color;

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = cat.name;
    nameInput.readOnly = cat.isTrash;
    nameInput.addEventListener("input", debounce(() => {
      const updated = PMCategories.update(cat.id, { name: nameInput.value });
      if (updated) folderInput.value = updated.folder;
    }, 300));

    const folderInput = document.createElement("input");
    folderInput.type = "text";
    folderInput.value = cat.folder;
    folderInput.readOnly = true;
    folderInput.title = cat.isTrash ? "廢片資料夾固定為 _廢片" : "目標資料夾會自動與分類名稱相同";

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = cat.color;
    colorInput.addEventListener("input", debounce(() => {
      PMCategories.update(cat.id, { color: colorInput.value });
      keyInput.style.borderColor = colorInput.value;
    }, 150));

    const actionSelect = document.createElement("select");
    PMCategories.ACTIONS.forEach((a) => {
      const opt = document.createElement("option");
      opt.value = a;
      opt.textContent = PMCategories.actionLabel(a);
      if (cat.action === a) opt.selected = true;
      actionSelect.appendChild(opt);
    });
    actionSelect.addEventListener("change", () => {
      PMCategories.update(cat.id, { action: actionSelect.value });
    });
    actionSelect.disabled = cat.isTrash;

    const tools = document.createElement("div");
    tools.className = "cat-tools";
    const up = document.createElement("button");
    up.className = "icon-btn"; up.textContent = "↑"; up.title = "往上移";
    up.disabled = cat.isTrash || idx === 0;
    up.onclick = () => { PMCategories.move(cat.id, -1); renderCatTable(); };
    const down = document.createElement("button");
    down.className = "icon-btn"; down.textContent = "↓"; down.title = "往下移";
    down.disabled = cat.isTrash || idx === cats.length - 2;
    down.onclick = () => { PMCategories.move(cat.id, 1); renderCatTable(); };
    const del = document.createElement("button");
    del.className = "icon-btn danger"; del.textContent = "✕"; del.title = "刪除";
    del.disabled = cat.isTrash;
    del.onclick = async () => {
      const used = PMLibrary.photos.filter((p) => p.catId === cat.id).length;
      if (used && !await confirmDialog({
        title: `刪除「${cat.name}」？`,
        message: `${used} 張照片會一併清除標記。`,
        tone: "danger", confirm: true, confirmText: "刪除分類",
      })) return;
      PMLibrary.photos.forEach((p) => { if (p.catId === cat.id) p.catId = null; });
      PMCategories.remove(cat.id);
      saveMarks();
      renderCatTable();
    };
    tools.append(up, down, del);

    row.append(keyInput, nameInput, folderInput, colorInput, actionSelect, tools);
    wrap.appendChild(row);
  });
}

export function mountPage() {
  $("addCatBtn").addEventListener("click", () => { PMCategories.add(); renderCatTable(); });

  $("exportCatBtn").addEventListener("click", () => {
    const blob = new Blob([PMCategories.toJSON()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "categories.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });

  $("importCatInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      PMCategories.importJSON(await file.text());
      renderCatTable();
      notify.success("已匯入");
    } catch (err) {
      await alertDialog({ title: "匯入失敗", message: err.message, tone: "danger" });
    }
  });

  $("resetCatBtn").addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "重設所有分類？",
      message: "自訂分類會消失, 回到 categories.json 的內容。",
      tone: "danger", confirm: true, confirmText: "重設分類",
    });
    if (!ok) return;
    await PMCategories.reset();
    renderCatTable();
  });

  renderCatTable();
}
