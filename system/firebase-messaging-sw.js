importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyDuTJ58Ab6dLCoeat50AERmXyWnDz9lF6I',
  authDomain: 'jnfa-4064f.firebaseapp.com',
  projectId: 'jnfa-4064f',
  storageBucket: 'jnfa-4064f.firebasestorage.app',
  messagingSenderId: '49696921648',
  appId: '1:49696921648:web:52640ad129911a9e6f75f5'
});

const messaging = firebase.messaging();
messaging.onBackgroundMessage(payload => {
  const data = payload.data || {};
  self.registration.showNotification(data.title || '駐衛警巡檢通知', {
    body: data.body || '巡檢通報時間已到，請查看未完成巡檢點。',
    icon: '../assets/system-icons/guardpatrol-icon.png',
    badge: '../assets/system-icons/guardpatrol-icon.png',
    tag: data.tag || 'patrol-timeout',
    data: { url: data.url || './guardpatrol.html' }
  });
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './guardpatrol.html', self.registration.scope).href;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const existing = list.find(client => client.url === target);
    return existing ? existing.focus() : clients.openWindow(target);
  }));
});
