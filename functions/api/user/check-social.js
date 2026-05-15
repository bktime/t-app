// POST /api/user/check-social
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
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const body = await request.json();
    const { social_id, social_type } = body;

    if (!social_id || !social_type) {
      return json({ error: 'Missing required fields' }, 400);
    }

    // map column
    const socialMap = {
      google: 'social_id_google',
      line: 'social_id_line',
      telegram: 'social_id_telegram',
    };

    const column = socialMap[social_type];

    if (!column) {
      return json({ error: 'Invalid social_type' }, 400);
    }

    // ตรวจสอบว่ามี social นี้อยู่ไหม
    const result = await env.DB.prepare(`
      SELECT id, uuid, name
      FROM users
      WHERE ${column} = ?
      LIMIT 1
    `)
      .bind(social_id)
      .first();

    return json({
      exists: !!result,
      user: result || null,
    });

  } catch (error) {
    console.error('Check social error:', error);

    return json({
      error: 'Internal Server Error',
    }, 500);
  }

  function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
  }
}