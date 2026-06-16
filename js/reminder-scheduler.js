// reminder-scheduler.js
class ReminderScheduler {
  constructor() {
    this.morningHour = 7;
    this.morningMinute = 10;
    this.afternoonHour = 16;
    this.afternoonMinute = 32;
    // ⏰ เวลาแจ้งเตือน pending (ครั้งเดียวต่อวัน เช่น 08:30)
    this.pendingHour = 8;
    this.pendingMinute = 30;
    this.checkInterval = null;
    this._attendanceCache = null;
    this._attendanceCacheDate = null;
  }

  _getTodayKey(type) {
    const today = new Date().toISOString().slice(0, 10);
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
      this._cleanOldKeys();
    } catch {
      // ignore
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

  async checkAndNotify() {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    // ─── เตือนลงเวลาเข้างาน ───
    const morningStart = this.morningHour * 60 + (this.morningMinute - 5);
    const morningEnd   = this.morningHour * 60 + (this.morningMinute + 30);

    if (currentMinutes >= morningStart && currentMinutes <= morningEnd) {
      if (!this._hasNotifiedToday('morning')) {
        const checkedIn = await this._hasCheckedInToday();
        if (!checkedIn) {
          this.sendReminder('morning', '🕒 ถึงเวลาลงเวลาเข้างานแล้ว', 'กรุณากดลงเวลาเข้างานวันนี้ครับ', 'reminder-morning');
        }
        this._markNotifiedToday('morning');
      }
    }

    // ─── เตือนลงเวลาออกงาน ───
    const afternoonStart = this.afternoonHour * 60 + (this.afternoonMinute - 1);
    const afternoonEnd   = this.afternoonHour * 60 + (this.afternoonMinute + 30);

    if (currentMinutes >= afternoonStart && currentMinutes <= afternoonEnd) {
      if (!this._hasNotifiedToday('afternoon')) {
        const checkedOut = await this._hasCheckedOutToday();
        if (!checkedOut) {
          this.sendReminder('afternoon', '🕒 ใกล้ถึงเวลาออกงานแล้ว', 'อย่าลืมลงเวลาออกงานก่อนกลับบ้านนะครับ', 'reminder-afternoon');
        }
        this._markNotifiedToday('afternoon');
      }
    }

    // ─── เตือน pending รออนุมัติ / รอรับรอง ───
    const pendingStart = this.pendingHour * 60 + (this.pendingMinute - 1);
    const pendingEnd   = this.pendingHour * 60 + (this.pendingMinute + 30);

    if (currentMinutes >= pendingStart && currentMinutes <= pendingEnd) {
      if (!this._hasNotifiedToday('pending')) {
        await this._checkPendingAndNotify();
        this._markNotifiedToday('pending');
      }
    }
  }

  // ============================================================
  // ✅ ดึงข้อมูลจาก API (1 ครั้ง + cache)
  // ============================================================
  async _fetchTodayAttendance() {
    const today = new Date().toISOString().slice(0, 10);

    if (this._attendanceCache && this._attendanceCacheDate === today) {
      return this._attendanceCache;
    }

    try {
      const token = localStorage.getItem('auth_token');
      if (!token) {
        console.warn('⚠️ Reminder: ไม่พบ auth_token');
        return null;
      }

      let uuid;
      try {
        const raw = localStorage.getItem('user_data');
        if (!raw) {
          console.warn('⚠️ Reminder: ไม่พบ user_data ใน localStorage');
          return null;
        }
        const userData = JSON.parse(raw);
        uuid = userData.uuid;
      } catch (parseErr) {
        console.error('❌ Reminder: parse user_data ไม่ได้:', parseErr);
        return null;
      }

      if (!uuid) {
        console.warn('⚠️ Reminder: ไม่พบ uuid ใน user_data');
        return null;
      }

      const url = `/api/attendance/today?uuid=${encodeURIComponent(uuid)}&date=${today}`;
      console.log(`🔄 Reminder fetching: ${url}`);

      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.warn(`⚠️ Reminder API ${res.status}: ${text}`);
        return null;
      }

      const json = await res.json();

      if (!json.success) {
        console.warn('⚠️ Reminder API error:', json.message);
        return null;
      }

      this._attendanceCache = json.data;
      this._attendanceCacheDate = today;

      console.log('✅ Reminder: ดึงข้อมูลสำเร็จ', {
        has_checkin:  json.data.has_checkin,
        has_checkout: json.data.has_checkout,
      });

      return json.data;

    } catch (err) {
      console.error('❌ Reminder fetch error:', err);
      return null;
    }
  }

  async _hasCheckedInToday() {
    const data = await this._fetchTodayAttendance();
    if (!data) return false;
    return data.has_checkin === true;
  }

  async _hasCheckedOutToday() {
    const data = await this._fetchTodayAttendance();
    if (!data) return false;
    return data.has_checkout === true;
  }

  // ============================================================
  // 🔔 ตรวจสอบ pending และส่ง notification
  // ============================================================
  async _checkPendingAndNotify() {
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) return;

      // ─── 1. คำขอรออนุมัติ (reviewer) ───
      let pendCount = 0;
      try {
        const res = await fetch('/api/attendance/request-manage?status=pending&limit=50', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const d = await res.json();
          if (d.success) pendCount = (d.data || []).length;
        }
      } catch (_) {}

      // ─── 2. รอรับรอง (supervisor) ───
      let supCount = 0;
      try {
        const res = await fetch('/api/attendance/supervisor-pending?status=pending&limit=50', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const text = await res.text();
          const d = JSON.parse(text);
          if (d.success) supCount = (d.data || []).length;
        }
      } catch (_) {}

      const total = pendCount + supCount;
      if (total === 0) {
        console.log('✅ Pending check: ไม่มีรายการรอดำเนินการ');
        return;
      }

      // ─── สร้างข้อความแจ้งเตือน ───
      const parts = [];
      if (pendCount > 0) parts.push(`${pendCount} รายการรออนุมัติ`);
      if (supCount  > 0) parts.push(`${supCount} รายการรอรับรอง`);

      const title = `📋 มีงานรอดำเนินการ ${total} รายการ`;
      const body  = parts.join(' · ');

      this.sendReminder('pending', title, body, 'reminder-pending');
      console.log(`✅ Pending reminder sent: pend=${pendCount} sup=${supCount}`);

    } catch (err) {
      console.error('❌ _checkPendingAndNotify error:', err);
    }
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
            minInterval: 15 * 60 * 1000
          });
          console.log('✅ Periodic Background Sync registered');
        } else {
          console.warn('⚠️ Periodic Background Sync not granted');
        }
      } else {
        console.warn('⚠️ Periodic Background Sync not supported');
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

// Auto-initialize
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