// js/app/recent-folder.js — 記住上一次開過的資料夾。
//
// FileSystemDirectoryHandle 可以被結構化複製, 所以能直接存進 IndexedDB
// （localStorage 不行, 它只吃字串）。存的是「哪個資料夾」, 不是資料夾裡的東西。
//
// 權限不會跟著存: 重新整理之後瀏覽器通常會把權限降回 prompt, 必須由使用者
// 的一個動作（按下按鈕）才要得回來。所以這裡只負責記住與問權限,
// 要不要自動開由呼叫端決定。

const DB_NAME = "photo-manager";
const STORE = "handles";
const KEY = "last-folder";

function withStore(mode, run) {
  return new Promise((resolve, reject) => {
    let request;
    try { request = indexedDB.open(DB_NAME, 1); }
    catch (err) { reject(err); return; }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(STORE, mode);
      const done = run(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); resolve(done?.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}

/** 記住這個資料夾。失敗不影響主流程（無痕模式會擋住 IndexedDB）。 */
export async function rememberFolder(handle) {
  if (!handle) return;
  try {
    await withStore("readwrite", (store) => store.put({ handle, name: handle.name, at: Date.now() }, KEY));
  } catch (err) {
    console.warn("記住資料夾失敗: ", err);
  }
}

export async function forgetFolder() {
  try { await withStore("readwrite", (store) => store.delete(KEY)); }
  catch { /* 沒存成功過就不用清 */ }
}

/** @returns {Promise<{handle:FileSystemDirectoryHandle, name:string}|null>} */
export async function loadLastFolder() {
  try {
    const saved = await withStore("readonly", (store) => store.get(KEY));
    if (!saved?.handle) return null;
    return saved;
  } catch {
    return null;
  }
}

/**
 * 這個資料夾現在能不能直接用。
 * @param {FileSystemDirectoryHandle} handle
 * @param {boolean} ask 是否可以跳出權限詢問（必須在使用者的點擊裡才會過）
 */
export async function ensureAccess(handle, ask = false) {
  if (!handle?.queryPermission) return true;
  const opts = { mode: "readwrite" };
  try {
    if (await handle.queryPermission(opts) === "granted") return true;
    if (!ask) return false;
    return await handle.requestPermission(opts) === "granted";
  } catch {
    return false;
  }
}
