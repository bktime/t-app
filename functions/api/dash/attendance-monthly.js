// functions/api/dash/attendance-monthly.js
// GET /api/dash/attendance-monthly?year=YYYY&month=MM
// → รายงานสรุปการลงเวลาประจำเดือน (ตารางแนวนอน รายคน × รายวัน)

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

  /* ── พารามิเตอร์ year / month ── */
  const now   = new Date();
  const year  = parseInt(url.searchParams.get('year')  || now.getFullYear(),  10);
  const month = parseInt(url.searchParams.get('month') || now.getMonth() + 1, 10);

  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
    return Response.json(
      { success: false, message: 'year / month ไม่ถูกต้อง' },
      { status: 400, headers: CORS }
    );
  }

  /* ── วันแรก–วันสุดท้ายของเดือน ── */
  const dateFrom = `${year}-${String(month).padStart(2, '0')}-01`;
  const daysInMonth = new Date(year, month, 0).getDate();
  const dateTo   = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  /* ── Scope ── */
  const { scopeSQL, scopeParams, scopeMeta, canFilter } = buildScope(me, url);

  try {
    const [attRes, affiliations, departments] = await Promise.all([

      /* ดึงข้อมูลทุก attendance ของเดือนนี้ในขอบเขต scope */
      env.DB.prepare(`
        SELECT
          u.uuid,
          CONCAT(u.prefix, ' ', u.firstName, ' ', u.lastName) AS name,
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

      /* filter options */
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
    ]);

    /* ── สร้าง dayOfWeek map สำหรับแต่ละวันในเดือน ── */
    const dayInfo = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dt  = new Date(year, month - 1, d);
      const dow = dt.getDay(); // 0=อาทิตย์ … 6=เสาร์
      dayInfo.push({ day: d, dow, isWeekend: dow === 0 || dow === 6 });
    }

    /* ── รวม rows เป็น Map<uuid, {userInfo, days:{[date]:record}}> ── */
    const WORK_START = '08:30:00';
    const userMap = new Map();

    // สร้าง user ที่ไม่มีข้อมูลลงเวลาเลยก็ต้องปรากฏ
    const rows = attRes.results ?? [];
    rows.forEach(r => {
      if (!userMap.has(r.uuid)) {
        userMap.set(r.uuid, {
          uuid:          r.uuid,
          name:          r.name,
          position:      r.position,
          personnelType: r.personnelType,
          dep_code:      r.dep_code,
          aff_code:      r.aff_code,
          department:    r.department,
          affiliation:   r.affiliation,
          days: {},           // key = 'YYYY-MM-DD'
          summary: { ok: 0, late: 0, absent: 0, request: 0, weekend: 0 },
        });
      }
      if (!r.date) return; // LEFT JOIN อาจ return row ที่ date=null ถ้าไม่มีบันทึก

      const u = userMap.get(r.uuid);

      /* คำนวณสถานะต่อวัน */
      let status = 'absent';
      if (r.request_type)                         status = 'request';
      else if (r.checkin_time)                    status = r.checkin_time > WORK_START ? 'late' : 'ok';

      u.days[r.date] = {
        date:        r.date,
        checkin:     r.checkin_time  ? r.checkin_time.slice(0, 5)  : null,
        checkout:    r.checkout_time ? r.checkout_time.slice(0, 5) : null,
        work_type:   r.checkin_work_type || null,
        request:     r.request_type   || null,
        sup_status:  r.supervisor_status || null,
        status,        // ok | late | absent | request
      };
    });

    /* ── คำนวณสรุปต่อคน (นับเฉพาะวันทำการ) ── */
    userMap.forEach(u => {
      dayInfo.forEach(({ day, dow, isWeekend }) => {
        const dateKey = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        if (isWeekend) { u.summary.weekend++; return; }
        const rec = u.days[dateKey];
        if (!rec) { u.summary.absent++; return; }
        u.summary[rec.status] = (u.summary[rec.status] || 0) + 1;
      });
    });

    /* ── แปลงเป็น Array เรียงตามลำดับเดิม ── */
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
        year,
        month,
        daysInMonth,
        dateFrom,
        dateTo,
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
    console.error('[dash/attendance-monthly GET]', err);
    return Response.json(
      { success: false, message: 'Internal Server Error' },
      { status: 500, headers: CORS }
    );
  }
}
