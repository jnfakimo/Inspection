// 全站前端錯誤回報 — 自架、輕量，不依賴第三方監控帳號。
// 攔截未捕捉的 JS 例外與 Promise rejection，寫入 Supabase 的 client_error_logs
// 表（system/sql/error_logging.sql），供後台「系統健康」頁面查看。
//
// 使用獨立的最小 Supabase client（不依賴各頁面自己的 db 變數），避免載入
// 順序造成的相依問題；讀寫本身走既有的 window.SUPA_URL/window.SUPA_KEY
// （由 supabase-config.js 提供），未載入時會安靜略過，不影響頁面其他功能。
(function () {
  if (window.__errorTrackerInstalled) return;
  window.__errorTrackerInstalled = true;

  var _client = null;
  function client() {
    if (_client) return _client;
    if (typeof supabase === 'undefined') return null;
    var url = window.SUPA_URL, key = window.SUPA_KEY;
    if (!url || !key) return null;
    _client = supabase.createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    return _client;
  }

  var queue = [];
  var flushing = false;
  var MAX_QUEUE = 50; // 避免錯誤回報本身在極端情況下無限累積

  function flush() {
    if (flushing || !queue.length) return;
    var c = client();
    if (!c) return; // supabase-js 或設定尚未就緒，留在佇列，下次錯誤觸發時再試
    flushing = true;
    var batch = queue.splice(0, queue.length);
    c.from('client_error_logs').insert(batch).then(
      function () { flushing = false; },
      function () { flushing = false; } // 回報失敗就放棄這批，不能因為回報錯誤本身又製造新錯誤
    );
  }

  function currentUserId() {
    try {
      return sessionStorage.getItem('user_id') || null;
    } catch (e) { return null; }
  }

  function report(kind, message, detail) {
    try {
      if (queue.length >= MAX_QUEUE) return;
      queue.push({
        kind: kind,
        message: String(message == null ? '' : message).slice(0, 2000),
        detail: detail ? JSON.stringify(detail).slice(0, 4000) : null,
        page: location.pathname.split('/').pop() || '',
        url: location.href.slice(0, 1000),
        user_id: currentUserId(),
        user_agent: navigator.userAgent.slice(0, 500),
        occurred_at: new Date().toISOString()
      });
      flush();
      // 若錯誤發生在 supabase-config.js／supabase-js 尚未載入完成的極早期，
      // 延遲重試一次，避免第一筆錯誤因為時機太早而永遠卡在佇列裡。
      setTimeout(flush, 3000);
    } catch (e) { /* 錯誤回報本身不可以拋出例外 */ }
  }

  window.addEventListener('error', function (ev) {
    report('js_error', ev.message, {
      source: ev.filename, line: ev.lineno, col: ev.colno,
      stack: ev.error && ev.error.stack
    });
  });

  window.addEventListener('unhandledrejection', function (ev) {
    var reason = ev.reason;
    report('unhandled_rejection', (reason && reason.message) || String(reason), {
      stack: reason && reason.stack
    });
  });

  // 供頁面主動回報「已經被 catch 但仍屬於重要異常」的情況，
  // 例如關鍵送出流程失敗、非預期的資料庫回應等。
  window.reportClientError = function (message, detail) {
    report('manual', message, detail);
  };
})();
