// สนับสนุนทั้ง POST และ OPTIONS (CORS preflight)
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

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const { code, redirect_uri } = body;

    console.log('[Worker] Received token exchange request, code:', code ? 'present' : 'missing');

    if (!code) {
      return Response.json({ success: false, message: 'Missing authorization code' }, { status: 400 });
    }

    // 🔐 ENV จาก Cloudflare
    const CHANNEL_ID     = env.VITE_LINE_CHANNEL_ID;
    const CHANNEL_SECRET = env.VITE_LINE_CHANNEL_SECRET;

    if (!CHANNEL_ID || !CHANNEL_SECRET) {
      console.error('[Worker] Missing LINE credentials in env');
      return Response.json({ success: false, message: 'Server configuration error' }, { status: 500 });
    }

    console.log('[Worker] Exchanging code with LINE API...');

    // 🔁 Exchange code → token
    const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri,
        client_id: CHANNEL_ID,
        client_secret: CHANNEL_SECRET
      })
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok) {
      console.error('[Worker] Token exchange failed:', tokenData);
      return Response.json({
        success: false,
        message: tokenData.error_description || tokenData.error || 'Token exchange failed'
      }, { status: 400 });
    }

    console.log('[Worker] Token exchange successful, fetching profile...');

    // 👤 ดึง profile
    const profileRes = await fetch('https://api.line.me/v2/profile', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`
      }
    });

    if (!profileRes.ok) {
      console.error('[Worker] Profile fetch failed:', profileRes.status);
      return Response.json({ success: false, message: 'Failed to fetch profile' }, { status: 400 });
    }

    const profile = await profileRes.json();
    console.log('[Worker] Profile fetched:', { userId: profile.userId, displayName: profile.displayName });

    // 📧 decode email from id_token (optional)
    let email = null;
    if (tokenData.id_token) {
      try {
        const payload = tokenData.id_token.split('.')[1];
        const decoded = JSON.parse(atob(payload));
        email = decoded.email || null;
      } catch (e) {
        console.log('[Worker] Could not decode id_token:', e.message);
      }
    }

    const user = {
      userId: profile.userId,
      displayName: profile.displayName,
      pictureUrl: profile.pictureUrl || null,
      statusMessage: profile.statusMessage || null,
      email
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
