(function(){
  'use strict';
  const config={
    apiKey:'AIzaSyDuTJ58Ab6dLCoeat50AERmXyWnDz9lF6I',
    authDomain:'jnfa-4064f.firebaseapp.com',
    projectId:'jnfa-4064f',
    storageBucket:'jnfa-4064f.firebasestorage.app',
    messagingSenderId:'49696921648',
    appId:'1:49696921648:web:52640ad129911a9e6f75f5'
  };
  const vapidKey='BOyCGXAVlpUo1VK6ZxqmfjCZYh1eqC3DFRv7v8Fulv4Z0J-Sro0cLOVC9iuF_nfS4uHQ-wCwm5tQmbuRPY2eDQA';
  let messaging;

  const loadScript=src=>new Promise((resolve,reject)=>{
    if(document.querySelector(`script[src="${src}"]`))return resolve();
    const script=document.createElement('script');script.src=src;script.onload=resolve;script.onerror=reject;document.head.appendChild(script);
  });
  async function init(){
    if(!('serviceWorker' in navigator)||!('Notification' in window))throw new Error('此瀏覽器不支援網頁推播');
    await loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
    await loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
    if(!firebase.apps.length)firebase.initializeApp(config);
    messaging=firebase.messaging();
    return navigator.serviceWorker.register('./firebase-messaging-sw.js',{scope:'./'});
  }
  async function currentUser(){
    const {data:{session}}=await db.auth.getSession();
    if(!session?.user)throw new Error('請先登入系統');
    return session.user;
  }
  async function subscribe(){
    if(!('serviceWorker' in navigator)||!('Notification' in window))throw new Error('此瀏覽器不支援網頁推播');
    if(Notification.permission==='denied')throw new Error('瀏覽器已封鎖通知，請先在網址列左側的網站權限中允許「通知」');
    // Permission must be requested immediately from the button click. Awaiting
    // authentication or SDK loading first can consume the browser user gesture.
    const permission=await Notification.requestPermission();
    if(permission!=='granted')throw new Error('尚未啟用通知，請在瀏覽器提示中選擇「允許」');
    const [user,registration]=await Promise.all([currentUser(),init()]);
    const token=await messaging.getToken({vapidKey,serviceWorkerRegistration:registration});
    if(!token)throw new Error('無法取得此裝置的推播識別碼');
    const deviceName=[navigator.platform,navigator.userAgent.includes('Edg/')?'Edge':navigator.userAgent.includes('Chrome/')?'Chrome':navigator.userAgent.includes('Safari/')?'Safari':'瀏覽器'].filter(Boolean).join(' / ');
    const {error}=await db.from('fcm_subscriptions').upsert({user_id:user.id,token,device_name:deviceName,enabled:true,last_seen_at:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:'token'});
    if(error)throw error;
    return token;
  }
  async function unsubscribe(){
    const user=await currentUser(),registration=await init();
    const token=await messaging.getToken({vapidKey,serviceWorkerRegistration:registration}).catch(()=>null);
    if(token){
      const {error}=await db.from('fcm_subscriptions').update({enabled:false,updated_at:new Date().toISOString()}).eq('user_id',user.id).eq('token',token);
      if(error)throw error;
      await messaging.deleteToken();
    }
  }
  async function status(){
    if(!('Notification' in window))return {supported:false,permission:'unsupported',count:0};
    const user=await currentUser();
    const {count,error}=await db.from('fcm_subscriptions').select('*',{count:'exact',head:true}).eq('user_id',user.id).eq('enabled',true);
    if(error)throw error;
    return {supported:true,permission:Notification.permission,count:count||0};
  }
  window.PatrolFCM={subscribe,unsubscribe,status};
})();
