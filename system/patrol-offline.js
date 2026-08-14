(function(){
  'use strict';
  const QUEUE_KEY='patrolCheckinQueueV1';
  const POINT_KEY='patrolPointCacheV1';
  let syncing=false;

  function read(key,fallback){
    try{return JSON.parse(localStorage.getItem(key)||'null')||fallback;}catch(e){return fallback;}
  }
  function write(key,value){localStorage.setItem(key,JSON.stringify(value));}
  function queue(){return read(QUEUE_KEY,[]);}
  function pendingCount(){return queue().length;}
  function makeId(){
    if(globalThis.crypto&&typeof globalThis.crypto.randomUUID==='function')return globalThis.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{
      const r=Math.random()*16|0,v=c==='x'?r:(r&3|8);return v.toString(16);
    });
  }
  function enqueue(item){
    const rows=queue();
    if(!rows.some(row=>row.checkin_id===item.checkin_id))rows.push(item);
    write(QUEUE_KEY,rows);notify();return rows.length;
  }
  function savePoint(type,id,point){
    const cache=read(POINT_KEY,{});cache[type+':'+id]=point;write(POINT_KEY,cache);
  }
  function getPoint(type,id){return read(POINT_KEY,{})[type+':'+id]||null;}
  function isNetworkError(error){
    const text=String(error&&error.message||error||'').toLowerCase();
    return !navigator.onLine||text.includes('failed to fetch')||text.includes('network')||text.includes('load failed')||text.includes('timeout');
  }
  function notify(detail){
    window.dispatchEvent(new CustomEvent('patrol-offline-change',{detail:Object.assign({pending:pendingCount()},detail||{})}));
  }
  // QR 簽到已改為「線上 + MFA + Edge Function」流程。保留此 API 僅為
  // 舊版 service worker 相容，但絕不再由瀏覽器直接寫入 checkin_logs。
  // 舊佇列會被清除，避免部署後重試舊的未驗證資料。
  async function sync(_db){
    const pending=pendingCount();
    if(pending)write(QUEUE_KEY,[]);
    syncing=false;notify({synced:0,discarded:pending,pending:0});
    return {synced:0,discarded:pending,pending:0};
  }
  function registerServiceWorker(){
    if('serviceWorker' in navigator){
      navigator.serviceWorker.register('patrol-service-worker.js',{scope:'./'}).catch(()=>{});
    }
  }

  window.PatrolOffline={enqueue,count:pendingCount,pendingCount,makeId,savePoint,getPoint,isNetworkError,sync,registerServiceWorker};
})();
