// ใช้ Firebase compat (เหมือนใน sw.js) — ไม่ต้อง import module ใหม่

async function registerFCMToken() {
  try {
    if (!('Notification' in window)) return;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    // ✅ รอ SW พร้อมก่อน แล้วส่ง registration เข้าไปใน getToken โดยตรง
    const registration = await navigator.serviceWorker.ready;

    const messaging = firebase.messaging();

const fcmToken = await messaging.getToken({
  vapidKey: 'BMbd1gPYFtFSFEUHDTM-Ir1XLTnnI8on62UI9etACDKvnSStjM0dgwRHBav7dqZJnRQ5FiWNWqXP7edw2slFf9U',
  serviceWorkerRegistration: registration
});

    console.log('FCM Token:', fcmToken);

    if (!fcmToken) return;

    const sessionToken = localStorage.getItem('auth_token');
    if (!sessionToken) return;

    await fetch('/api/fcm-token', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sessionToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fcm_token: fcmToken })
    });

    console.log('✅ FCM Token registered');
  } catch (err) {
    console.warn('⚠️ FCM registration:', err.message);
  }
}
// เรียกหลัง login สำเร็จ หรือ page load ที่ login แล้ว
document.addEventListener('DOMContentLoaded', () => {
  if (localStorage.getItem('auth_token')) {
    registerFCMToken();
  }
});

// เรียกตอน logout — ลบ token ออกจาก server
async function unregisterFCMToken() {
  try {
    const messaging = firebase.messaging();
    const fcmToken = await messaging.getToken();
    const sessionToken = localStorage.getItem('auth_token');

    if (!fcmToken || !sessionToken) return;

    await fetch('/api/fcm-token', {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${sessionToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fcm_token: fcmToken })
    });
  } catch (err) {
    console.warn('⚠️ FCM unregister:', err.message);
  }
}