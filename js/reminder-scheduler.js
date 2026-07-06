// reminder-scheduler.js
class ReminderScheduler {
  constructor() {
    this.morningHour = 6;
    this.morningMinute = 10;
    this.afternoonHour = 16;
    this.afternoonMinute = 32;

    // ⏰ ช่วงเวลาแจ้งเตือนเข้างาน / ออกงาน (configurable)
    this.morningWindowStartOffset = -1;   // เริ่มก่อน 1 นาที = 06:09
    this.morningEndHour = 8;
    this.morningEndMinute = 29;           // สิ้นสุด 08:29

    this.afternoonWindowStartOffset = -1; // เริ่มก่อน 1 นาที = 16:31
    this.afternoonEndHour = 17;
    this.afternoonEndMinute = 50;         // สิ้นสุด 17:50

    // ⏰ ช่วงเวลาแจ้งเตือน pending (ทุก 30 นาที ในช่วงนี้)
    this.pendingStartHour = 9;   // เริ่ม 09:00
    this.pendingEndHour   = 12;  // จบ 12:00 (ไม่รวม 12:00)

    this.checkInterval = null;
    this._visibilityHandler = null;
    this._attendanceCache = null;
    this._attendanceCacheDate = null;
  }

  // ─── ใช้ local date (ไม่ใช่ UTC) ทุกที่ ───
  _getLocalDateStr(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  _getTodayKey(type) {
    return `reminded_${type}_${this._getLocalDateStr()}`;
  }

  _getPendingSlotKey() {
    const now = new Date();
    const date = this._getLocalDateStr(now);
    const h = now.getHours();
    const slot = now.getMinutes() < 30 ? '00' : '30';
    return `reminded_pending_slot_${date}_${String(h).padStart(2, '0')}:${slot}`;
  }

  _hasNotifiedThisSlot() {
    try {
      return localStorage.getItem(this._getPendingSlotKey()) === '1';
    } catch {
      return false;
    }
  }

  _markNotifiedThisSlot() {
    try {
      localStorage.setItem(this._getPendingSlotKey(), '1');
      this._cleanOldKeys();
    } catch {
      // ignore
    }
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

  // ─── FIX #1: แยกวันที่ออกจาก key แล้วเปรียบเทียบ date จริงๆ ───
  _cleanOldKeys() {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 3);
      const cutoffStr = this._getLocalDateStr(cutoff);

      Object.keys(localStorage)
        .filter(k => k.startsWith('reminded_'))
        .forEach(k => {
          // ดึง date string ออกจาก key
          // pattern: reminded_{type}_{YYYY-MM-DD} หรือ reminded_pending_slot_{YYYY-MM-DD}_{HH:MM}
          const match = k.match(/(\d{4}-\d{2}-\d{2})/);
          if (match && match[1] < cutoffStr) {
            localStorage.removeItem(k);
          }
        });
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
    // ป้องกัน double-interval
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    this.checkInterval = setInterval(() => {
      this.checkAndNotify();
    }, 30 * 1000);

    // FIX #5: เก็บ reference เพื่อลบได้ภายหลัง
    this._visibilityHandler = () => {
      if (!document.hidden) {
        this.checkAndNotify();
      }
    };
    document.addEventListener('visibilitychange', this._visibilityHandler);
  }

  async checkAndNotify() {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    // ─── เตือนลงเวลาเข้างาน ───
    const morningStart = this.morningHour * 60 + this.morningMinute + this.morningWindowStartOffset;
    const morningEnd   = this.morningEndHour * 60 + this.morningEndMinute;

    if (currentMinutes >= morningStart && currentMinutes <= morningEnd) {
      if (!this._hasNotifiedToday('morning')) {
        // FIX #3: แยกสามกรณี — ลงเวลาแล้ว / ยังไม่ลง / ไม่ทราบ (API error)
        const checkResult = await this._hasCheckedInToday();
        if (checkResult === true) {
          // ลงเวลาแล้ว — ไม่ต้องเตือน แต่ mark เพื่อไม่เช็คซ้ำ
          this._markNotifiedToday('morning');
        } else if (checkResult === false) {
          // ยังไม่ลงเวลา — เตือน
          await this.sendReminder('morning', 'เข้างาน', 'กรุณากดลงเวลาเข้างานวันนี้ครับ', 'reminder-morning');
          this._markNotifiedToday('morning');
        }
        // checkResult === null (API error) → ไม่ mark จะได้ลองใหม่รอบถัดไป
      }
    }

    // ─── เตือนลงเวลาออกงาน ───
    const afternoonStart = this.afternoonHour * 60 + this.afternoonMinute + this.afternoonWindowStartOffset;
    const afternoonEnd   = this.afternoonEndHour * 60 + this.afternoonEndMinute;

    if (currentMinutes >= afternoonStart && currentMinutes <= afternoonEnd) {
      if (!this._hasNotifiedToday('afternoon')) {
        const checkResult = await this._hasCheckedOutToday();
        if (checkResult === true) {
          this._markNotifiedToday('afternoon');
        } else if (checkResult === false) {
          await this.sendReminder('afternoon', 'ใกล้เลิกงาน', 'อย่าลืมลงเวลาออกงานก่อนกลับบ้านนะครับ', 'reminder-afternoon');
          this._markNotifiedToday('afternoon');
        }
        // null → ลองใหม่รอบถัดไป
      }
    }

    // ─── เตือน pending ทุก 30 นาที ในช่วง 09:00–12:00 ───
    const pendingStartMin = this.pendingStartHour * 60;
    const pendingEndMin   = this.pendingEndHour * 60;

    if (currentMinutes >= pendingStartMin && currentMinutes < pendingEndMin) {
      if (!this._hasNotifiedThisSlot()) {
        await this._checkPendingAndNotify();
        this._markNotifiedThisSlot();
      }
    }
  }

  // ============================================================
  // ✅ ดึงข้อมูลจาก API (1 ครั้ง + cache รายวัน)
  // ============================================================
  async _fetchTodayAttendance() {
    const today = this._getLocalDateStr(); // FIX #2: local date

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

  // FIX #3: คืน true / false / null (null = ไม่ทราบผล)
  async _hasCheckedInToday() {
    const data = await this._fetchTodayAttendance();
    if (!data) return null;
    return data.has_checkin === true;
  }

  async _hasCheckedOutToday() {
    const data = await this._fetchTodayAttendance();
    if (!data) return null;
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
      let pendOk = false;
      try {
        const res = await fetch('/api/attendance/request-manage?status=pending&limit=50', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const d = await res.json();
          if (d.success) {
            pendCount = (d.data || []).length;
            pendOk = true;
          }
        }
      } catch (_) {}

      // ─── 2. รอรับรอง (supervisor) ───
      let supCount = 0;
      let supOk = false;
      try {
        const res = await fetch('/api/attendance/supervisor-pending?status=pending&limit=50', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const text = await res.text();
          const d = JSON.parse(text);
          if (d.success) {
            supCount = (d.data || []).length;
            supOk = true;
          }
        }
      } catch (_) {}

      // FIX: ถ้า API ทั้งคู่ล้มเหลว ไม่ควร mark slot ว่าแจ้งแล้ว
      if (!pendOk && !supOk) {
        console.warn('⚠️ Pending check: API ทั้งสองล้มเหลว จะลองใหม่รอบถัดไป');
        // ยกเลิก mark ของ slot นี้เพื่อลองใหม่
        try {
          localStorage.removeItem(this._getPendingSlotKey());
        } catch {}
        return;
      }

      const total = pendCount + supCount;
      if (total === 0) {
        console.log('✅ Pending check: ไม่มีรายการรอดำเนินการ');
        return;
      }

      if (supCount > 0) {
        const supTitle = supCount === total
          ? `รอรับรอง ${supCount} รายการ`
          : `รอดำเนินการ ${total} รายการ`;
        const supBody = supCount === total
          ? 'กรุณาตรวจสอบและรับรองเวลาลงงาน'
          : `${supCount} รอรับรอง · ${pendCount} รออนุมัติ`;
        await this.sendReminder('pending-sup', supTitle, supBody, 'reminder-pending-sup');
      }

      if (pendCount > 0) {
        const reqTitle = `คำขอรออนุมัติ ${pendCount} รายการ`;
        const reqBody  = 'กรุณาตรวจสอบและอนุมัติคำขอ';
        await this.sendReminder('pending-req', reqTitle, reqBody, 'reminder-pending-req');
      }

      console.log(`✅ Pending reminder sent: pend=${pendCount} sup=${supCount}`);

    } catch (err) {
      console.error('❌ _checkPendingAndNotify error:', err);
      // ยกเลิก mark slot เพื่อลองใหม่
      try {
        localStorage.removeItem(this._getPendingSlotKey());
      } catch {}
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
          badge: '/icons/badge-72.png',
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
      // FIX #6: เพิ่ม timeout ป้องกันค้างถ้าไม่มี SW
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('SW ready timeout')), 5000)
        )
      ]);

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
      console.warn('⚠️ Periodic Sync registration failed:', err.message);
    }
  }

  destroy() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    // FIX #5: ลบ visibility listener
    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityHandler = null;
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