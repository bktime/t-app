// functions/api/user/verify.js
// GET /api/user/verify — ตรวจสอบ token จาก user_sessions

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ success: false, message: 'No token provided' }, 401);
    }

    const token = authHeader.substring(7);

    // ── ตรวจสอบ session ────────────────────────────────────────────────────
    const session = await env.DB.prepare(`
      SELECT s.*, u.*,
             o.latitude, o.longitude, o.district,
             o.affiliation_code, o.department_code
      FROM user_sessions s
      JOIN users u ON u.uuid = s.uuid
      LEFT JOIN organizations o
        ON o.affiliation_code = u.aff_code
       AND o.department_code  = u.dep_code
      WHERE s.token = ?
        AND s.expires_at > CURRENT_TIMESTAMP
        AND u.status = 'Active'
    `).bind(token).first();

    if (!session) {
      return json({ success: false, message: 'Invalid or expired token' }, 401);
    }

    // ── อัปเดต last_active_at ──────────────────────────────────────────────
    await env.DB.prepare(`
      UPDATE user_sessions SET last_active_at = CURRENT_TIMESTAMP WHERE token = ?
    `).bind(token).run();

    return json({
      success: true,
      user: {
        uuid:          session.uuid,
        name:          session.name,
        email:         session.email,
        picture:       session.picture,
        social_type:   session.social_type,
        affiliation:   session.affiliation,
        department:    session.department,
        prefix:        session.prefix,
        firstName:     session.firstName,
        lastName:      session.lastName,
        position:      session.position,
        personnelType: session.personnelType,
        role:          session.role,
        status:        session.status,
        signature:     session.signature,
        // location: {
          latitude:  session.latitude,
          longitude: session.longitude,
          district:  session.district,
          aff_code:  session.affiliation_code,
          dep_code:  session.department_code,
        // },
        // staff: {
          supervisor:      session.supervisor,
          approver:        session.approver,
          payer:           session.payer,
          supervisor_code: session.supervisor_code,
          approver_code:   session.approver_code,
          payer_code:      session.payer_code,
          ot_rate_per_day: session.ot_rate_per_day,
          ot_rate_per_hour: session.ot_rate_per_hour,
          ot_max_hours_per_day: session.ot_max_hours_per_day,
        // },
      },
    });

  } catch (error) {
    console.error('[verify] error:', error);
    return json({ success: false, message: 'Internal server error' }, 500);
  }
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: corsHeaders });
}