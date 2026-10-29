// 共用 Supabase 連線設定 — 全站唯一來源，取代 30 個頁面各自硬編的 SUPA_URL/
// SUPA_KEY 與 createClient() 呼叫。anon key 設計上本來就是公開值（此純前端
// 多頁架構無建置流程，真正的存取控制在 Supabase RLS，不在於這把 key 是否可見）；
// 集中一份的目的單純是「金鑰輪替/端點變更時只需改一個檔案」的維護性，不是資安層。
//
// 用法：頁面在建立 client 前載入本檔（<script src="supabase-config.js">，需排在
// @supabase/supabase-js 之後），改用 window.createDb() 取代原本的
// supabase.createClient(SUPA_URL, SUPA_KEY)。一般登入憑證只放 sessionStorage；
// 巡檢 QR 另有最長 2 小時的跨分頁橋接；僅期限／身分留在 localStorage，權杖由仍開啟的同來源分頁即時傳遞。
// 自建站台所在網路連不到 *.supabase.co，沿用目前 origin 讓 IIS 反向代理轉發到本機 Supabase。
var isSelfHosted = typeof window !== 'undefined' && (
  /^https?:\/\/(?:192\.168\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.|1\.34\.|localhost|127\.0\.0\.1)/.test(window.location.origin) ||
  window.location.hostname === '1.34.250.22' ||
  window.location.port === '5057'
);
window.SUPA_URL = isSelfHosted ? window.location.origin : 'https://qztffronusdhgxhjjubt.supabase.co';
window.SUPA_KEY = isSelfHosted ? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzg4MjM1ODExLCJleHAiOjE5NDU5MTU4MTF9.quXojlju5ZREdYLgvaC9qMXccarzw15hY6kQw_PIwqA' : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6dGZmcm9udXNkaGd4aGpqdWJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2OTI1MzgsImV4cCI6MjA5NzI2ODUzOH0.FnUxot5YXI3yKCUCmJA5P4ysEJhmtaQQA6rM7MRy3oA';

// 全站（V1/V2 共用）密碼政策。這只是前端提示；真正檢查由 app-api/admin-api
// 的受信任後端再次執行，避免繞過畫面直接呼叫 Auth API。
window.PasswordPolicy = window.PasswordPolicy || {
  minLength: 8,
  maxLength: 8,
  message: function (password) {
    password = String(password || '');
    if (password.length !== this.minLength) return '密碼必須是 ' + this.minLength + ' 位數字';
    return /^\d{8}$/.test(password) ? '' : '密碼只能包含數字';
  }
};

// 受控 Edge Function 呼叫器：統一處理 V1 的密碼／管理操作回應，避免各頁
// 自己把 service-role 或未驗證的 Auth API 暴露在瀏覽器流程中。
window.invokeEdgeAction = async function (client, functionName, body) {
  var result = await client.functions.invoke(functionName, { body: body || {} });
  var data = result && result.data;
  if (result && result.error) {
    var message = result.error.message || '服務呼叫失敗';
    var context = result.error.context;
    if (context && typeof context.clone === 'function') {
      try { var payload = await context.clone().json(); if (payload && payload.message) message = payload.message; } catch (_) {}
    }
    throw new Error(message);
  }
  if (!data || data.ok !== true) throw new Error(data && data.message || '服務呼叫失敗');
  return data.data;
};

// V1／V2 共用的登入後資料流程：登入憑證只由 username-login 核發，
// 人員主檔與角色可用系統一律由受保護的 app-api/profile 回傳。
// 這裡不保存 access/refresh token；Supabase client 仍使用 sessionStorage。
(function installSystemAuth() {
  var sharedClient = null;
  function getClient(client) {
    if (client) return client;
    if (sharedClient) return sharedClient;
    if (typeof window.createDb !== 'function') throw new Error('登入服務尚未初始化');
    sharedClient = window.createDb();
    return sharedClient;
  }
  async function loadProfile(client) {
    var db = getClient(client);
    var profile = await window.invokeEdgeAction(db, 'app-api', { action: 'profile' });
    if (!profile || !profile.user_id || !profile.name) throw new Error('找不到啟用中的系統帳號');
    if (window.SystemUserProfile && typeof window.SystemUserProfile.save === 'function') {
      window.SystemUserProfile.save(profile);
    }
    return profile;
  }
  async function establishSession(client, tokens) {
    var db = getClient(client);
    var result = await db.auth.setSession({
      access_token: tokens && tokens.access_token,
      refresh_token: tokens && tokens.refresh_token,
    });
    if (result.error || !result.data || !result.data.session) {
      throw new Error('登入狀態建立失敗，請稍後重試');
    }
    try {
      var profile = await loadProfile(db);
      return { session: result.data.session, profile: profile };
    } catch (error) {
      try { await db.auth.signOut({ scope: 'local' }); } catch (_) {}
      if (window.SystemUserProfile && typeof window.SystemUserProfile.clear === 'function') {
        window.SystemUserProfile.clear();
      }
      throw error;
    }
  }
  async function restoreProfile(client) {
    var db = getClient(client);
    var result = await db.auth.getSession();
    if (result.error || !result.data || !result.data.session) {
      if (window.SystemUserProfile && typeof window.SystemUserProfile.clear === 'function') window.SystemUserProfile.clear();
      return null;
    }
    try { return await loadProfile(db); }
    catch (error) {
      if (window.SystemUserProfile && typeof window.SystemUserProfile.clear === 'function') window.SystemUserProfile.clear();
      throw error;
    }
  }
  window.SystemAuth = {
    loadProfile: loadProfile,
    establishSession: establishSession,
    restoreProfile: restoreProfile,
    clearProfile: function () {
      if (window.SystemUserProfile && typeof window.SystemUserProfile.clear === 'function') window.SystemUserProfile.clear();
    },
  };
})();

