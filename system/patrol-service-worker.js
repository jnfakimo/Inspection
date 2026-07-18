const CACHE='patrol-checkin-v3';
const SHELL=[
  './patrolcheckin.html','./patrol-offline.js?v=20260717-1','./patrolcheckin-app.js?v=20260717-1','./theme.js?v=20260717-3',
  './light-mode-fix.css','./mobile-unified.css?v=20260717-1',
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
  if(url.origin===location.origin){
    event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(response=>{
      if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}
      return response;
    })));
  }
});
