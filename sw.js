// sw.js - Service Worker สำหรับ PWA + Firebase + Scheduled Reminder (Fixed)
importScripts('https://www.gstatic.com/firebasejs/12.3.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.3.0/firebase-messaging-compat.js');

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
// Background Push Notification
// ─────────────────────────────────────
messaging.onBackgroundMessage((payload) => {
  console.log('[FCM] Background Message received:', payload);

  const notificationTitle = payload.notification?.title || 'เซกา | ระบบลงเวลา';
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
// Scheduled Reminder (เช้า + บ่าย) - แก้ไขปัญหา localStorage
// ─────────────────────────────────────
let remindersScheduledToday = false;

function scheduleDailyReminders() {
  if (remindersScheduledToday) return;

  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  // เวลาเช้า 07:45
  if (currentHour < 7 || (currentHour === 7 && currentMinute < 45)) {
    const morningTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 7, 45);
    const delayMorning = morningTime - now;
    setTimeout(() => sendLocalReminder('morning'), delayMorning);
  }

  // เวลาบ่าย 16:20
  if (currentHour < 16 || (currentHour === 16 && currentMinute < 20)) {
    const afternoonTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 16, 20);
    const delayAfternoon = afternoonTime - now;
    setTimeout(() => sendLocalReminder('afternoon'), delayAfternoon);
  }

  remindersScheduledToday = true;   // ป้องกันการตั้งซ้ำ
  console.log('✅ Scheduled daily reminders');
}

function sendLocalReminder(type) {
  let title = '';
  let body = '';

  if (type === 'morning') {
    title = '🕒 ถึงเวลาลงเวลาเข้างานแล้ว';
    body = 'กรุณากดลงเวลาเข้างานวันนี้ครับ';
  } else {
    title = '🕒 ใกล้ถึงเวลาออกงานแล้ว';
    body = 'อย่าลืมลงเวลาออกงานก่อนกลับบ้านนะครับ';
  }

  self.registration.showNotification(title, {
    body: body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-72.png',
    tag: `reminder-${type}`,
    requireInteraction: true,
    vibrate: [200, 100, 200]
  });
}

// ─────────────────────────────────────
// Cache Strategy
// ─────────────────────────────────────
const CACHE_NAME = 'time-attendance-v2.0';
const STATIC_CACHE_NAME = 'time-attendance-static-v2.0';

const appShellFiles = [
  '/', '/index.html', '/login.html', '/register.html', '/overtime.html',
  '/attendance.html', '/devices.html', '/request.html', '/profile.html',
  '/supervisor.html', '/manifest.json',
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
        keys.filter(k => k.startsWith('time-attendance-') && k !== CACHE_NAME && k !== STATIC_CACHE_NAME)
            .map(k => caches.delete(k))
      );
    })
  );
  self.clients.claim();
});

// Fetch
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (url.pathname.includes('/api/')) return;
  if (!url.protocol.startsWith('http')) return;

  if (cdnPatterns.some(p => url.hostname.includes(p))) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request))
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return res;
      })
      .catch(() => caches.match(request).then(cached => {
        if (cached) return cached;
        if (request.mode === 'navigate') return caches.match('/index.html');
      }))
  );
});

// รับคำสั่งจากหน้าเว็บ
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SCHEDULE_REMINDERS') {
    scheduleDailyReminders();
  }
});

// ตั้งเวลาเมื่อ Service Worker เริ่มทำงาน
self.addEventListener('activate', () => {
  scheduleDailyReminders();
});