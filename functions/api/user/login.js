// functions/api/user/login.js
// POST /api/user/login — Multi-device session support

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
    const { social_type, social_id, name, email, picture } = body;

    if (!social_type || !social_id) {
      return json({ success: false, message: 'ข้อมูลไม่ครบถ้วน' }, 400);
    }

    let socialField = 'social_id';
    switch (social_type) {
      case 'google':   socialField = 'social_id_google';   break;
      case 'line':     socialField = 'social_id_line';     break;
      case 'telegram': socialField = 'social_id_telegram'; break;
    }

    const user = await env.DB.prepare(`
      SELECT u.*,
             o.latitude, o.longitude, o.district,
             o.affiliation_code, o.department_code
      FROM users u
      LEFT JOIN organizations o
        ON o.affiliation_code = u.aff_code
       AND o.department_code  = u.dep_code
      WHERE u.${socialField} = ?
    `).bind(social_id).first();

    if (!user) {
      return json({
        success: false,
        not_registered: true,
        message: 'ไม่พบบัญชีนี้ในระบบ กรุณาสมัครสมาชิก',
      });
    }

    if (user.status !== 'Active') {
      return json({ success: false, message: 'บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ' }, 403);
    }

    // ── อ่าน device info จาก User-Agent ────────────────────────────────────
    const ua         = request.headers.get('User-Agent') || '';
    const ip         = request.headers.get('CF-Connecting-IP') ||
                       request.headers.get('X-Forwarded-For') || null;
    const deviceInfo = parseUserAgent(ua);

    // ── สร้าง token ใหม่ ────────────────────────────────────────────────────
    const authToken  = await generateSecureToken(user.uuid, social_type, env);
    const expiresAt  = new Date();
    expiresAt.setDate(expiresAt.getDate() + 365);

    // ── บันทึก session ─────────────────────────────────────────────────────
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
      social_type,
      expiresAt.toISOString(),
    ).run();

    // ── อัปเดต users (profile + last_login) ────────────────────────────────
    await env.DB.prepare(`
      UPDATE users SET
        name          = COALESCE(?, name),
        email         = COALESCE(?, email),
        picture       = COALESCE(?, picture),
        last_login_at = CURRENT_TIMESTAMP,
        updated_at    = CURRENT_TIMESTAMP
      WHERE uuid = ?
    `).bind(name || null, email || null, picture || null, user.uuid).run();

    return json({
      success: true,
      token: authToken,
      user: buildUserPayload(user),
      redirect: 'index.html',
    });

  } catch (error) {
    console.error('[login] error:', error);
    return json({ success: false, message: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' }, 500);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

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
    // location: {
      latitude:  user.latitude,
      longitude: user.longitude,
      district:  user.district,
      aff_code:  user.affiliation_code,
      dep_code:  user.department_code,
    // },
    // staff: {
      supervisor:      user.supervisor,
      approver:        user.approver,
      payer:           user.payer,
      supervisor_code: user.supervisor_code,
      approver_code:   user.approver_code,
      payer_code:      user.payer_code,
      ot_rate_per_day: user.ot_rate_per_day,
      ot_rate_per_hour: user.ot_rate_per_hour,
      ot_max_hours_per_day: user.ot_max_hours_per_day,
    // },
  };
}

function parseUserAgent(ua) {
  // ── OS ─────────────────────────────────────────────────────────────────────
  let os = 'Unknown';
  if (/iPhone|iPad|iPod/i.test(ua))        os = /iPad/i.test(ua) ? 'iPadOS' : 'iOS';
  else if (/Android/i.test(ua))            os = 'Android';
  else if (/Windows NT/i.test(ua))         os = 'Windows';
  else if (/Macintosh|Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua))              os = 'Linux';
  else if (/CrOS/i.test(ua))              os = 'ChromeOS';

  // ── Browser ────────────────────────────────────────────────────────────────
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

  // ── Device type ────────────────────────────────────────────────────────────
  let device_type = 'desktop';
  if (/iPhone|iPod/i.test(ua))            device_type = 'mobile';
  else if (/iPad/i.test(ua))              device_type = 'tablet';
  else if (/Android/i.test(ua)) {
    device_type = /Mobile/i.test(ua) ? 'mobile' : 'tablet';
  }

  // ── Device name ────────────────────────────────────────────────────────────
  let device_name = 'Unknown Device';
  if (device_type === 'mobile' || device_type === 'tablet') {
    device_name = `${browser} บน ${os}`;
  } else {
    device_name = `${browser} บน ${os}`;
  }

  return { os, browser, device_type, device_name };
}

async function generateSecureToken(userUuid, socialType, env) {
  const timestamp   = Date.now();
  const random      = Math.random().toString(36).substring(2, 15);
  const payload     = `${userUuid.substring(0, 8)}|${socialType}|${timestamp}|${random}`;
  const encoder     = new TextEncoder();
  const secretKey   = env.TOKEN_SECRET;

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