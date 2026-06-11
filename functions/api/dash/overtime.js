// functions/api/dash/overtime.js
// GET /api/dash/overtime?month=YYYY-MM  → รายการ OT รายเดือน

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

  /* ── เดือน ── default = เดือนนี้ */
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
  const lastDay = new Date(year, mon, 0).getDate();
  const dateEnd = `${year}-${String(mon).padStart(2, '0')}-${lastDay}`;

  /* ── Scope ── */
  // buildScope ใช้ column u.aff_code / u.dep_code แต่ OT เก็บ aff_code / dep_code ใน attendance_overtime
  // ดึง scope แล้วแปลงให้ match column ของ attendance_overtime
  const { scopeSQL: rawScopeSQL, scopeParams, scopeMeta, canFilter } = buildScope(me, url, 'u_ot');

  // map alias u_ot สำหรับ join users
  // เราจะ join users เพื่อ filter scope แล้วดึงข้อมูล dep_code / aff_code จาก users
  const scopeSQL = rawScopeSQL; // already uses u_ot alias

  try {
    /* ── ดึงรายการ OT ── */
    const [otRes, affiliations, departments] = await Promise.all([

      env.DB.prepare(`
        SELECT
          ot.id,
          ot.uuid,
          ot.reference,
          ot.ot_date,
          ot.ot_start,
          ot.ot_end,
          ot.ot_hours,
          ot.ot_days,
          ot.work_type,
          ot.note,
          ot.latitude,
          ot.longitude,
          ot.distance_m,
          ot.is_in_range,
          ot.name,
          ot.department,
          ot.ot_rate_per_hour,
          ot.ot_rate_per_day,
          ot.ot_max_hours,
          ot.amount_hour,
          ot.amount_day,
          ot.approver_code,
          ot.supervisor_name,
          ot.supervisor_status,
          ot.supervisor_note,
          ot.reviewed_at,
          ot.submitted_at,
          ot.updated_at,
          ot.finance_code,
          ot.finance_name,
          ot.finance_at,
          ot.finance_note,
          ot.finance_status,

          u_ot.aff_code,
          u_ot.dep_code,
          u_ot.affiliation

        FROM attendance_overtime ot
        INNER JOIN users u_ot ON u_ot.uuid = ot.uuid

        WHERE ot.ot_date BETWEEN ? AND ?
          AND u_ot.status = 'Active'
          AND ot.supervisor_status in ('approved', 'pending')
          ${scopeSQL}

        ORDER BY ot.ot_date ASC, ot.ot_start ASC, ot.submitted_at ASC
      `).bind(dateStart, dateEnd, ...scopeParams).all(),

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

    const records = otRes.results ?? [];

    return Response.json({
      success: true,
      data: {
        records,
        affiliations: affiliations.results ?? [],
        departments:  departments.results  ?? [],
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
    console.error('[dash/overtime GET]', err);
    return Response.json(
      { success: false, message: 'Internal Server Error' },
      { status: 500, headers: CORS }
    );
  }
}