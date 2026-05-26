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
  const { scopeSQL, scopeParams, scopeMeta, canFilter } = buildScope(me, url);

  try {
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

            -- Request
            a.request_ref,
            a.request_type,
            a.request_reason,
            a.request_at,

            -- Supervisor Review
            a.approver_uuid,
            a.supervisor_status,
            a.supervisor_note,
            a.reviewed_at,

            -- ✅ ดึงเฉพาะ firstName ของผู้รับรอง
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

        /* filter options — เพิ่ม AS u */
        env.DB.prepare(`
          SELECT DISTINCT aff_code, affiliation FROM users AS u     /* ← เพิ่ม AS u */
          WHERE u.aff_code IS NOT NULL AND u.status='Active' ${scopeSQL}
          ORDER BY u.affiliation ASC
        `).bind(...scopeParams).all(),

        env.DB.prepare(`
          SELECT DISTINCT dep_code, department, aff_code FROM users AS u     /* ← เพิ่ม AS u */
          WHERE u.dep_code IS NOT NULL AND u.status='Active' ${scopeSQL}
          ORDER BY u.department ASC
        `).bind(...scopeParams).all(),
      ]);


    const rows = attRes.results ?? [];

    const WORK_START = '08:30:00';
    let ok = 0, late = 0, absent = 0, request = 0, pending = 0;

    rows.forEach(r => {
      if (r.request_type)              { request++; }
      else if (!r.checkin_time)        { absent++; }
      else if (r.checkin_time > WORK_START) { late++; }
      else                             { ok++; }

      if (r.checkin_time || r.request_type) {
        if (!['approved', 'rejected'].includes(r.supervisor_status)) {
          pending++;
        }
      }
    });

    const summary = { total: rows.length, ok, late, absent, request, pending };

    return Response.json({
      success: true,
      data: {
        attendance:   rows,
        summary,
        affiliations: affiliations.results ?? [],
        departments:  departments.results  ?? [],
      },
      meta: {
        date:        dateParam,
        role:        me.role,
        role_level:  me.role_level, // ✅ ส่งระดับไปให้ Frontend เช็คสิทธิ์พิมพ์
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
