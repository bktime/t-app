// functions/api/dash/ot-stats.js
// GET /api/dash/ot-stats?from=YYYY-MM-DD&to=YYYY-MM-DD[&aff=xxx][&dep=xxx]

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
    const [departments, otTypes, topOt, otStatusSummary, dailyOt] = await Promise.all([

      // เข้างานแยกตามหน่วยงาน
      // admin/supervisor: แสดง department ใน scope
      // user: แสดงได้เฉพาะ dep ตัวเอง → แสดง 1 แถว
      env.DB.prepare(`
        SELECT
          COALESCE(u.department, 'ไม่ระบุ') AS department,
          u.dep_code,
          COUNT(*) AS count
        FROM attendance a
        JOIN users u ON u.uuid = a.uuid
        WHERE a.date BETWEEN ? AND ?
          AND a.checkin_time IS NOT NULL AND a.supervisor_status <> 'cancelled'
          AND a.uuid IN (${inUUIDs})
        GROUP BY u.department, u.dep_code
        ORDER BY count DESC
        LIMIT 15
      `).bind(from, to, ...scopeParams).all(),

      // OT แยกประเภท
      env.DB.prepare(`
        SELECT
          COALESCE(o.work_type, 'ไม่ระบุ') AS work_type,
          COUNT(*)                          AS count,
          COALESCE(SUM(o.ot_hours), 0)      AS total_hours,
          COALESCE(SUM(o.amount_hour + COALESCE(o.amount_day, 0)), 0) AS total_amount
        FROM attendance_overtime o
        WHERE o.ot_date BETWEEN ? AND ? AND o.supervisor_status <> 'cancelled'
          AND o.uuid IN (${inUUIDs})
        GROUP BY o.work_type
        ORDER BY count DESC
      `).bind(from, to, ...scopeParams).all(),

      // Top 10 OT ชั่วโมงสูงสุด
      env.DB.prepare(`
        SELECT
          o.uuid,
          COALESCE(o.name, u.firstName || ' ' || u.lastName)  AS name,
          COALESCE(o.department, u.department)                 AS department,
          o.supervisor_status,
          COUNT(*)                      AS records,
          COALESCE(SUM(o.ot_hours), 0)  AS total_hours,
          COALESCE(SUM(o.ot_days),  0)  AS total_days,
          COALESCE(SUM(o.amount_hour + COALESCE(o.amount_day, 0)), 0) AS total_amount
        FROM attendance_overtime o
        LEFT JOIN users u ON u.uuid = o.uuid
        WHERE o.ot_date BETWEEN ? AND ? AND o.supervisor_status <> 'cancelled'
          AND o.uuid IN (${inUUIDs})
        GROUP BY o.uuid
        ORDER BY total_hours DESC
        LIMIT 10
      `).bind(from, to, ...scopeParams).all(),

      // สรุปสถานะ OT
      env.DB.prepare(`
        SELECT
          COALESCE(o.supervisor_status, 'pending') AS status,
          COUNT(*)                   AS count,
          COALESCE(SUM(o.ot_hours), 0) AS hours
        FROM attendance_overtime o
        WHERE o.ot_date BETWEEN ? AND ? AND o.supervisor_status <> 'cancelled'
          AND o.uuid IN (${inUUIDs})
        GROUP BY o.supervisor_status
      `).bind(from, to, ...scopeParams).all(),

      // OT รายวัน
      env.DB.prepare(`
        SELECT
          o.ot_date                    AS date,
          COUNT(*)                     AS count,
          COALESCE(SUM(o.ot_hours), 0) AS hours
        FROM attendance_overtime o
        WHERE o.ot_date BETWEEN ? AND ? AND o.supervisor_status <> 'cancelled'
          AND o.uuid IN (${inUUIDs})
        GROUP BY o.ot_date
        ORDER BY o.ot_date ASC
      `).bind(from, to, ...scopeParams).all(),
    ]);

    return Response.json({
      success: true,
      data: {
        departments:     departments.results     ?? [],
        otTypes:         otTypes.results         ?? [],
        topOt:           topOt.results           ?? [],
        otStatusSummary: otStatusSummary.results ?? [],
        dailyOt:         dailyOt.results         ?? [],
      },
      meta: { from, to, role: me.role, canFilter, ...scopeMeta },
    }, { headers: CORS });

  } catch (err) {
    console.error('[dash/ot-stats]', err);
    return Response.json({ success: false, message: 'Internal Server Error' }, { status: 500, headers: CORS });
  }
}
