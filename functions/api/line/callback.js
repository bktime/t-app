// functions/api/line/callback.js
export async function onRequest(context) {
  const { request, env } = context;
  
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }
  
  // Only allow POST
  if (request.method !== 'POST') {
    return Response.json(
      { success: false, message: `Method ${request.method} not allowed` },
      { status: 405, headers: { 'Allow': 'POST, OPTIONS' } }
    );
  }
  
  return onRequestPost({ request, env });
}

async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const { code, redirect_uri } = body;

    console.log('[Worker] 1. Received request, code:', code ? 'present' : 'missing');
    console.log('[Worker] 2. env keys:', Object.keys(env));

    if (!code) {
      return Response.json({ success: false, message: 'Missing authorization code' }, { status: 400 });
    }

    // 🔐 อ่านค่าจาก env (ไม่มี VITE_ นำหน้า)
    const CHANNEL_ID = env.LINE_CHANNEL_ID;
    const CHANNEL_SECRET = env.LINE_CHANNEL_SECRET;

    console.log('[Worker] 3. CHANNEL_ID:', CHANNEL_ID ? 'set' : 'MISSING!');
    console.log('[Worker] 4. CHANNEL_SECRET:', CHANNEL_SECRET ? 'set (length: ' + CHANNEL_SECRET.length + ')' : 'MISSING!');

    if (!CHANNEL_ID || !CHANNEL_SECRET) {
      console.error('[Worker] Missing LINE credentials in env');
      return Response.json({ 
        success: false, 
        message: 'Server configuration error: Missing LINE credentials. Please check environment variables.' 
      }, { status: 500 });
    }

    console.log('[Worker] 5. Exchanging code with LINE API...');

    // 🔁 Exchange code → token
    const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirect_uri,
        client_id: CHANNEL_ID,
        client_secret: CHANNEL_SECRET
      })
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok) {
      console.error('[Worker] 6. Token exchange failed:', tokenData);
      return Response.json({
        success: false,
        message: tokenData.error_description || tokenData.error || 'Token exchange failed'
      }, { status: 400 });
    }

    console.log('[Worker] 7. Token exchange successful');

    // 👤 ดึง profile
    const profileRes = await fetch('https://api.line.me/v2/profile', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`
      }
    });

    if (!profileRes.ok) {
      console.error('[Worker] 8. Profile fetch failed:', profileRes.status);
      return Response.json({ success: false, message: 'Failed to fetch profile' }, { status: 400 });
    }

    const profile = await profileRes.json();
    console.log('[Worker] 9. Profile fetched:', { userId: profile.userId, displayName: profile.displayName });

    // 📧 decode email from id_token
    let email = null;
    if (tokenData.id_token) {
      try {
        const payload = tokenData.id_token.split('.')[1];
        const decoded = JSON.parse(atob(payload));
        email = decoded.email || null;
        console.log('[Worker] 10. Email from id_token:', email);
      } catch (e) {
        console.log('[Worker] Could not decode id_token:', e.message);
      }
    }

    const user = {
      userId: profile.userId,
      displayName: profile.displayName,
      pictureUrl: profile.pictureUrl || null,
      statusMessage: profile.statusMessage || null,
      email: email
    };

    return Response.json({
      success: true,
      user
    }, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      }
    });

  } catch (err) {
    console.error('[Worker] Unexpected error:', err);
    return Response.json({
      success: false,
      message: err.message || 'Internal server error'
    }, { status: 500 });
  }
}
