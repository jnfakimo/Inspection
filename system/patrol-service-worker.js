const CACHE='patrol-checkin-v10-mfa-reset';
const SHELL=[
  './patrolcheckin.html','./patrolcheckin-app.js?v=20260814-mfa-reset2','./theme.js?v=20260814-patrol-session1',
  './light-mode-fix.css','./mobile-unified.css?v=20260717-1','./supabase-config.js?v=20260814-patrol-session1',
  './vendor/supabase-js-2.min.js'
];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.mode==='navigate'&&url.pathname.endsWith('/patrolcheckin.html')){
    event.respondWith(fetch(event.request).then(response=>{
      const copy=response.clone();caches.open(CACHE).then(cache=>cache.put('./patrolcheckin.html',copy));return response;
    }).catch(()=>caches.match('./patrolcheckin.html')));
    return;
  }
  // Other system pages must remain network-first so deployments are not hidden
  // behind the patrol offline cache.
  if(event.request.mode==='navigate')return;
  if(url.origin===location.origin){
    // stale-while-revalidate：有快取就秒回（地下室弱網也不卡），
    // 同時背景抓新版寫回快取，下一次開啟就是最新的。
    // 舊的 cache-first 一旦命中就永遠不回網路，部署後會卡住舊版 JS/CSS。
    event.respondWith(caches.match(event.request).then(hit=>{
      const fresh=fetch(event.request).then(response=>{
        if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}
        return response;
      }).catch(err=>{if(hit)return hit;throw err;});
      // 命中快取時回應已經送出，要靠 waitUntil 撐住背景更新不被 SW 回收。
      if(hit)event.waitUntil(fresh);
      return hit||fresh;
    }));
  }
});
