// 樓層名稱正規化 — 全站唯一來源，取代各頁面各自實作、彼此不相容的版本。
// canonicalFloor() 回傳值只作「比對/分組鍵值」用；畫面顯示文字一律改叫 floorLabel()，
// 兩者不要混用（尤其 RF/頂樓：內部鍵值固定用 'RF'，顯示文字固定用「頂樓」）。
window.FloorUtils = (function () {
  function canonicalFloor(raw) {
    const s = String(raw == null ? '' : raw).trim().toUpperCase().replace(/\s+/g, '');
    if (!s) return '';
    if (/^(RF|R|頂樓|PH|ROOF)$/.test(s)) return 'RF';
    const b = s.match(/^B(\d+)F?$/);           // B1, B1F, B12, B12F → B1, B12
    if (b) return 'B' + parseInt(b[1], 10);
    const f = s.match(/^(\d+)F?$/);            // 1, 1F, 12, 12F → 1F, 12F
    if (f) return parseInt(f[1], 10) + 'F';
    return s;                                  // 無法辨識：原樣回傳，呼叫端應視為獨立/未知樓層，不強制歸類
  }

  function floorLabel(canonicalKey) {
    if (canonicalKey === 'RF') return '頂樓';
    return canonicalKey;
  }

  return { canonicalFloor, floorLabel };
})();
