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
    var url=SUPABASE_URL+'/rest/v1/users?select=user_id,name,role,rbac_role,department&auth_id=eq.'+encodeURIComponent(authId)+'&status=eq.active&limit=1';
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
  var ALL_SYSTEM_KEYS=['admin','workorder','guardpatrol','handover','equipment','structuremap'];
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
            return out;
          })
          .catch(function(){return new Set();});
      });
    },
    // systemKey: 'admin' / 'workorder' / 'guardpatrol' / 'handover' / 'equipment' / 'structuremap'
    // 回傳 Promise<boolean>；false 時已經處理好導頁，呼叫端只需 `if(!(await SystemAccess.enforce('admin')))return;`
    enforce:function(systemKey){
      return resolveCurrentProfileForAccess().then(function(profile){
        var roleId=resolveRbacRole(profile);
        if(roleId==='sysadmin')return true;
        if(!roleId)return denyAccess(systemKey);
        var auth=storedAuthSessionForAccess();
        var bearer=(auth&&auth.access_token)||SUPABASE_ANON_KEY;
        var url=SUPABASE_URL+'/rest/v1/role_permissions?select=allowed&role_id=eq.'+encodeURIComponent(roleId)+'&perm=eq.sys_'+encodeURIComponent(systemKey);
        return fetch(url,{headers:{apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+bearer}})
          .then(function(r){return r.ok?r.json():[];})
          .then(function(rows){
            var allowed=Array.isArray(rows)&&rows[0]&&rows[0].allowed===true;
            return allowed?true:denyAccess(systemKey);
          })
          .catch(function(){return denyAccess(systemKey);});
      });
    }
  };

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

    var replaceTargets={'dashboard.html':1,'workorder.html':1,'repair.html':1,'admin.html':1,'dispatch.html':1,'equipment.html':1,'guardpatrol.html':1,'guardpatrol-index.html':1,'handover.html':1};
    Array.prototype.slice.call(host.children).forEach(function(child){
      if(child===meta)return;
      if(child.tagName==='A'){
        var href='';
        try{href=(new URL(child.getAttribute('href')||'',location.href).pathname.split('/').pop()||'').toLowerCase();}catch(e){}
        if(replaceTargets[href])child.remove();
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
    if(host)host.appendChild(meta);
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
      if(name&&!dept&&deptId&&!deptLookupStarted){
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
  ready(function(){
    installSystemMeta();
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
