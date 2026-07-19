(function(){
  'use strict';
  let rules=[],users=[],departments=[];
  const days=['日','一','二','三','四','五','六'];
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const id=()=>globalThis.crypto?.randomUUID?.()||('rule_'+Date.now()+'_'+Math.random().toString(36).slice(2));
  function defaultRule(){return {id:id(),label:'早班巡邏',start:'08:00',end:'09:00',grace:0,days:[0,1,2,3,4,5,6],user_ids:[],enabled:true,only_incomplete:true,include_points:true};}
  function selected(rule,userId){return (rule.user_ids||[]).includes(userId);}
  function render(){
    const host=document.getElementById('patrol-timeout-settings');if(!host)return;
    host.innerHTML=`<div style="border-top:1px solid rgba(180,138,255,.25);padding-top:16px">
      <label style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><span style="font-weight:700;color:var(--text-hi)">巡檢逾時 LINE 推播</span><label class="line-toggle"><input type="checkbox" id="line-notify-patrol-timeout" ${sysSettings.line_notify_patrol_timeout==='true'?'checked':''}><span class="line-toggle-slider"></span></label></label>
      <div id="patrolTimeoutRules">${rules.map((r,i)=>ruleHtml(r,i)).join('')||'<div style="color:var(--text-dim);font-size:.8rem">尚未設定巡邏時段</div>'}</div>
      <div style="display:flex;gap:8px;margin-top:10px"><button type="button" class="btn btn-sm" id="addPatrolTimeoutRule">＋新增巡邏時段</button><button type="button" class="btn btn-sm" id="testPatrolTimeout">立即統計測試</button></div>
      <p style="margin-top:8px;font-size:.72rem;color:var(--text-dim)">超過結束時間及寬限時間後，自動統計應打卡、已打卡、未打卡、當班部門與人員，且每時段只推播一次。</p>
    </div>`;
    host.querySelector('#addPatrolTimeoutRule').onclick=()=>{rules.push(defaultRule());render();};
    host.querySelector('#testPatrolTimeout').onclick=testNow;
    host.querySelectorAll('[data-rule]').forEach(el=>bindRule(el,Number(el.dataset.rule)));
  }
  function ruleHtml(r,i){
    const options=users.map(u=>`<option value="${esc(u.user_id)}" ${selected(r,u.user_id)?'selected':''}>${esc(u.department||departments.find(d=>d.dept_id===u.dept_id)?.name||'未設定單位')}｜${esc(u.name)}</option>`).join('');
    return `<div data-rule="${i}" style="padding:12px;margin-bottom:10px;border:1px solid rgba(180,138,255,.25);border-radius:4px;background:rgba(180,138,255,.04)">
      <div style="display:grid;grid-template-columns:2fr 1fr 1fr 90px;gap:8px"><input data-k="label" value="${esc(r.label)}" placeholder="時段名稱"><input data-k="start" type="time" value="${esc(r.start)}"><input data-k="end" type="time" value="${esc(r.end)}"><input data-k="grace" type="number" min="0" max="120" value="${Number(r.grace)||0}" title="寬限分鐘"></div>
      <div style="margin-top:8px;font-size:.75rem;color:var(--text-dim)">適用星期：${days.map((d,n)=>`<label style="margin-right:7px"><input data-day="${n}" type="checkbox" ${(r.days||[]).includes(n)?'checked':''}>${d}</label>`).join('')}</div>
      <div style="margin-top:8px"><label style="font-size:.75rem;color:var(--text-dim)">當班巡檢人員（可複選）</label><select data-users multiple size="${Math.min(5,Math.max(2,users.length))}" style="width:100%;margin-top:4px">${options}</select></div>
      <div style="display:flex;gap:14px;align-items:center;margin-top:8px;font-size:.75rem"><label><input data-k="enabled" type="checkbox" ${r.enabled!==false?'checked':''}>啟用</label><label><input data-k="only_incomplete" type="checkbox" ${r.only_incomplete!==false?'checked':''}>僅未完成時推播</label><label><input data-k="include_points" type="checkbox" ${r.include_points?'checked':''}>列出未打卡點位</label><button type="button" data-delete class="btn btn-sm" style="margin-left:auto">刪除</button></div>
    </div>`;
  }
  function bindRule(el,i){
    el.querySelectorAll('[data-k]').forEach(input=>input.onchange=()=>{const k=input.dataset.k;rules[i][k]=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;});
    el.querySelectorAll('[data-day]').forEach(input=>input.onchange=()=>{rules[i].days=[...el.querySelectorAll('[data-day]:checked')].map(x=>Number(x.dataset.day));});
    el.querySelector('[data-users]').onchange=e=>rules[i].user_ids=[...e.target.selectedOptions].map(o=>o.value);
    el.querySelector('[data-delete]').onclick=()=>{rules.splice(i,1);render();};
  }
  async function load(){
    if(typeof db==='undefined'||typeof sysSettings==='undefined')return;
    try{rules=JSON.parse(sysSettings.patrol_timeout_rules||'[]');}catch(_e){rules=[];}
    const [u,d]=await Promise.all([db.from('users').select('user_id,name,department,dept_id').eq('status','active').order('name'),db.from('departments').select('dept_id,name').eq('status','active')]);
    users=u.data||[];departments=d.data||[];render();
  }
  async function save(){
    const enabled=document.getElementById('line-notify-patrol-timeout')?.checked||false;
    if(rules.some(r=>!r.label||!r.start||!r.end)){showToast('請完整填寫巡邏時段',true);return false;}
    const rows=[{key:'line_notify_patrol_timeout',value:String(enabled)},{key:'patrol_timeout_rules',value:JSON.stringify(rules)}];
    const {error}=await db.from('system_settings').upsert(rows,{onConflict:'key'});if(error){showToast('巡檢逾時設定儲存失敗：'+error.message,true);return false;}
    sysSettings.line_notify_patrol_timeout=String(enabled);sysSettings.patrol_timeout_rules=JSON.stringify(rules);return true;
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
