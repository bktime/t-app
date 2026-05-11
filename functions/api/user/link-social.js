// functions/api/user/link-social.js
// POST /api/user/link-social — เชื่อมต่อบัญชีโซเชียลเพิ่มเติม

import { authUser, extractToken } from '../_auth.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// column ใน users table สำหรับแต่ละ platform
const PLATFORM_COL = {
  google:   'social_id_google',
  line:     'social_id_line',
  telegram: 'social_id_telegram',
};

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return json({ success: false, message: 'Method not allowed' }, 405);
  }

  if (!env.DB) {
    return json({ success: false, message: 'Database not configured' }, 500);
  }

  const token   = extractToken(request);
  const session = await authUser(env, token);
  if (!session) return json({ success: false, message: 'Unauthorized' }, 401);

  try {
    const body = await request.json();
    const { uuid, platform, social_id, email, picture } = body;

    if (!uuid || !platform || !social_id) {
      return json({ success: false, message: 'Missing required fields: uuid, platform, social_id' }, 400);
    }

    if (uuid !== session.uuid) {
      return json({ success: false, message: 'UUID ไม่ตรงกัน' }, 403);
    }

    const col = PLATFORM_COL[platform];
    if (!col) {
      return json({ success: false, message: `Unsupported platform: ${platform}` }, 400);
    }

    // ตรวจสอบว่า social_id นี้ถูกใช้โดย uuid อื่นหรือยัง
    const conflict = await env.DB.prepare(
      `SELECT uuid FROM users WHERE ${col} = ? AND uuid != ?`
    ).bind(social_id, uuid).first();

    if (conflict) {
      return json({
        success: false,
        message: `บัญชี ${platform} นี้ถูกเชื่อมต่อกับผู้ใช้อื่นแล้ว`,
      }, 409);
    }

    // สร้าง SET clause ตาม platform และ column จริงใน users table
    let setClauses = [`${col} = ?`];
    let binds      = [social_id];

    if (platform === 'google') {
      if (email)   { setClauses.push('email = COALESCE(email, ?)');     binds.push(email); }
      if (picture) { setClauses.push('picture = COALESCE(picture, ?)'); binds.push(picture); }
    }

    setClauses.push('updated_at = CURRENT_TIMESTAMP');
    binds.push(uuid);

    await env.DB.prepare(
      `UPDATE users SET ${setClauses.join(', ')} WHERE uuid = ?`
    ).bind(...binds).run();

    return json({ success: true, message: `เชื่อมต่อ ${platform} สำเร็จ` });

  } catch (err) {
    console.error('[link-social] error:', err);
    return json({ success: false, message: err.message || 'เกิดข้อผิดพลาดภายในระบบ' }, 500);
  }
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: corsHeaders });
}