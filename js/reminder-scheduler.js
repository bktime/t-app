// reminder-scheduler.js
// ฝังในทุกหน้า HTML: <script src="/js/reminder-scheduler.js"></script>

class ReminderScheduler {
  constructor() {
    this.morningHour = 7;
    this.morningMinute = 45;
    this.afternoonHour = 16;
    this.afternoonMinute = 20;
    this.checkInterval = null;
  }

  // ✅ แก้ไข: อ่าน/เขียน state ผ่าน localStorage เพื่อให้คงอยู่แม้ refresh หน้า
  _getTodayKey(type) {
    const today = new Date().toISOString().slice(0, 10); // "2024-01-15"
    return `reminded_${type}_${today}`;
  }

  _hasNotifiedToday(type) {
    try {
      return localStorage.getItem(this._getTodayKey(type)) === '1';
    } catch {
      return false;
    }
  }

  _markNotifiedToday(type) {
    try {
      localStorage.setItem(this._getTodayKey(type), '1');
      // ลบ key เก่า (เก่ากว่า 3 วัน) ไม่ให้ localStorage พอง
      this._cleanOldKeys();
    } catch {
      // ignore quota errors
    }
  }

  _cleanOldKeys() {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 3);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      Object.keys(localStorage)
        .filter(k => k.startsWith('reminded_') && k < `reminded_z_${cutoffStr}`)
        .forEach(k => localStorage.removeItem(k));
    } catch {
      // ignore
    }
  }

  async init() {
    if (!('Notification' in window)) {
      console.warn('⚠️ Browser ไม่รองรับ Notification');
      return;
    }

    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        console.warn('⚠️ User ไม่อนุญาต Notification');
        return;
      }
    }

    if (Notification.permission !== 'granted') return;

    await this.registerPeriodicSync();
    this.startChecking();
    this.checkAndNotify();

    console.log('✅ Reminder Scheduler initialized');
  }

  startChecking() {
    this.checkInterval = setInterval(() => {
      this.checkAndNotify();
    }, 30 * 1000);

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this.checkAndNotify();
      }
    });
  }

  checkAndNotify() {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    // เวลาเช้า: 7:40 - 7:50 (±5 นาที จาก 7:45)
    const morningStart = this.morningHour * 60 + (this.morningMinute - 5);
    const morningEnd   = this.morningHour * 60 + (this.morningMinute + 5);

    if (currentMinutes >= morningStart && currentMinutes <= morningEnd) {
      // ✅ แก้ไข: เช็คจาก localStorage แทน instance variable
      if (!this._hasNotifiedToday('morning')) {
        this.sendReminder(
          'morning',
          '🕒 ถึงเวลาลงเวลาเข้างานแล้ว',
          'กรุณากดลงเวลาเข้างานวันนี้ครับ',
          'reminder-morning'
        );
        this._markNotifiedToday('morning');
      }
    }

    // เวลาบ่าย: 16:15 - 16:25 (±5 นาที จาก 16:20)
    const afternoonStart = this.afternoonHour * 60 + (this.afternoonMinute - 5);
    const afternoonEnd   = this.afternoonHour * 60 + (this.afternoonMinute + 5);

    if (currentMinutes >= afternoonStart && currentMinutes <= afternoonEnd) {
      // ✅ แก้ไข: เช็คจาก localStorage แทน instance variable
      if (!this._hasNotifiedToday('afternoon')) {
        this.sendReminder(
          'afternoon',
          '🕒 ใกล้ถึงเวลาออกงานแล้ว',
          'อย่าลืมลงเวลาออกงานก่อนกลับบ้านนะครับ',
          'reminder-afternoon'
        );
        this._markNotifiedToday('afternoon');
      }
    }

    // ✅ แก้ไข: ลบ block reset เที่ยงคืนออก
    // ไม่จำเป็นอีกต่อไปเพราะ key ใน localStorage มีวันที่กำกับอยู่แล้ว
    // วันใหม่ = key ใหม่ = ไม่เคยแจ้งเตือน โดยอัตโนมัติ
  }

  async sendReminder(type, title, body, tag) {
    try {
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'SHOW_NOTIFICATION',
          title: title,
          body: body,
          tag: tag
        });
        console.log(`✅ ${type} reminder sent via SW`);
      } else {
        new Notification(title, {
          body: body,
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-72.png',
          tag: tag,
          requireInteraction: true,
          vibrate: [200, 100, 200]
        });
        console.log(`✅ ${type} reminder sent via Notification API`);
      }
    } catch (err) {
      console.error('❌ Failed to send reminder:', err);
    }
  }

  async registerPeriodicSync() {
    try {
      const registration = await navigator.serviceWorker.ready;

      if ('periodicSync' in registration) {
        const status = await navigator.permissions.query({
          name: 'periodic-background-sync'
        });

        if (status.state === 'granted') {
          await registration.periodicSync.register('attendance-reminder', {
            minInterval: 15 * 60 * 1000 // ขั้นต่ำ 15 นาที
          });
          console.log('✅ Periodic Background Sync registered');
        } else {
          console.warn('⚠️ Periodic Background Sync not granted');
        }
      } else {
        console.warn('⚠️ Periodic Background Sync not supported (iOS/Firefox) — แจ้งเตือนได้เฉพาะเมื่อเปิดแอปไว้');
      }
    } catch (err) {
      console.warn('⚠️ Periodic Sync registration failed:', err);
    }
  }

  destroy() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }
}

// Auto-initialize (ป้องกัน duplicate init ถ้าโหลดสคริปต์ซ้ำ)
if (!window.__reminderSchedulerInit) {
  window.__reminderSchedulerInit = true;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      window.__reminderScheduler = new ReminderScheduler();
      window.__reminderScheduler.init();
    });
  } else {
    window.__reminderScheduler = new ReminderScheduler();
    window.__reminderScheduler.init();
  }
}