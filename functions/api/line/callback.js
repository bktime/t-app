// functions/api/line/callback.js

// CORS Headers สำหรับทุก Response
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export async function onRequest(context) {
  const { request, env } = context;

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // Only allow POST
  if (request.method !== 'POST') {
    return Response.json(
      { success: false, message: `Method ${request.method} not allowed` },
      { status: 405, headers: corsHeaders }
    );
  }

  return onRequestPost({ request, env });
}

async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const { code, redirect_uri } = body;

    console.log('[Worker] ========== LINE CALLBACK START ==========');
    console.log('[Worker] 1. Code received:', code ? `${code.substring(0, 20)}...` : 'MISSING');
    console.log('[Worker] 2. redirect_uri:', redirect_uri);

    if (!code) {
      return Response.json(
        { success: false, message: 'Missing authorization code' },
        { status: 400, headers: corsHeaders }
      );
    }

    // 🔐 อ่านค่าจาก environment variables อย่าลืมลบค่าออก !!!
    const CHANNEL_ID = env.LINE_CHANNEL_ID;
    const CHANNEL_SECRET = env.LINE_CHANNEL_SECRET; 

    console.log('[Worker] 3. CHANNEL_ID from env:', CHANNEL_ID);
    console.log('[Worker] 4. CHANNEL_SECRET from env:', CHANNEL_SECRET ? `[SET] length=${CHANNEL_SECRET.length}` : 'MISSING!');

    // ตรวจสอบ credentials
    if (!CHANNEL_ID || !CHANNEL_SECRET) {
      console.error('[Worker] Missing LINE credentials in environment');
      return Response.json(
        {
          success: false,
          message: 'Server configuration error: Missing LINE credentials. Please set LINE_CHANNEL_ID and LINE_CHANNEL_SECRET in Cloudflare Workers Environment Variables.',
        },
        { status: 500, headers: corsHeaders }
      );
    }

    // 🔁 Exchange authorization code for access token
    console.log('[Worker] 5. Exchanging code with LINE API...');

    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirect_uri,
      client_id: CHANNEL_ID,
      client_secret: CHANNEL_SECRET,
    });

    const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenParams,
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok) {
      console.error('[Worker] 6. Token exchange FAILED:', {
        status: tokenRes.status,
        error: tokenData.error,
        error_description: tokenData.error_description,
      });
      
      // ส่ง error message กลับไปให้ frontend แสดง
      return Response.json(
        {
          success: false,
          message: tokenData.error_description || tokenData.error || 'Token exchange failed',
          debug: {
            error: tokenData.error,
            hint: 'Check that Channel ID and Channel Secret match the LINE Developers Console',
          },
        },
        { status: 400, headers: corsHeaders }
      );
    }

    console.log('[Worker] 7. Token exchange SUCCESS');
    console.log('[Worker]   - has access_token:', !!tokenData.access_token);
    console.log('[Worker]   - has id_token:', !!tokenData.id_token);
    console.log('[Worker]   - expires_in:', tokenData.expires_in);

    // 👤 Fetch user profile
    console.log('[Worker] 8. Fetching user profile...');

    const profileRes = await fetch('https://api.line.me/v2/profile', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    if (!profileRes.ok) {
      console.error('[Worker] 9. Profile fetch FAILED:', profileRes.status);
      return Response.json(
        { success: false, message: 'Failed to fetch user profile from LINE' },
        { status: 400, headers: corsHeaders }
      );
    }

    const profile = await profileRes.json();
    console.log('[Worker] 10. Profile fetched successfully');
    console.log('[Worker]   - userId:', profile.userId);
    console.log('[Worker]   - displayName:', profile.displayName);
    console.log('[Worker]   - has pictureUrl:', !!profile.pictureUrl);

    // 📧 Extract email from id_token (if available)
    let email = null;
    if (tokenData.id_token) {
      try {
        // id_token is JWT: header.payload.signature
        const payloadBase64 = tokenData.id_token.split('.')[1];
        // แก้ไข base64 URL-safe -> standard base64
        const base64 = payloadBase64.replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(atob(base64));
        email = payload.email || null;
        console.log('[Worker] 11. Email extracted from id_token:', email);
      } catch (e) {
        console.log('[Worker] 11. Could not decode id_token:', e.message);
      }
    }

    // สร้าง user object
    const user = {
      userId: profile.userId,
      displayName: profile.displayName,
      pictureUrl: profile.pictureUrl || null,
      statusMessage: profile.statusMessage || null,
      email: email,
    };

    console.log('[Worker] ========== LINE CALLBACK SUCCESS ==========');

    // Return success response
    return Response.json(
      {
        success: true,
        user: user,
      },
      {
        headers: corsHeaders,
      }
    );

  } catch (err) {
    console.error('[Worker] UNEXPECTED ERROR:', err);
    console.error('[Worker] Stack trace:', err.stack);
    
    return Response.json(
      {
        success: false,
        message: err.message || 'Internal server error',
      },
      { status: 500, headers: corsHeaders }
    );
  }
}