(function(){
  'use strict';
  let rules=[];
  const days=['日','一','二','三','四','五','六'];
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const id=()=>globalThis.crypto?.randomUUID?.()||('rule_'+Date.now()+'_'+Math.random().toString(36).slice(2));
  function defaultRule(){return {id:id(),label:'早班巡邏',start:'08:00',end:'09:00',grace:0,days:[0,1,2,3,4,5,6],enabled:true,only_incomplete:true,include_points:true,_open:true};}
  function render(){
    const host=document.getElementById('patrol-timeout-settings');if(!host)return;
    host.innerHTML=`<style>.patrol-timeout-settings,.patrol-timeout-settings input,.patrol-timeout-settings select,.patrol-timeout-settings button{font-family:'Noto Sans TC',system-ui,sans-serif}.patrol-timeout-title,.patrol-timeout-summary{font-size:.85rem;font-weight:400;line-height:1.5}.patrol-timeout-grid{display:grid;grid-template-columns:2fr 1fr 1fr 90px;gap:8px;padding-top:10px}@media(max-width:720px){.patrol-timeout-grid{grid-template-columns:1fr 1fr}.patrol-timeout-grid input:first-child{grid-column:1/-1}}</style><div class="patrol-timeout-settings" style="border-top:1px solid rgba(180,138,255,.25);padding-top:16px">
      <label style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><span class="patrol-timeout-title" style="display:inline-flex;align-items:center;gap:6px;color:var(--text-hi)"><img src="../assets/system-icons/guardpatrol-icon.png" alt="" style="width:18px;height:18px;object-fit:contain">駐衛警巡檢逾時通知</span><label class="line-toggle"><input type="checkbox" id="line-notify-patrol-timeout" ${sysSettings.line_notify_patrol_timeout==='true'?'checked':''}><span class="line-toggle-slider"></span></label></label>
      <div id="patrolTimeoutRules">${rules.map((r,i)=>ruleHtml(r,i)).join('')||'<div style="color:var(--text-dim);font-size:.8rem">尚未設定巡邏時段</div>'}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button type="button" class="btn btn-sm" id="addPatrolTimeoutRule">＋新增巡邏時段</button><button type="button" class="btn btn-sm" id="testPatrolTimeout">立即統計測試</button><a href="patrol-notifications.html" class="btn btn-sm" style="text-decoration:none">查詢推播紀錄</a></div>
      <p style="margin-top:8px;font-size:.72rem;color:var(--text-dim)">超過結束時間及寬限時間後，自動統計應打卡、已打卡、未打卡、當班部門與人員，且每時段只推播一次。</p>
    </div>`;
    host.querySelector('#addPatrolTimeoutRule').onclick=()=>{rules.push(defaultRule());render();};
    host.querySelector('#testPatrolTimeout').onclick=testNow;
    host.querySelectorAll('[data-rule]').forEach(el=>bindRule(el,Number(el.dataset.rule)));
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
    el.querySelectorAll('[data-k]').forEach(input=>input.onchange=()=>{const k=input.dataset.k;rules[i][k]=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;if(k==='label')el.querySelector('[data-summary-label]').textContent=input.value||'未命名時段';if(k==='start'||k==='end')el.querySelector('[data-summary-time]').textContent=`${rules[i].start}～${rules[i].end}`;});
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
    if(rules.some(r=>!r.label||!r.start||!r.end)){showToast('請完整填寫巡邏時段',true);return false;}
    const cleanRules=rules.map(({_open,...r})=>r);
    const rows=[{key:'line_notify_patrol_timeout',value:String(enabled)},{key:'patrol_timeout_rules',value:JSON.stringify(cleanRules)}];
    const {error}=await db.from('system_settings').upsert(rows,{onConflict:'key'});if(error){showToast('巡檢逾時設定儲存失敗：'+error.message,true);return false;}
    sysSettings.line_notify_patrol_timeout=String(enabled);sysSettings.patrol_timeout_rules=JSON.stringify(cleanRules);return true;
  }
  async function testNow(){
    if(!await save())return;showToast('正在執行巡檢統計測試…');
    try{const res=await fetch(SUPABASE_URL+'/functions/v1/patrol-timeout-check',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+SUPABASE_ANON_KEY},body:JSON.stringify({force:true})});const body=await res.json();showToast(body.ok?'巡檢統計測試已執行':'測試失敗：'+(body.msg||''),!body.ok);}catch(e){showToast('測試失敗：'+e.message,true);}
  }
  const original=window.saveLineSettings;
  window.saveLineSettings=async function(){if(original)await original();await save();};
  window.addEventListener('system-settings-loaded',load);
  const timer=setInterval(()=>{if(typeof db!=='undefined'&&typeof sysSettings!=='undefined'&&Object.keys(sysSettings).length&&document.getElementById('patrol-timeout-settings')){clearInterval(timer);load();}},100);
})();
