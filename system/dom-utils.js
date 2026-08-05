// HTML escaping — 全站唯一來源，取代 13+ 個檔案各自重複實作的版本
// （其中 admin.html 曾經有兩份彼此覆蓋、且其中一份漏掉單引號跳脫）。
// 同時提供 escHtml 與 esc 兩個名稱，對應現有頁面兩種不同的既有呼叫習慣，方便逐頁遷移。
window.DomUtils = (function () {
  function escHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }
  return { escHtml, esc: escHtml };
})();
