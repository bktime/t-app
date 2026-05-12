// functions/api/dash/ot-stats.js
// GET /api/dash/ot-stats?from=YYYY-MM-DD&to=YYYY-MM-DD
// import { authUser, extractToken, unauthorized } from '../_auth.js';

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
    const [departments, otTypes, topOt, otStatusSummary, dailyOt] = await Promise.all([

      // เข้างานแยกตามหน่วยงาน (JOIN users)
      env.DB.prepare(`
        SELECT
          COALESCE(u.department, 'ไม่ระบุ') AS department,
          COUNT(*) AS count
        FROM attendance a
        JOIN users u ON u.uuid = a.uuid
        WHERE a.date BETWEEN ? AND ? AND a.checkin_time IS NOT NULL
        GROUP BY u.department
        ORDER BY count DESC
        LIMIT 15
      `).bind(from, to).all(),

      // OT แยกตาม work_type
      env.DB.prepare(`
        SELECT
          COALESCE(work_type, 'ไม่ระบุ') AS work_type,
          COUNT(*)                        AS count,
          COALESCE(SUM(ot_hours), 0)      AS total_hours,
          COALESCE(SUM(amount_hour + COALESCE(amount_day,0)), 0) AS total_amount
        FROM attendance_overtime
        WHERE ot_date BETWEEN ? AND ?
        GROUP BY work_type
        ORDER BY count DESC
      `).bind(from, to).all(),

      // Top 10 OT ชั่วโมงสูงสุด
      env.DB.prepare(`
        SELECT
          o.uuid,
          COALESCE(o.name, u.firstName || ' ' || u.lastName) AS name,
          COALESCE(o.department, u.department)               AS department,
          o.supervisor_status,
          COUNT(*)                      AS records,
          COALESCE(SUM(o.ot_hours), 0)  AS total_hours,
          COALESCE(SUM(o.ot_days),  0)  AS total_days,
          COALESCE(SUM(o.amount_hour + COALESCE(o.amount_day,0)), 0) AS total_amount
        FROM attendance_overtime o
        LEFT JOIN users u ON u.uuid = o.uuid
        WHERE o.ot_date BETWEEN ? AND ?
        GROUP BY o.uuid
        ORDER BY total_hours DESC
        LIMIT 10
      `).bind(from, to).all(),

      // สรุปสถานะ OT (pending / approved / rejected)
      env.DB.prepare(`
        SELECT
          COALESCE(supervisor_status, 'pending') AS status,
          COUNT(*)                   AS count,
          COALESCE(SUM(ot_hours), 0) AS hours
        FROM attendance_overtime
        WHERE ot_date BETWEEN ? AND ?
        GROUP BY supervisor_status
      `).bind(from, to).all(),

      // OT รายวัน
      env.DB.prepare(`
        SELECT
          ot_date                    AS date,
          COUNT(*)                   AS count,
          COALESCE(SUM(ot_hours), 0) AS hours
        FROM attendance_overtime
        WHERE ot_date BETWEEN ? AND ?
        GROUP BY ot_date
        ORDER BY ot_date ASC
      `).bind(from, to).all(),
    ]);

    return Response.json({
      success: true,
      data: {
        departments:     departments.results    ?? [],
        otTypes:         otTypes.results        ?? [],
        topOt:           topOt.results          ?? [],
        otStatusSummary: otStatusSummary.results ?? [],
        dailyOt:         dailyOt.results        ?? [],
      },
      meta: { from, to },
    }, { headers: CORS });

  } catch (err) {
    console.error('[dash/ot-stats]', err);
    return Response.json({ success: false, message: 'Internal Server Error' }, { status: 500, headers: CORS });
  }
}
