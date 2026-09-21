// js/engine/image.js — 瀏覽器圖片解碼共用層。
//
// HEIC / HEIF 先在本機用 heic2any 轉成瀏覽器可讀的 JPEG；原始 File 不會被
// 取代，整理分類在搬移／複製時仍操作原本的 HEIC 檔案。

const PMImage = (function () {
    const HEIC_RE = /\.(heic|heif)$/i;
    const converted = new WeakMap();

    function isHeic(file) {
        return !!file && (HEIC_RE.test(file.name || '') || /^image\/(heic|heif)$/i.test(file.type || ''));
    }

    async function convertHeic(file) {
        if (typeof window.heic2any !== 'function') {
            throw new Error('HEIC 解碼器載入失敗');
        }
        const result = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.94 });
        const blob = Array.isArray(result) ? result[0] : result;
        if (!(blob instanceof Blob)) throw new Error('HEIC 轉換失敗');
        return blob;
    }

    function toBrowserBlob(file) {
        if (!isHeic(file)) return Promise.resolve(file);
        let pending = converted.get(file);
        if (!pending) {
            pending = convertHeic(file).catch((err) => {
                converted.delete(file);
                throw err;
            });
            converted.set(file, pending);
        }
        return pending;
    }

    async function decodeBitmap(file, options) {
        const blob = await toBrowserBlob(file);
        try {
            return await createImageBitmap(blob, options);
        } catch (err) {
            // 舊瀏覽器不接受 imageOrientation / resizeQuality 等 options。
            if (options) return createImageBitmap(blob);
            throw err;
        }
    }

    return { isHeic, toBrowserBlob, decodeBitmap };
})();
