(function(){
  var KEY='siteTheme';
  var PROFILE_KEY='inspectionSystemUserProfile';
  var SUPABASE_URL='https://qztffronusdhgxhjjubt.supabase.co';
  var SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6dGZmcm9udXNkaGd4aGpqdWJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2OTI1MzgsImV4cCI6MjA5NzI2ODUzOH0.FnUxot5YXI3yKCUCmJA5P4ysEJhmtaQQA6rM7MRy3oA';
  var PROFILE_FIELDS=['user_id','username','name','role','rbac_role','dept_id','department','phone'];
  function readProfile(){
    try{return JSON.parse(localStorage.getItem(PROFILE_KEY)||'null')||null;}catch(e){return null;}
  }
  function saveProfile(profile){
    if(!profile||!profile.name)return;
    var clean={};
    PROFILE_FIELDS.forEach(function(key){if(profile[key]!=null&&profile[key]!=='')clean[key]=profile[key];});
    localStorage.setItem(PROFILE_KEY,JSON.stringify(clean));
    var keyMap={user_id:'user_id',username:'user_username',name:'user_name',role:'user_role',rbac_role:'user_rbac_role',dept_id:'user_dept_id',department:'user_department',phone:'user_phone'};
    Object.keys(keyMap).forEach(function(key){
      if(clean[key]!=null&&clean[key]!=='')sessionStorage.setItem(keyMap[key],clean[key]);
      else sessionStorage.removeItem(keyMap[key]);
    });
    window.dispatchEvent(new CustomEvent('system-user-profile-updated'));
  }
  function clearProfile(){
    localStorage.removeItem(PROFILE_KEY);
    ['user_id','user_username','user_name','user_role','user_rbac_role','user_dept_id','user_department','user_phone'].forEach(function(key){sessionStorage.removeItem(key);});
  }
  window.SystemUserProfile={read:readProfile,save:saveProfile,clear:clearProfile};
  var LEGACY_TO_RBAC={admin:'sysadmin',supervisor:'unit_supervisor',maintenance:'technician',inspector:'reporter'};
  function resolveRbacRole(profile){
    return (profile&&(profile.rbac_role||LEGACY_TO_RBAC[profile.role]))||null;
  }
  function storedAuthSessionForAccess(){
    try{
      var raw=localStorage.getItem('sb-qztffronusdhgxhjjubt-auth-token');
      if(!raw)return null;
      if(raw.indexOf('base64-')===0)raw=decodeURIComponent(escape(atob(raw.slice(7))));
      return JSON.parse(raw);
    }catch(e){return null;}
  }
  function fetchUserRowForAccess(authId,token){
    var url=SUPABASE_URL+'/rest/v1/users?select=user_id,name,role,rbac_role,dept_id,department&auth_id=eq.'+encodeURIComponent(authId)+'&status=eq.active&limit=1';
    return fetch(url,{headers:{apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+token}})
      .then(function(r){return r.ok?r.json():[];})
      .then(function(rows){return rows&&rows[0]?rows[0]:null;})
      .catch(function(){return null;});
  }
  function resolveCurrentProfileForAccess(){
    var cached=readProfile();
    if(cached&&(cached.rbac_role||cached.role))return Promise.resolve(cached);
    var auth=storedAuthSessionForAccess();
    var token=auth&&auth.access_token;
    var authId=auth&&auth.user&&auth.user.id;
    if(!token||!authId)return Promise.resolve(cached);
    return fetchUserRowForAccess(authId,token).then(function(row){
      if(row){saveProfile(row);return row;}
      return cached;
    });
  }
  function denyAccess(systemKey){
    location.replace('index.html?denied='+encodeURIComponent(systemKey));
    return false;
  }
  function hasVehicleAssignment(profile,bearer,table){
    if(!profile||!profile.user_id)return Promise.resolve(false);
    var url=SUPABASE_URL+'/rest/v1/'+table+'?select=active&user_id=eq.'+encodeURIComponent(profile.user_id)+'&active=eq.true&limit=1';
    return fetch(url,{headers:{apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+bearer}})
      .then(function(r){return r.ok?r.json():[];})
      .then(function(rows){return Array.isArray(rows)&&rows[0]&&rows[0].active===true;})
      .catch(function(){return false;});
  }
  function hasVehiclePersonnelAccess(profile,bearer){
    return Promise.all([
      hasVehicleAssignment(profile,bearer,'vehicle_dispatch_managers'),
      hasVehicleAssignment(profile,bearer,'vehicle_dispatch_drivers')
    ]).then(function(result){return result[0]||result[1];});
  }
  function isSysadminAccess(){
    var auth=storedAuthSessionForAccess();
    var token=auth&&auth.access_token;
    var authId=auth&&auth.user&&auth.user.id;
    function isSysadminProfile(profile){return !!profile&&(profile.rbac_role==='sysadmin'||profile.role==='admin');}
    if(!token||!authId)return Promise.resolve(isSysadminProfile(readProfile()));
    return fetchUserRowForAccess(authId,token).then(function(profile){
      if(!profile)return false;
      saveProfile(profile);
      return isSysadminProfile(profile);
    });
  }
  function denySysadminAccess(redirectPage){
    var target=redirectPage||'index.html';
    location.replace(target+(target.indexOf('?')>=0?'&':'?')+'denied=sysadmin');
    return false;
  }
  var ALL_SYSTEM_KEYS=['admin','workorder','guardpatrol','handover','equipment','structuremap','vehicle','meetingroom'];
  window.SystemAccess={
    ALL_SYSTEM_KEYS:ALL_SYSTEM_KEYS,
    // 回傳 Promise<Set<string>|null>；null 代表 sysadmin，視為全部允許。
    // 給 portal 頁一次批次查詢用，不逐一呼叫 enforce()。
    allowedSystems:function(){
      return resolveCurrentProfileForAccess().then(function(profile){
        var roleId=resolveRbacRole(profile);
        if(roleId==='sysadmin')return null;
        if(!roleId)return new Set();
        var auth=storedAuthSessionForAccess();
        var bearer=(auth&&auth.access_token)||SUPABASE_ANON_KEY;
        var perms=ALL_SYSTEM_KEYS.map(function(k){return 'sys_'+k;}).join(',');
        var url=SUPABASE_URL+'/rest/v1/role_permissions?select=perm,allowed&role_id=eq.'+encodeURIComponent(roleId)+'&perm=in.('+perms+')';
        return fetch(url,{headers:{apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+bearer}})
          .then(function(r){return r.ok?r.json():[];})
          .then(function(rows){
            var out=new Set();
            (rows||[]).forEach(function(row){
              if(row.allowed===true&&row.perm&&row.perm.indexOf('sys_')===0)out.add(row.perm.slice(4));
            });
            return hasVehiclePersonnelAccess(profile,bearer).then(function(hasAccess){if(hasAccess)out.add('vehicle');return out;});
          })
          .catch(function(){return new Set();});
      });
    },
    // systemKey: 'admin' / 'workorder' / 'guardpatrol' / 'handover' / 'equipment' / 'structuremap' / 'vehicle'
    // 回傳 Promise<boolean>；false 時已經處理好導頁，呼叫端只需 `if(!(await SystemAccess.enforce('admin')))return;`
    enforce:function(systemKey){
      return resolveCurrentProfileForAccess().then(function(profile){
        var roleId=resolveRbacRole(profile);
        if(roleId==='sysadmin')return true;
        if(!roleId)return denyAccess(systemKey);
        var auth=storedAuthSessionForAccess();
        var bearer=(auth&&auth.access_token)||SUPABASE_ANON_KEY;
        var url=SUPABASE_URL+'/rest/v1/role_permissions?select=allowed&role_id=eq.'+encodeURIComponent(roleId)+'&perm=eq.sys_'+encodeURIComponent(systemKey);
        var roleAccess=fetch(url,{headers:{apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+bearer}})
          .then(function(r){return r.ok?r.json():[];})
          .then(function(rows){return Array.isArray(rows)&&rows[0]&&rows[0].allowed===true;})
          .catch(function(){return false;});
        var personnelAccess=systemKey==='vehicle'?hasVehiclePersonnelAccess(profile,bearer):Promise.resolve(false);
        return Promise.all([roleAccess,personnelAccess]).then(function(result){return result[0]||result[1]?true:denyAccess(systemKey);});
      });
    },
    isSysadmin:isSysadminAccess,
    enforceSysadmin:function(redirectPage){
      return isSysadminAccess().then(function(allowed){return allowed?true:denySysadminAccess(redirectPage);});
    }
  };

  function installSysadminOnlyAccess(){
    var selector='[data-sysadmin-only],a[href*="patrolshifts.html"],a[href*="patrol-notifications.html"]';
    var resolved=false,allowed=false;
    var style=document.createElement('style');
    style.id='sysadminOnlyAccessStyle';
    style.textContent='[data-sysadmin-only][hidden],a[hidden][href*="patrolshifts.html"],a[hidden][href*="patrol-notifications.html"]{display:none!important}';
    document.head.appendChild(style);
    function sync(){
      document.querySelectorAll(selector).forEach(function(node){node.hidden=!resolved||!allowed;});
      document.documentElement.classList.toggle('is-sysadmin',resolved&&allowed);
    }
    sync();
    var observer=new MutationObserver(sync);
    observer.observe(document.body,{childList:true,subtree:true});
    isSysadminAccess().then(function(result){resolved=true;allowed=result;sync();}).catch(function(){resolved=true;allowed=false;sync();});
  }

  // 共用「登出」／「更改密碼」動作，供頂部導覽列的按鈕使用（全站共用元件）
  function performLogout(){
    try{
      var auth=storedAuthSessionForAccess();
      var token=auth&&auth.access_token;
      if(token){
        fetch(SUPABASE_URL+'/auth/v1/logout?scope=global',{method:'POST',headers:{apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+token}}).catch(function(){});
      }
    }catch(e){}
    clearProfile();
    try{localStorage.removeItem('sb-qztffronusdhgxhjjubt-auth-token');}catch(e){}
    location.href='login.html';
  }
  function ensureChangePwModal(){
    if(document.getElementById('sharedChangePwModal'))return;
    var style=document.createElement('style');
    style.textContent='#sharedChangePwModal{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99997;display:none;align-items:center;justify-content:center;padding:20px}#sharedChangePwModal.show{display:flex}#sharedChangePwModal .spw-box{background:var(--surface,#fff);border:1px solid var(--border,#dbe4ee);border-radius:8px;padding:20px;width:100%;max-width:360px;color:var(--text,#334155);font-family:"Noto Sans TC",system-ui,sans-serif}#sharedChangePwModal h3{margin:0 0 14px;font-size:1rem;color:var(--text-hi,var(--text,#334155))}#sharedChangePwModal label{display:block;font-size:.78rem;color:var(--text-dim,#64748b);margin:10px 0 4px}#sharedChangePwModal input{width:100%;padding:9px 10px;border:1px solid var(--border,#dbe4ee);border-radius:4px;background:var(--bg,#f4f6fa);color:var(--text,#334155);font-size:.9rem;box-sizing:border-box}#sharedChangePwModal .spw-actions{display:flex;gap:8px;margin-top:16px}#sharedChangePwModal button{flex:1;padding:9px;border-radius:4px;border:1px solid var(--border,#dbe4ee);background:transparent;color:var(--text-dim,#64748b);font-size:.85rem;cursor:pointer}#sharedChangePwModal button.spw-primary{background:var(--cyan,#0284c7);border-color:var(--cyan,#0284c7);color:#fff}#sharedChangePwModal .spw-msg{font-size:.76rem;margin-top:8px;min-height:16px}';
    document.head.appendChild(style);
    var modal=document.createElement('div');
    modal.id='sharedChangePwModal';
    modal.innerHTML='<div class="spw-box"><h3>更改密碼</h3><label>新密碼</label><input type="password" id="spwNew" autocomplete="new-password" placeholder="至少 8 個字元"><label>確認新密碼</label><input type="password" id="spwNew2" autocomplete="new-password" placeholder="再輸入一次"><div class="spw-msg" id="spwMsg"></div><div class="spw-actions"><button type="button" id="spwCancel">取消</button><button type="button" class="spw-primary" id="spwSubmit">確認更改</button></div></div>';
    document.body.appendChild(modal);
    modal.addEventListener('click',function(e){ if(e.target===modal)closeChangePwModal(); });
    document.getElementById('spwCancel').addEventListener('click',closeChangePwModal);
    document.getElementById('spwSubmit').addEventListener('click',performChangePassword);
  }
  function openChangePwModal(){
    ensureChangePwModal();
    document.getElementById('spwNew').value='';
    document.getElementById('spwNew2').value='';
    var msg=document.getElementById('spwMsg');
    msg.textContent='';
    document.getElementById('sharedChangePwModal').classList.add('show');
  }
  function closeChangePwModal(){
    var m=document.getElementById('sharedChangePwModal');
    if(m)m.classList.remove('show');
  }
  function performChangePassword(){
    var pw=document.getElementById('spwNew').value;
    var pw2=document.getElementById('spwNew2').value;
    var msg=document.getElementById('spwMsg');
    if(pw.length<8){msg.style.color='var(--red,#dc2626)';msg.textContent='密碼至少需要 8 個字元';return;}
    if(pw!==pw2){msg.style.color='var(--red,#dc2626)';msg.textContent='兩次密碼不一致';return;}
    var auth=storedAuthSessionForAccess();
    var token=auth&&auth.access_token;
    if(!token){msg.style.color='var(--red,#dc2626)';msg.textContent='請先登入後再更改密碼';return;}
    msg.style.color='var(--text-dim,#64748b)';
    msg.textContent='處理中…';
    fetch(SUPABASE_URL+'/auth/v1/user',{method:'PUT',headers:{apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({password:pw})})
      .then(function(r){return r.json().then(function(j){return {ok:r.ok,body:j};}).catch(function(){return {ok:r.ok,body:null};});})
      .then(function(res){
        if(!res.ok){
          msg.style.color='var(--red,#dc2626)';
          var m=(res.body&&(res.body.msg||res.body.error_description||res.body.message))||'';
          msg.textContent='更改失敗：'+(m.indexOf('Password should be at least')===0||/at least/.test(m)?'密碼長度不足':(m||'請稍後再試'));
          return;
        }
        msg.style.color='var(--green,#059669)';
        msg.textContent='密碼已更改';
        setTimeout(closeChangePwModal,1200);
      })
      .catch(function(){msg.style.color='var(--red,#dc2626)';msg.textContent='網路連線失敗，請稍後再試';});
  }
  window.SystemAccountActions={logout:performLogout,openChangePassword:openChangePwModal};

  function current(){ return document.documentElement.getAttribute('data-theme')||'tech'; }
  function ready(fn){ if(document.readyState!=='loading') fn(); else document.addEventListener('DOMContentLoaded',fn); }
  function taipeiNow(){
    var parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
    var p={};parts.forEach(function(x){p[x.type]=x.value;});
    return p.year+'-'+p.month+'-'+p.day+' '+p.hour+':'+p.minute+':'+p.second;
  }
  function installSharedHeaderActions(host,meta){
    if(!host||!meta.classList||meta.classList.contains('system-meta-fallback'))return;
    var page=(location.pathname.split('/').pop()||'').toLowerCase();
    if(/^(?:index|login|app|materials)\.html$/.test(page))return;

    var style=document.createElement('style');
    style.setAttribute('data-system-actions-style','');
    style.textContent='.system-actions-unified{display:inline-flex;align-items:center;justify-content:flex-end;gap:10px;margin-left:0;white-space:nowrap;order:900}.system-action-unified{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:5px 11px;border:1px solid var(--border,#dbe4ee);border-radius:3px;background:transparent;color:var(--text-dim,#64748b);font-size:.72rem;line-height:1;text-decoration:none;white-space:nowrap;transition:border-color .2s,color .2s,background .2s}.system-action-unified:hover,.system-action-unified:focus-visible{border-color:var(--cyan,#0284c7);color:var(--cyan,#0284c7);outline:none}.system-action-unified.is-current{border-color:var(--cyan,#0284c7);color:var(--cyan,#0284c7);background:rgba(0,212,255,.08);font-weight:700}.system-action-icon{display:inline-block;width:15px;height:15px;object-fit:contain;flex:0 0 15px}.system-action-unified.is-current .system-action-icon{filter:drop-shadow(0 0 4px rgba(0,132,199,.3))}@media(max-width:1100px){.system-actions-unified{gap:6px;flex-wrap:wrap}.system-action-unified{padding:5px 8px}}@media(max-width:720px){.system-actions-unified{width:100%;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));order:998}.system-action-unified{min-width:0;min-height:44px;padding:6px 3px;font-size:.62rem;gap:3px}.system-action-icon{width:13px;height:13px;flex-basis:13px}}';
    document.head.appendChild(style);

    // href 對到其中一把 key 就是舊版「共用導覽」連結，理當被下面新插入的統一版取代而移除；
    // guardpatrol.html/guardpatrol-index.html 這兩把多加了 label 檢查，因為 guardpatrol.html
    // 同時也是少數頁面（guardpatrol3d.html、patrolshifts.html、patrol-notifications.html）
    // 「巡檢稽核總覽」這個頁面專屬捷徑的目的地——純比對 href 會誤刪掉那個不相關的連結，
    // 所以這兩把才需要連 label 文字也符合「駐衛警巡檢」才真的移除。
    var replaceTargets={'dashboard.html':'','workorder.html':'','repair.html':'','admin.html':'','dispatch.html':'','equipment.html':'','guardpatrol.html':'駐衛警巡檢','guardpatrol-index.html':'駐衛警巡檢','handover.html':''};
    Array.prototype.slice.call(host.children).forEach(function(child){
      if(child===meta)return;
      if(child.tagName==='A'){
        var href='';
        try{href=(new URL(child.getAttribute('href')||'',location.href).pathname.split('/').pop()||'').toLowerCase();}catch(e){}
        if(href in replaceTargets){
          var expectLabel=replaceTargets[href];
          if(!expectLabel||(child.textContent||'').indexOf(expectLabel)!==-1)child.remove();
        }
      }else if(child.tagName==='SPAN'&&(child.textContent||'').trim()==='後台'){
        child.remove();
      }
    });

    var actions=document.createElement('nav');
    actions.className='system-actions-unified';
    actions.setAttribute('data-system-actions','');
    actions.setAttribute('aria-label','共用系統導覽');
    // sysKey 對應 SystemAccess 的系統代碼；之後新增子系統只要在這裡多加一筆並填 sysKey，
    // 就會自動依角色的「系統存取權限」設定顯示/隱藏，不用再逐頁修改。
    var defs=[
      {href:'index.html',label:'首頁',icon:'<img class="system-action-icon" src="../assets/system-icons/home-icon.svg" alt="">'},
      {href:'dashboard.html',label:'戰情儀表板',icon:'<img class="system-action-icon" src="../assets/system-icons/admin-icon.png" alt="">'},
      {href:'https://jnfakimo.github.io/word-cloud/system/admin.html?v=8f9d41c#repairs',label:'維修/派完工',icon:'<img class="system-action-icon" src="../assets/system-icons/maintenance-icon.png" alt="">',sysKey:'workorder'},
      {href:'https://jnfakimo.github.io/word-cloud/system/guardpatrol-index.html?v=1fb34a7',label:'駐衛警巡檢',icon:'<img class="system-action-icon" src="../assets/system-icons/guardpatrol-icon.png" alt="">',sysKey:'guardpatrol'},
      {href:'handover.html',label:'電子交接簿',icon:'<img class="system-action-icon" src="../assets/system-icons/handover-icon.png" alt="">',sysKey:'handover'},
      {href:'admin.html',label:'後台',icon:'<img class="system-action-icon" src="../assets/system-icons/admin-icon.png" alt="">',sysKey:'admin'}
    ];
    var sysLinks=[];
    defs.forEach(function(def){
      var link=document.createElement('a');
      link.className='system-action-unified';
      link.href=def.href;
      link.innerHTML=def.icon+'<span>'+def.label+'</span>';
      var targetPage='';
      try{targetPage=(new URL(def.href,location.href).pathname.split('/').pop()||'').toLowerCase();}catch(e){}
      var targetHash='';
      try{targetHash=(new URL(def.href,location.href).hash||'').toLowerCase();}catch(e){}
      if(page===targetPage&&(!targetHash||location.hash.toLowerCase()===targetHash)){link.classList.add('is-current');link.setAttribute('aria-current','page');}
      if(def.sysKey)sysLinks.push({key:def.sysKey,link:link});
      actions.appendChild(link);
    });
    host.insertBefore(actions,meta);
    // 依角色的「系統存取權限」設定，隱藏沒有權限的捷徑（sysadmin 一律全部顯示）
    if(sysLinks.length&&window.SystemAccess&&typeof window.SystemAccess.allowedSystems==='function'){
      window.SystemAccess.allowedSystems().then(function(allowed){
        if(allowed===null)return;
        sysLinks.forEach(function(sl){ if(!allowed.has(sl.key))sl.link.style.display='none'; });
      });
    }
  }
  // 全站共用左側品牌列：■ TAIPEC-MKT-1 <頁面名稱> 臺北農產公司／第一果菜市場
  // 頁面名稱優先讀取頁面既有的 .nav-title / .topbar-title 文字（大多數頁面已有，不用改頁面），
  // 新增頁面若沒有這兩者，預設會顯示空白頁面名稱，屆時只要在頁面既有的 .navbar/.topbar 容器內
  // 加一個 <div class="nav-title">頁面名稱</div> 即可自動套用，不需要改 theme.js。
  function pageBrandLabel(){
    var titleEl=document.querySelector('.nav-title')||document.querySelector('.topbar-title');
    if(titleEl){var t=(titleEl.textContent||'').trim();if(t)return t;}
    var page=(location.pathname.split('/').pop()||'').toLowerCase();
    if(page==='admin.html')return '後台';
    return (document.title||'').split(/[—–-]/)[0].trim();
  }
  function installBrandBar(){
    var page=(location.pathname.split('/').pop()||'').toLowerCase();
    if(/^(?:index|login|app|materials)\.html$/.test(page))return; // 入口/登入/已封存頁不套用
    var container=document.querySelector('.topbar')||document.querySelector('.navbar');
    if(!container)return; // #topbar 這類固定式圖示工具列（平面圖/3D）版面較窄，不強加品牌列

    var style=document.createElement('style');
    style.textContent='.brand-bar-unified{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:.72rem;letter-spacing:.05em;line-height:1.3}.brand-bar-unified .sys-tag-unified{color:var(--cyan,#0284c7);font-weight:700;white-space:nowrap}.brand-bar-unified .brand-org-unified,.brand-bar-unified .brand-site-unified,.brand-bar-unified .brand-sep-unified{color:var(--text-dim,#64748b)}@media(max-width:720px){.brand-bar-unified{font-size:.62rem;gap:4px}}';
    document.head.appendChild(style);

    var label=pageBrandLabel();
    var target=container.querySelector('.nav-title')||container.querySelector('.topbar-title')||container.querySelector('.topbar-left');
    if(!target){
      target=document.createElement('div');
      container.insertBefore(target,container.firstChild);
    }
    target.className=(target.className?target.className+' ':'')+'brand-bar-unified';
    target.innerHTML='<span class="sys-tag-unified">■ TAIPEC-MKT-1'+(label?(' '+label):'')+'</span>'+
      '<span class="brand-org-unified" data-sysname="org">臺北農產公司</span>'+
      '<span class="brand-sep-unified">／</span>'+
      '<span class="brand-site-unified" data-sysname="site">第一果菜市場</span>';
  }
  // 機構／場所名稱可在後台「系統設定」修改；全站沿用 data-sysname 屬性作為統一掛勾點，
  // 抓一次 system_settings 就能同步套用到品牌列與其他既有沿用同一屬性的頁面內容。
  function applyBrandNames(){
    fetch(SUPABASE_URL+'/rest/v1/system_settings?select=key,value&key=in.(org_name,site_name)',{headers:{apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+SUPABASE_ANON_KEY}})
      .then(function(r){return r.ok?r.json():[];})
      .then(function(rows){
        var s={};(rows||[]).forEach(function(row){s[row.key]=row.value;});
        if(s.org_name)document.querySelectorAll('[data-sysname="org"]').forEach(function(el){el.textContent=s.org_name;});
        if(s.site_name)document.querySelectorAll('[data-sysname="site"]').forEach(function(el){el.textContent=s.site_name;});
      })
      .catch(function(){});
  }
  function installSystemMeta(){
    var style=document.createElement('style');
    style.textContent='.system-meta-unified{display:inline-flex;align-items:center;justify-content:flex-end;gap:12px;margin-left:0;white-space:nowrap;font-family:var(--font-mono,monospace);font-size:.72rem;letter-spacing:.05em;color:var(--text-dim,#64748b);order:999}.system-connectivity-unified{display:inline-flex;align-items:center;gap:7px}.system-meta-unified .system-dot{width:7px;height:7px;border-radius:50%;background:var(--green,#00b87a);box-shadow:0 0 8px var(--green,#00b87a);flex:0 0 auto}.system-meta-unified.is-offline .system-dot{background:var(--red,#dc2626);box-shadow:0 0 8px var(--red,#dc2626)}.system-user-unified{max-width:240px;overflow:hidden;text-overflow:ellipsis;color:var(--text,#334155)}.system-clock-unified{color:var(--cyan,#0284c7);font-family:var(--font-mono,monospace);font-size:.72rem;letter-spacing:.08em}.system-user-unified,.system-connectivity-unified,.system-clock-unified,.system-changepw-unified,.system-logout-unified{padding-left:11px;border-left:1px solid var(--border,#dbe4ee)}.system-changepw-unified,.system-logout-unified{cursor:pointer;text-decoration:none;color:var(--text-dim,#64748b);background:none;border-top:none;border-right:none;border-bottom:none;margin:0;padding-top:0;padding-right:0;padding-bottom:0;font:inherit;font-size:inherit;letter-spacing:inherit;transition:color .2s}.system-changepw-unified:hover,.system-changepw-unified:focus-visible{color:var(--cyan,#0284c7)}.system-logout-unified:hover,.system-logout-unified:focus-visible{color:var(--red,#dc2626)}.system-meta-fallback{position:fixed;top:10px;right:12px;z-index:99998;padding:7px 10px;border:1px solid var(--border,#dbe4ee);background:var(--surface,#fff)}@media(max-width:1100px){.system-meta-unified{justify-content:flex-end}.topbar-right,.nav-right,.navbar,.topbar,#topbar{flex-wrap:wrap}}@media(max-width:720px){.system-meta-unified{gap:6px;font-size:.61rem;letter-spacing:0}.system-user-unified{max-width:145px}.system-clock-unified{font-size:.61rem;letter-spacing:0}.system-user-unified,.system-connectivity-unified,.system-clock-unified,.system-changepw-unified,.system-logout-unified{padding-left:6px}}';
    document.head.appendChild(style);

    var meta=document.createElement('div');
    meta.className='system-meta-unified';
    meta.setAttribute('data-system-meta','');
    meta.innerHTML='<span class="system-user-unified" data-system-user>尚未登入</span><span class="system-connectivity-unified"><span class="system-dot" aria-hidden="true"></span><span class="system-connectivity-label">系統連線中</span></span><span class="system-clock-unified" data-system-clock>----</span><button type="button" class="system-changepw-unified" data-system-changepw style="display:none">更改密碼</button><button type="button" class="system-logout-unified" data-system-logout style="display:none">登出</button>';
    var userMeta=meta.querySelector('[data-system-user]');
    var clock=meta.querySelector('[data-system-clock]');
    var label=meta.querySelector('.system-connectivity-label');
    var changepwBtn=meta.querySelector('[data-system-changepw]');
    var logoutBtn=meta.querySelector('[data-system-logout]');
    changepwBtn.addEventListener('click',function(){ if(window.SystemAccountActions)window.SystemAccountActions.openChangePassword(); });
    logoutBtn.addEventListener('click',function(){ if(window.SystemAccountActions)window.SystemAccountActions.logout(); });
    document.querySelectorAll('#navUser,#topClock,#clock,.online-dot,.dot-online').forEach(function(el){el.style.display='none';});
    document.querySelectorAll('span,div').forEach(function(el){
      if(!el.closest('[data-system-meta]')&&(el.textContent||'').trim()==='系統連線中'){
        var old=el.closest('.status-pill')||el;
        old.style.display='none';
      }
    });
    var host=document.querySelector('.topbar-right')||document.querySelector('.nav-right')||document.querySelector('.navbar')||document.querySelector('.topbar')||document.querySelector('#topbar')||document.querySelector('.statusbar-right')||document.querySelector('header');
    if(host){
      host.classList.add('system-header-unified-host');
      var shell=host.closest('.navbar,.topbar,#topbar,header')||host;
      shell.classList.add('system-header-unified-shell');
      host.appendChild(meta);
    }
    else{meta.classList.add('system-meta-fallback');document.body.appendChild(meta);}
    installSharedHeaderActions(host,meta);

    var deptLookupStarted=false;
    var authLookupStarted=false;
    function storedAuthSession(){
      try{
        var raw=localStorage.getItem('sb-qztffronusdhgxhjjubt-auth-token');
        if(!raw)return null;
        if(raw.indexOf('base64-')===0)raw=decodeURIComponent(escape(atob(raw.slice(7))));
        return JSON.parse(raw);
      }catch(e){return null;}
    }
    function recoverProfileFromAuth(){
      if(authLookupStarted)return;
      var auth=storedAuthSession();
      var token=auth&&auth.access_token;
      var authId=auth&&auth.user&&auth.user.id;
      if(!token||!authId)return;
      authLookupStarted=true;
      var url=SUPABASE_URL+'/rest/v1/users?select=user_id,username,name,role,rbac_role,dept_id,department,phone&auth_id=eq.'+encodeURIComponent(authId)+'&status=eq.active&limit=1';
      fetch(url,{headers:{apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+token}})
        .then(function(r){return r.ok?r.json():[];})
        .then(function(rows){if(rows&&rows[0]){saveProfile(rows[0]);updateUser();}})
        .catch(function(){});
    }
    function updateUser(){
      var cached=readProfile()||{};
      var name=sessionStorage.getItem('user_name')||cached.name||'';
      var dept=sessionStorage.getItem('user_department')||cached.department||'';
      if(name&&!sessionStorage.getItem('user_name'))saveProfile(cached);
      userMeta.textContent=name?(dept||'未設定單位')+'｜'+name:'尚未登入';
      changepwBtn.style.display=name?'':'none';
      logoutBtn.style.display=name?'':'none';
      var deptId=sessionStorage.getItem('user_dept_id')||cached.dept_id||'';
      if(!name||(!dept&&!deptId))recoverProfileFromAuth();
      if(name&&deptId&&!deptLookupStarted){
        deptLookupStarted=true;
        var auth=storedAuthSession();
        var bearer=auth&&auth.access_token||SUPABASE_ANON_KEY;
        fetch(SUPABASE_URL+'/rest/v1/departments?select=dept_id,name,parent_id&status=eq.active',{headers:{apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+bearer}})
          .then(function(r){return r.ok?r.json():[];})
          .then(function(rows){
            var map={};rows.forEach(function(d){map[d.dept_id]=d;});
            var path=[],cur=map[deptId],guard=0;
            while(cur&&guard++<10){path.unshift(cur.name);cur=map[cur.parent_id];}
            if(path.length){
              var profile=readProfile()||{name:name,dept_id:deptId};
              profile.department=path.join(' / ');
              saveProfile(profile);
              updateUser();
            }
          }).catch(function(){});
      }
    }

    function update(){
      var online=navigator.onLine;
      meta.classList.toggle('is-offline',!online);
      label.textContent=online?'系統連線中':'系統離線';
      clock.textContent=taipeiNow();
      updateUser();
    }
    update();
    setInterval(update,1000);
    window.addEventListener('online',update);
    window.addEventListener('offline',update);
    window.addEventListener('storage',updateUser);
    window.addEventListener('system-user-profile-updated',updateUser);
  }
  function installResponsiveHeaderLayout(){
    var style=document.createElement('style');
    style.id='system-responsive-header-style';
    style.textContent=`
      html,body{max-width:100%;overflow-x:hidden}
      @supports(overflow:clip){html,body{overflow-x:clip}}
      .system-header-unified-shell,
      .system-header-unified-host{
        box-sizing:border-box!important;
        min-width:0!important;
        max-width:100%!important;
      }
      .system-header-unified-shell{
        width:100%!important;
        height:auto!important;
        min-height:50px;
        display:flex!important;
        flex-wrap:wrap!important;
        align-items:center!important;
        align-content:center!important;
        overflow-x:hidden!important;
        overflow-y:visible!important;
      }
      .system-header-unified-shell>*{min-width:0;max-width:100%;box-sizing:border-box}
      .system-header-unified-host{
        flex:1 1 auto!important;
        display:flex!important;
        flex-wrap:wrap!important;
        align-items:center!important;
        justify-content:flex-end!important;
        overflow:visible!important;
      }
      .brand-bar-unified{flex:1 1 210px!important;min-width:0!important;max-width:100%!important}
      .system-actions-unified{
        flex:1 1 520px!important;
        min-width:0!important;
        max-width:100%!important;
        display:flex!important;
        flex-wrap:wrap!important;
        justify-content:flex-end!important;
        white-space:normal!important;
      }
      .system-action-unified{min-width:0;max-width:100%;white-space:nowrap}
      .system-meta-unified{
        flex:1 1 440px!important;
        min-width:0!important;
        max-width:100%!important;
        display:flex!important;
        flex-wrap:wrap!important;
        justify-content:flex-end!important;
        white-space:normal!important;
        overflow:hidden;
      }
      .system-meta-unified>*{min-width:0;max-width:100%}
      .system-user-unified{max-width:min(240px,100%)!important}
      html.system-has-fixed-topbar .system-fixed-below-header{
        top:calc(var(--system-header-height,50px) + var(--system-header-offset,0px))!important;
      }
      @media(max-width:1100px){
        .brand-bar-unified{flex-basis:100%!important}
        .system-actions-unified{flex-basis:100%!important;justify-content:flex-start!important}
        .system-meta-unified{flex-basis:100%!important;justify-content:flex-start!important}
      }
      @media(max-width:720px){
        .system-header-unified-shell{padding-left:8px!important;padding-right:8px!important;gap:6px!important}
        .system-header-unified-host{gap:6px!important}
        .system-actions-unified{
          width:100%!important;
          display:grid!important;
          grid-template-columns:repeat(3,minmax(0,1fr))!important;
          gap:6px!important;
        }
        .system-action-unified{width:100%;min-height:42px;white-space:normal;text-align:center}
        .system-meta-unified{display:flex!important;gap:6px!important;padding-bottom:5px}
        .system-user-unified{max-width:100%!important}
      }
      @media(max-width:430px){
        .system-actions-unified{grid-template-columns:repeat(2,minmax(0,1fr))!important}
        .system-meta-unified{justify-content:flex-start!important}
      }
    `;
    document.head.appendChild(style);

    var shell=document.querySelector('.system-header-unified-shell');
    if(!shell)return;
    var fixed=getComputedStyle(shell).position==='fixed';
    if(!fixed)return;
    document.documentElement.classList.add('system-has-fixed-topbar');

    var offsetSelectors='#c3d,#osd,#panel,#panelToggle,#floorsToggle,#floors,#mkToggle,#mkpanel,#tools,#focusNotice';
    var observed=Array.prototype.slice.call(document.querySelectorAll(offsetSelectors));
    function captureOffsets(){
      observed.forEach(function(el){el.classList.remove('system-fixed-below-header');});
      observed.forEach(function(el){
        var cs=getComputedStyle(el);
        var top=parseFloat(cs.top);
        if(cs.position==='fixed'&&Number.isFinite(top)&&top>=49){
          el.style.setProperty('--system-header-offset',(top-50)+'px');
          el.classList.add('system-fixed-below-header');
        }
      });
    }
    function syncHeight(){
      var height=Math.max(50,Math.ceil(shell.getBoundingClientRect().height));
      document.documentElement.style.setProperty('--system-header-height',height+'px');
    }
    captureOffsets();
    syncHeight();
    if(window.ResizeObserver){new ResizeObserver(syncHeight).observe(shell);}
    var timer=0;
    window.addEventListener('resize',function(){
      clearTimeout(timer);
      timer=setTimeout(function(){captureOffsets();syncHeight();},80);
    });
  }
  ready(function(){
    installSysadminOnlyAccess();
    installSystemMeta();
    installBrandBar();
    installResponsiveHeaderLayout();
    applyBrandNames();
    var btn=document.createElement('button');
    btn.id='themeToggleBtn';
    btn.type='button';
    btn.setAttribute('aria-label','切換介面風格');
    btn.style.cssText='position:fixed;right:16px;bottom:16px;z-index:99999;width:44px;height:44px;'+
      'border-radius:50%;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;'+
      'box-shadow:0 2px 10px rgba(0,0,0,.35);transition:background .2s,color .2s,border-color .2s;';
    function paint(){
      var t=current();
      var light=t==='light';
      btn.textContent=light?'🌙':'☀️';
      btn.title=light?'切換為科技版':'切換為一般版';
      btn.style.background=light?'rgba(255,255,255,.95)':'rgba(10,20,35,.88)';
      btn.style.color=light?'#1e293b':'#fff';
      btn.style.border='1px solid '+(light?'rgba(0,0,0,.15)':'rgba(255,255,255,.25)');
    }
    btn.addEventListener('click',function(){
      var next=current()==='light'?'tech':'light';
      localStorage.setItem(KEY,next);
      document.documentElement.setAttribute('data-theme',next);
      paint();
    });
    paint();
    document.body.appendChild(btn);
  });
})();
