// functions/api/dash/users.js
// GET    /api/dash/users                  → list + summary + filter options
// POST   /api/dash/users                  → create user (admin/hr only)
// PUT    /api/dash/users/:uuid            → update user (admin/hr only)
// DELETE /api/dash/users/:uuid            → delete user (admin only)

import { authUser, extractToken, unauthorized } from '../_auth.js';
import { buildScope, getMe, scopedUUIDsSQL } from './_scope.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    },
  });
}

/* ──────────────────────────────────────
 * GET /api/dash/users
 * คืนรายชื่อผู้ใช้ตาม scope + KPI summary + dropdown options
 * ────────────────────────────────────── */
export async function onRequestGet({ request, env }) {
  const token = extractToken(request);
  const session = await authUser(env, token);
  if (!session) return unauthorized(CORS);

  const me = await getMe(env, session.uuid);
  if (!me) return unauthorized(CORS);

  const url = new URL(request.url);
  const { scopeSQL, scopeParams, scopeMeta, canFilter } = buildScope(me, url);

  try {
    const [usersRes, summaryRow, affiliations, departments] = await Promise.all([

      // รายชื่อ user ตาม scope
      env.DB.prepare(`
        SELECT
*
        FROM users u
        WHERE 1=1
          ${scopeSQL}
        ORDER BY u.firstName ASC, u.lastName ASC
      `).bind(...scopeParams).all(),

      // summary counts ตาม scope
      env.DB.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'Active'    THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN status = 'Inactive'  THEN 1 ELSE 0 END) AS inactive,
          SUM(CASE WHEN status = 'Suspended' THEN 1 ELSE 0 END) AS suspended,
          SUM(CASE WHEN strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now') THEN 1 ELSE 0 END) AS new_this_month
        FROM users
        WHERE 1=1
          ${scopeSQL}
      `).bind(...scopeParams).first(),

      // aff dropdown ตาม scope
      env.DB.prepare(`
        SELECT DISTINCT aff_code, affiliation
        FROM users
        WHERE status = 'Active'
          AND aff_code IS NOT NULL
          ${scopeSQL}
        ORDER BY affiliation ASC
      `).bind(...scopeParams).all(),

      // dep dropdown ตาม scope
      env.DB.prepare(`
        SELECT DISTINCT dep_code, department, aff_code
        FROM users
        WHERE status = 'Active'
          AND dep_code IS NOT NULL
          ${scopeSQL}
        ORDER BY department ASC
      `).bind(...scopeParams).all(),
    ]);

    return Response.json({
      success: true,
      data: {
        users:        usersRes.results ?? [],
        summary: {
          total:          Number(summaryRow?.total          ?? 0),
          active:         Number(summaryRow?.active         ?? 0),
          inactive:       Number(summaryRow?.inactive       ?? 0),
          suspended:      Number(summaryRow?.suspended      ?? 0),
          new_this_month: Number(summaryRow?.new_this_month ?? 0),
        },
        affiliations: affiliations.results ?? [],
        departments:  departments.results  ?? [],
      },
      meta: {
        role:     me.role,
        can_edit: me.can_edit,
        canFilter,
        ...scopeMeta,
      },
    }, { headers: CORS });

  } catch (err) {
    console.error('[dash/users GET]', err);
    return Response.json({ success: false, message: 'Internal Server Error' }, { status: 500, headers: CORS });
  }
}

/* ──────────────────────────────────────
 * POST /api/dash/users   → create user
 * ────────────────────────────────────── */
export async function onRequestPost({ request, env }) {
  const token = extractToken(request);
  const session = await authUser(env, token);
  if (!session) return unauthorized(CORS);

  const me = await getMe(env, session.uuid);
  if (!me || !me.can_edit) {
    return Response.json({ success: false, message: 'Permission denied' }, { status: 403, headers: CORS });
  }

  // admin เท่านั้นที่สร้าง admin ได้
  const isAdmin = ['admin'].includes(me.role);

  let body;
  try { body = await request.json(); } catch {
    return Response.json({ success: false, message: 'Invalid JSON' }, { status: 400, headers: CORS });
  }

  const { firstName, lastName, email, password, role, status,
          phone, emp_id, position, aff_code, dep_code, department, affiliation } = body;

  // Validation
  if (!firstName?.trim() || !lastName?.trim() || !email?.trim() || !password || !role) {
    return Response.json({ success: false, message: 'firstName, lastName, email, password, role จำเป็น' }, { status: 400, headers: CORS });
  }
  if (role === 'admin' && !isAdmin) {
    return Response.json({ success: false, message: 'เฉพาะ Admin เท่านั้นที่สร้าง Admin ได้' }, { status: 403, headers: CORS });
  }
  if (password.length < 8) {
    return Response.json({ success: false, message: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' }, { status: 400, headers: CORS });
  }

  try {
    // ตรวจ email ซ้ำ
    const dup = await env.DB.prepare('SELECT uuid FROM users WHERE email = ? LIMIT 1').bind(email.trim().toLowerCase()).first();
    if (dup) return Response.json({ success: false, message: 'อีเมลนี้มีในระบบแล้ว' }, { status: 409, headers: CORS });

    // Hash password
    const hashed = await hashPassword(password);

    // resolve department / affiliation name จาก code ถ้าไม่ส่งมา
    let depName = department || null;
    let affName = affiliation || null;
    if (dep_code && !depName) {
      const r = await env.DB.prepare('SELECT department FROM users WHERE dep_code=? AND department IS NOT NULL LIMIT 1').bind(dep_code).first();
      depName = r?.department || null;
    }
    if (aff_code && !affName) {
      const r = await env.DB.prepare('SELECT affiliation FROM users WHERE aff_code=? AND affiliation IS NOT NULL LIMIT 1').bind(aff_code).first();
      affName = r?.affiliation || null;
    }

    const uuid = crypto.randomUUID();
    const now  = new Date().toISOString();

    await env.DB.prepare(`
      INSERT INTO users
        (uuid, firstName, lastName, email, password, phone, emp_id, role, status,
         position, dep_code, aff_code, department, affiliation, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      uuid, firstName.trim(), lastName.trim(),
      email.trim().toLowerCase(), hashed,
      phone?.trim() || null, emp_id?.trim() || null,
      role, status || 'Active',
      position?.trim() || null,
      dep_code || null, aff_code || null,
      depName, affName,
      now, now
    ).run();

    return Response.json({ success: true, data: { uuid }, message: 'สร้างผู้ใช้งานสำเร็จ' }, { status: 201, headers: CORS });

  } catch (err) {
    console.error('[dash/users POST]', err);
    return Response.json({ success: false, message: 'Internal Server Error' }, { status: 500, headers: CORS });
  }
}

/* ──────────────────────────────────────
 * PUT /api/dash/users/:uuid  → update
 * ────────────────────────────────────── */
export async function onRequestPut({ request, env, params }) {
  const token = extractToken(request);
  const session = await authUser(env, token);
  if (!session) return unauthorized(CORS);

  const me = await getMe(env, session.uuid);
  if (!me || !me.can_edit) {
    return Response.json({ success: false, message: 'Permission denied' }, { status: 403, headers: CORS });
  }

  // ดึง uuid จาก URL path  /api/dash/users/:uuid
  const targetUUID = params?.uuid || new URL(request.url).pathname.split('/').pop();
  if (!targetUUID || targetUUID === 'users') {
    return Response.json({ success: false, message: 'ระบุ UUID' }, { status: 400, headers: CORS });
  }

  let body;
  try { body = await request.json(); } catch {
    return Response.json({ success: false, message: 'Invalid JSON' }, { status: 400, headers: CORS });
  }

  const { firstName, lastName, email, password, role, status,
          phone, emp_id, position, aff_code, dep_code, department, affiliation } = body;

  if (!firstName?.trim() || !lastName?.trim() || !email?.trim() || !role) {
    return Response.json({ success: false, message: 'firstName, lastName, email, role จำเป็น' }, { status: 400, headers: CORS });
  }
  if (role === 'admin' && me.role !== 'admin') {
    return Response.json({ success: false, message: 'เฉพาะ Admin เท่านั้นที่กำหนด role Admin ได้' }, { status: 403, headers: CORS });
  }

  try {
    // ตรวจ user มี
    const target = await env.DB.prepare('SELECT uuid FROM users WHERE uuid=? LIMIT 1').bind(targetUUID).first();
    if (!target) return Response.json({ success: false, message: 'ไม่พบผู้ใช้งาน' }, { status: 404, headers: CORS });

    // ตรวจ email ซ้ำ (ยกเว้นตัวเอง)
    const dup = await env.DB.prepare('SELECT uuid FROM users WHERE email=? AND uuid<>? LIMIT 1').bind(email.trim().toLowerCase(), targetUUID).first();
    if (dup) return Response.json({ success: false, message: 'อีเมลนี้มีในระบบแล้ว' }, { status: 409, headers: CORS });

    let depName = department || null;
    let affName = affiliation || null;
    if (dep_code && !depName) {
      const r = await env.DB.prepare('SELECT department FROM users WHERE dep_code=? AND department IS NOT NULL LIMIT 1').bind(dep_code).first();
      depName = r?.department || null;
    }
    if (aff_code && !affName) {
      const r = await env.DB.prepare('SELECT affiliation FROM users WHERE aff_code=? AND affiliation IS NOT NULL LIMIT 1').bind(aff_code).first();
      affName = r?.affiliation || null;
    }

    const now = new Date().toISOString();

    if (password) {
      if (password.length < 8) return Response.json({ success: false, message: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' }, { status: 400, headers: CORS });
      const hashed = await hashPassword(password);
      await env.DB.prepare(`
        UPDATE users SET
          firstName=?, lastName=?, email=?, password=?, phone=?, emp_id=?,
          role=?, status=?, position=?,
          dep_code=?, aff_code=?, department=?, affiliation=?,
          updated_at=?
        WHERE uuid=?
      `).bind(
        firstName.trim(), lastName.trim(), email.trim().toLowerCase(), hashed,
        phone?.trim()||null, emp_id?.trim()||null,
        role, status||'Active', position?.trim()||null,
        dep_code||null, aff_code||null, depName, affName,
        now, targetUUID
      ).run();
    } else {
      await env.DB.prepare(`
        UPDATE users SET
          firstName=?, lastName=?, email=?, phone=?, emp_id=?,
          role=?, status=?, position=?,
          dep_code=?, aff_code=?, department=?, affiliation=?,
          updated_at=?
        WHERE uuid=?
      `).bind(
        firstName.trim(), lastName.trim(), email.trim().toLowerCase(),
        phone?.trim()||null, emp_id?.trim()||null,
        role, status||'Active', position?.trim()||null,
        dep_code||null, aff_code||null, depName, affName,
        now, targetUUID
      ).run();
    }

    return Response.json({ success: true, message: 'อัปเดตผู้ใช้งานสำเร็จ' }, { headers: CORS });

  } catch (err) {
    console.error('[dash/users PUT]', err);
    return Response.json({ success: false, message: 'Internal Server Error' }, { status: 500, headers: CORS });
  }
}

/* ──────────────────────────────────────
 * DELETE /api/dash/users/:uuid
 * admin เท่านั้น
 * ────────────────────────────────────── */
export async function onRequestDelete({ request, env, params }) {
  const token = extractToken(request);
  const session = await authUser(env, token);
  if (!session) return unauthorized(CORS);

  const me = await getMe(env, session.uuid);
  if (!me || me.role !== 'admin') {
    return Response.json({ success: false, message: 'เฉพาะ Admin เท่านั้นที่ลบผู้ใช้งานได้' }, { status: 403, headers: CORS });
  }

  const targetUUID = params?.uuid || new URL(request.url).pathname.split('/').pop();
  if (!targetUUID || targetUUID === 'users') {
    return Response.json({ success: false, message: 'ระบุ UUID' }, { status: 400, headers: CORS });
  }

  // ห้ามลบตัวเอง
  if (targetUUID === session.uuid) {
    return Response.json({ success: false, message: 'ไม่สามารถลบบัญชีของตัวเองได้' }, { status: 400, headers: CORS });
  }

  try {
    const target = await env.DB.prepare('SELECT uuid, role FROM users WHERE uuid=? LIMIT 1').bind(targetUUID).first();
    if (!target) return Response.json({ success: false, message: 'ไม่พบผู้ใช้งาน' }, { status: 404, headers: CORS });

    // Soft delete → set status = 'Inactive'
    // เปลี่ยนเป็น hard delete ได้ถ้าต้องการ: DELETE FROM users WHERE uuid=?
    await env.DB.prepare(`
      UPDATE users SET status='Inactive', updated_at=? WHERE uuid=?
    `).bind(new Date().toISOString(), targetUUID).run();

    return Response.json({ success: true, message: 'ลบผู้ใช้งานสำเร็จ (soft delete)' }, { headers: CORS });

  } catch (err) {
    console.error('[dash/users DELETE]', err);
    return Response.json({ success: false, message: 'Internal Server Error' }, { status: 500, headers: CORS });
  }
}

/* ──────────────────────────────────────
 * Helpers
 * ────────────────────────────────────── */

/**
 * hashPassword  — bcrypt-style ด้วย Web Crypto (PBKDF2-SHA256)
 * format: pbkdf2$iterations$salt$hash (hex)
 */
async function hashPassword(plain, iterations = 310_000) {
  const salt   = crypto.getRandomValues(new Uint8Array(16));
  const keyMat = await crypto.subtle.importKey('raw', new TextEncoder().encode(plain), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits(
    { name:'PBKDF2', hash:'SHA-256', salt, iterations },
    keyMat, 256
  );
  const toHex = buf => [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
  return `pbkdf2$${iterations}$${toHex(salt.buffer)}$${toHex(derived)}`;
}