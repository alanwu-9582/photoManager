// js/app/state.js — 跨頁共用的畫面狀態與分類標記。
//
// 路由每次換頁都會重建 DOM, 但「選了哪些 EXIF 欄位」「每頁幾張」「現在選到哪一張」
// 這些是使用者的選擇, 不該跟著 DOM 一起被丟掉, 所以放在模組層。

/* ---------- 卡片上可顯示的 EXIF 欄位 ---------- */
export const FIELD_DEFS = [
  { key: "model", label: "相機型號", on: true },
  { key: "lensModel", label: "鏡頭", on: true },
  { key: "focalLength", label: "焦段", on: true },
  { key: "fNumber", label: "光圈", on: true },
  { key: "exposureTime", label: "快門", on: true },
  { key: "iso", label: "ISO", on: true },
  { key: "exposureBias", label: "曝光補償", on: false },
  { key: "exposureProgram", label: "曝光模式", on: false },
  { key: "meteringMode", label: "測光模式", on: false },
  { key: "whiteBalance", label: "白平衡", on: false },
  { key: "flash", label: "閃光燈", on: false },
  { key: "colorSpace", label: "色域", on: false },
  { key: "focalLength35mm", label: "35mm等效焦段", on: false },
  { key: "sceneCaptureType", label: "場景類型", on: false },
  { key: "dateTimeOriginal", label: "拍攝時間", on: false },
  { key: "make", label: "製造商", on: false },
  { key: "creativeStyle", label: "創意風格 (Sony)", on: true },
];

export const state = {
  fields: new Map(FIELD_DEFS.map((f) => [f.key, f.on])),
  pageSize: 50,
  photosPage: 0,
  hideDone: false,
  columns: 4,
  /** 照片檢視的篩選條件: {field, value, mode:"include"|"exclude"} */
  filters: [],
  manageColumns: 3,
  selectedId: null,
  // 編輯工具之間共用的目前照片。外部上傳也可在工具間延續，但不會改 selectedId。
  editorPhoto: null,
};

/* ---------- 換來源 / 換標記時, 讓正在顯示的頁面自己重畫 ---------- */
const listeners = new Set();

/** @returns {Function} 取消訂閱 */
export function onLibraryChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitLibraryChange() {
  for (const fn of [...listeners]) {
    try { fn(); } catch (err) { console.error(err); }
  }
}

export function fmtBytes(n) {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return (n / 1024 ** i).toFixed(i === 0 ? 0 : 1) + " " + units[i];
}

export function debounce(fn, ms) {
  let t = null;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

/* ---------- 分類標記的本機記憶（依來源資料夾名稱分開存） ---------- */
export const Marks = {
  key() { return "pm.marks." + (PMLibrary.rootName || "__none__"); },
  load() {
    try { return JSON.parse(localStorage.getItem(this.key()) || "{}"); }
    catch { return {}; }
  },
  write() {
    if (!PMLibrary.rootName) return;
    const map = {};
    PMLibrary.photos.forEach((p) => { if (p.catId && !p.organized) map[p.relPath] = p.catId; });
    try {
      if (Object.keys(map).length) localStorage.setItem(this.key(), JSON.stringify(map));
      else localStorage.removeItem(this.key());
    } catch { /* 空間不足就算了, 不影響主要功能 */ }
  },
  restore() {
    const map = this.load();
    let n = 0;
    PMLibrary.photos.forEach((p) => {
      const id = map[p.relPath];
      if (id && PMCategories.byId(id)) { p.catId = id; n++; }
    });
    return n;
  },
};

export const saveMarks = debounce(() => Marks.write(), 250);

/** 縮圖延遲載入: 只有真的排到這一頁才會去讀檔案。 */
export function attachThumb(img, photo, onMeta) {
  if (photo.thumbUrl) {
    img.src = photo.thumbUrl;
    PMExif.applyOrientation(img, photo.info ? photo.info.orientation : null, false);
    onMeta?.();
    return;
  }
  img.classList.add("thumb-loading");
  PMLibrary.ensureThumb(photo).then((url) => {
    img.classList.remove("thumb-loading");
    if (!img.isConnected) return;
    if (url) img.src = url;
    PMExif.applyOrientation(img, photo.info ? photo.info.orientation : null, false);
    onMeta?.();
  }).catch(() => img.classList.remove("thumb-loading"));
}

/** 上一頁／下一頁。totalPages <= 1 就整條收起來。 */
export function renderPagination(host, page, totalPages, onChange) {
  if (!host) return;
  host.innerHTML = "";
  if (totalPages <= 1) return;

  const prev = document.createElement("button");
  prev.className = "page-btn";
  prev.textContent = "← 上一頁";
  prev.disabled = page <= 0;
  prev.onclick = () => onChange(page - 1);

  const info = document.createElement("span");
  info.className = "page-info";
  info.textContent = `第 ${page + 1} / ${totalPages} 頁`;

  const next = document.createElement("button");
  next.className = "page-btn";
  next.textContent = "下一頁 →";
  next.disabled = page >= totalPages - 1;
  next.onclick = () => onChange(page + 1);

  host.append(prev, info, next);
}
