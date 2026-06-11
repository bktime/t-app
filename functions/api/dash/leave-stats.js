// functions/api/dash/leave-stats.js
// GET /api/dash/leave-stats?from=YYYY-MM-DD&to=YYYY-MM-DD[&aff=xxx][&dep=xxx]

import { authUser, extractToken, unauthorized } from '../_auth.js';
import { buildScope, scopedUUIDsSQL } from './_scope.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

const LEAVE_TYPE_TH = {
  sick:      'ลาป่วย',
  maternity: 'ลาคลอด',
  paternity: 'ลาบิดา',
  personal:  'ลากิจ',
  vacation:  'ลาพักร้อน',
  ordain:    'ลาอุปสมบท',
  military:  'ลาราชการทหาร',
  study:     'ลาศึกษา',
  intl:      'ลาไปต่างประเทศ',
  spouse:    'ลาดูแลคู่สมรส',
  rehab:     'ลาฟื้นฟูสมรรถภาพ',
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
    const [byType, byStatus, topLeave, totalRow] = await Promise.all([

      // แยกประเภทการลา
      env.DB.prepare(`
        SELECT
          lr.leave_type,
          COUNT(*)                    AS count,
          COALESCE(SUM(lr.days), 0)   AS total_days
        FROM leave_records lr
        WHERE lr.start_date <= ? AND lr.end_date >= ?
          AND lr.status <> 'rejected'
          AND lr.user_uuid IN (${inUUIDs})
        GROUP BY lr.leave_type
        ORDER BY total_days DESC
      `).bind(to, from, ...scopeParams).all(),

      // สรุปสถานะ
      env.DB.prepare(`
        SELECT
          lr.status,
          COUNT(*)                    AS count,
          COALESCE(SUM(lr.days), 0)   AS total_days
        FROM leave_records lr
        WHERE lr.start_date <= ? AND lr.end_date >= ?
          AND lr.user_uuid IN (${inUUIDs})
        GROUP BY lr.status
      `).bind(to, from, ...scopeParams).all(),

      // Top 10 ผู้ลามากสุด
      env.DB.prepare(`
        SELECT
          lr.user_uuid,
          u.firstName || ' ' || u.lastName AS name,
          COALESCE(u.department, '')        AS department,
          COUNT(*)                          AS records,
          COALESCE(SUM(lr.days), 0)         AS total_days,
          GROUP_CONCAT(DISTINCT lr.leave_type) AS leave_types
        FROM leave_records lr
        JOIN users u ON u.uuid = lr.user_uuid
        WHERE lr.start_date <= ? AND lr.end_date >= ?
          AND lr.status = 'approved'
          AND lr.user_uuid IN (${inUUIDs})
        GROUP BY lr.user_uuid
        ORDER BY total_days DESC
        LIMIT 10
      `).bind(to, from, ...scopeParams).all(),

      // รวมทั้งหมด
      env.DB.prepare(`
        SELECT
          COUNT(*)                                                              AS grand_count,
          COALESCE(SUM(lr.days), 0)                                            AS grand_days,
          SUM(CASE WHEN lr.status = 'pending'  THEN 1 ELSE 0 END)             AS pending_count,
          SUM(CASE WHEN lr.status = 'approved' THEN 1 ELSE 0 END)             AS approved_count,
          COALESCE(SUM(CASE WHEN lr.status='approved' THEN lr.days ELSE 0 END), 0) AS approved_days
        FROM leave_records lr
        WHERE lr.start_date <= ? AND lr.end_date >= ?
          AND lr.user_uuid IN (${inUUIDs})
      `).bind(to, from, ...scopeParams).first(),
    ]);

    const byTypeMapped = (byType.results ?? []).map(r => ({
      ...r,
      leave_type_th: LEAVE_TYPE_TH[r.leave_type] || r.leave_type,
    }));

    return Response.json({
      success: true,
      data: {
        byType:    byTypeMapped,
        byStatus:  byStatus.results  ?? [],
        topLeave:  topLeave.results  ?? [],
        summary: {
          grandCount:    Number(totalRow?.grand_count    ?? 0),
          grandDays:     Number(totalRow?.grand_days     ?? 0),
          pendingCount:  Number(totalRow?.pending_count  ?? 0),
          approvedCount: Number(totalRow?.approved_count ?? 0),
          approvedDays:  Number(totalRow?.approved_days  ?? 0),
        },
      },
      meta: { from, to, role: me.role, canFilter, ...scopeMeta },
    }, { headers: CORS });

  } catch (err) {
    console.error('[dash/leave-stats]', err);
    return Response.json({ success: false, message: 'Internal Server Error' }, { status: 500, headers: CORS });
  }
}