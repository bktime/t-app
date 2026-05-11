// functions/api/_auth.js
// Shared auth helper — ใช้ร่วมกันทุก API
// import { authUser } from '../_auth.js';

/**
 * ตรวจสอบ token จาก user_sessions
 * คืนค่า { uuid, ... } หรือ null ถ้าไม่ valid
 */
export async function authUser(env, token) {
  if (!token) return null;

const session = await env.DB.prepare(`
  SELECT s.uuid, s.id, s.token, u.status, u.role
  FROM user_sessions s
  JOIN users u ON u.uuid = s.uuid
  WHERE s.token = ?
    AND s.expires_at > CURRENT_TIMESTAMP
    AND u.status = 'Active'
`).bind(token).first();

  if (!session) return null;

  // อัปเดต last_active_at (fire-and-forget)
  env.DB.prepare(
    `UPDATE user_sessions SET last_active_at = CURRENT_TIMESTAMP WHERE token = ?`
  ).bind(token).run().catch(() => {});

  return session;
}

/**
 * ดึง token จาก Authorization header หรือ query string
 * Authorization: Bearer <token>  หรือ  ?token=<token>
 */
export function extractToken(request) {
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.substring(7);

  // fallback: query string (สำหรับ GET ที่ส่ง token ไม่ได้)
  const url = new URL(request.url);
  return url.searchParams.get('token') || null;
}

/**
 * สร้าง 401 response สำเร็จรูป
 */
export function unauthorized(corsHeaders = {}) {
  return Response.json(
    { success: false, message: 'Unauthorized' },
    { status: 401, headers: corsHeaders }
  );
}
