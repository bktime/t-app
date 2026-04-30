// functions/api/user/unlink-social.js
// POST /api/user/unlink-social — ยกเลิกการเชื่อมต่อบัญชีโซเชียล

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

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
    const { uuid, platform } = body;

    if (!uuid || !platform) {
      return json({ success: false, message: 'Missing required fields: uuid, platform' }, 400);
    }

    const col = PLATFORM_COL[platform];
    if (!col) {
      return json({ success: false, message: `Unsupported platform: ${platform}` }, 400);
    }

    if (env.DB) {
      // ตรวจสอบว่า platform นี้เป็นบัญชีหลักหรือไม่
      const user = await env.DB.prepare(
        'SELECT social_type FROM users WHERE uuid = ?'
      ).bind(uuid).first();

      if (!user) {
        return json({ success: false, message: 'ไม่พบข้อมูลผู้ใช้' }, 404);
      }

      if (user.social_type === platform) {
        return json({
          success: false,
          message: `ไม่สามารถยกเลิกบัญชีหลัก (${platform}) ได้ กรุณาติดต่อผู้ดูแลระบบ`,
        }, 403);
      }

      // นับจำนวน social ที่เชื่อมต่ออยู่ — ต้องมีอย่างน้อย 1 อัน
      const countRow = await env.DB.prepare(`
        SELECT (
          (CASE WHEN social_id_google   IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN social_id_line     IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN social_id_telegram IS NOT NULL THEN 1 ELSE 0 END)
        ) AS cnt
        FROM users WHERE uuid = ?
      `).bind(uuid).first();

      if (countRow?.cnt <= 1) {
        return json({
          success: false,
          message: 'ต้องมีบัญชีโซเชียลอย่างน้อย 1 บัญชี ไม่สามารถยกเลิกได้',
        }, 403);
      }

      // ลบ social id ออก
      await env.DB.prepare(
        `UPDATE users SET ${col} = NULL, updated_at = CURRENT_TIMESTAMP WHERE uuid = ?`
      ).bind(uuid).run();

      // ลบข้อมูลเสริมตาม platform
      if (platform === 'line') {
        await env.DB.prepare('UPDATE users SET name_line = NULL WHERE uuid = ?').bind(uuid).run();
      }
      if (platform === 'telegram') {
        await env.DB.prepare('UPDATE users SET username_telegram = NULL WHERE uuid = ?').bind(uuid).run();
      }

      return json({ success: true, message: `ยกเลิกการเชื่อมต่อ ${platform} สำเร็จ` });
    }

    // Demo mode
    return json({ success: true, message: `ยกเลิกการเชื่อมต่อ ${platform} สำเร็จ (demo)` });

  } catch (err) {
    console.error('[unlink-social] error:', err);
    return json({ success: false, message: 'เกิดข้อผิดพลาดภายในระบบ' }, 500);
  }
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: corsHeaders });
}