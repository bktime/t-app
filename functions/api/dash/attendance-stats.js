// functions/api/dash/attendance-stats.js
// GET /api/dash/attendance-stats?from=YYYY-MM-DD&to=YYYY-MM-DD[&aff=xxx][&dep=xxx]

import { authUser, extractToken, unauthorized } from '../_auth.js';
import { buildScope, scopedUUIDsSQL } from './_scope.js';

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

  const url   = new URL(request.url);
  const today = new Date().toISOString().slice(0, 10);
  const from  = url.searchParams.get('from') || today;
  const to    = url.searchParams.get('to')   || today;

  const { scopeSQL, scopeParams, scopeMeta, canFilter } = buildScope(me, url);
  const inUUIDs = scopedUUIDsSQL(scopeSQL);

  try {
    const [workTypes, supervisorStatus, dailyCounts, inRangeStats, checkoutTypes] = await Promise.all([

      // ประเภทงาน
      env.DB.prepare(`
        SELECT
          COALESCE(a.checkin_work_type, 'ไม่ระบุ') AS type,
          COUNT(*) AS count
        FROM attendance a
        WHERE a.date BETWEEN ? AND ?
          AND a.checkin_time IS NOT NULL AND a.supervisor_status <> 'cancelled'
          AND a.uuid IN (${inUUIDs})
        GROUP BY a.checkin_work_type
        ORDER BY count DESC
      `).bind(from, to, ...scopeParams).all(),

      // สถานะ supervisor
      env.DB.prepare(`
        SELECT
          COALESCE(a.supervisor_status, 'none') AS status,
          COUNT(*) AS count
        FROM attendance a
        WHERE a.date BETWEEN ? AND ? AND a.supervisor_status <> 'cancelled'
          AND a.uuid IN (${inUUIDs})
        GROUP BY a.supervisor_status
        ORDER BY count DESC
      `).bind(from, to, ...scopeParams).all(),

      // รายวัน
      env.DB.prepare(`
        SELECT
          a.date,
          COUNT(*)                                                           AS total,
          SUM(CASE WHEN a.checkin_time IS NOT NULL THEN 1 ELSE 0 END)       AS checkins,
          SUM(CASE WHEN a.checkin_time > '08:30:00' THEN 1 ELSE 0 END)      AS late,
          SUM(CASE WHEN a.checkout_type = 'manual' THEN 1 ELSE 0 END)       AS manual_checkout,
          SUM(CASE WHEN a.checkin_in_range = 1 THEN 1 ELSE 0 END)           AS in_range
        FROM attendance a
        WHERE a.date BETWEEN ? AND ? AND a.supervisor_status <> 'cancelled'
          AND a.uuid IN (${inUUIDs})
        GROUP BY a.date
        ORDER BY a.date ASC
      `).bind(from, to, ...scopeParams).all(),

      // ในพื้นที่ vs นอก
      env.DB.prepare(`
        SELECT
          SUM(CASE WHEN a.checkin_in_range = 1    THEN 1 ELSE 0 END) AS in_range,
          SUM(CASE WHEN a.checkin_in_range = 0    THEN 1 ELSE 0 END) AS out_range,
          SUM(CASE WHEN a.checkin_in_range IS NULL THEN 1 ELSE 0 END) AS unknown
        FROM attendance a
        WHERE a.date BETWEEN ? AND ?
          AND a.checkin_time IS NOT NULL AND a.supervisor_status <> 'cancelled'
          AND a.uuid IN (${inUUIDs})
      `).bind(from, to, ...scopeParams).first(),

      // ประเภท checkout
      env.DB.prepare(`
        SELECT
          COALESCE(a.checkout_type, 'auto') AS type,
          COUNT(*) AS count
        FROM attendance a
        WHERE a.date BETWEEN ? AND ? AND a.supervisor_status <> 'cancelled'
          AND a.checkout_time IS NOT NULL
          AND a.uuid IN (${inUUIDs})
        GROUP BY a.checkout_type
      `).bind(from, to, ...scopeParams).all(),
    ]);

    return Response.json({
      success: true,
      data: {
        workTypes:        workTypes.results        ?? [],
        supervisorStatus: supervisorStatus.results ?? [],
        dailyCounts:      dailyCounts.results      ?? [],
        inRangeStats: {
          inRange:  Number(inRangeStats?.in_range  ?? 0),
          outRange: Number(inRangeStats?.out_range ?? 0),
          unknown:  Number(inRangeStats?.unknown   ?? 0),
        },
        checkoutTypes: checkoutTypes.results ?? [],
      },
      meta: { from, to, role: me.role, canFilter, ...scopeMeta },
    }, { headers: CORS });

  } catch (err) {
    console.error('[dash/attendance-stats]', err);
    return Response.json({ success: false, message: 'Internal Server Error' }, { status: 500, headers: CORS });
  }
}
