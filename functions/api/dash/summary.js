// functions/api/dash/summary.js
// GET /api/dash/summary?from=YYYY-MM-DD&to=YYYY-MM-DD

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

      // จำนวน user ทั้งหมดที่ Active
      env.DB.prepare(`
        SELECT COUNT(*) AS c FROM users WHERE status = 'Active'
      `).first('c'),

      // user ที่สมัครในช่วงนี้
      env.DB.prepare(`
        SELECT COUNT(*) AS c FROM users
        WHERE DATE(created_at) BETWEEN ? AND ?
      `).bind(from, to).first('c'),

      // เช็คอินในช่วงนี้
      env.DB.prepare(`
        SELECT COUNT(*) AS c FROM attendance
        WHERE date BETWEEN ? AND ? AND checkin_time IS NOT NULL
      `).bind(from, to).first('c'),

      // มาสาย (checkin > 08:30)
      env.DB.prepare(`
        SELECT COUNT(*) AS c FROM attendance
        WHERE date BETWEEN ? AND ?
          AND checkin_time IS NOT NULL
          AND checkin_time > '08:30:00'
      `).bind(from, to).first('c'),

      // เช็คเอาท์
      env.DB.prepare(`
        SELECT COUNT(*) AS c FROM attendance
        WHERE date BETWEEN ? AND ?
          AND checkout_time IS NOT NULL
          AND checkout_type = 'manual'
      `).bind(from, to).first('c'),

      // OT รวม
      env.DB.prepare(`
        SELECT
          COUNT(*)                                            AS cnt,
          COALESCE(SUM(ot_hours), 0)                         AS hrs,
          SUM(CASE WHEN supervisor_status = 'pending' THEN 1 ELSE 0 END) AS pend,
          COALESCE(SUM(amount_hour + COALESCE(amount_day,0)), 0) AS total_amount
        FROM attendance_overtime
        WHERE ot_date BETWEEN ? AND ?
      `).bind(from, to).first(),

      // คำขอแก้ไขเวลาในช่วงนี้
      env.DB.prepare(`
        SELECT COUNT(*) AS c FROM attendance
        WHERE date BETWEEN ? AND ? AND request_ref IS NOT NULL
      `).bind(from, to).first('c'),

      // รอ supervisor อนุมัติ (attendance)
      env.DB.prepare(`
        SELECT COUNT(*) AS c FROM attendance
        WHERE date BETWEEN ? AND ? AND supervisor_status = 'pending'
      `).bind(from, to).first('c'),
    ]);

    const total = Number(totalUsers ?? 0);
    const cin   = Number(checkinCount ?? 0);

    return Response.json({
      success: true,
      data: {
        totalUsers:     total,
        newUsers:       Number(newUsers      ?? 0),
        checkinCount:   cin,
        checkinRate:    total > 0 ? parseFloat(((cin / total) * 100).toFixed(1)) : 0,
        lateCount:      Number(lateCount     ?? 0),
        checkoutCount:  Number(checkoutCount ?? 0),
        otCount:        Number(otRow?.cnt    ?? 0),
        otHours:        parseFloat((otRow?.hrs ?? 0).toFixed(2)),
        otPending:      Number(otRow?.pend   ?? 0),
        otTotalAmount:  parseFloat((otRow?.total_amount ?? 0).toFixed(2)),
        requestCount:   Number(requestCount  ?? 0),
        pendingRequests:Number(pendingRequests ?? 0),
      },
      meta: { from, to },
    }, { headers: CORS });

  } catch (err) {
    console.error('[dash/summary]', err);
    return Response.json({ success: false, message: 'Internal Server Error' }, { status: 500, headers: CORS });
  }
}
