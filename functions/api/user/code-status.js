// functions/api/user/code-status.js
import { authUser, extractToken, unauthorized } from '../_auth.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const token = extractToken(request);
  const user = await authUser(env, token);
  if (!user) return unauthorized(corsHeaders);

  try {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');

    if (!code) {
      return json({ success: false, message: 'ไม่พบรหัส' }, 400);
    }

    // ค้นหารหัสที่เป็นของ User คนนี้ (ป้องกันการสุ่มเช็คของคนอื่น)
    const record = await env.DB.prepare(`
      SELECT used, expires_at FROM login_codes 
      WHERE code = ? AND uuid = ?
    `).bind(code, user.uuid).first();

    if (!record) {
      return json({ success: false, used: false, message: 'ไม่พบรหัสนี้' }, 404);
    }

    // ถ้าหมดอายุแล้ว ให้ถือว่าจบการทำงาน
    const isExpired = new Date(record.expires_at) < new Date();
    if (isExpired) {
      return json({ success: true, used: true, expired: true });
    }

    // คืนสถานะว่าถูกใช้ไปแล้วหรือยัง
    return json({ 
      success: true, 
      used: record.used === 1 
    });

  } catch (error) {
    console.error('[code-status] error:', error);
    return json({ success: false, message: 'เกิดข้อผิดพลาด' }, 500);
  }
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: corsHeaders });
}