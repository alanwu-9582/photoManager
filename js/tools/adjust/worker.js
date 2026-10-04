// js/tools/adjust/worker.js — 「調整」的計算丟到背景執行緒。
//
// 規範 §9.1: 超過約 50 毫秒的計算都放到背景, 介面不凍結；
// 新的請求進來就放掉舊的結果, 只顯示最新參數的畫面。
//
// 原圖載進來一次就留著（load）, 之後每次只送參數（render）, 不必一直搬幾 MB 的像素。

import { prepare, applyTo, isIdentity, autoTone } from "./develop.js";

/** token → { rgba, W, H }。同時只會有一張, 但用 Map 比較好清。 */
const sources = new Map();

/** 從原圖縮出一塊指定長邊的 RGBA（最近鄰; 只是給預覽用, 夠快就好）。 */
function scaled(src, edge) {
  const { rgba, W, H } = src;
  const k = Math.min(1, edge / Math.max(W, H));
  if (k >= 1) return { rgba: new Uint8ClampedArray(rgba), w: W, h: H };
  const w = Math.max(1, Math.round(W * k));
  const h = Math.max(1, Math.round(H * k));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(H - 1, Math.floor((y + 0.5) * H / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(W - 1, Math.floor((x + 0.5) * W / w));
      const si = (sy * W + sx) * 4;
      const di = (y * w + x) * 4;
      out[di] = rgba[si];
      out[di + 1] = rgba[si + 1];
      out[di + 2] = rgba[si + 2];
      out[di + 3] = 255;
    }
  }
  return { rgba: out, w, h };
}

self.onmessage = (e) => {
  const msg = e.data;

  if (msg.type === "load") {
    sources.set(msg.token, { rgba: new Uint8ClampedArray(msg.rgba), W: msg.W, H: msg.H });
    // 一次只留一張, 其他的放掉。
    for (const key of sources.keys()) if (key !== msg.token) sources.delete(key);
    self.postMessage({ type: "loaded", token: msg.token });
    return;
  }

  if (msg.type === "render") {
    const src = sources.get(msg.token);
    if (!src) { self.postMessage({ type: "error", id: msg.id, message: "原圖不在了" }); return; }
    const { rgba, w, h } = scaled(src, msg.edge);
    if (!isIdentity(msg.params)) {
      const maps = prepare(rgba, w, h, msg.params);
      applyTo(rgba, { x0: 0, y0: 0, w, h }, w, h, msg.params, maps);
    }
    self.postMessage({ type: "done", id: msg.id, rgba: rgba.buffer, w, h, draft: msg.draft },
      [rgba.buffer]);
    return;
  }

  if (msg.type === "export") {
    const src = sources.get(msg.token);
    if (!src) { self.postMessage({ type: "error", id: msg.id, message: "原圖不在了" }); return; }
    const out = new Uint8ClampedArray(src.rgba);
    if (!isIdentity(msg.params)) {
      const maps = prepare(out, src.W, src.H, msg.params);
      // 一段一段算, 中間回報進度 —— 兩千萬畫素也不會讓人以為當掉了。
      const strip = Math.max(64, Math.round(262144 / Math.max(1, src.W)));
      for (let y = 0; y < src.H; y += strip) {
        const rows = Math.min(strip, src.H - y);
        const block = new Uint8ClampedArray(rows * src.W * 4);
        block.set(out.subarray(y * src.W * 4, (y + rows) * src.W * 4));
        applyTo(block, { x0: 0, y0: y, w: src.W, h: rows }, src.W, src.H, msg.params, maps);
        out.set(block, y * src.W * 4);
        self.postMessage({ type: "progress", id: msg.id, done: Math.min(src.H, y + rows), total: src.H });
      }
    }
    self.postMessage({ type: "exported", id: msg.id, rgba: out.buffer, w: src.W, h: src.H }, [out.buffer]);
    return;
  }

  if (msg.type === "auto") {
    const src = sources.get(msg.token);
    if (!src) { self.postMessage({ type: "error", id: msg.id, message: "原圖不在了" }); return; }
    self.postMessage({ type: "auto", id: msg.id, values: autoTone(src.rgba, src.W, src.H, msg.params) });
  }
};
