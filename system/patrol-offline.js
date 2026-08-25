(function(){
  'use strict';
  const QUEUE_KEY='patrolCheckinQueueV1';
  const QUARANTINE_KEY='patrolCheckinQuarantineV1';
  const POINT_KEY='patrolPointCacheV1';
  const EVENT_FIELDS=['checkin_id','target_type','target_id','floor_id','label','user_id','user_name','checkin_at'];

  function read(key,fallback){
    try{return JSON.parse(localStorage.getItem(key)||'null')||fallback;}catch(e){return fallback;}
  }
  function write(key,value){localStorage.setItem(key,JSON.stringify(value));}
  function queue(){return read(QUEUE_KEY,[]);}
  function pendingCount(){return queue().length;}
  function quarantine(){return read(QUARANTINE_KEY,[]);}
  function eventFingerprint(item){return EVENT_FIELDS.map(key=>String((item&&item[key])??'')).join('\u001f');}
  function quarantineRows(rows,reason){
    const source=Array.isArray(rows)?rows.filter(Boolean):[];
    if(!source.length)return 0;
    const now=new Date().toISOString();
    const existing=quarantine();
    const known=new Set(existing.map(item=>`${item.quarantine_reason||''}\u001f${eventFingerprint(item)}`));
    source.forEach(item=>{
      const row=Object.assign({},item,{quarantine_reason:reason,quarantined_at:now});
      const key=`${reason}\u001f${eventFingerprint(row)}`;
      if(!known.has(key)){existing.push(row);known.add(key);}
    });
    // 保留最近 1000 筆隔離項目，避免舊版瀏覽器的 localStorage 被無限佔用。
    write(QUARANTINE_KEY,existing.slice(-1000));
    return source.length;
  }
  function makeId(){
    if(globalThis.crypto&&typeof globalThis.crypto.randomUUID==='function')return globalThis.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{
      const r=Math.random()*16|0,v=c==='x'?r:(r&3|8);return v.toString(16);
    });
  }
  function enqueue(item){
    const rows=queue();
    const duplicate=rows.find(row=>row.checkin_id&&row.checkin_id===item.checkin_id);
    let quarantined=0;
    if(!duplicate)rows.push(item);
    else if(eventFingerprint(duplicate)!==eventFingerprint(item)){
      quarantined=quarantineRows([duplicate,item],'checkin_id_conflict');
      rows.splice(rows.indexOf(duplicate),1);
    }
    write(QUEUE_KEY,rows);notify({quarantined});return rows.length;
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
  // 舊佇列不可直接重送：其中可能沒有通過登入、MFA 與即時目標狀態驗證。
  // 改為隔離保存，避免資料遺失，也避免把未驗證事件寫回 checkin_logs。
  async function sync(_db){
    const pending=pendingCount();
    const quarantined=pending?quarantineRows(queue(),'legacy_unverified_queue'):0;
    if(pending)write(QUEUE_KEY,[]);
    notify({synced:0,quarantined,pending:0});
    return {synced:0,quarantined,pending:0};
  }
  function registerServiceWorker(){
    if('serviceWorker' in navigator){
      navigator.serviceWorker.register('patrol-service-worker.js',{scope:'./'}).catch(()=>{});
    }
  }

  window.PatrolOffline={enqueue,count:pendingCount,pendingCount,quarantineCount:()=>quarantine().length,makeId,savePoint,getPoint,isNetworkError,sync,registerServiceWorker};
})();
