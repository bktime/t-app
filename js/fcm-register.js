// fcm-register.js

// ✅ ฟังก์ชันตรวจสอบว่าเป็นมือถือ Android/iOS หรือไม่
function isMobileDevice() {
  const userAgent = navigator.userAgent || navigator.vendor || window.opera;
  const isMobileUA = /Android|iPhone|iPod/i.test(userAgent);
  const isIPad = /Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 0;
  return isMobileUA || isIPad;
}

// ✅ ฟังก์ชันลงทะเบียนรับแจ้งเตือน
async function registerFCMToken() {
  try {
    if (!isMobileDevice()) {
      // console.log('ℹ️ ข้ามการลงทะเบียน FCM เนื่องจากเป็น PC');
      return;
    }

    if (!('Notification' in window) || !('serviceWorker' in navigator)) return;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    const registration = await navigator.serviceWorker.ready;
    const messaging = firebase.messaging();

    const fcmToken = await messaging.getToken({
      vapidKey: 'BMbd1gPYFtFSFEUHDTM-Ir1XLTnnI8on62UI9etACDKvnSStjM0dgwRHBav7dqZJnRQ5FiWNWqXP7edw2slFf9U',
      serviceWorkerRegistration: registration
    });

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

// ✅ ฟังก์ชันยกเลิกรับแจ้งเตือน (ใช้ตอน Logout)
async function unregisterFCMToken() {
  try {
    if (!isMobileDevice()) return;
    if (!('serviceWorker' in navigator)) return;

    const messaging = firebase.messaging();
    const fcmToken = await messaging.getToken();
    const sessionToken = localStorage.getItem('auth_token');

    if (!fcmToken || !sessionToken) return;

    // 1. ลบ Token ออกจาก Server
    await fetch('/api/fcm-token', {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${sessionToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fcm_token: fcmToken })
    });

    // 2. ลบ Token ออกจาก Browser ด้วย (เคลียร์ให้สะอาด)
    await messaging.deleteToken();
    console.log('🗑️ FCM Token deleted from device');

  } catch (err) {
    console.warn('⚠️ FCM unregister:', err.message);
  }
}