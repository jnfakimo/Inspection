'use client';

// 平面圖貼圖的預處理：淺色主題重畫成黑線、科技版濾掉光暈。
// 這裡刻意不依賴 three.js 或任何檢視器——3D 樓層圖、平面樓層圖、標記圖臺與
// 3D建模系統的上傳流程都用同一份，演算法只能有一個版本。改這裡等於同時改四個地方，
// 也代表 tools/build-floorplan-variants.py 的 to_light()／to_tech() 必須跟著改。

/**
 * 貼圖預處理的實作本體，與 three.js 無關，平面模型圖也用同一份。
 * 取不到像素（跨網域讓 canvas 汙染）時回傳 null，由呼叫端決定退回原圖。
 *
 * - light：近白視為背景轉透明，其餘塗黑（線條顏色烘在圖檔裡，改不掉，只能重畫）。
 * - tech ：保留原色，但濾掉光暈。renderNeon 是三道疊出來的（blur 4／1.5／0），
 *   低透明度那兩道在深底上讓線看起來比一般版粗一截。實測 B1.png 的透明度分布：
 *   全透明 89.4%、1–15 的外圈光暈 3.4%、16–63 的內圈光暈 3.2%、核心線 2.5%——
 *   光暈是核心的兩倍多。等倍率目視比對後採門檻 64（濾掉整片光暈），此時與一般版
 *   的粗細最接近；門檻 32 仍明顯偏粗。
 */
const GLOW_ALPHA_CUTOFF = 64;

// 來源可以是 <img>（檢視器載入的貼圖）或 <canvas>（建模系統剛畫好、還沒上傳的圖），
// 兩者都能直接餵給 drawImage，處理邏輯完全相同。
export function preparePlanCanvas(image: HTMLImageElement | HTMLCanvasElement, mode: 'light' | 'tech'): HTMLCanvasElement | null {
  if (!image.width) return null;
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0);
  try {
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = data.data;
    let clear = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const alpha = pixels[i + 3];
      if (alpha === 0) { clear += 1; continue; } // 原本就透明，不動
      if (mode === 'tech') {
        if (alpha < GLOW_ALPHA_CUTOFF) pixels[i + 3] = 0;   // 濾掉光暈，只留核心線
        continue;                                            // 顏色不動
      }
      const luma = (pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114);
      if (luma > 232) { pixels[i + 3] = 0; clear += 1; continue; } // 近白＝背景
      pixels[i] = 0; pixels[i + 1] = 0; pixels[i + 2] = 0;
    }
    // 保險絲：這套重畫的前提是貼圖為「線條＋透明（或近白）底」，也就是 3D建模系統
    // renderNeon 目前產出的樣子（實測 B1.png 約 89% 全透明）。若哪天建模端改成不透明
    // 深色底，逐像素塗黑會把整片平面變成一塊黑色——那比不重畫還糟，而且是靜默的。
    // 判定為底圖不透明時直接放棄重畫，沿用原圖並留下線索。
    const clearRatio = clear / (pixels.length / 4);
    if (mode === 'light' && clearRatio < 0.2) {
      console.warn(`平面圖底圖不透明（可視為背景的像素僅 ${(clearRatio * 100).toFixed(1)}%），`
        + '略過淺色主題的黑線重畫。請確認 3D建模系統 renderNeon 的產出格式是否變更。');
      return null;
    }
    ctx.putImageData(data, 0, 0);
  } catch {
    return null;
  }
  return canvas;
}

/**
 * 載入平面圖、重畫成黑線，回傳可直接餵給 OpenSeadragon 的 blob 網址。
 * 失敗時回傳 null（呼叫端沿用原網址）。用 blob 而非 dataURL：長邊 2400px 的圖轉成
 * base64 會多出三分之一體積，而且無法釋放。呼叫端負責 revokeObjectURL。
 */
export function preparePlanObjectUrl(url: string, mode: 'light' | 'tech'): Promise<string | null> {
  return new Promise(resolve => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const canvas = preparePlanCanvas(image, mode);
      if (!canvas) return resolve(null);
      canvas.toBlob(blob => resolve(blob ? URL.createObjectURL(blob) : null), 'image/png');
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });
}
