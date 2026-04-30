// functions/api/user/link-social.js
// POST /api/user/link-social — เชื่อมต่อบัญชีโซเชียลเพิ่มเติม

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ชื่อ column ใน DB สำหรับแต่ละ platform
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

  try {
    const body = await request.json();
    const { uuid, platform, social_id, email, name, username, picture } = body;

    if (!uuid || !platform || !social_id) {
      return json({ success: false, message: 'Missing required fields: uuid, platform, social_id' }, 400);
    }

    const col = PLATFORM_COL[platform];
    if (!col) {
      return json({ success: false, message: `Unsupported platform: ${platform}` }, 400);
    }

    if (env.DB) {
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

      // อัปเดต social id
      const extra = platform === 'google'   ? `, email = COALESCE(email, ?)` :
                    platform === 'line'     ? `, name_line = ?` :
                    platform === 'telegram' ? `, username_telegram = ?` : '';
      const extraVal = platform === 'google'   ? (email || null) :
                       platform === 'line'     ? (name  || null) :
                       platform === 'telegram' ? (username || null) : null;

      let stmt;
      if (extraVal !== null) {
        stmt = await env.DB.prepare(
          `UPDATE users SET ${col} = ?, updated_at = CURRENT_TIMESTAMP${extra} WHERE uuid = ?`
        ).bind(social_id, extraVal, uuid);
      } else {
        stmt = await env.DB.prepare(
          `UPDATE users SET ${col} = ?, updated_at = CURRENT_TIMESTAMP WHERE uuid = ?`
        ).bind(social_id, uuid);
      }
      await stmt.run();

      return json({ success: true, message: `เชื่อมต่อ ${platform} สำเร็จ` });
    }

    // Demo mode
    return json({ success: true, message: `เชื่อมต่อ ${platform} สำเร็จ (demo)` });

  } catch (err) {
    console.error('[link-social] error:', err);
    return json({ success: false, message: 'เกิดข้อผิดพลาดภายในระบบ' }, 500);
  }
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: corsHeaders });
}