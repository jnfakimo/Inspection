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
    if(/^(?:index|login|app|inspection-archived|materials|materials-archived)\.html$/.test(page))return;

    var style=document.createElement('style');
    style.setAttribute('data-system-actions-style','');
    style.textContent='.system-actions-unified{display:inline-flex;align-items:center;justify-content:flex-end;gap:10px;margin-left:0;white-space:nowrap;order:900}.system-action-unified{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:5px 11px;border:1px solid var(--border,#dbe4ee);border-radius:3px;background:transparent;color:var(--text-dim,#64748b);font-size:.72rem;line-height:1;text-decoration:none;white-space:nowrap;transition:border-color .2s,color .2s,background .2s}.system-action-unified:hover,.system-action-unified:focus-visible{border-color:var(--cyan,#0284c7);color:var(--cyan,#0284c7);outline:none}.system-action-unified.is-current{border-color:var(--cyan,#0284c7);color:var(--cyan,#0284c7);background:rgba(0,212,255,.08);font-weight:700}.system-action-icon{display:inline-block;width:15px;height:15px;object-fit:contain;flex:0 0 15px}.system-action-unified.is-current .system-action-icon{filter:drop-shadow(0 0 4px rgba(0,132,199,.3))}@media(max-width:1100px){.system-actions-unified{gap:6px;flex-wrap:wrap}.system-action-unified{padding:5px 8px}}@media(max-width:720px){.system-actions-unified{width:100%;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));order:998}.system-action-unified{min-width:0;min-height:44px;padding:6px 3px;font-size:.62rem;gap:3px}.system-action-icon{width:13px;height:13px;flex-basis:13px}}';
    document.head.appendChild(style);

    var replaceTargets={'dashboard.html':1,'workorder.html':1,'repair.html':1,'admin.html':1,'dispatch.html':1,'equipment.html':1,'guardpatrol.html':1};
    Array.prototype.slice.call(host.children).forEach(function(child){
      if(child===meta)return;
      if(child.tagName==='A'){
        var href=(child.getAttribute('href')||'').split('#')[0].split('?')[0].toLowerCase();
        if(replaceTargets[href])child.remove();
      }else if(child.tagName==='SPAN'&&(child.textContent||'').trim()==='後台'){
        child.remove();
      }
    });

    var actions=document.createElement('nav');
    actions.className='system-actions-unified';
    actions.setAttribute('data-system-actions','');
    actions.setAttribute('aria-label','共用系統導覽');
    var defs=[
      {href:'index.html',label:'首頁',icon:'<img class="system-action-icon" src="../assets/system-icons/home-icon.svg" alt="">'},
      {href:'dashboard.html',label:'戰情儀表板',icon:'<img class="system-action-icon" src="../assets/system-icons/admin-icon.png" alt="">'},
      {href:'admin.html#repairs',label:'報修系統',icon:'<img class="system-action-icon" src="../assets/system-icons/maintenance-icon.png" alt="">'},
      {href:'repair.html',label:'完工回報',icon:'<img class="system-action-icon" src="../assets/system-icons/maintenance-icon.png" alt="">'},
      {href:'guardpatrol.html',label:'駐衛警巡檢',icon:'<img class="system-action-icon" src="../assets/system-icons/guardpatrol-icon.png" alt="">'},
      {href:'admin.html',label:'後台',icon:'<img class="system-action-icon" src="../assets/system-icons/admin-icon.png" alt="">'}
    ];
    defs.forEach(function(def){
      var link=document.createElement('a');
      link.className='system-action-unified';
      link.href=def.href;
      link.innerHTML=def.icon+'<span>'+def.label+'</span>';
      if(page===def.href){link.classList.add('is-current');link.setAttribute('aria-current','page');}
      actions.appendChild(link);
    });
    host.insertBefore(actions,meta);
  }
  function installSystemMeta(){
    var style=document.createElement('style');
    style.textContent='.system-meta-unified{display:inline-flex;align-items:center;justify-content:flex-end;gap:12px;margin-left:0;white-space:nowrap;font-family:var(--font-mono,monospace);font-size:.72rem;letter-spacing:.05em;color:var(--text-dim,#64748b);order:999}.system-connectivity-unified{display:inline-flex;align-items:center;gap:7px}.system-meta-unified .system-dot{width:7px;height:7px;border-radius:50%;background:var(--green,#00b87a);box-shadow:0 0 8px var(--green,#00b87a);flex:0 0 auto}.system-meta-unified.is-offline .system-dot{background:var(--red,#dc2626);box-shadow:0 0 8px var(--red,#dc2626)}.system-user-unified{max-width:240px;overflow:hidden;text-overflow:ellipsis;color:var(--text,#334155)}.system-clock-unified{color:var(--cyan,#0284c7);font-family:var(--font-mono,monospace);font-size:.72rem;letter-spacing:.08em}.system-user-unified,.system-connectivity-unified,.system-clock-unified{padding-left:11px;border-left:1px solid var(--border,#dbe4ee)}.system-meta-fallback{position:fixed;top:10px;right:12px;z-index:99998;padding:7px 10px;border:1px solid var(--border,#dbe4ee);background:var(--surface,#fff)}@media(max-width:1100px){.system-meta-unified{justify-content:flex-end}.topbar-right,.nav-right,.navbar,.topbar,#topbar{flex-wrap:wrap}}@media(max-width:720px){.system-meta-unified{gap:6px;font-size:.61rem;letter-spacing:0}.system-user-unified{max-width:145px}.system-clock-unified{font-size:.61rem;letter-spacing:0}.system-user-unified,.system-connectivity-unified,.system-clock-unified{padding-left:6px}}';
    document.head.appendChild(style);

    var meta=document.createElement('div');
    meta.className='system-meta-unified';
    meta.setAttribute('data-system-meta','');
    meta.innerHTML='<span class="system-user-unified" data-system-user>尚未登入</span><span class="system-connectivity-unified"><span class="system-dot" aria-hidden="true"></span><span class="system-connectivity-label">系統連線中</span></span><span class="system-clock-unified" data-system-clock>----</span>';
    var userMeta=meta.querySelector('[data-system-user]');
    var clock=meta.querySelector('[data-system-clock]');
    var label=meta.querySelector('.system-connectivity-label');
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
