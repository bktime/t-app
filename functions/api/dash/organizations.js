// functions/api/dash/organizations.js
// GET /api/dash/organizations   → list + summary + filter options
//
// functions/api/dash/organizations/[dep_code].js
// PUT /api/dash/organizations/:dep_code  → update (ไม่แก้ affiliation_code / department_code)

// ════════════════════════════════════════════════
// GET  — วางที่ functions/api/dash/organizations.js
// ════════════════════════════════════════════════
import { authUser, extractToken, unauthorized } from '../_auth.js';
import { buildScope } from './_scope.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

/**
 * buildOrgScope — เหมือน buildScope แต่ใช้ชื่อ column ของตาราง organizations
 * affiliation_code / department_code แทน aff_code / dep_code
 */
function buildOrgScope(me, url) {
  const scope    = me.access_scope;
  const aff      = url?.searchParams.get('aff') || null;
  const dep      = url?.searchParams.get('dep') || null;

  if (scope === 'ตนเอง') {
    return { sql: `AND department_code = ?`, params: [me.dep_code] };
  }
  if (scope === 'หน่วยงาน') {
    if (dep) return { sql: `AND affiliation_code = ? AND department_code = ?`, params: [me.aff_code, dep] };
    return { sql: `AND affiliation_code = ?`, params: [me.aff_code] };
  }
  if (scope === 'สังกัด') {
    if (aff && dep) return { sql: `AND affiliation_code = ? AND department_code = ?`, params: [aff, dep] };
    if (aff)        return { sql: `AND affiliation_code = ?`, params: [aff] };
    if (dep)        return { sql: `AND department_code = ?`, params: [dep] };
    return { sql: '', params: [] };
  }
  // ทั้งหมด
  if (aff && dep) return { sql: `AND affiliation_code = ? AND department_code = ?`, params: [aff, dep] };
  if (aff)        return { sql: `AND affiliation_code = ?`, params: [aff] };
  if (dep)        return { sql: `AND department_code = ?`, params: [dep] };
  return { sql: '', params: [] };
}


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

  // session มี role, role_level, access_scope, can_edit, aff_code ครบแล้ว
  const me = session;

  const url = new URL(request.url);
  const { scopeSQL, scopeParams, scopeMeta, canFilter } = buildScope(me, url);

  // สร้าง scope SQL สำหรับตาราง organizations (ใช้ affiliation_code / department_code)
  const orgScope = buildOrgScope(me, url);

  try {
    const hasOrgTable = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='organizations' LIMIT 1`
    ).first();

    let orgsRes, summaryRow, affiliations, districts;

    if (hasOrgTable) {
      [orgsRes, summaryRow, affiliations, districts] = await Promise.all([

        env.DB.prepare(`
          SELECT
            o.id,
            o.affiliation,
            o.department,
            o.affiliation_code,
            o.department_code,
            o.district,
            o.latitude,
            o.longitude,
            o.doc_no,
            o.updated_at,
            o.created_at,
            (SELECT COUNT(*) FROM users u
             WHERE u.dep_code = o.department_code
               AND u.status = 'Active') AS user_count
          FROM organizations o
          WHERE 1=1 ${orgScope.sql}
          ORDER BY o.affiliation ASC, o.department ASC
        `).bind(...orgScope.params).all(),

        env.DB.prepare(`
          SELECT
            COUNT(*)                                                AS total,
            COUNT(DISTINCT affiliation_code)                        AS total_aff,
            SUM(CASE WHEN latitude IS NOT NULL AND latitude != ''
                     THEN 1 ELSE 0 END)                             AS has_location
          FROM organizations
          WHERE 1=1 ${orgScope.sql}
        `).bind(...orgScope.params).first(),

        env.DB.prepare(`
          SELECT DISTINCT affiliation_code AS aff_code, affiliation
          FROM organizations
          WHERE affiliation_code IS NOT NULL ${orgScope.sql}
          ORDER BY affiliation ASC
        `).bind(...orgScope.params).all(),

        env.DB.prepare(`
          SELECT DISTINCT district
          FROM organizations
          WHERE district IS NOT NULL ${orgScope.sql}
          ORDER BY district ASC
        `).bind(...orgScope.params).all(),
      ]);

    } else {
      // fallback: ดึงจาก users table (ใช้ scopeSQL เดิมได้เลย)
      [orgsRes, summaryRow, affiliations, districts] = await Promise.all([
        env.DB.prepare(`
          SELECT DISTINCT
            u.aff_code  AS affiliation_code,
            u.dep_code  AS department_code,
            u.affiliation,
            u.department,
            NULL AS district, NULL AS latitude, NULL AS longitude,
            NULL AS doc_no,   NULL AS id,
            NULL AS updated_at, NULL AS created_at,
            COUNT(*) AS user_count
          FROM users u
          WHERE 1=1 ${scopeSQL}
          GROUP BY u.aff_code, u.dep_code
          ORDER BY u.affiliation ASC, u.department ASC
        `).bind(...scopeParams).all(),

        env.DB.prepare(`
          SELECT
            COUNT(DISTINCT dep_code)  AS total,
            COUNT(DISTINCT aff_code)  AS total_aff,
            0                          AS has_location
          FROM users WHERE 1=1 ${scopeSQL}
        `).bind(...scopeParams).first(),

        env.DB.prepare(`
          SELECT DISTINCT aff_code, affiliation FROM users
          WHERE aff_code IS NOT NULL ${scopeSQL} ORDER BY affiliation ASC
        `).bind(...scopeParams).all(),

        Promise.resolve({ results: [] }),
      ]);
    }

    return Response.json({
      success: true,
      data: {
        organizations: orgsRes.results ?? [],
        summary: {
          total:       Number(summaryRow?.total      ?? 0),
          total_aff:   Number(summaryRow?.total_aff  ?? 0),
          has_location:Number(summaryRow?.has_location ?? 0),
        },
        affiliations: affiliations.results ?? [],
        districts:    districts.results    ?? [],
        source: hasOrgTable ? 'organizations' : 'users',
      },
      meta: {
        role:     me.role,
        can_edit: !!me.can_edit,
        scope:    me.access_scope,
        aff_code: me.aff_code || null,
        canFilter,
        ...scopeMeta,
      },
    }, { headers: CORS });

  } catch (err) {
    console.error('[dash/organizations GET]', err);
    return Response.json({ success: false, message: 'Internal Server Error' }, { status: 500, headers: CORS });
  }
}