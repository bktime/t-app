// functions/api/dash/filter-options.js
// GET /api/dash/filter-options[?aff=xxx]
//
// คืนค่า dropdown สำหรับ filter bar
//   user       → { canFilter:{aff:false,dep:false}, affiliation:null, departments:null }
//   supervisor → { canFilter:{aff:false,dep:true},  affiliation:{...}, departments:[...] }
//   admin      → { canFilter:{aff:true,dep:true},   affiliations:[...], departments:[...] }
//                 admin ส่ง ?aff=xxx มาเพื่อโหลด dep list ของ aff นั้น

import { authUser, extractToken, unauthorized } from '../_auth.js';

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

  const me = session;

  const url = new URL(request.url);

  try {
    /* ── user ── ดูได้แค่ dep ตัวเอง ไม่มี filter */
    if (me.role === 'user') {
      return Response.json({
        success: true,
        data: {
          canFilter: { aff: false, dep: false },
          affiliation: null,
          departments: null,
        },
        meta: { role: me.role, scope: 'department', dep_code: me.dep_code },
      }, { headers: CORS });
    }

    /* ── supervisor ── เห็น aff ตัวเอง + dep list ใน aff */
    if (me.role === 'supervisor') {
      const deps = await env.DB.prepare(`
        SELECT DISTINCT dep_code, department
        FROM users
        WHERE status = 'Active'
          AND aff_code = ?
          AND dep_code IS NOT NULL
        ORDER BY department ASC
      `).bind(me.aff_code).all();

      return Response.json({
        success: true,
        data: {
          canFilter: { aff: false, dep: true },
          affiliation: { aff_code: me.aff_code, affiliation: me.affiliation },
          departments: deps.results ?? [],
        },
        meta: { role: me.role, scope: 'affiliation', aff_code: me.aff_code },
      }, { headers: CORS });
    }

    /* ── admin ── affiliations ทั้งหมด + dep list ตาม ?aff= */
    const selectedAff = url.searchParams.get('aff') || null;

    const [affiliations, departments] = await Promise.all([
      env.DB.prepare(`
        SELECT DISTINCT aff_code, affiliation
        FROM users
        WHERE status = 'Active'
          AND aff_code IS NOT NULL
        ORDER BY affiliation ASC
      `).all(),

      selectedAff
        ? env.DB.prepare(`
            SELECT DISTINCT dep_code, department
            FROM users
            WHERE status = 'Active'
              AND aff_code = ?
              AND dep_code IS NOT NULL
            ORDER BY department ASC
          `).bind(selectedAff).all()
        : env.DB.prepare(`
            SELECT DISTINCT dep_code, department, aff_code
            FROM users
            WHERE status = 'Active'
              AND dep_code IS NOT NULL
            ORDER BY department ASC
          `).all(),
    ]);

    return Response.json({
      success: true,
      data: {
        canFilter:    { aff: true, dep: true },
        affiliations: affiliations.results ?? [],
        departments:  departments.results  ?? [],
      },
      meta: { role: me.role, scope: 'all', selectedAff },
    }, { headers: CORS });

  } catch (err) {
    console.error('[dash/filter-options]', err);
    return Response.json({ success: false, message: 'Internal Server Error' }, { status: 500, headers: CORS });
  }
}
