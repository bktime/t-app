// functions/api/google/callback.js
// Cloudflare Pages Function — Google OAuth Code Exchange

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json({ success: false, message: `Method ${request.method} not allowed` }, 405);
  }

  try {
    const body = await request.json();
    const { code, redirect_uri } = body;

    if (!code)         return json({ success: false, message: 'Missing authorization code' }, 400);
    if (!redirect_uri) return json({ success: false, message: 'Missing redirect_uri' }, 400);

    // ── อ่าน credentials จาก env ────────────────────────────────────────────
    const CLIENT_ID     = env.GOOGLE_CLIENT_ID;
    const CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET;

    if (!CLIENT_SECRET) {
      return json({ success: false, message: 'Server config error: GOOGLE_CLIENT_SECRET not set' }, 500);
    }

    // ── Exchange code → token ────────────────────────────────────────────────
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri,
        grant_type:    'authorization_code',
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || tokenData.error) {
      console.error('[Google callback] token error:', tokenData);
      return json({
        success: false,
        message: tokenData.error_description || tokenData.error || 'Token exchange failed',
      }, 400);
    }

    // ── ดึงข้อมูล user จาก id_token (JWT) ──────────────────────────────────
    let user;
    if (tokenData.id_token) {
      try {
        const payloadB64 = tokenData.id_token.split('.')[1];
        const base64     = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
        const payload    = JSON.parse(atob(base64));

        user = {
          sub:     payload.sub,
          name:    payload.name    || '',
          email:   payload.email   || '',
          picture: payload.picture || '',
        };
      } catch (e) {
        console.error('[Google callback] id_token parse error:', e);
      }
    }

    // fallback: ใช้ userinfo endpoint ถ้า id_token ไม่มี
    if (!user) {
      const infoRes  = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const infoData = await infoRes.json();
      user = {
        sub:     infoData.sub,
        name:    infoData.name    || '',
        email:   infoData.email   || '',
        picture: infoData.picture || '',
      };
    }

    if (!user?.sub) {
      return json({ success: false, message: 'ไม่สามารถดึงข้อมูลผู้ใช้จาก Google ได้' }, 400);
    }

    return json({ success: true, user });

  } catch (err) {
    console.error('[Google callback] unexpected error:', err);
    return json({ success: false, message: err.message || 'Internal server error' }, 500);
  }
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: corsHeaders });
}