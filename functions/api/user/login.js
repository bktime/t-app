// POST /api/user/login
export async function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const { social_type, social_id, name, email, picture } = body;

    if (!social_type || !social_id) {
      return new Response(JSON.stringify({
        success: false,
        message: 'ข้อมูลไม่ครบถ้วน'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let socialField = 'social_id';
    switch (social_type) {
      case 'google': socialField = 'social_id_google'; break;
      case 'line': socialField = 'social_id_line'; break;
      case 'telegram': socialField = 'social_id_telegram'; break;
    }

    // Query with LEFT JOIN to get organization coordinates
    const user = await env.DB.prepare(`
      SELECT 
        u.*,
        o.latitude,
        o.longitude,
        o.district,
        o.affiliation_code,
        o.department_code
      FROM users u
      LEFT JOIN organizations o 
        ON o.affiliation_code = u.aff_code 
        AND o.department_code = u.dep_code
      WHERE u.${socialField} = ?
    `).bind(social_id).first();

    if (!user) {
      return new Response(JSON.stringify({
        success: false,
        not_registered: true,
        message: 'ไม่พบบัญชีนี้ในระบบ กรุณาสมัครสมาชิก'
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (user.status !== 'Active') {
      return new Response(JSON.stringify({
        success: false,
        message: 'บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ'
      }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const authToken = await generateSecureToken(user.uuid, social_type, env);
    const tokenExpiresAt = new Date();
    tokenExpiresAt.setDate(tokenExpiresAt.getDate() + 365);

    await env.DB.prepare(`
      UPDATE users SET 
        name = COALESCE(?, name),
        email = COALESCE(?, email),
        picture = COALESCE(?, picture),
        auth_token = ?,
        token_expires_at = ?,
        last_login_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE uuid = ?
    `).bind(name, email, picture, authToken, tokenExpiresAt.toISOString(), user.uuid).run();

    return new Response(JSON.stringify({
      success: true,
      token: authToken,
      user: {
        uuid: user.uuid,
        name: user.name,
        email: user.email,
        picture: user.picture,
        social_type: user.social_type,
        affiliation: user.affiliation,
        department: user.department,
        prefix: user.prefix,
        firstName: user.firstName,
        lastName: user.lastName,
        position: user.position,
        personnelType: user.personnelType,
        role: user.role,
        status: user.status,
        location: {
          latitude: user.latitude,
          longitude: user.longitude,
          district: user.district,
          aff_code: user.affiliation_code,
          dep_code: user.department_code
        },
        staff : {
          supervisor: user.supervisor,
          approver: user.approver,
          payer: user.payer,
          supervisor_code: user.supervisor_code,
          approver_code: user.approver_code,
          payer_code: user.payer_code
        },
      },
      redirect: 'index.html'
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Login error:', error);
    return new Response(JSON.stringify({
      success: false,
      message: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

async function generateSecureToken(userUuid, socialType, env) {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  const randomBytes = crypto.randomBytes ? crypto.randomBytes(16).toString('hex') : random;
  
  const payload = `${userUuid.substring(0, 8)}|${socialType}|${timestamp}|${random}|${randomBytes}`;
  
  const encoder = new TextEncoder();
  const secretKey = env.TOKEN_SECRET || 'your-super-secret-key-min-32-chars-long-2024!';
  
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secretKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(payload)
  );
  
  const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  const tokenRaw = `${payload}|${signatureBase64.substring(0, 32)}`;
  const token = btoa(tokenRaw);
  
  return token;
}