// js/app/photo-filter.js — 照片檢視的篩選條件。
//
// 一條條件就是「欄位 + 值 + 包含／不包含」, 例如「相機型號 是 ILCE-6400」。
// 組合規則跟一般相簿軟體一樣, 也是大家預期的那樣:
//
//   同一個欄位的多個「包含」  → 任一符合就算（或）
//   不同欄位之間              → 都要符合（且）
//   「不包含」                → 一律排除
//
// 可以挑的值直接從目前這批照片長出來, 所以不會出現選了卻一張都沒有的選項。

/**
 * 可以拿來篩的欄位。
 *   key    EXIF 欄位名, 或是 __ 開頭的自訂欄位
 *   value  自訂欄位怎麼從照片取值
 */
export const FILTER_FIELDS = [
  { key: "model", label: "相機型號" },
  { key: "lensModel", label: "鏡頭" },
  { key: "focalLength", label: "焦段" },
  { key: "fNumber", label: "光圈" },
  { key: "exposureTime", label: "快門" },
  { key: "iso", label: "ISO", format: (v) => `ISO ${v}` },
  { key: "whiteBalance", label: "白平衡" },
  { key: "exposureProgram", label: "曝光模式" },
  { key: "creativeStyle", label: "創意風格" },
  { key: "make", label: "製造商" },
  {
    key: "__date",
    label: "拍攝日期",
    value: (p) => {
      const raw = p.info?.dateTimeOriginal || p.info?.dateTime;
      const m = /^(\d{4}):(\d{2}):(\d{2})/.exec(String(raw || ""));
      return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
    },
  },
  {
    key: "__ext",
    label: "檔案格式",
    value: (p) => {
      const dot = p.name.lastIndexOf(".");
      return dot > 0 ? p.name.slice(dot + 1).toUpperCase() : null;
    },
  },
  {
    key: "__cat",
    label: "分類",
    value: (p) => (p.catId ? (PMCategories.byId(p.catId)?.name || null) : "未分類"),
  },
  {
    key: "__dir",
    label: "資料夾",
    value: (p) => {
      const slash = p.relPath.lastIndexOf("/");
      return slash > 0 ? p.relPath.slice(0, slash) : "（最上層）";
    },
  },
];

export function fieldByKey(key) {
  return FILTER_FIELDS.find((f) => f.key === key) || null;
}

/** 這張照片在這個欄位上的值（字串）。沒有就回 null。 */
export function valueOf(photo, field) {
  if (!field) return null;
  if (field.value) return field.value(photo);
  const raw = photo.info ? photo.info[field.key] : null;
  if (raw === null || raw === undefined || raw === "") return null;
  return field.format ? field.format(raw) : String(raw);
}

/**
 * 這個欄位在這批照片裡出現過哪些值, 多的排前面。
 * @returns {Array<{value:string, count:number}>}
 */
export function optionsFor(fieldKey, photos) {
  const field = fieldByKey(fieldKey);
  if (!field) return [];
  const counts = new Map();
  for (const photo of photos) {
    const v = valueOf(photo, field);
    if (v == null) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value), "zh-Hant", { numeric: true }));
}

/** 這張照片有沒有通過全部條件。 */
export function matches(photo, filters) {
  if (!filters?.length) return true;

  // 「包含」依欄位分組: 同一欄位裡只要中一個就算, 不同欄位之間要全中。
  const includes = new Map();
  for (const f of filters) {
    if (!f.field || !f.value) continue;
    if (f.mode === "exclude") {
      if (valueOf(photo, fieldByKey(f.field)) === f.value) return false;
    } else {
      if (!includes.has(f.field)) includes.set(f.field, []);
      includes.get(f.field).push(f.value);
    }
  }
  for (const [key, wanted] of includes) {
    const v = valueOf(photo, fieldByKey(key));
    if (!wanted.includes(v)) return false;
  }
  return true;
}

export function applyFilters(photos, filters) {
  if (!filters?.length) return photos;
  return photos.filter((p) => matches(p, filters));
}

/** 真正有作用的條件數（欄位與值都選好了才算）。 */
export function activeCount(filters) {
  return (filters || []).filter((f) => f.field && f.value).length;
}
