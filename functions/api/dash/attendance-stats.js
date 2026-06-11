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
    const [
      workTypes,
      supervisorStatus,
      dailyCounts,
      inRangeStats,
      checkoutTypes,
      checkinByDept,
      hourlyCheckin,
      distanceBuckets,
    ] = await Promise.all([

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
          SUM(CASE WHEN a.checkout_time IS NOT NULL THEN 1 ELSE 0 END)      AS checkouts,
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
        ORDER BY count DESC
      `).bind(from, to, ...scopeParams).all(),

      // Checkin rate รายหน่วยงาน
      env.DB.prepare(`
        SELECT
          COALESCE(u.department, 'ไม่ระบุ')  AS department,
          u.dep_code,
          COUNT(DISTINCT u.uuid)              AS total_users,
          COUNT(DISTINCT CASE WHEN a.checkin_time IS NOT NULL
                               AND a.supervisor_status <> 'cancelled'
                               THEN a.uuid END) AS checkin_users,
          COUNT(CASE WHEN a.checkin_time IS NOT NULL
                      AND a.supervisor_status <> 'cancelled'
                      THEN 1 END)            AS checkin_count,
          COUNT(CASE WHEN a.checkin_time > '08:30:00'
                      AND a.supervisor_status <> 'cancelled'
                      THEN 1 END)            AS late_count
        FROM users u
        LEFT JOIN attendance a
          ON a.uuid = u.uuid AND a.date BETWEEN ? AND ?
        WHERE u.status = 'Active' ${scopeSQL}
        GROUP BY u.department, u.dep_code
        ORDER BY checkin_count DESC
        LIMIT 15
      `).bind(from, to, ...scopeParams).all(),

      // การกระจายชั่วโมงเช็คอิน
      env.DB.prepare(`
        SELECT
          CASE
            WHEN a.checkin_time < '07:00:00' THEN 'ก่อน 07:00'
            WHEN a.checkin_time < '07:30:00' THEN '07:00–07:30'
            WHEN a.checkin_time < '08:00:00' THEN '07:30–08:00'
            WHEN a.checkin_time < '08:30:00' THEN '08:00–08:30'
            WHEN a.checkin_time < '09:00:00' THEN '08:30–09:00'
            WHEN a.checkin_time < '09:30:00' THEN '09:00–09:30'
            WHEN a.checkin_time < '10:00:00' THEN '09:30–10:00'
            ELSE 'หลัง 10:00'
          END AS bucket,
          COUNT(*) AS count,
          CASE
            WHEN a.checkin_time < '07:00:00' THEN 1
            WHEN a.checkin_time < '07:30:00' THEN 2
            WHEN a.checkin_time < '08:00:00' THEN 3
            WHEN a.checkin_time < '08:30:00' THEN 4
            WHEN a.checkin_time < '09:00:00' THEN 5
            WHEN a.checkin_time < '09:30:00' THEN 6
            WHEN a.checkin_time < '10:00:00' THEN 7
            ELSE 8
          END AS sort_order
        FROM attendance a
        WHERE a.date BETWEEN ? AND ?
          AND a.checkin_time IS NOT NULL AND a.supervisor_status <> 'cancelled'
          AND a.uuid IN (${inUUIDs})
        GROUP BY bucket
        ORDER BY sort_order ASC
      `).bind(from, to, ...scopeParams).all(),

      // bucket ระยะทาง
      env.DB.prepare(`
        SELECT
          CASE
            WHEN a.checkin_distance_m IS NULL        THEN 'ไม่ทราบ'
            WHEN a.checkin_distance_m <= 50           THEN '≤50 ม.'
            WHEN a.checkin_distance_m <= 200          THEN '51–200 ม.'
            WHEN a.checkin_distance_m <= 500          THEN '201–500 ม.'
            WHEN a.checkin_distance_m <= 1000         THEN '501 ม.–1 กม.'
            ELSE '>1 กม.'
          END AS bucket,
          COUNT(*) AS count
        FROM attendance a
        WHERE a.date BETWEEN ? AND ?
          AND a.checkin_time IS NOT NULL AND a.supervisor_status <> 'cancelled'
          AND a.uuid IN (${inUUIDs})
        GROUP BY bucket
        ORDER BY MIN(COALESCE(a.checkin_distance_m, 99999)) ASC
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
        checkoutTypes:    checkoutTypes.results    ?? [],
        hourlyCheckin:    hourlyCheckin.results    ?? [],
        distanceBuckets:  distanceBuckets.results  ?? [],
        checkinByDept:    checkinByDept.results    ?? [],
      },
      meta: { from, to, role: me.role, canFilter, ...scopeMeta },
    }, { headers: CORS });

  } catch (err) {
    console.error('[dash/attendance-stats]', err);
    return Response.json({ success: false, message: 'Internal Server Error' }, { status: 500, headers: CORS });
  }
}