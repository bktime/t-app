// GET /api/user/verify
export async function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // รับ token จาก Header
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({
        success: false,
        message: 'No token provided'
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.substring(7);

    // ตรวจสอบ token ในฐานข้อมูล
    const user = await env.DB.prepare(`
      SELECT * FROM users 
      WHERE auth_token = ? 
      AND token_expires_at > CURRENT_TIMESTAMP
      AND status = 'Active'
    `).bind(token).first();

    if (!user) {
      return new Response(JSON.stringify({
        success: false,
        message: 'Invalid or expired token'
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ส่งข้อมูลผู้ใช้กลับ (ไม่ต้องส่ง token กลับ)
    return new Response(JSON.stringify({
      success: true,
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
        status: user.status
      }
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Verify error:', error);
    return new Response(JSON.stringify({
      success: false,
      message: 'Internal server error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}