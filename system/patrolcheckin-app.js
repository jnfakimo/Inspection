(function(){
  'use strict';
  const db=createDb();
  const offline=window.PatrolOffline;
  const card=document.getElementById('card');
  const badge=document.getElementById('offlineQueueBadge');

  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function fmt(value){const d=new Date(value);const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}/${p(d.getMonth()+1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;}
  function updateBadge(){const count=offline.count();badge.hidden=count===0;badge.textContent=`待同步 ${count} 筆`;}
  function showState(icon,iconClass,title,sub,backHref,backLabel){
    card.innerHTML=`<div class="icon ${iconClass}">${icon}</div><h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div><a class="btn" href="${esc(backHref||'patrollist.html')}">← ${esc(backLabel||'返回巡檢')}</a>`;
  }
  function cachedProfile(session){
    let profile=null;
    try{profile=window.SystemUserProfile?.read?.()||null;}catch(_e){}
    return {user_id:profile?.user_id||null,name:profile?.name||sessionStorage.getItem('user_name')||session.user.user_metadata?.name||session.user.email||'巡檢人員'};
  }
  async function getProfile(session){
    const fallback=cachedProfile(session);
    if(!navigator.onLine)return fallback;
    try{
      const {data,error}=await db.from('users').select('user_id,name').eq('auth_id',session.user.id).single();
      if(error)throw error;
      return data||fallback;
    }catch(_e){return fallback;}
  }
  async function getPoint(type,id){
    const cached=offline.getPoint(type,id);
    if(navigator.onLine){
      try{
        if(type==='marker'){
          const {data,error}=await db.from('plan_markers').select('marker_id,floor_id,label,kind,status').eq('marker_id',id).single();
          if(error)throw error;
          if(!data||data.kind!=='patrol'||data.status!=='active')return {invalid:true};
          const point={label:data.label,floor_id:data.floor_id};offline.savePoint(type,id,point);return point;
        }
        const {data,error}=await db.from('floor_spaces').select('space_id,floor,space_name').eq('space_id',id).single();
        if(error)throw error;
        if(!data)return {invalid:true};
        const point={label:data.space_name,floor_id:data.floor};offline.savePoint(type,id,point);return point;
      }catch(error){if(!offline.isNetworkError(error)&&!cached)throw error;}
    }
    return cached||{label:type==='marker'?`巡檢點 ${id.slice(0,8)}`:`巡檢區域 ${id.slice(0,8)}`,floor_id:'待同步確認'};
  }
  function renderSuccess(event,point,queued,backHref,backLabel){
    const pointLabel=event.target_type==='marker'?'巡檢點':'巡檢區域';
    card.innerHTML=`
      <div class="icon ok">${queued?'📱':'✓'}</div>
      <h1>${queued?'已離線保存':'打卡成功'}</h1>
      <div class="sub">${queued?'資料已暫存於本手機，恢復網路後將自動回傳':'巡檢紀錄已成功送出'}</div>
      <div class="detail">
        <div><span class="k">${pointLabel}</span><b>${esc(point.label)}</b></div>
        <div><span class="k">樓層</span><b>${esc(point.floor_id)}</b></div>
        <div><span class="k">人員</span><b>${esc(event.user_name)}</b></div>
        <div><span class="k">掃描時間</span><b>${esc(fmt(event.checkin_at))}</b></div>
        ${queued?`<div><span class="k">同步狀態</span><b>待同步（共 ${offline.count()} 筆）</b></div>`:''}
      </div>
      <a class="btn" href="${esc(backHref)}">← ${esc(backLabel)}</a>
      <div class="hist" id="hist"></div>`;
    updateBadge();
    if(!queued)loadHistory(event.target_type,event.target_id,pointLabel);
  }
  async function loadHistory(type,id,pointLabel){
    const hist=document.getElementById('hist');if(!hist||!navigator.onLine)return;
    hist.innerHTML=`<div class="hist-t">本${esc(pointLabel)}最近打卡紀錄</div><div class="hist-empty">載入中…</div>`;
    try{
      const {data,error}=await db.from('checkin_logs').select('user_name,checkin_at').eq('target_type',type).eq('target_id',id).order('checkin_at',{ascending:false}).limit(10);
      if(error)throw error;
      const rows=(data||[]).map(r=>`<div class="hist-row"><span class="u">${esc(r.user_name||'')}</span><span>${esc(fmt(r.checkin_at))}</span></div>`).join('');
      hist.innerHTML=`<div class="hist-t">本${esc(pointLabel)}最近打卡紀錄</div>${rows||'<div class="hist-empty">尚無打卡紀錄</div>'}`;
    }catch(_e){hist.innerHTML=`<div class="hist-error">暫時無法載入紀錄</div>`;}
  }
  async function syncPending(){
    if(!navigator.onLine)return;
    const result=await offline.sync(db);updateBadge();
    if(result.synced>0&&card.querySelector('h1')?.textContent==='已離線保存'){
      const sub=card.querySelector('.sub');if(sub)sub.textContent=`已自動回傳 ${result.synced} 筆巡檢紀錄`;
    }
  }
  async function main(){
    offline.registerServiceWorker();updateBadge();
    window.addEventListener('patrol-offline-change',updateBadge);
    window.addEventListener('online',syncPending);
    const params=new URLSearchParams(location.search),markerId=params.get('marker'),spaceId=params.get('space');
    const targetType=markerId?'marker':spaceId?'space':null,targetId=markerId||spaceId;
    if(!targetType){showState('⚠','err','無效的巡檢碼','QR Code 缺少巡檢點資料');return;}
    const backHref=targetType==='marker'?'patrollist.html':'arealist.html';
    const backLabel=targetType==='marker'?'返回巡檢列表':'返回區域列表';
    let session;
    try{({data:{session}}=await db.auth.getSession());}catch(_e){}
    if(!session){location.href='login.html?redirect='+encodeURIComponent('patrolcheckin.html'+location.search);return;}
    const profile=await getProfile(session);
    let point;
    try{point=await getPoint(targetType,targetId);}catch(_e){showState('⚠','err','讀取巡檢點失敗','請稍後重試',backHref,backLabel);return;}
    if(point.invalid){showState('⚠','err','巡檢點無效','此 QR Code 已停用或不存在',backHref,backLabel);return;}
    const event={checkin_id:offline.makeId(),target_type:targetType,target_id:targetId,floor_id:point.floor_id,label:point.label,user_id:profile.user_id||null,user_name:profile.name||'巡檢人員',checkin_at:new Date().toISOString()};
    if(!navigator.onLine){offline.enqueue(event);renderSuccess(event,point,true,backHref,backLabel);return;}
    try{
      const {error}=await db.from('checkin_logs').insert(event);if(error)throw error;
      renderSuccess(event,point,false,backHref,backLabel);syncPending();
    }catch(error){
      if(offline.isNetworkError(error)){offline.enqueue(event);renderSuccess(event,point,true,backHref,backLabel);return;}
      showState('⚠','err','打卡失敗',error?.message||'請稍後重試',backHref,backLabel);
    }
  }
  main();
})();
