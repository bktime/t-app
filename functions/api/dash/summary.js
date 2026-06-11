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
      pendingCheckins,
      leaveRow,
      holidayRow,
    ] = await Promise.all([

      // 1. จำนวนผู้ใช้ Active ใน scope
      env.DB.prepare(`
        SELECT COUNT(*) AS c FROM users
        WHERE status = 'Active' ${scopeSQL}
      `).bind(...scopeParams).first('c'),

      // 2. ผู้ใช้ใหม่ในช่วง
      env.DB.prepare(`
        SELECT COUNT(*) AS c FROM users
        WHERE status = 'Active'
          AND DATE(created_at) BETWEEN ? AND ?
          ${scopeSQL}
      `).bind(from, to, ...scopeParams).first('c'),

      // 3. เช็คอิน
      env.DB.prepare(`
        SELECT COUNT(*) AS c FROM attendance a
        WHERE a.date BETWEEN ? AND ?
          AND a.checkin_time IS NOT NULL AND a.supervisor_status <> 'cancelled'
          AND a.uuid IN (${inUUIDs})
      `).bind(from, to, ...scopeParams).first('c'),

      // 4. มาสาย
      env.DB.prepare(`
        SELECT COUNT(*) AS c FROM attendance a
        WHERE a.date BETWEEN ? AND ?
          AND a.checkin_time IS NOT NULL
          AND a.checkin_time > '08:30:00' AND a.supervisor_status <> 'cancelled'
          AND a.uuid IN (${inUUIDs})
      `).bind(from, to, ...scopeParams).first('c'),

      // 5. เช็คเอาท์ manual
      env.DB.prepare(`
        SELECT COUNT(*) AS c FROM attendance a
        WHERE a.date BETWEEN ? AND ?
          AND a.checkout_time IS NOT NULL
          AND a.checkout_type = 'manual' AND a.supervisor_status <> 'cancelled'
          AND a.uuid IN (${inUUIDs})
      `).bind(from, to, ...scopeParams).first('c'),

      // 6. OT สรุป
      env.DB.prepare(`
        SELECT
          COUNT(*)                                                        AS cnt,
          COALESCE(SUM(ot_hours), 0)                                      AS hrs,
          COALESCE(SUM(ot_days),  0)                                      AS days,
          SUM(CASE WHEN supervisor_status = 'pending' THEN 1 ELSE 0 END)  AS pend,
          COALESCE(SUM(amount_hour + COALESCE(amount_day, 0)), 0)         AS total_amount
        FROM attendance_overtime o
        WHERE o.ot_date BETWEEN ? AND ? AND o.supervisor_status <> 'cancelled'
          AND o.uuid IN (${inUUIDs})
      `).bind(from, to, ...scopeParams).first(),

      // 7. คำขอแก้ไขเวลา
      env.DB.prepare(`
        SELECT COUNT(*) AS c FROM attendance a
        WHERE a.date BETWEEN ? AND ?
          AND a.request_ref IS NOT NULL AND a.supervisor_status <> 'cancelled'
          AND a.uuid IN (${inUUIDs})
      `).bind(from, to, ...scopeParams).first('c'),

      // 8. คำขอแก้ไขรอดำเนินการ
      env.DB.prepare(`
        SELECT COUNT(*) AS c FROM attendance a
        WHERE a.date BETWEEN ? AND ?
          AND a.request_ref IS NOT NULL AND a.supervisor_status = 'pending'
          AND a.uuid IN (${inUUIDs})
      `).bind(from, to, ...scopeParams).first('c'),

      // 9. รอตรวจสอบ (Checkin รออนุมัติ)
      env.DB.prepare(`
        SELECT COUNT(*) AS c FROM attendance a
        WHERE a.date BETWEEN ? AND ?
          AND a.request_ref IS NULL AND a.supervisor_status = 'pending'
          AND a.uuid IN (${inUUIDs})
      `).bind(from, to, ...scopeParams).first('c'),

      // 10. การลา สรุป
      env.DB.prepare(`
        SELECT
          COUNT(*)                                                          AS cnt,
          SUM(CASE WHEN status = 'pending'  THEN 1 ELSE 0 END)             AS pend,
          SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END)             AS approved,
          COALESCE(SUM(CASE WHEN status = 'approved' THEN days ELSE 0 END), 0) AS total_days
        FROM leave_records lr
        WHERE (lr.start_date <= ? AND lr.end_date >= ?)
          AND lr.user_uuid IN (${inUUIDs})
      `).bind(to, from, ...scopeParams).first(),

      // 11. วันหยุด
      env.DB.prepare(`
        SELECT id, name, date, type
        FROM holidays
        WHERE date BETWEEN ? AND ?
        ORDER BY date ASC
      `).bind(from, to).all(),
    ]);

    const holidayList = holidayRow?.results ?? [];
    const holidayDates = new Set(holidayList.map(h => h.date));
    let workdays = 0, totalDays = 0;
    const todayStr = new Date().toISOString().slice(0, 10);
    const cur = new Date(from + 'T00:00:00');
    const end = new Date(to   + 'T00:00:00');
    while(cur <= end) {
      const dow = cur.getDay();
      const ds  = cur.toISOString().slice(0, 10);
      totalDays++;
      if(dow >= 1 && dow <= 5 && !holidayDates.has(ds)) workdays++;
      cur.setDate(cur.getDate() + 1);
    }
    const daysRemain = (() => {
      let r = 0;
      const c2 = new Date(Math.max(new Date(todayStr), new Date(from + 'T00:00:00')));
      const e2 = new Date(to + 'T00:00:00');
      while(c2 <= e2) {
        const dow = c2.getDay();
        const ds  = c2.toISOString().slice(0, 10);
        if(dow >= 1 && dow <= 5 && !holidayDates.has(ds)) r++;
        c2.setDate(c2.getDate() + 1);
      }
      return r;
    })();

    const total = Number(totalUsers ?? 0);
    const cin   = Number(checkinCount ?? 0);
    const expectedCheckins = total * workdays;
    const checkinRate = expectedCheckins > 0 ? parseFloat(((cin / expectedCheckins) * 100).toFixed(1)) : 0;

    return Response.json({
      success: true,
      data: {
        totalUsers:      total,
        newUsers:        Number(newUsers       ?? 0),
        checkinCount:    cin,
        checkinRate,
        lateCount:       Number(lateCount      ?? 0),
        checkoutCount:   Number(checkoutCount  ?? 0),
        otCount:         Number(otRow?.cnt     ?? 0),
        otHours:         parseFloat((otRow?.hrs ?? 0).toFixed(2)),
        otDays:          parseFloat((otRow?.days ?? 0).toFixed(2)),
        otPending:       Number(otRow?.pend    ?? 0),
        otTotalAmount:   parseFloat((otRow?.total_amount ?? 0).toFixed(2)),
        requestCount:    Number(requestCount   ?? 0),
        pendingRequests: Number(pendingRequests ?? 0),
        pendingCheckins: Number(pendingCheckins ?? 0),
        leaveCount:      Number(leaveRow?.cnt      ?? 0),
        leavePending:    Number(leaveRow?.pend     ?? 0),
        leaveApproved:   Number(leaveRow?.approved ?? 0),
        leaveTotalDays:  parseFloat((leaveRow?.total_days ?? 0).toFixed(1)),
        holidayCount:    holidayList.length,
        holidays:        holidayList,
        workdays,
        totalDays,
        daysRemain,
      },
      meta: { from, to, role: me.role, canFilter, ...scopeMeta },
    }, { headers: CORS });

  } catch (err) {
    console.error('[dash/summary]', err);
    return Response.json({ success: false, message: 'Internal Server Error' }, { status: 500, headers: CORS });
  }
}