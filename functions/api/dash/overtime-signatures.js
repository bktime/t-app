// functions/api/dash/overtime-signatures.js
// GET /api/dash/overtime-signatures?month=YYYY-MM  → ลายเซ็นผู้ทำ OT + หัวหน้า สำหรับพิมพ์

import { authUser, extractToken, unauthorized } from '../_auth.js';
import { buildScope } from './_scope.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
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

  // ✅ ต้องมีระดับ > 1 ถึงจะดึงลายเซ็นได้
  if (
    (!session.role_level || Number(session.role_level) <= 1) &&
    session.role !== 'admin' &&
    session.role !== 'hr'
  ) {
    return Response.json(
      { success: false, message: 'ไม่มีสิทธิ์เข้าถึงข้อมูลลายเซ็น' },
      { status: 403, headers: CORS }
    );
  }

  const me = session;
  const url = new URL(request.url);

  const monthParam = url.searchParams.get('month') ||
    new Date().toISOString().slice(0, 7);

  if (!/^\d{4}-\d{2}$/.test(monthParam)) {
    return Response.json(
      { success: false, message: 'รูปแบบเดือนไม่ถูกต้อง (YYYY-MM)' },
      { status: 400, headers: CORS }
    );
  }

  const [year, mon] = monthParam.split('-').map(Number);
  const dateStart = `${year}-${String(mon).padStart(2, '0')}-01`;
  const lastDay   = new Date(year, mon, 0).getDate();
  const dateEnd   = `${year}-${String(mon).padStart(2, '0')}-${lastDay}`;

  // buildScope ใช้ alias u_ot (join users)
  const { scopeSQL, scopeParams } = buildScope(me, url, 'u_ot');

  try {
    /*
      ดึง:
        - u_ot.uuid            → uuid ของผู้ทำ OT
        - u_ot.signature       → ลายเซ็นผู้ทำ OT
        - u_sv.signature       → ลายเซ็นหัวหน้า (approver_code → users)

      approver_code ใน attendance_overtime เป็น uuid ของหัวหน้า
    */
    const res = await env.DB.prepare(`
      SELECT
        u_ot.uuid,
        u_ot.signature                                      AS user_signature,
        u_sv.signature                                      AS approver_signature,
        (u_sv.prefix || '' || u_sv.firstName || ' ' || u_sv.lastName) AS approver_name
      FROM attendance_overtime ot
      INNER JOIN users u_ot ON u_ot.uuid = ot.uuid
      LEFT  JOIN users u_sv ON u_sv.uuid = ot.approver_code
      WHERE ot.ot_date BETWEEN ? AND ?
        AND u_ot.status = 'Active'
        ${scopeSQL}
      GROUP BY u_ot.uuid
    `).bind(dateStart, dateEnd, ...scopeParams).all();

    return Response.json({
      success: true,
      data: res.results ?? [],
    }, { headers: CORS });

  } catch (err) {
    console.error('[dash/overtime-signatures GET]', err);
    return Response.json(
      { success: false, message: 'Internal Server Error' },
      { status: 500, headers: CORS }
    );
  }
}