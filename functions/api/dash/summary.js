// functions/api/dash/summary.js
// GET /api/dash/summary?from=YYYY-MM-DD&to=YYYY-MM-DD[&aff=xxx][&dep=xxx]

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

  // user ธรรมดาดู dashboard ได้แค่ dep ตัวเอง
  // supervisor, admin ผ่านได้
  const url   = new URL(request.url);
  const today = new Date().toISOString().slice(0, 10);
  const from  = url.searchParams.get('from') || today;
  const to    = url.searchParams.get('to')   || today;

  const { scopeSQL, scopeParams, scopeMeta, canFilter } = buildScope(me, url);
  const inUUIDs = scopedUUIDsSQL(scopeSQL);

  try {
    const [
      totalUsers,
      newUsers,
      checkinCount,
      lateCount,
      checkoutCount,
      otRow,
      requestCount,
      pendingRequests,
    ] = await Promise.all([

      env.DB.prepare(`
        SELECT COUNT(*) AS c FROM users
        WHERE status = 'Active' ${scopeSQL}
      `).bind(...scopeParams).first('c'),

      env.DB.prepare(`
        SELECT COUNT(*) AS c FROM users
        WHERE status = 'Active'
          AND DATE(created_at) BETWEEN ? AND ?
          ${scopeSQL}
      `).bind(from, to, ...scopeParams).first('c'),

      env.DB.prepare(`
        SELECT COUNT(*) AS c FROM attendance a
        WHERE a.date BETWEEN ? AND ?
          AND a.checkin_time IS NOT NULL AND a.supervisor_status <> 'cancelled'
          AND a.uuid IN (${inUUIDs})
      `).bind(from, to, ...scopeParams).first('c'),

      env.DB.prepare(`
        SELECT COUNT(*) AS c FROM attendance a
        WHERE a.date BETWEEN ? AND ?
          AND a.checkin_time IS NOT NULL
          AND a.checkin_time > '08:30:00' AND a.supervisor_status <> 'cancelled'
          AND a.uuid IN (${inUUIDs})
      `).bind(from, to, ...scopeParams).first('c'),

      env.DB.prepare(`
        SELECT COUNT(*) AS c FROM attendance a
        WHERE a.date BETWEEN ? AND ?
          AND a.checkout_time IS NOT NULL
          AND a.checkout_type = 'manual' AND a.supervisor_status <> 'cancelled'
          AND a.uuid IN (${inUUIDs})
      `).bind(from, to, ...scopeParams).first('c'),

      env.DB.prepare(`
        SELECT
          COUNT(*)                                                        AS cnt,
          COALESCE(SUM(ot_hours), 0)                                      AS hrs,
          SUM(CASE WHEN supervisor_status = 'pending' THEN 1 ELSE 0 END) AS pend,
          COALESCE(SUM(amount_hour + COALESCE(amount_day, 0)), 0)        AS total_amount
        FROM attendance_overtime o
        WHERE o.ot_date BETWEEN ? AND ? AND o.supervisor_status <> 'cancelled'
          AND o.uuid IN (${inUUIDs})
      `).bind(from, to, ...scopeParams).first(),

      env.DB.prepare(`
        SELECT COUNT(*) AS c FROM attendance a
        WHERE a.date BETWEEN ? AND ?
          AND a.request_ref IS NOT NULL AND a.supervisor_status <> 'cancelled'
          AND a.uuid IN (${inUUIDs})
      `).bind(from, to, ...scopeParams).first('c'),

      env.DB.prepare(`
        SELECT COUNT(*) AS c FROM attendance a
        WHERE a.date BETWEEN ? AND ?
          AND a.supervisor_status = 'pending'
          AND a.uuid IN (${inUUIDs})
      `).bind(from, to, ...scopeParams).first('c'),
    ]);

    const total = Number(totalUsers ?? 0);
    const cin   = Number(checkinCount ?? 0);

    return Response.json({
      success: true,
      data: {
        totalUsers:      total,
        newUsers:        Number(newUsers       ?? 0),
        checkinCount:    cin,
        checkinRate:     total > 0 ? parseFloat(((cin / total) * 100).toFixed(1)) : 0,
        lateCount:       Number(lateCount      ?? 0),
        checkoutCount:   Number(checkoutCount  ?? 0),
        otCount:         Number(otRow?.cnt     ?? 0),
        otHours:         parseFloat((otRow?.hrs ?? 0).toFixed(2)),
        otPending:       Number(otRow?.pend    ?? 0),
        otTotalAmount:   parseFloat((otRow?.total_amount ?? 0).toFixed(2)),
        requestCount:    Number(requestCount   ?? 0),
        pendingRequests: Number(pendingRequests ?? 0),
      },
      meta: { from, to, role: me.role, canFilter, ...scopeMeta },
    }, { headers: CORS });

  } catch (err) {
    console.error('[dash/summary]', err);
    return Response.json({ success: false, message: 'Internal Server Error' }, { status: 500, headers: CORS });
  }
}
