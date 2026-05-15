// functions/api/_auth.js

/**
 * ตรวจสอบ token จาก user_sessions
 * คืนค่า user session + role policy
 */
export async function authUser(env, token) {
  if (!token) return null;

  const session = await env.DB.prepare(`
    SELECT
      s.id,
      s.uuid,
      s.token,
      s.expires_at,
      s.last_active_at,

      u.status,
      u.role,
      u.name,
      u.dep_code,
      u.aff_code,
      u.department,
      u.affiliation,

      r.role_name,
      r.level           AS role_level,
      r.access_scope,
      r.can_edit

    FROM user_sessions s

    JOIN users u
      ON u.uuid = s.uuid

    LEFT JOIN roles r
      ON r.role = u.role

    WHERE s.token = ?
      AND s.expires_at > CURRENT_TIMESTAMP
      AND u.status = 'Active'

    LIMIT 1
  `).bind(token).first();

  if (!session) return null;

  // fire-and-forget
  env.DB.prepare(`
    UPDATE user_sessions
    SET last_active_at = CURRENT_TIMESTAMP
    WHERE token = ?
  `).bind(token).run().catch(() => {});

  return session;
}

/**
 * ดึง token จาก header หรือ query
 */
export function extractToken(request) {
  const auth = request.headers.get('Authorization') || '';

  if (auth.startsWith('Bearer ')) {
    return auth.substring(7).trim();
  }

  const url = new URL(request.url);

  return url.searchParams.get('token') || null;
}

/**
 * 401
 */
export function unauthorized(corsHeaders = {}) {
  return Response.json(
    {
      success: false,
      code: 401,
      message: 'Unauthorized',
    },
    {
      status: 401,
      headers: corsHeaders,
    }
  );
}

/**
 * 403
 */
export function forbidden(corsHeaders = {}) {
  return Response.json(
    {
      success: false,
      code: 403,
      message: 'Forbidden',
    },
    {
      status: 403,
      headers: corsHeaders,
    }
  );
}