window.PatrolSessionBridge = (function () {
  var KEY='beinongPatrolTrustedSessionV1',CHANNEL='inspection-patrol-session-v1';
  var MAX_AGE_MS=2*60*60*1000,provider=null;
  function clear(){try{localStorage.removeItem(KEY);}catch(_e){}}
  function write(value){localStorage.setItem(KEY,JSON.stringify({version:1,user_id:value.user_id,valid_until:value.valid_until}));}
  function read(){
    try{
      var value=JSON.parse(localStorage.getItem(KEY)||'null');
      if(!value||value.version!==1||typeof value.user_id!=='string'||!value.user_id||!Number.isFinite(value.valid_until)||value.valid_until<=Date.now()){clear();return null;}
      var safe={version:1,user_id:value.user_id,valid_until:value.valid_until};
      if('access_token' in value||'refresh_token' in value)write(safe);
      return safe;
    }catch(_e){clear();return null;}
  }
  function save(session){
    if(!session||!session.access_token||!session.refresh_token||!session.user||!session.user.id)return false;
    try{
      var existing=read(),sameUser=existing&&existing.user_id===session.user.id;
      write({user_id:session.user.id,valid_until:sameUser?existing.valid_until:Date.now()+MAX_AGE_MS});return true;
    }catch(_e){return false;}
  }
  function update(session){var current=read();return !!(current&&session&&session.user&&current.user_id===session.user.id&&save(session));}
  function install(client){
    if(provider)provider.close();provider=null;
    try{provider=new BroadcastChannel(CHANNEL);}catch(_e){return;}
    provider.onmessage=async function(event){
      var m=event.data,current=read();
      if(!m||m.type!=='request'||typeof m.id!=='string'||!current||m.user_id!==current.user_id)return;
      try{
        var result=await client.auth.getSession(),session=result.data&&result.data.session,latest=read();
        if(result.error||!session||!latest||latest.user_id!==m.user_id||session.user.id!==m.user_id)return;
        provider.postMessage({type:'response',id:m.id,user_id:m.user_id,access_token:session.access_token,refresh_token:session.refresh_token});
      }catch(_e){}
    };
  }
  function request(userId){
    return new Promise(function(resolve){
      var channel,id,timer;
      try{channel=new BroadcastChannel(CHANNEL);id=crypto.randomUUID();}catch(_e){resolve(null);return;}
      function finish(value){clearTimeout(timer);channel.close();resolve(value);}
      channel.onmessage=function(event){var m=event.data;if(m&&m.type==='response'&&m.id===id&&m.user_id===userId&&typeof m.access_token==='string'&&typeof m.refresh_token==='string')finish(m);};
      timer=setTimeout(function(){finish(null);},1500);
      channel.postMessage({type:'request',id:id,user_id:userId});
    });
  }
  async function restore(client){
    var value=read();if(!value||!client||!client.auth)return null;
    try{
      var current=await client.auth.getSession(),credentials=current.data&&current.data.session;
      if(credentials&&credentials.user.id!==value.user_id)return null;
      if(!credentials)credentials=await request(value.user_id);
      var latest=read();if(!credentials||!latest||latest.user_id!==value.user_id)return null;
      var result=await client.auth.setSession({access_token:credentials.access_token,refresh_token:credentials.refresh_token});
      var session=result&&result.data&&result.data.session;
      latest=read();
      if(result.error||!session||!session.user||session.user.id!==value.user_id||!latest||latest.user_id!==value.user_id){clear();return null;}
      update(session);return session;
    }catch(_e){clear();return null;}
  }
  read(); // Migrate old permanent token copies to token-free metadata only.
  return {save:save,update:update,restore:restore,clear:clear,read:read,install:install,maxAgeMs:MAX_AGE_MS};
})();

window.createDb = function (options) {
  var config=Object.assign({},options||{});
  config.auth=Object.assign({persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:window.sessionStorage},config.auth||{});
  var client=supabase.createClient(window.SUPA_URL, window.SUPA_KEY, config);
  window.PatrolSessionBridge.install(client);
  if(client.auth&&client.auth.onAuthStateChange){
    client.auth.onAuthStateChange(function(event,session){
      if(event==='SIGNED_OUT'||event==='USER_DELETED')window.PatrolSessionBridge.clear();
      else if(session&&event==='SIGNED_IN')window.PatrolSessionBridge.save(session);
      else if(session&&['INITIAL_SESSION','TOKEN_REFRESHED','USER_UPDATED','MFA_CHALLENGE_VERIFIED'].indexOf(event)>=0)window.PatrolSessionBridge.update(session);
    });
  }
  return client;
};
window.safeDbError = function (error) {
  var code=String(error&&error.code||'');
  var message=String(error&&error.message||error||'');
  if(code==='23505')return '資料已存在，請勿重複送出';
  if(code==='23503')return '資料仍被其他紀錄使用，無法完成操作';
  if(code==='23502'||code==='22P02')return '資料格式不正確或缺少必填欄位';
  if(code==='42501'||/row-level security|permission denied/i.test(message))return '您沒有執行此操作的權限';
  if(/failed to fetch|networkerror|load failed/i.test(message))return '網路連線失敗，請確認連線後重試';
  if(code==='42P01'||code==='42703'||/schema cache|does not exist/i.test(message))return '系統資料結構尚未完成更新，請聯絡管理員';
  return '操作失敗，請稍後重試；若持續發生請聯絡管理員';
};
