const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return json({ success: false, message: 'กรุณาเข้าสู่ระบบ' }, 401);
    }
    const token = authHeader.split(' ')[1];

    const session = await env.DB.prepare(`
      SELECT uuid FROM user_sessions WHERE token = ? AND expires_at > CURRENT_TIMESTAMP
    `).bind(token).first();

    if (!session) {
      return json({ success: false, message: 'Session ไม่ถูกต้องหรือหมดอายุ' }, 401);
    }

    // ── สุ่มรหัส 6 หลัก (100000 – 999999) ──
    const kioskPin = String(Math.floor(100000 + Math.random() * 900000));

    // Hash ก่อนเก็บลง DB
    const hashedPin = await hashPassword(kioskPin, session.uuid);

    // ✅ เก็บลง kiosk_pin_hash (แยกจากรหัสผ่านปกติ)
    await env.DB.prepare(`
      UPDATE users SET kiosk_pin_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE uuid = ?
    `).bind(hashedPin, session.uuid).run();

    return json({
      success: true,
      pin: kioskPin,
      message: 'สร้างรหัสผ่าน Kiosk สำเร็จ'
    });

  } catch (error) {
    console.error('[generate-kiosk-password] error:', error);
    return json({ success: false, message: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' }, 500);
  }
}

async function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + salt);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: corsHeaders });
}