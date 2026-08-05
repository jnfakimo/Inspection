// 日期格式化 — 全站唯一來源，取代 6 個檔案各自重複、時區處理方式不一致的版本。
// 全站日期一律用西元 YYYY-MM-DD；一律以 Asia/Taipei 為準，不依賴瀏覽器/裝置本機時區
// （這正是稽核報告點名的問題：部分頁面直接用 new Date(v).getFullYear() 之類的本機時區
// getter，或是對 timestamptz 欄位的 UTC ISO 字串直接 slice(0,10)，會在台北時間
// 00:00–07:59 這段區間算錯一天）。
window.DateUtils = (function () {
  function todayISO() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
  }
  function fmtDate(v) {
    if (!v) return '—';
    const d = new Date(v);
    if (isNaN(d)) return String(v).slice(0, 10);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(d);
  }
  return { todayISO, fmtDate };
})();
