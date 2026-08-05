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
  async function sync(db){
    if(syncing||!navigator.onLine||!db)return {synced:0,pending:pendingCount()};
    syncing=true;let synced=0,rows=queue(),remaining=[];
    for(let i=0;i<rows.length;i++){
      const item=rows[i];
      const payload={
        checkin_id:item.checkin_id,target_type:item.target_type,target_id:item.target_id,
        floor_id:item.floor_id||null,label:item.label||null,user_id:item.user_id||null,
        user_name:item.user_name||null,checkin_at:item.checkin_at
      };
      try{
        const {error}=await db.from('checkin_logs').insert(payload);
        if(!error||error.code==='23505'){synced++;continue;}
        if(isNetworkError(error)){remaining.push(...rows.slice(i));break;}
        item.last_error=error.message||'sync failed';remaining.push(item);
      }catch(error){remaining.push(...rows.slice(i));break;}
    }
    write(QUEUE_KEY,remaining);syncing=false;
    const result={synced,pending:remaining.length};notify(result);return result;
  }
  function registerServiceWorker(){
    if('serviceWorker' in navigator){
      navigator.serviceWorker.register('patrol-service-worker.js',{scope:'./'}).catch(()=>{});
    }
  }

  window.PatrolOffline={enqueue,count:pendingCount,pendingCount,makeId,savePoint,getPoint,isNetworkError,sync,registerServiceWorker};
})();
