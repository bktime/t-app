export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { code, redirect_uri } = body;

    if (!code) {
      return Response.json({ success: false, message: 'Missing code' }, { status: 400 });
    }

    // 🔐 ENV จาก Cloudflare
    const CHANNEL_ID     = env.VITE_LINE_CHANNEL_ID;
    const CHANNEL_SECRET = env.VITE_LINE_CHANNEL_SECRET;

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
      return Response.json({
        success: false,
        message: tokenData.error_description || 'Token exchange failed'
      }, { status: 400 });
    }

    // 👤 ดึง profile
    const profileRes = await fetch('https://api.line.me/v2/profile', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`
      }
    });

    const profile = await profileRes.json();

    if (!profileRes.ok) {
      return Response.json({ success: false, message: 'Profile fetch failed' }, { status: 400 });
    }

    // 📧 decode email (optional)
    let email = null;
    if (tokenData.id_token) {
      const payload = tokenData.id_token.split('.')[1];
      const decoded = JSON.parse(atob(payload));
      email = decoded.email || null;
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
    });

  } catch (err) {
    return Response.json({
      success: false,
      message: err.message
    }, { status: 500 });
  }
}
