// functions/api/user/code-generate.js
import { authUser, extractToken, unauthorized } from '../_auth.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // ตรวจสอบสิทธิ์ว่าล็อกอินแล้ว
  const token = extractToken(request);
  const user = await authUser(env, token);
  if (!user) return unauthorized(corsHeaders);

  try {
    // สุ่มเลข 6 หลัก
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 3 * 60 * 1000).toISOString(); // หมดอายุใน 3 นาที

    await env.DB.prepare(`
      INSERT INTO login_codes (code, uuid, expires_at) 
      VALUES (?, ?, ?)
    `).bind(code, user.uuid, expiresAt).run();

    return json({
      success: true,
      code: code,
      expiresIn: 180
    });

  } catch (error) {
    console.error('[code-generate] error:', error);
    return json({ success: false, message: 'สร้างรหัสไม่สำเร็จ' }, 500);
  }
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: corsHeaders });
}