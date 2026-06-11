// functions/api/dash/overtime-summary.js
// GET /api/dash/overtime-summary?month=YYYY-MM
// → สรุปรายบุคคล + grid รายวัน สำหรับตารางหลักฐานการจ่ายเงินค่าตอบแทน OT

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

  /* ── เดือน ── */
  const monthParam = url.searchParams.get('month') ||
    new Date().toISOString().slice(0, 7);

  if (!/^\d{4}-\d{2}$/.test(monthParam)) {
    return Response.json(
      { success: false, message: 'รูปแบบเดือนไม่ถูกต้อง (YYYY-MM)' },
      { status: 400, headers: CORS }
    );
  }

  const [year, mon] = monthParam.split('-').map(Number);
  const dateStart = `${year}-${String(mon).padStart(2, '0')}-01`;
  const lastDay   = new Date(year, mon, 0).getDate();
  const dateEnd   = `${year}-${String(mon).padStart(2, '0')}-${lastDay}`;

  /* ── Scope ── */
  const { scopeSQL, scopeParams, scopeMeta, canFilter } = buildScope(me, url, 'u_ot');

  /* ── filter เพิ่มเติม (aff / dep) ── */
  const affFilter = url.searchParams.get('aff') || '';
  const depFilter = url.searchParams.get('dep') || '';

  let extraSQL = '';
  const extraParams = [];
  if (affFilter) { extraSQL += ' AND u_ot.aff_code = ?'; extraParams.push(affFilter); }
  if (depFilter) { extraSQL += ' AND u_ot.dep_code = ?';  extraParams.push(depFilter); }

  try {
    /* ── ดึง OT ที่ approved + finance_status = verified เท่านั้น ── */
    const otRes = await env.DB.prepare(`
      SELECT
        ot.uuid,
        ot.ot_date,
        ot.ot_start,
        ot.ot_end,
        ot.ot_hours,
        ot.ot_days,
        ot.work_type,
        ot.note,
        ot.amount_hour,
        ot.amount_day,
        ot.supervisor_status,
        ot.finance_status,
        ot.name,
        ot.department,
        ot.ot_rate_per_hour,
        ot.ot_rate_per_day,
        u_ot.aff_code,
        u_ot.dep_code,
        u_ot.affiliation,
        u_ot.position 
      FROM attendance_overtime ot
      INNER JOIN users u_ot ON u_ot.uuid = ot.uuid
      WHERE ot.ot_date BETWEEN ? AND ?
        AND u_ot.status = 'Active'
        AND ot.supervisor_status IN ('approved', 'pending')
        ${scopeSQL}
        ${extraSQL}
      ORDER BY u_ot.aff_code ASC, ot.name ASC, ot.ot_date ASC, ot.ot_start ASC
    `).bind(dateStart, dateEnd, ...scopeParams, ...extraParams).all();

    const [affiliationsRes, departmentsRes] = await Promise.all([
      env.DB.prepare(`
        SELECT DISTINCT u_ot.aff_code, u_ot.affiliation
        FROM users AS u_ot
        WHERE u_ot.aff_code IS NOT NULL AND u_ot.status = 'Active'
          ${scopeSQL}
        ORDER BY u_ot.affiliation ASC
      `).bind(...scopeParams).all(),

      env.DB.prepare(`
        SELECT DISTINCT u_ot.dep_code, u_ot.department, u_ot.aff_code
        FROM users AS u_ot
        WHERE u_ot.dep_code IS NOT NULL AND u_ot.status = 'Active'
          ${scopeSQL}
        ORDER BY u_ot.department ASC
      `).bind(...scopeParams).all(),
    ]);

    const rows = otRes.results ?? [];

    /* ── สร้าง grid รายบุคคล ── */
    // key = uuid → { person info, days: { "DD": [{ start, end, hours, work_type }] } }
    const personMap = new Map();

    for (const r of rows) {
      if (!personMap.has(r.uuid)) {
        personMap.set(r.uuid, {
          uuid:        r.uuid,
          name:        r.name        || '—',
          department:  r.department  || '—',
          position:    r.position    || '—',
          aff_code:    r.aff_code,
          dep_code:    r.dep_code,
          affiliation: r.affiliation || '—',
          days: {},             // key = day number (1-31) → array of entries
          totalHoursNormal:  0, // วันปกติ
          totalHoursHoliday: 0, // วันหยุด
          totalAmountHour:   0,
          totalAmountDay:    0,
        });
      }

      const p   = personMap.get(r.uuid);
      const day = Number(r.ot_date.split('-')[2]); // วันที่ 1-31
      if (!p.days[day]) p.days[day] = [];

      const isHoliday = (r.work_type || '').includes('วันหยุด');

      p.days[day].push({
        start:      r.ot_start    || '',
        end:        r.ot_end      || '',
        hours:      Number(r.ot_hours   || 0),
        days_ot:    Number(r.ot_days    || 0),
        work_type:  r.work_type   || '',
        is_holiday: isHoliday,
        fin_status: r.finance_status || 'pending',
        sup_status: r.supervisor_status || 'pending',
        amount_hour: Number(r.amount_hour || 0),
        amount_day:  Number(r.amount_day  || 0),
        note:        r.note || '',
      });

      // สะสมชั่วโมงแยกวันปกติ/วันหยุด
      if (isHoliday) {
        p.totalHoursHoliday += Number(r.ot_hours || 0);
      } else {
        p.totalHoursNormal  += Number(r.ot_hours || 0);
      }
      p.totalAmountHour += Number(r.amount_hour || 0);
      p.totalAmountDay  += Number(r.amount_day  || 0);
    }

    /* ── แปลง Map → Array เรียงตามชื่อ ── */
    const persons = Array.from(personMap.values())
      .sort((a, b) => a.name.localeCompare(b.name, 'th'));

    /* ── สรุปรวม ── */
    const summary = persons.reduce((acc, p) => {
      acc.totalHoursNormal  += p.totalHoursNormal;
      acc.totalHoursHoliday += p.totalHoursHoliday;
      acc.totalAmountHour   += p.totalAmountHour;
      acc.totalAmountDay    += p.totalAmountDay;
      return acc;
    }, { totalHoursNormal: 0, totalHoursHoliday: 0, totalAmountHour: 0, totalAmountDay: 0 });

    return Response.json({
      success: true,
      data: {
        persons,
        affiliations: affiliationsRes.results ?? [],
        departments:  departmentsRes.results  ?? [],
        summary,
        lastDay,
        dateStart,
        dateEnd,
      },
      meta: {
        month:        monthParam,
        role:         me.role,
        role_level:   me.role_level,
        access_scope: me.access_scope,
        can_edit:     !!me.can_edit,
        aff_code:     me.aff_code,
        dep_code:     me.dep_code,
        affiliation:  me.affiliation,
        department:   me.department,
        canFilter,
        ...scopeMeta,
      },
    }, { headers: CORS });

  } catch (err) {
    console.error('[dash/overtime-summary GET]', err);
    return Response.json(
      { success: false, message: 'Internal Server Error' },
      { status: 500, headers: CORS }
    );
  }
}
