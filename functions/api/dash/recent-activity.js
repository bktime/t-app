// functions/api/dash/recent-activity.js
// GET /api/dash/recent-activity?from=YYYY-MM-DD&to=YYYY-MM-DD[&aff=xxx][&dep=xxx][&limit=20]

import { authUser, extractToken, unauthorized } from '../_auth.js';
import { buildScope, getMe, scopedUUIDsSQL } from './_scope.js';

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

  const me = await getMe(env, session.uuid);
  if (!me) return unauthorized(CORS);

  const url   = new URL(request.url);
  const today = new Date().toISOString().slice(0, 10);
  const from  = url.searchParams.get('from')  || today;
  const to    = url.searchParams.get('to')    || today;
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);

  const { scopeSQL, scopeParams, scopeMeta, canFilter } = buildScope(me, url);
  const inUUIDs = scopedUUIDsSQL(scopeSQL);

  try {
    const [recentCheckins, recentRequests, recentOt] = await Promise.all([

      // เช็คอินล่าสุด
      env.DB.prepare(`
        SELECT
          a.date,
          a.checkin_time,
          a.checkin_work_type,
          a.checkin_in_range,
          a.checkin_distance_m,
          a.checkin_at,
          u.firstName || ' ' || u.lastName AS name,
          u.department,
          u.position
        FROM attendance a
        JOIN users u ON u.uuid = a.uuid
        WHERE a.date BETWEEN ? AND ?
          AND a.checkin_time IS NOT NULL AND a.supervisor_status <> 'cancelled'
          AND a.uuid IN (${inUUIDs})
        ORDER BY a.checkin_at DESC
        LIMIT ?
      `).bind(from, to, ...scopeParams, limit).all(),

      // คำขอแก้ไขเวลา
      env.DB.prepare(`
        SELECT
          a.date,
          a.request_ref,
          a.request_type,
          a.request_reason,
          a.request_at,
          a.supervisor_status,
          a.supervisor_note,
          a.reviewed_at,
          u.firstName || ' ' || u.lastName   AS name,
          u.department,
          u.position,
          sv.firstName || ' ' || sv.lastName AS supervisor_name
        FROM attendance a
        JOIN users u  ON u.uuid  = a.uuid
        LEFT JOIN users sv ON sv.uuid = a.approver_uuid
        WHERE a.date BETWEEN ? AND ?
          AND a.request_ref IS NOT NULL AND a.supervisor_status <> 'cancelled'
          AND a.uuid IN (${inUUIDs})
        ORDER BY a.request_at DESC
        LIMIT ?
      `).bind(from, to, ...scopeParams, limit).all(),

      // คำขอ OT ล่าสุด
      env.DB.prepare(`
        SELECT
          o.reference,
          o.ot_date,
          o.ot_start,
          o.ot_end,
          o.ot_hours,
          o.work_type,
          o.supervisor_status,
          o.supervisor_note,
          o.reviewed_at,
          o.submitted_at,
          COALESCE(o.name, u.firstName || ' ' || u.lastName) AS name,
          COALESCE(o.department, u.department)               AS department
        FROM attendance_overtime o
        LEFT JOIN users u ON u.uuid = o.uuid
        WHERE o.ot_date BETWEEN ? AND ? AND o.supervisor_status <> 'cancelled'
          AND o.uuid IN (${inUUIDs})
        ORDER BY o.submitted_at DESC
        LIMIT ?
      `).bind(from, to, ...scopeParams, limit).all(),
    ]);

    return Response.json({
      success: true,
      data: {
        recentCheckins:  recentCheckins.results  ?? [],
        recentRequests:  recentRequests.results  ?? [],
        recentOt:        recentOt.results        ?? [],
      },
      meta: { from, to, limit, role: me.role, canFilter, ...scopeMeta },
    }, { headers: CORS });

  } catch (err) {
    console.error('[dash/recent-activity]', err);
    return Response.json({ success: false, message: 'Internal Server Error' }, { status: 500, headers: CORS });
  }
}
