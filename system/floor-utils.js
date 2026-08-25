// 樓層名稱正規化 — 全站唯一來源，取代各頁面各自實作、彼此不相容的版本。
// canonicalFloor() 回傳值只作「比對/分組鍵值」用；畫面顯示文字一律改叫 floorLabel()，
// 兩者不要混用（尤其 RF/頂樓：內部鍵值固定用 'RF'，顯示文字固定用「頂樓」）。
window.FloorUtils = (function () {
  // 實作在 theme.js 的 window.canonicalFloor，這裡在「載入當下」就把它抓住。
  //
  // 原本是每次呼叫才去查 window.canonicalFloor，而頁面只要寫
  // `function canonicalFloor(f){ return window.FloorUtils.canonicalFloor(f); }`
  // ——最上層的函式宣告會蓋掉 theme.js 那份全域——就變成
  // 頁面 → FloorUtils → 頁面 → … 的相互遞迴，每一次呼叫都直接 stack overflow。
  // b1_integrated_marker_system、equipment、guardpatrol 三頁都踩過這個坑。
  // 載入時綁定之後，頁面再怎麼覆蓋全域都只會蓋掉自己那一份，不會繞回來。
  // 前提是本檔在 theme.js 之後載入——九個頁面都是第 7、8 行成對引入。
  var impl = typeof window.canonicalFloor === 'function' ? window.canonicalFloor : null;

  function canonicalFloor(raw) {
    return impl ? impl(raw) : String(raw == null ? '' : raw).trim().toUpperCase();
  }

  function floorLabel(canonicalKey) {
    if (canonicalKey === 'RF') return '頂樓';
    return canonicalKey;
  }

  return { canonicalFloor, floorLabel };
})();
