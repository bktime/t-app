// functions/api/auth/set-password.js
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
    // ดึง Token จาก Header
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return json({ success: false, message: 'กรุณาเข้าสู่ระบบ' }, 401);
    }
    const token = authHeader.split(' ')[1];

    // ตรวจสอบว่า Token นี้เป็นของ User คนไหน
    const session = await env.DB.prepare(`
      SELECT uuid FROM user_sessions WHERE token = ? AND expires_at > CURRENT_TIMESTAMP
    `).bind(token).first();

    if (!session) {
      return json({ success: false, message: 'Session ไม่ถูกต้องหรือหมดอายุ' }, 401);
    }

    const body = await request.json();
    const { newPassword } = body;

    if (!newPassword || newPassword.length < 6) {
      return json({ success: false, message: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' }, 400);
    }

    // Hash รหัสผ่านด้วย SHA-256 ก่อนเก็บลง DB (ใช้ uuid เป็น salt เบื้องต้นเพื่อความปลอดภัย)
    const hashedPassword = await hashPassword(newPassword, session.uuid);

    // บันทึกลงฐานข้อมูล
    await env.DB.prepare(`
      UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE uuid = ?
    `).bind(hashedPassword, session.uuid).run();

    return json({ success: true, message: 'ตั้งรหัสผ่านสำเร็จ' });

  } catch (error) {
    console.error('[set-password] error:', error);
    return json({ success: false, message: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' }, 500);
  }
}

// Helper สำหรับ Hash รหัสผ่าน
async function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + salt); // ใช้ uuid เป็น salt
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: corsHeaders });
}