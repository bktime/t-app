// functions/api/dash/get-signatures.js
import { authUser, extractToken, unauthorized } from '../_auth.js';
import { buildScope } from './_scope.js';

// ✅ ตั้งค่า Header ป้องกันการแคชลายเซ็นทุกชนิด
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

  // ✅ ตรวจสอบสิทธิ์: ต้องมีระดับ > 2 เท่านั้นถึงจะดึงลายเซ็นได้
  if (!session.role_level || Number(session.role_level) <= 2) {
    return Response.json(
      { success: false, message: 'ไม่มีสิทธิ์เข้าถึงข้อมูลลายเซ็น' },
      { status: 403, headers: CORS }
    );
  }

  const me = session;
  const url = new URL(request.url);
  const dateParam = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);

  const { scopeSQL, scopeParams } = buildScope(me, url);

  try {
    const res = await env.DB.prepare(`
      SELECT
        u.uuid,
        u.signature AS checkin_signature,
        uApv.signature AS approver_signature
      FROM users u
      INNER JOIN attendance a ON a.uuid = u.uuid AND a.date = ?
      LEFT JOIN users uApv ON uApv.uuid = a.approver_uuid
      WHERE u.status = 'Active'
        AND a.checkin_time IS NOT NULL
        ${scopeSQL}
    `).bind(dateParam, ...scopeParams).all();

    return Response.json({
      success: true,
      data: res.results ?? []
    }, { headers: CORS });

  } catch (err) {
    console.error('[get-signatures GET]', err);
    return Response.json(
      { success: false, message: 'Internal Server Error' },
      { status: 500, headers: CORS }
    );
  }
}