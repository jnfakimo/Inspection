// 樓層名稱正規化 — 全站唯一來源，取代各頁面各自實作、彼此不相容的版本。
// canonicalFloor() 回傳值只作「比對/分組鍵值」用；畫面顯示文字一律改叫 floorLabel()，
// 兩者不要混用（尤其 RF/頂樓：內部鍵值固定用 'RF'，顯示文字固定用「頂樓」）。
window.FloorUtils = (function () {
  function canonicalFloor(raw) {
    return typeof window.canonicalFloor === 'function'
      ? window.canonicalFloor(raw)
      : String(raw == null ? '' : raw).trim();
  }

  function floorLabel(canonicalKey) {
    if (canonicalKey === 'RF') return '頂樓';
    return canonicalKey;
  }

  return { canonicalFloor, floorLabel };
})();
