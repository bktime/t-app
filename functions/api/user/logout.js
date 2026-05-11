// functions/api/user/logout.js
// POST /api/user/logout — ลบ session ปัจจุบัน หรือทุก session

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ success: false, message: 'No token provided' }, 401);
    }

    const token = authHeader.substring(7);

    // body อาจมี { all: true } เพื่อ logout ทุกอุปกรณ์
    let logoutAll = false;
    try {
      const body = await request.json();
      logoutAll  = body?.all === true;
    } catch (_) {}

    if (logoutAll) {
      // หา uuid จาก token ก่อน แล้วลบทุก session ของ user นั้น
      const session = await env.DB.prepare(
        `SELECT uuid FROM user_sessions WHERE token = ?`
      ).bind(token).first();

      if (session) {
        await env.DB.prepare(
          `DELETE FROM user_sessions WHERE uuid = ?`
        ).bind(session.uuid).run();
      }

      return json({ success: true, message: 'ออกจากระบบทุกอุปกรณ์แล้ว' });
    }

    // ลบเฉพาะ session ปัจจุบัน
    await env.DB.prepare(
      `DELETE FROM user_sessions WHERE token = ?`
    ).bind(token).run();

    return json({ success: true, message: 'ออกจากระบบแล้ว' });

  } catch (error) {
    console.error('[logout] error:', error);
    return json({ success: false, message: 'Internal server error' }, 500);
  }
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: corsHeaders });
}