// js/engine/image.js — 瀏覽器圖片解碼共用層。
//
// HEIC / HEIF 先在本機用 heic2any 轉成瀏覽器可讀的 JPEG；原始 File 不會被
// 取代，整理分類在搬移／複製時仍操作原本的 HEIC 檔案。

const PMImage = (function () {
    const HEIC_RE = /\.(heic|heif)$/i;
    const IMAGE_RE = /\.(jpe?g|png|gif|webp|bmp|tiff?|avif|heic|heif)$/i;
    const converted = new WeakMap();

    function isHeic(file) {
        return !!file && (HEIC_RE.test(file.name || '') || /^image\/(heic|heif)$/i.test(file.type || ''));
    }

    /**
     * 是不是我們讀得動的圖片。
     * 不能只看 file.type: 從資料夾（File System Access API）拿到的 .heic 在 Windows 上
     * 常常是空字串, 只認 MIME 的話整批 HEIC 都會被當成「不是圖片檔」擋掉。
     */
    function isImageFile(file) {
        if (!file) return false;
        if (/^image\//i.test(file.type || '')) return true;
        return IMAGE_RE.test(file.name || '');
    }

    async function convertHeic(file) {
        if (typeof window.heic2any !== 'function') {
            throw new Error('HEIC 解碼器載入失敗');
        }
        let result;
        try {
            result = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.94 });
        } catch (err) {
            const raw = (err && (err.message || err.code) || '').toString();
            // 副檔名是 .heic 但裡面其實是 JPEG（相機或雲端轉檔留下來的）。
            // heic2any 會回報「已經讀得動了」, 那就直接用原檔。
            if (/already browser readable/i.test(raw)) return file;
            // 其他情況丟回來的是 libheif 的原始錯誤碼, 直接顯示看不懂。
            // 讀不開也只是不能預覽而已 —— 檔案本身還在, 分類與搬移照樣可以做。
            throw new Error(`這張 HEIC 解不開, 只能看 EXIF${raw ? ` (${raw})` : ''}`);
        }
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

    return { isHeic, isImageFile, toBrowserBlob, decodeBitmap };
})();
