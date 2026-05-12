// sw.js - Service Worker for PWA
const CACHE_NAME = 'time-attendance-v2.0';
const STATIC_CACHE_NAME = 'time-attendance-static-v2.0';

// ไฟล์จากเซิร์ฟเวอร์เราเอง (Cache ตอน Install)
const appShellFiles = [
  '/',
  '/index.html',
  '/login.html',
  '/register.html',
  '/overtime.html',
  '/attendance.html',
  '/devices.html',
  '/request.html',
  '/profile.html',
  '/supervisor.html',
  '/dash.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-192.png',
  '/icons/maskable-512.png',
  '/screenshots/mobile.png',
  '/screenshots/desktop.png'
];

// ทรัพยากรจาก CDN (Cache แบบ Cache-First ตอน Fetch)
const cdnPatterns = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net'
];

// ═══════════════════════════════════
//  Install: Cache App Shell
// ═══════════════════════════════════
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('📦 Caching App Shell');
        // ใช้ addAll แบบไม่ throw ถ้าไฟล์ไหนไม่มี (เผื่อบางหน้ายังไม่ได้สร้าง)
        return Promise.allSettled(
          appShellFiles.map(url =>
            cache.add(url).catch(err => {
              console.warn(`⚠️ Failed to cache: ${url}`, err.message);
            })
          )
        );
      })
  );
  self.skipWaiting();
});

// ═══════════════════════════════════
//  Activate: Clean old caches
// ═══════════════════════════════════
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name.startsWith('time-attendance-') && name !== CACHE_NAME && name !== STATIC_CACHE_NAME)
          .map(name => {
            console.log('🗑️ Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    })
  );
  self.clients.claim();
});

// ═══════════════════════════════════
//  Fetch: Strategy depends on request type
// ═══════════════════════════════════
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET
  if (request.method !== 'GET') return;

  // Skip API calls
  if (url.pathname.includes('/api/')) return;

  // Skip chrome-extension และอื่นๆ ที่ไม่ใช่ http/https
  if (!url.protocol.startsWith('http')) return;

  // ── CDN Resources: Cache First, Fallback to Network ──
  if (cdnPatterns.some(pattern => url.hostname.includes(pattern))) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(STATIC_CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // ── App Pages & Assets: Network First, Fallback to Cache ──
  event.respondWith(
    fetch(request)
      .then(response => {
        // สำเร็จ: เก็บเข้า Cache
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => {
        // Offline: หาจาก Cache
        return caches.match(request).then(cachedResponse => {
          if (cachedResponse) return cachedResponse;

          // ถ้าเป็น navigation request (ผู้ใช้พิมพ์ URL หรือกดลิงก์)
          // และไม่เจอใน Cache ให้แสดง index.html
          if (request.mode === 'navigate') {
            return caches.match('/index.html');
          }

          // กรณีอื่นๆ (เช่นรูปภาพที่ยังไม่ได้ Cache)
          return undefined;
        });
      })
  );
});