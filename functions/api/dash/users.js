// functions/api/dash/users.js
// GET /api/dash/users  → list + summary + filter options
//
// วางที่: functions/api/dash/users.js
// URL:    GET /api/dash/users

import { authUser, extractToken, unauthorized } from '../_auth.js';
import { buildScope } from './_scope.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    },
  });
}

export async function onRequestGet({ request, env }) {
  const token = extractToken(request);
  const session = await authUser(env, token);
  if (!session) return unauthorized(CORS);

  const me = session; // session มี role, role_level, access_scope, can_edit, aff_code, dep_code ครบ

  const url = new URL(request.url);
  const { scopeSQL, scopeParams, scopeMeta, canFilter } = buildScope(me, url);

  try {
    const [usersRes, summaryRow, affiliations, departments, personnelTypes] = await Promise.all([

      env.DB.prepare(`
        SELECT
          u.uuid, u.prefix, u.firstName, u.lastName, u.name,
          u.email, u.picture, u.profileImage,
          u.role, u.status, u.position, u.personnelType,
          u.dep_code, u.aff_code, u.department, u.affiliation,
          u.idCard,
          u.supervisor,  u.supervisor_code,
          u.approver,    u.approver_code,
          u.payer,       u.payer_code,
          u.social_type, 
          u.ot_rate_per_day, u.ot_rate_per_hour, u.ot_max_hours_per_day,
          u.registered_at, u.last_login_at, u.created_at, u.updated_at
        FROM users u
        WHERE 1=1 ${scopeSQL}
        ORDER BY u.firstName ASC, u.lastName ASC
      `).bind(...scopeParams).all(),

      env.DB.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status='Active'    THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN status='Inactive'  THEN 1 ELSE 0 END) AS inactive,
          SUM(CASE WHEN status='Suspended' THEN 1 ELSE 0 END) AS suspended,
          SUM(CASE WHEN strftime('%Y-%m',created_at)=strftime('%Y-%m','now')
                   THEN 1 ELSE 0 END) AS new_this_month
        FROM users WHERE 1=1 ${scopeSQL}
      `).bind(...scopeParams).first(),

      env.DB.prepare(`
        SELECT DISTINCT aff_code, affiliation FROM users
        WHERE aff_code IS NOT NULL ${scopeSQL} ORDER BY affiliation ASC
      `).bind(...scopeParams).all(),

      env.DB.prepare(`
        SELECT DISTINCT dep_code, department, aff_code FROM users
        WHERE dep_code IS NOT NULL ${scopeSQL} ORDER BY department ASC
      `).bind(...scopeParams).all(),

      env.DB.prepare(`
        SELECT DISTINCT personnelType FROM users
        WHERE personnelType IS NOT NULL ${scopeSQL} ORDER BY personnelType ASC
      `).bind(...scopeParams).all(),
    ]);

    return Response.json({
      success: true,
      data: {
        users: usersRes.results ?? [],
        summary: {
          total:          Number(summaryRow?.total          ?? 0),
          active:         Number(summaryRow?.active         ?? 0),
          inactive:       Number(summaryRow?.inactive       ?? 0),
          suspended:      Number(summaryRow?.suspended      ?? 0),
          new_this_month: Number(summaryRow?.new_this_month ?? 0),
        },
        affiliations:   affiliations.results   ?? [],
        departments:    departments.results    ?? [],
        personnelTypes: personnelTypes.results ?? [],
      },
      meta: { role: me.role, role_level: me.role_level, can_edit: !!me.can_edit, canFilter, ...scopeMeta },
    }, { headers: CORS });

  } catch (err) {
    console.error('[dash/users GET]', err);
    return Response.json(
      { success: false, message: 'Internal Server Error' },
      { status: 500, headers: CORS }
    );
  }
}
