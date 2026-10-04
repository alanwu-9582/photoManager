// js/app/grouping.js — 照片檢視的分組（從桌面版 photomanager/grouping.py 移植）。
//
// 每一種都是「照片 → 群組名稱」; 群組依照片原本的順序第一次出現的位置排列
// （資料夾、日期這種有自然順序的, 另外照名稱排）。
//
// 「相似照片」比較特別: 先依拍攝時間排好, 相鄰兩張長得夠像（差異雜湊相差很少）,
// 或是同一台相機一秒多內連拍的, 就歸在同一組 —— 挑連拍、挑同一個構圖時最好用。
// 沒有找到相似的照片收在最後的「單張」裡。

export const GROUPS = [
  { value: "none", label: "不分組" },
  { value: "folder", label: "資料夾" },
  { value: "date", label: "拍攝日期" },
  { value: "camera", label: "相機型號" },
  { value: "lens", label: "鏡頭" },
  { value: "category", label: "分類" },
  { value: "format", label: "檔案格式" },
  { value: "similar", label: "相似照片" },
];

/** 這幾種要先有 EXIF 才分得出來。 */
export const NEEDS_EXIF = new Set(["date", "camera", "lens", "similar"]);

const SIMILAR_BITS = 12;     // 64 位元裡最多差幾個位元算「像」
const BURST_SECONDS = 1.5;

const DT = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;
const collator = new Intl.Collator("zh-Hant", { numeric: true, sensitivity: "base" });

function shotTime(p) {
  const m = DT.exec(String((p.info || {}).dateTimeOriginal || ""));
  if (m) {
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    if (!Number.isNaN(t)) return t / 1000;
  }
  return p.lastModified ? p.lastModified / 1000 : 0;
}

function folderOf(p) {
  const slash = p.relPath.lastIndexOf("/");
  return slash > 0 ? p.relPath.slice(0, slash) : "";
}

function extOf(p) {
  const dot = p.name.lastIndexOf(".");
  return dot > 0 ? p.name.slice(dot + 1).toUpperCase() : "";
}

function keyOf(p, how) {
  const info = p.info || {};
  if (how === "folder") return folderOf(p) || "（最上層）";
  if (how === "date") {
    const m = DT.exec(String(info.dateTimeOriginal || ""));
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    if (p.lastModified) {
      const d = new Date(p.lastModified);
      const z = (v) => String(v).padStart(2, "0");
      return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
    }
    return "（不明）";
  }
  if (how === "camera") return info.model || "（沒有 EXIF）";
  if (how === "lens") return info.lensModel || "（沒有鏡頭資訊）";
  if (how === "category") {
    if (p.organized) return `已整理 · ${p.organized.folder}`;
    const cat = p.catId ? PMCategories.byId(p.catId) : null;
    return cat ? cat.name : "未分類";
  }
  if (how === "format") return extOf(p) || "（其他）";
  return "";
}

function similar(photos) {
  const ordered = [...photos].sort((a, b) =>
    shotTime(a) - shotTime(b) || collator.compare(a.relPath, b.relPath));

  const runs = [];
  let cur = [];
  let prev = null;
  for (const p of ordered) {
    if (prev) {
      const close = p.dhash && prev.dhash && PMLibrary.hamming(p.dhash, prev.dhash) <= SIMILAR_BITS;
      const burst = Math.abs(shotTime(p) - shotTime(prev)) <= BURST_SECONDS
        && (p.info || {}).model === (prev.info || {}).model;
      if (!close && !burst) { runs.push(cur); cur = []; }
    }
    cur.push(p);
    prev = p;
  }
  if (cur.length) runs.push(cur);

  const out = [];
  const singles = [];
  for (const run of runs) {
    if (run.length < 2) { singles.push(...run); continue; }
    const t = shotTime(run[0]);
    const when = t
      ? new Date(t * 1000).toLocaleString("zh-TW", {
        month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
      })
      : run[0].name;
    out.push({ key: `similar:${run[0].id}`, title: `${when} · ${run[0].name}`, photos: run });
  }
  if (singles.length) out.push({ key: "similar:__single", title: "單張（沒有相似的）", photos: singles });
  return out;
}

/**
 * 把照片分組。
 * @returns {Array<{key:string, title:string, photos:Array}>} 不分組時回傳空陣列。
 */
export function group(photos, how) {
  if (!how || how === "none") return [];
  if (how === "similar") return similar(photos);

  const buckets = new Map();
  for (const p of photos) {
    const key = keyOf(p, how);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(p);
  }

  let keys = [...buckets.keys()];
  const isPlaceholder = (k) => k.startsWith("（");
  if (how === "folder" || how === "date" || how === "format") {
    keys.sort((a, b) => (isPlaceholder(a) - isPlaceholder(b)) || collator.compare(a, b));
  } else if (how === "category") {
    const order = new Map(PMCategories.all().map((c, i) => [c.name, i]));
    keys.sort((a, b) =>
      (a.startsWith("已整理") - b.startsWith("已整理"))
      || ((a === "未分類") - (b === "未分類"))
      || ((order.get(a) ?? 99) - (order.get(b) ?? 99))
      || collator.compare(a, b));
  } else {
    // 相機、鏡頭: 張數多的排前面。
    keys.sort((a, b) => buckets.get(b).length - buckets.get(a).length || collator.compare(a, b));
  }

  return keys.map((k) => ({ key: `${how}:${k}`, title: k, photos: buckets.get(k) }));
}
