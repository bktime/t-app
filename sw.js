// sw.js - Service Worker สำหรับ PWA + Firebase + Scheduled Reminder
// ✅ แก้ไข: เวอร์ชัน Firebase SDK ที่มีอยู่จริง (10.14.1)
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

// ─────────────────────────────────────
// Firebase Configuration
// ─────────────────────────────────────
firebase.initializeApp({
  apiKey: "AIzaSyASi0aclvDbgrJH89r2E2I1Jm8AqYO1wDU",
  authDomain: "attendance-app-c1aeb.firebaseapp.com",
  projectId: "attendance-app-c1aeb",
  storageBucket: "attendance-app-c1aeb.firebasestorage.app",
  messagingSenderId: "383918652730",
  appId: "1:383918652730:web:6be2fcbd25964e21f72403"
});

const messaging = firebase.messaging();

// ─────────────────────────────────────
// Background Push Notification (FCM)
// ─────────────────────────────────────
messaging.onBackgroundMessage((payload) => {
  console.log('[FCM] Background Message received:', payload);

  const notificationTitle = payload.notification?.title || 'ระบบลงเวลา';
  const notificationOptions = {
    body: payload.notification?.body || 'คุณมีแจ้งเตือนใหม่',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-72.png',
    tag: 'fcm-' + Date.now(),
    requireInteraction: false
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// ─────────────────────────────────────
// รับคำสั่งแจ้งเตือนจาก Client
// ─────────────────────────────────────
self.addEventListener('message', (event) => {
  if (!event.data) return;

  switch (event.data.type) {
    case 'SHOW_NOTIFICATION':
      showLocalNotification(event.data.title, event.data.body, event.data.tag);
      break;

    case 'SCHEDULE_REMINDERS':
      // SW ถูก kill ได้ตลอดเวลา — ให้ client เป็นคนจับเวลาแทน
      event.source.postMessage({
        type: 'SW_READY',
        message: 'Service Worker is ready, client should handle scheduling'
      });
      break;
  }
});

// ─────────────────────────────────────
// Notification Click
// ─────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const tag = event.notification.tag;
  let targetUrl = '/';

  if (tag === 'reminder-morning') {
    targetUrl = '/attendance.html?action=checkin';
  } else if (tag === 'reminder-afternoon') {
    targetUrl = '/attendance.html?action=checkout';
  } else if (tag === 'reminder-pending') {
    // ✅ เปิดหน้า index แล้วให้ user กดเปิด notif panel เอง
    // หรือจะชี้ตรงไปที่ requests.html ก็ได้
    targetUrl = '/requests.html';
  } else if (tag?.startsWith('fcm-')) {
    targetUrl = '/attendance.html';
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});

function showLocalNotification(title, body, tag) {
  self.registration.showNotification(title, {
    body: body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-72.png',
    tag: tag || 'local-' + Date.now(),
    requireInteraction: true,
    vibrate: [200, 100, 200]
  });
}

// ─────────────────────────────────────
// Periodic Background Sync (Chrome on Android only)
// ─────────────────────────────────────
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'attendance-reminder') {
    event.waitUntil(checkAndSendReminder());
  }
});

async function checkAndSendReminder() {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const timeStr = `${hour}:${String(minute).padStart(2, '0')}`;

  // ─── เตือนลงเวลาเข้า ───
  if (timeStr >= '7:00' && timeStr <= '8:00') {
    showLocalNotification(
      '🕒 ถึงเวลาลงเวลาเข้างานแล้ว',
      'กรุณากดลงเวลาเข้างานวันนี้ครับ',
      'reminder-morning'
    );
    return;
  }

  // ─── เตือนลงเวลาออก ───
  if (timeStr >= '16:30' && timeStr <= '17:00') {
    showLocalNotification(
      '🕒 ใกล้ถึงเวลาออกงานแล้ว',
      'อย่าลืมลงเวลาออกงานก่อนกลับบ้านนะครับ',
      'reminder-afternoon'
    );
    return;
  }

  // ─── เตือน pending ทุก 30 นาที ในช่วง 09:00–12:00 ───
  // dedup จริงทำที่ client (_hasNotifiedThisSlot) SW แค่ trigger เท่านั้น
  if (timeStr >= '9:00' && timeStr < '12:00') {
    await checkAndSendPendingReminder();
  }
}

// ─── ดึง pending count จาก API แล้วแจ้งเตือน (ใช้ใน periodic sync) ───
async function checkAndSendPendingReminder() {
  // SW ไม่มี localStorage → ไม่รู้ auth_token → ใช้ได้เฉพาะเมื่อ SW controller active
  // ทางนี้จึง postMessage กลับไปให้ client จัดการแทน
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (clients.length > 0) {
    clients[0].postMessage({ type: 'CHECK_PENDING_REMINDER' });
    console.log('[SW] ส่ง CHECK_PENDING_REMINDER ไปยัง client');
  }
  // ถ้าไม่มี client เปิดอยู่ → ข้ามไป รอรอบถัดไป
}

// ─────────────────────────────────────
// Cache Strategy
// ─────────────────────────────────────
const CACHE_NAME = 'time-attendance-v2.1';
const STATIC_CACHE_NAME = 'time-attendance-static-v2.1';

const appShellFiles = [
  '/', '/index.html', '/login.html', '/register.html', '/overtime.html',
  '/attendance.html', '/devices.html', '/request.html', '/profile.html',
  '/supervisor.html', '/404.html', '/manifest.json',
  '/icons/icon-192.png', '/icons/icon-512.png'
];

const cdnPatterns = [
  'fonts.googleapis.com', 'fonts.gstatic.com',
  'cdnjs.cloudflare.com', 'cdn.jsdelivr.net'
];

// Install
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('📦 Caching App Shell');
      return Promise.allSettled(appShellFiles.map(url =>
        cache.add(url).catch(() => {})
      ));
    })
  );
  self.skipWaiting();
});

// Activate
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(k =>
          k.startsWith('time-attendance-') &&
          k !== CACHE_NAME &&
          k !== STATIC_CACHE_NAME
        ).map(k => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (url.pathname.includes('/api/')) return;
  if (!url.protocol.startsWith('http')) return;

  // CDN → Cache First
  if (cdnPatterns.some(p => url.hostname.includes(p))) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request))
    );
    return;
  }

  // App → Network First + Cache Fallback
  event.respondWith(
    fetch(request)
      .then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return res;
      })
      .catch(() =>
        caches.match(request).then(cached => {
          if (cached) return cached;
          if (request.mode === 'navigate') return caches.match('/404.html');
          // ✅ แก้ไข: เพิ่ม fallback สุดท้ายแทน undefined
          return new Response('Offline', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        })
      )
  );
});