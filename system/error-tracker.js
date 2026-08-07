// 全站前端錯誤回報 — 自架、輕量，不依賴第三方監控帳號。
// 攔截未捕捉的 JS 例外與 Promise rejection，寫入 Supabase 的 client_error_logs
// 表（system/sql/error_logging.sql），供後台「系統健康」頁面查看。
//
// 使用目前登入者的 access token 直接寫入 REST，不建立第二個 Auth client；
// 未登入時不蒐集，也不保存網址 query/hash，避免密碼重設資訊進入錯誤紀錄。
(function () {
  if (window.__errorTrackerInstalled) return;
  window.__errorTrackerInstalled = true;

  function authToken() {
    try {
      var raw=sessionStorage.getItem('sb-qztffronusdhgxhjjubt-auth-token');
      if(!raw)return '';
      if(raw.indexOf('base64-')===0)raw=decodeURIComponent(escape(atob(raw.slice(7))));
      return JSON.parse(raw).access_token||'';
    } catch(e) { return ''; }
  }

  var queue = [];
  var flushing = false;
  var MAX_QUEUE = 50; // 避免錯誤回報本身在極端情況下無限累積

  function flush() {
    if (flushing || !queue.length) return;
    var url=window.SUPA_URL,key=window.SUPA_KEY,token=authToken();
    if(!url||!key||!token){queue.length=0;return;} // 未登入頁不蒐集瀏覽器錯誤或重設連結資訊
    flushing = true;
    var batch = queue.splice(0, queue.length);
    fetch(url+'/rest/v1/client_error_logs',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+token,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify(batch)})
      .catch(function(){})
      .finally(function(){flushing=false;});
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
        url: (location.origin + location.pathname).slice(0, 1000),
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

  // 瀏覽器在同一影格內延後 ResizeObserver 通知時會送出此非致命警告。
  // 版面仍會在下一影格完成更新，不應當成應用程式錯誤重複寫入系統紀錄。
  function isBenignResizeObserverWarning(message) {
    return /^ResizeObserver loop (?:limit exceeded|completed with undelivered notifications)\.?$/i
      .test(String(message || '').trim());
  }

  window.addEventListener('error', function (ev) {
    if (isBenignResizeObserverWarning(ev.message)) {
      if (typeof ev.preventDefault === 'function') ev.preventDefault();
      return;
    }
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
