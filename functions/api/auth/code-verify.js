// functions/api/auth/code-verify.js
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const body = await request.json();
    const { nationalId, code } = body;

    if (!nationalId || !code) {
      return json({ success: false, message: 'กรุณากรอกข้อมูลให้ครบถ้วน' }, 400);
    }

    // ── 1. ค้นหารหัส 6 หลักที่ยังไม่หมดอายุและยังไม่ถูกใช้ ────────────────────────
    const codeRecord = await env.DB.prepare(`
      SELECT * FROM login_codes 
      WHERE code = ? AND used = 0 AND expires_at > CURRENT_TIMESTAMP
    `).bind(code).first();

    if (!codeRecord) {
      return json({ success: false, message: 'รหัสไม่ถูกต้อง หมดอายุ หรือถูกใช้ไปแล้ว' }, 400);
    }

    // ── 2. ตรวจสอบเลข 13 หลัก ว่าตรงกับเจ้าของรหัสหรือไม่ ────────────────────────
    // ⚠️ โปรดตรวจสอบ: หากคอลัมน์เก็บเลขบัตรในตาราง users ของคุณไม่ใช่ชื่อ `national_id` 
    // กรุณาเปลี่ยน `u.national_id` ด้านล่างให้ตรงกับชื่อคอลัมน์ใน DB ของคุณ (เช่น u.cid หรือ u.id_card)
    const user = await env.DB.prepare(`
      SELECT u.*,
             o.latitude, o.longitude, o.district,
             o.affiliation_code, o.department_code
      FROM users u
      LEFT JOIN organizations o
        ON o.affiliation_code = u.aff_code
       AND o.department_code  = u.dep_code
      WHERE u.uuid = ? AND u.idCard = ? AND u.status = 'Active'
    `).bind(codeRecord.uuid, nationalId).first();

    if (!user) {
      return json({ success: false, message: 'เลขบัตรประชาชนไม่ตรงกับรหัสที่ออกให้ หรือบัญชีถูกระงับ' }, 400);
    }

    // ── 3. ทำเครื่องหมายว่ารหัสถูกใช้แล้ว (One-time use) ─────────────────────────────
    await env.DB.prepare(`UPDATE login_codes SET used = 1 WHERE code = ?`).bind(code).run();

    // ── 4. สร้าง Session ใหม่สำหรับเครื่องที่ล็อกอินเข้ามา (ใช้วิธีเดียวกับ login.js) ────────
    const ua         = request.headers.get('User-Agent') || '';
    const ip         = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || null;
    const deviceInfo = parseUserAgent(ua);

    const authToken  = await generateSecureToken(user.uuid, 'code', env);
    const expiresAt  = new Date();
    expiresAt.setDate(expiresAt.getDate() + 365);

    await env.DB.prepare(`
      INSERT INTO user_sessions
        (uuid, token, device_name, device_type, browser, os, ip, social_type, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      user.uuid,
      authToken,
      deviceInfo.device_name,
      deviceInfo.device_type,
      deviceInfo.browser,
      deviceInfo.os,
      ip,
      'code', // ระบุ social_type ว่ามาจากการล็อกอินด้วยรหัส
      expiresAt.toISOString(),
    ).run();

    // ── 5. อัปเดต last_login ────────────────────────────────────────────────────────
    await env.DB.prepare(`
      UPDATE users SET 
        last_login_at = CURRENT_TIMESTAMP,
        updated_at    = CURRENT_TIMESTAMP
      WHERE uuid = ?
    `).bind(user.uuid).run();

    // ── 6. ส่งข้อมูลกลับ ────────────────────────────────────────────────────────────
    return json({
      success: true,
      token: authToken,
      user: buildUserPayload(user),
      message: 'เข้าสู่ระบบสำเร็จ'
    });

  } catch (error) {
    console.error('[code-verify] error:', error);
    return json({ success: false, message: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' }, 500);
  }
}

// ── Helpers (คัดลอกมาจาก login.js เพื่อให้ Session Structure ตรงกันทุกประการ) ──────────

function buildUserPayload(user) {
  return {
    uuid:          user.uuid,
    name:          user.name,
    email:         user.email,
    picture:       user.picture,
    social_type:   user.social_type,
    affiliation:   user.affiliation,
    department:    user.department,
    prefix:        user.prefix,
    firstName:     user.firstName,
    lastName:      user.lastName,
    position:      user.position,
    personnelType: user.personnelType,
    role:          user.role,
    status:        user.status,
    signature:     user.signature,
    latitude:  user.latitude,
    longitude: user.longitude,
    district:  user.district,
    aff_code:  user.affiliation_code,
    dep_code:  user.department_code,
    supervisor:      user.supervisor,
    approver:        user.approver,
    payer:           user.payer,
    supervisor_code: user.supervisor_code,
    approver_code:   user.approver_code,
    payer_code:      user.payer_code,
    ot_rate_per_day: user.ot_rate_per_day,
    ot_rate_per_hour: user.ot_rate_per_hour,
    ot_max_hours_per_day: user.ot_max_hours_per_day,
  };
}

function parseUserAgent(ua) {
  let os = 'Unknown';
  if (/iPhone|iPad|iPod/i.test(ua))        os = /iPad/i.test(ua) ? 'iPadOS' : 'iOS';
  else if (/Android/i.test(ua))            os = 'Android';
  else if (/Windows NT/i.test(ua))         os = 'Windows';
  else if (/Macintosh|Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua))              os = 'Linux';
  else if (/CrOS/i.test(ua))              os = 'ChromeOS';

  let browser = 'Unknown';
  if (/Line\//i.test(ua))                          browser = 'LINE';
  else if (/FBAV|FBAN|FB_IAB/i.test(ua))           browser = 'Facebook';
  else if (/EdgA?\/|Edg\//i.test(ua))              browser = 'Edge';
  else if (/OPR\/|Opera\//i.test(ua))              browser = 'Opera';
  else if (/SamsungBrowser/i.test(ua))             browser = 'Samsung Browser';
  else if (/CriOS/i.test(ua))                      browser = 'Chrome (iOS)';
  else if (/FxiOS/i.test(ua))                      browser = 'Firefox (iOS)';
  else if (/Chrome\/[0-9]/i.test(ua) && !/Chromium/i.test(ua)) browser = 'Chrome';
  else if (/Firefox\/[0-9]/i.test(ua))             browser = 'Firefox';
  else if (/Safari\/[0-9]/i.test(ua) && !/Chrome/i.test(ua))  browser = 'Safari';

  let device_type = 'desktop';
  if (/iPhone|iPod/i.test(ua))            device_type = 'mobile';
  else if (/iPad/i.test(ua))              device_type = 'tablet';
  else if (/Android/i.test(ua)) {
    device_type = /Mobile/i.test(ua) ? 'mobile' : 'tablet';
  }

  let device_name = `${browser} บน ${os}`;

  return { os, browser, device_type, device_name };
}

async function generateSecureToken(userUuid, socialType, env) {
  const timestamp   = Date.now();
  const random      = Math.random().toString(36).substring(2, 15);
  const payload     = `${userUuid.substring(0, 8)}|${socialType}|${timestamp}|${random}`;
  const encoder     = new TextEncoder();
  const secretKey   = env.TOKEN_SECRET || 'anicca-dukkha-anatta'; // ควรตั้งค่า TOKEN_SECRET ใน Environment Variables ของคุณเพื่อความปลอดภัย

  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secretKey),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signature      = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const signatureB64   = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return btoa(`${payload}|${signatureB64.substring(0, 32)}`);
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: corsHeaders });
}