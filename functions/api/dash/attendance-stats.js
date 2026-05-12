// functions/api/dash/attendance-stats.js
// GET /api/dash/attendance-stats?from=YYYY-MM-DD&to=YYYY-MM-DD
// import { authUser, extractToken, unauthorized } from '../../_auth.js';

import { authUser, extractToken } from '../_auth.js';

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
  if (!['admin', 'supervisor'].includes(session.role)) {
    return Response.json({ success: false, message: 'Forbidden' }, { status: 403, headers: CORS });
  }

  const url  = new URL(request.url);
  const today = new Date().toISOString().slice(0, 10);
  const from = url.searchParams.get('from') || today;
  const to   = url.searchParams.get('to')   || today;

  try {
    const [workTypes, supervisorStatus, dailyCounts, inRangeStats, checkoutTypes] = await Promise.all([

      // จำนวนเช็คอินแยกตามประเภทงาน
      env.DB.prepare(`
        SELECT
          COALESCE(checkin_work_type, 'ไม่ระบุ') AS type,
          COUNT(*) AS count
        FROM attendance
        WHERE date BETWEEN ? AND ? AND checkin_time IS NOT NULL
        GROUP BY checkin_work_type
        ORDER BY count DESC
      `).bind(from, to).all(),

      // สถานะ supervisor แยกกลุ่ม
      env.DB.prepare(`
        SELECT
          COALESCE(supervisor_status, 'none') AS status,
          COUNT(*) AS count
        FROM attendance
        WHERE date BETWEEN ? AND ?
        GROUP BY supervisor_status
        ORDER BY count DESC
      `).bind(from, to).all(),

      // จำนวนเข้างานรายวัน + มาสาย
      env.DB.prepare(`
        SELECT
          date,
          COUNT(*)                                                            AS total,
          SUM(CASE WHEN checkin_time IS NOT NULL THEN 1 ELSE 0 END)          AS checkins,
          SUM(CASE WHEN checkin_time > '08:30:00' THEN 1 ELSE 0 END)         AS late,
          SUM(CASE WHEN checkout_type = 'manual' THEN 1 ELSE 0 END)          AS manual_checkout,
          SUM(CASE WHEN checkin_in_range = 1 THEN 1 ELSE 0 END)              AS in_range
        FROM attendance
        WHERE date BETWEEN ? AND ?
        GROUP BY date
        ORDER BY date ASC
      `).bind(from, to).all(),

      // เช็คอินในพื้นที่ vs นอกพื้นที่
      env.DB.prepare(`
        SELECT
          SUM(CASE WHEN checkin_in_range = 1 THEN 1 ELSE 0 END)  AS in_range,
          SUM(CASE WHEN checkin_in_range = 0 THEN 1 ELSE 0 END)  AS out_range,
          SUM(CASE WHEN checkin_in_range IS NULL THEN 1 ELSE 0 END) AS unknown
        FROM attendance
        WHERE date BETWEEN ? AND ? AND checkin_time IS NOT NULL
      `).bind(from, to).first(),

      // ประเภท checkout (manual / auto)
      env.DB.prepare(`
        SELECT
          COALESCE(checkout_type, 'auto') AS type,
          COUNT(*) AS count
        FROM attendance
        WHERE date BETWEEN ? AND ? AND checkout_time IS NOT NULL
        GROUP BY checkout_type
      `).bind(from, to).all(),
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
      meta: { from, to },
    }, { headers: CORS });

  } catch (err) {
    console.error('[dash/attendance-stats]', err);
    return Response.json({ success: false, message: 'Internal Server Error' }, { status: 500, headers: CORS });
  }
}
