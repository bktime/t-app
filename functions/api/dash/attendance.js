// functions/api/dash/attendance.js
// GET /api/dash/attendance?date=YYYY-MM-DD  → daily attendance sheet

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

  /* ── วันที่ ── default = วันนี้ */
  const dateParam = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return Response.json(
      { success: false, message: 'รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)' },
      { status: 400, headers: CORS }
    );
  }

  /* ── Scope ── */
  const { scopeSQL, scopeParams, scopeMeta, canFilter } = buildScope(me, url, 'u');

  try {
      /* ✅ 1. ตรวจสอบวันหยุด (Holidays + เสาร์-อาทิตย์) */
      const isHolidayRow = await env.DB.prepare(`
        SELECT name, type FROM holidays 
        WHERE date = ? OR (is_recurring = 1 AND substr(date, 6) = substr(?, 6))
      `).bind(dateParam, dateParam).first();

      const dayOfWeek = new Date(dateParam + 'T00:00:00').getDay();
      const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6); // 0=อาทิตย์, 6=เสาร์
      const isDayOff = isWeekend || !!isHolidayRow;
      const holidayName = isHolidayRow?.name || (isWeekend ? 'วันหยุดรายสัปดาห์' : null);

      /* ✅ 2. ดึงข้อมูลการลาทับวันปัจจุบัน */
      const leavesRes = await env.DB.prepare(`
        SELECT user_uuid, leave_type, status 
        FROM leave_records 
        WHERE ? BETWEEN start_date AND end_date 
          AND status IN ('approved', 'pending')
      `).bind(dateParam).all();

      const leaveMap = {};
      (leavesRes.results || []).forEach(l => {
        // ถ้ามีหลายใบลา ให้เอาใบที่ approved มาก่อน
        if (!leaveMap[l.user_uuid] || l.status === 'approved') {
          leaveMap[l.user_uuid] = l;
        }
      });

      /* ── 3. ดึงข้อมูลหลัก ── */
      const [attRes, affiliations, departments] = await Promise.all([

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
            u.approver_code,

            a.id            AS att_id,
            a.date,

            -- Checkin
            a.checkin_time,
            a.checkin_work_type,
            a.checkin_note,
            a.checkin_latitude,
            a.checkin_longitude,
            a.checkin_distance_m,
            a.checkin_in_range,
            a.checkin_reference,
            a.checkin_iso,
            a.checkin_at,

            -- Checkout
            a.checkout_time,
            a.checkout_type,
            a.checkout_work_type,
            a.checkout_note,
            a.checkout_latitude,
            a.checkout_longitude,
            a.checkout_distance_m,
            a.checkout_in_range,
            a.checkout_iso,
            a.checkout_at,

            -- Request (บนตาราง attendance เช่น ลืมลงเวลา/ขอแก้ไข)
            a.request_ref,
            a.request_type,
            a.request_reason,
            a.request_at,

            -- Supervisor Review
            a.approver_uuid,
            a.supervisor_status,
            a.supervisor_note,
            a.reviewed_at,

            -- ผู้รับรอง
            uApv.firstName AS approver_first_name

          FROM users u
          LEFT JOIN attendance a
            ON a.uuid = u.uuid
           AND a.date = ?
          
          LEFT JOIN users uApv
            ON uApv.uuid = a.approver_uuid

          WHERE u.status = 'Active'
            ${scopeSQL}

          ORDER BY u.department ASC, u.firstName ASC, u.lastName ASC
        `).bind(dateParam, ...scopeParams).all(),

        env.DB.prepare(`
          SELECT DISTINCT u.aff_code, u.affiliation FROM users AS u
          WHERE u.aff_code IS NOT NULL AND u.status = 'Active' ${scopeSQL}
          ORDER BY u.affiliation ASC
        `).bind(...scopeParams).all(),

        env.DB.prepare(`
          SELECT DISTINCT u.dep_code, u.department, u.aff_code FROM users AS u
          WHERE u.dep_code IS NOT NULL AND u.status = 'Active' ${scopeSQL}
          ORDER BY u.department ASC
        `).bind(...scopeParams).all(),
      ]);

    const rows = attRes.results ?? [];

    const WORK_START = '08:31:00';
    let ok = 0, late = 0, absent = 0, request = 0, pending = 0, holiday = 0, leave = 0;

    /* ✅ 4. ประมวลผล final_status และนับสถิติ */
    /* ✅ 4. ประมวลผล final_status และนับสถิติ */
    rows.forEach(r => {
      const supervisorResolved = ['approved', 'rejected'].includes(r.supervisor_status);
      const userLeave = leaveMap[r.uuid];

      // ใส่ข้อมูลการลาเข้าไปใน row
      r.leave_type = userLeave?.leave_type || null;
      r.leave_status = userLeave?.status || null;
      r.holiday_name = holidayName;

      // ถ้าเป็นวันหยุดราชการ / เสาร์-อาทิตย์
      if (isDayOff) {
        r.final_status = 'วันหยุด';
        holiday++;
      } 
      else {
        // วันทำการ
        
        // ✅ 1. ถ้ามีคำขอ (request_type) และหัวหน้ายังไม่ได้พิจารณา (pending) → ถือว่าเป็น "คำขอ" ลำดับแรก
        if (r.request_type && !supervisorResolved) {
          r.final_status = 'คำขอ';
          request++;
        } 
        // ✅ 2. ถ้ามีใบลาที่อนุมัติแล้ว
        else if (userLeave && userLeave.status === 'approved') {
          r.final_status = 'ลา';
          leave++;
        } 
        // ✅ 3. ถ้าลงเวลามาแล้ว
        else if (r.checkin_time) {
          if (r.request_type && supervisorResolved) {
             r.final_status = 'ปกติ'; // คำขอแก้ไขถูกอนุมัติแล้ว ให้ถือว่ามาปกติ
             ok++;
          } 
          else if (r.checkin_time > WORK_START) {
             r.final_status = 'มาสาย';
             late++;
          } 
          else {
             r.final_status = 'ปกติ';
             ok++;
          }
        } 
        // ✅ 4. ถ้ามีใบลาที่รออนุมัติ (แต่ไม่มีเวลามา และไม่มีคำขอบนตาราง attendance)
        else if (userLeave && userLeave.status === 'pending') {
          r.final_status = 'ลา(รออนุมัติ)';
          request++; 
        } 
        // ✅ 5. นอกจากนี้ถือว่าขาด
        else {
          r.final_status = 'ขาด';
          absent++;
        }
      }

      // นับรอพิจารณา (เฉพาะวันทำการ และมีเวลามา/มีคำขอ แต่หัวหน้ายังไม่อนุมัติ)
      if ((r.checkin_time || r.request_type) && !supervisorResolved && r.final_status !== 'วันหยุด') {
        pending++;
      }
    });

    const summary = { total: rows.length, ok, late, absent, request, pending, holiday, leave };

    return Response.json({
      success: true,
      data: {
        attendance:   rows,
        summary,
        affiliations: affiliations.results ?? [],
        departments:  departments.results  ?? [],
        is_day_off:   isDayOff, // ✅ ส่งบอก Frontend ว่าวันนี้เป็นวันหยุด
      },
      meta: {
        date:        dateParam,
        role:        me.role,
        role_level:  me.role_level,
        access_scope: me.access_scope,
        can_edit:    !!me.can_edit,
        aff_code:    me.aff_code,
        dep_code:    me.dep_code,
        affiliation: me.affiliation,
        department:  me.department,
        canFilter,
        ...scopeMeta,
      },
    }, { headers: CORS });

  } catch (err) {
    console.error('[dash/attendance GET]', err);
    return Response.json(
      { success: false, message: 'Internal Server Error' },
      { status: 500, headers: CORS }
    );
  }
}
