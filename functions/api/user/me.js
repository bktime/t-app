// GET /api/user/me

import { authUser, extractToken } from '../_auth.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const json = (d, s = 200) => Response.json(d, { status: s, headers: corsHeaders });

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (request.method !== 'GET')     return json({ success: false, message: 'Method not allowed' }, 405);

  try {
    const token   = extractToken(request);
    const session = await authUser(env, token);

    if (!session) return json({ success: false, message: 'Token ไม่ถูกต้องหรือหมดอายุ กรุณาเข้าสู่ระบบใหม่' }, 401);

    const user = await env.DB.prepare(`
      SELECT
        uuid, social_id, social_id_google, social_id_line, social_id_telegram,
        social_type, name, email, picture, status, role,
        affiliation, aff_code, department, dep_code, substr(idCard, 1, 4) || 'XXXXXXXX' || substr(idCard, -1) AS idCard, prefix, firstName, lastName,
        position, personnelType, signature, profileImage,
        supervisor, supervisor_code, approver, approver_code, payer, payer_code,
        ot_doc_number, ot_rate_per_day, ot_rate_per_hour, ot_max_hours_per_day, ot_bank_account,
        registered_at, created_at, updated_at, last_login_at
      FROM users
      WHERE uuid = ? AND status = 'Active'
    `).bind(session.uuid).first();

    if (!user) return json({ success: false, message: 'ไม่พบข้อมูลผู้ใช้หรือบัญชีถูกระงับ' }, 403);

    return json({ success: true, user });

  } catch (error) {
    console.error('[me] error:', error);
    return json({ success: false, message: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' }, 500);
  }
}