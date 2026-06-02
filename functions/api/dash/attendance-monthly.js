// functions/api/dash/attendance-monthly.js
// GET /api/dash/attendance-monthly?year=YYYY&month=MM

import { authUser, extractToken, unauthorized } from '../_auth.js';
import { buildScope } from './_scope.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    },
  });
}

export async function onRequestGet({ request, env }) {
  const token = extractToken(request);
  const session = await authUser(env, token);
  if (!session) return unauthorized(CORS);

  const me = session;
  const url = new URL(request.url);

  const now   = new Date();
  const year  = parseInt(url.searchParams.get('year')  || now.getFullYear(),  10);
  const month = parseInt(url.searchParams.get('month') || now.getMonth() + 1, 10);

  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
    return Response.json(
      { success: false, message: 'year / month ไม่ถูกต้อง' },
      { status: 400, headers: CORS }
    );
  }

  const dateFrom = `${year}-${String(month).padStart(2, '0')}-01`;
  const daysInMonth = new Date(year, month, 0).getDate();
  const dateTo   = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  const { scopeSQL, scopeParams, scopeMeta, canFilter } = buildScope(me, url);

  try {
    const [attRes, affiliations, departments, holidaysRes, leavesRes] = await Promise.all([

      env.DB.prepare(`
        SELECT
          u.uuid,
          (u.prefix || ' ' || u.firstName || ' ' || u.lastName) AS name,
          u.position,
          u.personnelType,
          u.dep_code,
          u.aff_code,
          u.department,
          u.affiliation,
          a.date,
          a.checkin_time,
          a.checkin_work_type,
          a.checkout_time,
          a.checkout_type,
          a.request_type,
          a.request_reason,
          a.supervisor_status
        FROM users u
        LEFT JOIN attendance a
          ON  a.uuid = u.uuid
          AND a.date >= ?
          AND a.date <= ?
        WHERE u.status = 'Active'
          ${scopeSQL}
        ORDER BY u.affiliation ASC, u.department ASC, u.firstName ASC, u.lastName ASC, a.date ASC
      `).bind(dateFrom, dateTo, ...scopeParams).all(),

      env.DB.prepare(`
        SELECT DISTINCT aff_code, affiliation FROM users
        WHERE aff_code IS NOT NULL AND status='Active' ${scopeSQL}
        ORDER BY affiliation ASC
      `).bind(...scopeParams).all(),

      env.DB.prepare(`
        SELECT DISTINCT dep_code, department, aff_code FROM users
        WHERE dep_code IS NOT NULL AND status='Active' ${scopeSQL}
        ORDER BY department ASC
      `).bind(...scopeParams).all(),

      /* ✅ ดึงวันหยุดประจำเดือน */
      env.DB.prepare(`
        SELECT date, name, type FROM holidays
        WHERE (date >= ? AND date <= ?)
           OR (is_recurring = 1 AND substr(date, 6) >= substr(?, 6) AND substr(date, 6) <= substr(?, 6))
      `).bind(dateFrom, dateTo, dateFrom, dateTo).all(),

      /* ✅ ดึงข้อมูลการลาที่คาบเกี่ยวกับเดือนนี้ */
      env.DB.prepare(`
        SELECT user_uuid, leave_type, status, start_date, end_date
        FROM leave_records
        WHERE end_date >= ? AND start_date <= ?
          AND status IN ('approved', 'pending')
      `).bind(dateFrom, dateTo).all(),
    ]);

    /* ── สร้าง Map ของวันหยุด ── */
    const holidayMap = {};
    (holidaysRes.results || []).forEach(h => {
      holidayMap[h.date] = h.name;
    });

    /* ── สร้าง Map ของการลาต่อ user ── */
    const userLeavesMap = {};
    (leavesRes.results || []).forEach(l => {
      if (!userLeavesMap[l.user_uuid]) userLeavesMap[l.user_uuid] = [];
      userLeavesMap[l.user_uuid].push(l);
    });

    /* ── ข้อมูลวันในเดือน ── */
    const dayInfo = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateKey = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const dt  = new Date(year, month - 1, d);
      const dow = dt.getDay(); 
      const isWeekend = dow === 0 || dow === 6;
      const isHoliday = !!holidayMap[dateKey];
      const isDayOff = isWeekend || isHoliday;
      
      dayInfo.push({ 
        day: d, 
        dow, 
        isWeekend, 
        isHoliday, 
        isDayOff, 
        holidayName: holidayMap[dateKey] || (isWeekend ? 'วันหยุดรายสัปดาห์' : null) 
      });
    }

    /* ── รวม rows เป็น Map ── */
    const WORK_START = '08:30:00';
    const userMap = new Map();
    const rows = attRes.results ?? [];

    rows.forEach(r => {
      if (!userMap.has(r.uuid)) {
        userMap.set(r.uuid, {
          uuid: r.uuid, name: r.name, position: r.position, personnelType: r.personnelType,
          dep_code: r.dep_code, aff_code: r.aff_code, department: r.department, affiliation: r.affiliation,
          days: {},
          summary: { ok: 0, late: 0, absent: 0, leave: 0, request: 0, weekend: 0 },
        });
      }
      if (!r.date) return;
      
      const u = userMap.get(r.uuid);
      const supervisorResolved = ['approved', 'rejected'].includes(r.supervisor_status);
      
      // สถานะเริ่มต้นจากการลงเวลา
      let status = 'absent'; 
      if (r.request_type && supervisorResolved) status = 'ok';
      else if (r.request_type) status = 'request';
      else if (r.checkin_time) status = r.checkin_time > WORK_START ? 'late' : 'ok';

      u.days[r.date] = {
        date: r.date,
        checkin: r.checkin_time ? r.checkin_time.slice(0, 5) : null,
        checkout: r.checkout_time ? r.checkout_time.slice(0, 5) : null,
        work_type: r.checkin_work_type || null,
        request: r.request_type || null,
        sup_status: r.supervisor_status || null,
        status, 
      };
    });

    /* ── คำนวณสถานะสุดท้ายและสรุปยอดต่อคน ── */
    userMap.forEach(u => {
      const userLeaves = userLeavesMap[u.uuid] || [];

      dayInfo.forEach(({ day, isDayOff, holidayName }) => {
        const dateKey = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        
        // ถ้าเป็นวันหยุดราชการ/เสาร์-อาทิตย์
        if (isDayOff) {
          u.days[dateKey] = { status: 'วันหยุด', holidayName };
          u.summary.weekend++;
          return; 
        }

        // ตรวจสอบว่ามีใบลาไหม (เช็คว่า dateKey อยู่ระหว่าง start_date และ end_date)
        let approvedLeave = null;
        let pendingLeave = null;
        for (const l of userLeaves) {
          if (dateKey >= l.start_date && dateKey <= l.end_date) {
            if (l.status === 'approved') approvedLeave = l;
            if (l.status === 'pending') pendingLeave = l;
          }
        }

        const rec = u.days[dateKey];

        // ลำดับความสำคัญของสถานะ (เหมือนหน้ารายวัน)
        if (approvedLeave) {
          u.days[dateKey] = { ...(rec || {}), status: 'ลา', leave_type: approvedLeave.leave_type };
          u.summary.leave++;
        } 
        else if (pendingLeave) {
          u.days[dateKey] = { ...(rec || {}), status: 'ลา(รออนุมัติ)', leave_type: pendingLeave.leave_type };
          u.summary.request++; // นับรวมคำขอ
        }
        else if (rec) {
          // มีข้อมูลลงเวลา/คำขอลงเวลาจากตาราง attendance
          if (rec.status === 'absent') {
            rec.status = 'ขาด';
            u.summary.absent++;
          } else if (rec.status === 'late') {
            u.summary.late++;
          } else if (rec.status === 'ok') {
            u.summary.ok++;
          } else if (rec.status === 'request') {
            u.summary.request++;
          }
        } 
        else {
          // วันทำการแต่ไม่มีข้อมูลอะไรเลย = ขาด
          u.days[dateKey] = { status: 'ขาด' };
          u.summary.absent++;
        }
      });
    });

    const users = Array.from(userMap.values());

    return Response.json({
      success: true,
      data: {
        users,
        dayInfo,
        affiliations: affiliations.results ?? [],
        departments:  departments.results  ?? [],
      },
      meta: {
        year, month, daysInMonth, dateFrom, dateTo,
        role: me.role, role_level: me.role_level, access_scope: me.access_scope,
        can_edit: !!me.can_edit, aff_code: me.aff_code, dep_code: me.dep_code,
        affiliation: me.affiliation, department: me.department, canFilter, ...scopeMeta,
      },
    }, { headers: CORS });

  } catch (err) {
    console.error('[dash/attendance-monthly GET]', err);
    return Response.json(
      { success: false, message: 'Internal Server Error' },
      { status: 500, headers: CORS }
    );
  }
}