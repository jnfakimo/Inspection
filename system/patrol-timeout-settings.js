(function(){
  'use strict';
  let rules=[];
  const days=['日','一','二','三','四','五','六'];
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const id=()=>globalThis.crypto?.randomUUID?.()||('rule_'+Date.now()+'_'+Math.random().toString(36).slice(2));
  function defaultRule(){return {id:id(),label:'早班巡邏',start:'08:00',end:'09:00',grace:0,days:[0,1,2,3,4,5,6],enabled:true,only_incomplete:true,include_points:true,_open:true};}
  function pushTime(rule){
    const [startHour,startMinute]=String(rule.start||'00:00').split(':').map(Number);
    const [endHour,endMinute]=String(rule.end||'00:00').split(':').map(Number);
    const startTotal=startHour*60+startMinute;
    let total=endHour*60+endMinute+(Number(rule.grace)||0);
    if(endHour*60+endMinute<=startTotal)total+=24*60;
    const day=Math.floor(total/(24*60));
    const time=`${String(Math.floor(total/60)%24).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`;
    return `${day?'翌日 ':''}${time}${Number(rule.grace)?`（含寬限 ${Number(rule.grace)} 分鐘）`:''}`;
  }
  function scheduleHtml(){
    if(!rules.length)return '<div style="color:var(--text-dim);font-size:.8rem">尚未設定 LINE 推播時間</div>';
    return `<div class="patrol-push-table"><div class="patrol-push-head"><span>通知名稱</span><span>巡檢時段</span><span>LINE 自動推播時間</span><span>狀態</span></div>${rules.map(r=>`<div class="patrol-push-row"><span>${esc(r.label||'未命名時段')}</span><span>${esc(r.start)}～${esc(r.end)}</span><strong>${esc(pushTime(r))}</strong><span style="color:${r.enabled!==false?'var(--green)':'var(--text-dim)'}">${r.enabled!==false?'啟用':'停用'}</span></div>`).join('')}</div>`;
  }
  function refreshScheduleList(){const box=document.getElementById('patrolPushSchedule');if(box)box.innerHTML=scheduleHtml();}
  function render(){
    const host=document.getElementById('patrol-timeout-settings');if(!host)return;
    host.innerHTML=`<style>.patrol-timeout-settings,.patrol-timeout-settings input,.patrol-timeout-settings select,.patrol-timeout-settings button{font-family:'Noto Sans TC',system-ui,sans-serif}.patrol-timeout-title,.patrol-timeout-summary{font-size:.85rem;font-weight:400;line-height:1.5}.patrol-timeout-grid{display:grid;grid-template-columns:2fr 1fr 1fr 90px;gap:8px;padding-top:10px}.patrol-push-table{border:1px solid rgba(180,138,255,.25);border-radius:4px;overflow:hidden}.patrol-push-head,.patrol-push-row{display:grid;grid-template-columns:1.2fr 1fr 1.5fr 70px;gap:12px;padding:10px 12px;align-items:center;font-size:.78rem}.patrol-push-head{background:rgba(180,138,255,.1);color:var(--text-dim);font-weight:600}.patrol-push-row{border-top:1px solid rgba(180,138,255,.16);color:var(--text-hi)}.patrol-push-row strong{color:var(--cyan);font-weight:600}@media(max-width:720px){.patrol-timeout-grid{grid-template-columns:1fr 1fr}.patrol-timeout-grid input:first-child{grid-column:1/-1}.patrol-push-head{display:none}.patrol-push-row{grid-template-columns:1fr 1fr}.patrol-push-row strong{grid-column:1/-1}}</style><div class="patrol-timeout-settings" style="border-top:1px solid rgba(180,138,255,.25);padding-top:16px">
      <label style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><span class="patrol-timeout-title" style="display:inline-flex;align-items:center;gap:6px;color:var(--text-hi)"><img src="../assets/system-icons/guardpatrol-icon.png" alt="" style="width:18px;height:18px;object-fit:contain">駐衛警巡檢逾時通知</span><label class="line-toggle"><input type="checkbox" id="line-notify-patrol-timeout" ${sysSettings.line_notify_patrol_timeout==='true'?'checked':''}><span class="line-toggle-slider"></span></label></label>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 14px;padding:12px;border:1px solid rgba(0,212,255,.24);background:rgba(0,212,255,.035);border-radius:4px">
        <span style="font-size:.82rem;color:var(--text-hi);font-weight:600">Google Firebase Cloud Messaging</span>
        <label class="line-toggle" title="通報時間到時同步發送 FCM"><input type="checkbox" id="fcm-notify-patrol-timeout" ${sysSettings.fcm_notify_patrol_timeout==='true'?'checked':''}><span class="line-toggle-slider"></span></label>
        <span id="fcmDeviceStatus" style="font-size:.75rem;color:var(--text-dim)">檢查裝置中…</span>
        <button type="button" class="btn btn-sm" id="enableFcmDevice" style="margin-left:auto">啟用此裝置推播</button>
        <button type="button" class="btn btn-sm" id="disableFcmDevice">停用此裝置</button>
      </div>
      <div id="patrolTimeoutRules">${rules.map((r,i)=>ruleHtml(r,i)).join('')||'<div style="color:var(--text-dim);font-size:.8rem">尚未設定巡邏時段</div>'}</div>
      <div style="margin:14px 0 8px;font-size:.82rem;color:var(--text-hi);font-weight:600">LINE 自動推播時間表</div>
      <div id="patrolPushSchedule">${scheduleHtml()}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button type="button" class="btn btn-sm" id="addPatrolTimeoutRule">＋新增巡邏時段</button><button type="button" class="btn btn-sm" id="testPatrolTimeout">立即統計測試</button><a href="patrol-notifications.html" class="btn btn-sm" style="text-decoration:none">查詢推播紀錄</a></div>
      <p style="margin-top:8px;font-size:.72rem;color:var(--text-dim)">超過結束時間及寬限時間後，自動統計應打卡、已打卡、未打卡、當班部門與人員，且每時段只推播一次。</p>
    </div>`;
    host.querySelector('#addPatrolTimeoutRule').onclick=()=>{rules.push(defaultRule());render();};
    host.querySelector('#testPatrolTimeout').onclick=testNow;
    host.querySelector('#enableFcmDevice').onclick=enableFcmDevice;
    host.querySelector('#disableFcmDevice').onclick=disableFcmDevice;
    host.querySelectorAll('[data-rule]').forEach(el=>bindRule(el,Number(el.dataset.rule)));
    refreshFcmStatus();
  }
  function ruleHtml(r,i){
    return `<details data-rule="${i}" ${r._open?'open':''} style="margin-bottom:10px;border:1px solid rgba(180,138,255,.25);border-radius:4px;background:rgba(180,138,255,.04)">
      <summary class="patrol-timeout-summary" style="display:flex;align-items:center;gap:12px;padding:12px;cursor:pointer;list-style:none;color:var(--text-hi)"><span style="color:#b48aff">▸</span><span data-summary-label>${esc(r.label||'未命名時段')}</span><span data-summary-time style="color:var(--text-dim)">${esc(r.start)}～${esc(r.end)}</span><span style="margin-left:auto;color:${r.enabled!==false?'var(--green)':'var(--text-dim)'}">${r.enabled!==false?'啟用':'停用'}</span></summary>
      <div style="padding:0 12px 12px;border-top:1px solid rgba(180,138,255,.16)">
      <div class="patrol-timeout-grid"><input data-k="label" value="${esc(r.label)}" placeholder="時段名稱"><input data-k="start" type="time" value="${esc(r.start)}"><input data-k="end" type="time" value="${esc(r.end)}"><input data-k="grace" type="number" min="0" max="120" value="${Number(r.grace)||0}" title="寬限分鐘"></div>
      <div style="margin-top:8px;font-size:.75rem;color:var(--text-dim)">適用星期：${days.map((d,n)=>`<label style="margin-right:7px"><input data-day="${n}" type="checkbox" ${(r.days||[]).includes(n)?'checked':''}>${d}</label>`).join('')}</div>
      <div style="margin-top:8px;font-size:.75rem;color:var(--text-dim)">當班部門與巡檢人員由「駐衛警巡檢系統 → 巡檢排班」自動讀取。</div>
      <div style="display:flex;gap:14px;align-items:center;margin-top:8px;font-size:.75rem"><label><input data-k="enabled" type="checkbox" ${r.enabled!==false?'checked':''}>啟用</label><label><input data-k="only_incomplete" type="checkbox" ${r.only_incomplete!==false?'checked':''}>僅未完成時推播</label><label><input data-k="include_points" type="checkbox" ${r.include_points?'checked':''}>列出未打卡點位</label><button type="button" data-done class="btn btn-sm" style="margin-left:auto">完成並收合</button><button type="button" data-delete class="btn btn-sm">刪除</button></div>
      </div>
    </details>`;
  }
  function bindRule(el,i){
    el.addEventListener('toggle',()=>rules[i]._open=el.open);
    el.querySelectorAll('[data-k]').forEach(input=>input.onchange=()=>{const k=input.dataset.k;rules[i][k]=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;if(k==='label')el.querySelector('[data-summary-label]').textContent=input.value||'未命名時段';if(k==='start'||k==='end')el.querySelector('[data-summary-time]').textContent=`${rules[i].start}～${rules[i].end}`;refreshScheduleList();});
    el.querySelectorAll('[data-day]').forEach(input=>input.onchange=()=>{rules[i].days=[...el.querySelectorAll('[data-day]:checked')].map(x=>Number(x.dataset.day));});
    el.querySelector('[data-delete]').onclick=()=>{rules.splice(i,1);render();};
    el.querySelector('[data-done]').onclick=()=>{rules[i]._open=false;el.open=false;};
  }
  async function load(){
    if(typeof db==='undefined'||typeof sysSettings==='undefined')return;
    try{rules=JSON.parse(sysSettings.patrol_timeout_rules||'[]').map(r=>({...r,_open:false}));}catch(_e){rules=[];}
    render();
  }
  async function save(){
    const enabled=document.getElementById('line-notify-patrol-timeout')?.checked||false;
    const fcmEnabled=document.getElementById('fcm-notify-patrol-timeout')?.checked||false;
    if(rules.some(r=>!r.label||!r.start||!r.end)){showToast('請完整填寫巡邏時段',true);return false;}
    const cleanRules=rules.map(({_open,...r})=>r);
    const rows=[{key:'line_notify_patrol_timeout',value:String(enabled)},{key:'fcm_notify_patrol_timeout',value:String(fcmEnabled)},{key:'patrol_timeout_rules',value:JSON.stringify(cleanRules)}];
    const {error}=await db.from('system_settings').upsert(rows,{onConflict:'key'});if(error){showToast('巡檢逾時設定儲存失敗：'+error.message,true);return false;}
    sysSettings.line_notify_patrol_timeout=String(enabled);sysSettings.fcm_notify_patrol_timeout=String(fcmEnabled);sysSettings.patrol_timeout_rules=JSON.stringify(cleanRules);return true;
  }
  async function refreshFcmStatus(){
    const el=document.getElementById('fcmDeviceStatus');if(!el)return;
    if(!window.PatrolFCM){el.textContent='FCM 程式尚未載入';return;}
    try{const s=await PatrolFCM.status();el.textContent=!s.supported?'此瀏覽器不支援推播':s.permission==='denied'?`通知已封鎖｜已登記 ${s.count} 台`:`通知權限：${s.permission==='granted'?'已允許':'尚未允許'}｜已登記 ${s.count} 台`;}
    catch(e){el.textContent='狀態讀取失敗：'+e.message;}
  }
  async function enableFcmDevice(){
    try{showToast('正在啟用此裝置推播…');await PatrolFCM.subscribe();showToast('此裝置已啟用 Firebase 推播');await refreshFcmStatus();}
    catch(e){showToast('FCM 啟用失敗：'+e.message,true);}
  }
  async function disableFcmDevice(){
    try{await PatrolFCM.unsubscribe();showToast('此裝置的 Firebase 推播已停用');await refreshFcmStatus();}
    catch(e){showToast('FCM 停用失敗：'+e.message,true);}
  }
  async function testNow(){
    if(!await save())return;showToast('正在執行巡檢統計測試…');
    try{const {data:{session}}=await db.auth.getSession();if(!session?.access_token)throw new Error('登入已過期，請重新登入');const res=await fetch(SUPABASE_URL+'/functions/v1/patrol-timeout-check',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token},body:JSON.stringify({force:true})});const body=await res.json();showToast(body.ok?'巡檢統計測試已執行':'測試失敗：'+(body.msg||''),!body.ok);}catch(e){showToast('測試失敗：'+e.message,true);}
  }
  const original=window.saveLineSettings;
  window.saveLineSettings=async function(){if(original)await original();await save();};
  window.addEventListener('system-settings-loaded',load);
  const timer=setInterval(()=>{if(typeof db!=='undefined'&&typeof sysSettings!=='undefined'&&Object.keys(sysSettings).length&&document.getElementById('patrol-timeout-settings')){clearInterval(timer);load();}},100);
})();
