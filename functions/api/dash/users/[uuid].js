// functions/api/dash/users/[uuid].js
// PUT /api/dash/users/:uuid  → update user (can_edit) + audit log
//
// วางที่: functions/api/dash/users/[uuid].js
// URL:    PUT /api/dash/users/<uuid>
//
// Cloudflare Pages Functions ใช้ [param] สำหรับ dynamic segment
// context.params.uuid จะมีค่า uuid ที่ส่งมาใน URL

import { authUser, extractToken, unauthorized } from '../../_auth.js';
import { diffFields, writeAuditLog } from '../_audit.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS,
      'Access-Control-Allow-Methods': 'PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    },
  });
}

export async function onRequestPut({ request, env, params }) {
  const token = extractToken(request);
  const session = await authUser(env, token);
  if (!session) return unauthorized(CORS);

  const me = session; // session มี can_edit, role, role_level, aff_code ครบ

  if (!me.can_edit) {
    return Response.json(
      { success: false, message: 'Permission denied' },
      { status: 403, headers: CORS }
    );
  }

  // params.uuid มาจาก [uuid].js dynamic segment
  const targetUUID = params?.uuid;
  if (!targetUUID) {
    return Response.json(
      { success: false, message: 'ระบุ UUID' },
      { status: 400, headers: CORS }
    );
  }

  let body;
  try { body = await request.json(); }
  catch {
    return Response.json(
      { success: false, message: 'Invalid JSON body' },
      { status: 400, headers: CORS }
    );
  }

  const {
    prefix, firstName, lastName, email, idCard,
    role, status, position, personnelType,
    aff_code, dep_code,
    supervisor_code, approver_code, payer_code,
    ot_rate_per_day, ot_rate_per_hour, ot_max_hours_per_day,
  } = body;

  /* ── Validation ── */
  const missing = [];
  if (!prefix?.trim())        missing.push('prefix');
  if (!firstName?.trim())     missing.push('firstName');
  if (!lastName?.trim())      missing.push('lastName');
  if (!role?.trim())          missing.push('role');
  if (!position?.trim())      missing.push('position');
  if (!personnelType?.trim()) missing.push('personnelType');
  if (!aff_code?.trim())      missing.push('aff_code');
  if (!dep_code?.trim())      missing.push('dep_code');
  if (missing.length) {
    return Response.json(
      { success: false, message: `จำเป็น: ${missing.join(', ')}` },
      { status: 400, headers: CORS }
    );
  }
  try {
    /* ── โหลด role level ของ actor (me) และ target ── */
    const [myRoleRow, targetRoleRow, newRoleRow] = await Promise.all([
      // level ของ actor
      env.DB.prepare('SELECT level FROM roles WHERE role=? LIMIT 1').bind(me.role).first(),
      // record เดิมของ target (รวม role เดิม)
      env.DB.prepare(`
        SELECT u.uuid, u.firstName, u.lastName, u.email, u.role, u.status,
               u.position, u.personnelType,
               u.aff_code, u.dep_code, u.affiliation, u.department,
               u.supervisor_code, u.approver_code, u.payer_code,
               u.ot_rate_per_day, u.ot_rate_per_hour, u.ot_max_hours_per_day, u.idCard,
               r.level AS role_level
        FROM users u
        LEFT JOIN roles r ON r.role = u.role
        WHERE u.uuid=? LIMIT 1
      `).bind(targetUUID).first(),
      // level ของ role ใหม่ที่ต้องการกำหนด
      env.DB.prepare('SELECT level FROM roles WHERE role=? LIMIT 1').bind(role).first(),
    ]);

    const before = targetRoleRow;

    if (!before) {
      return Response.json(
        { success: false, message: 'ไม่พบผู้ใช้งาน' },
        { status: 404, headers: CORS }
      );
    }

    const myLevel     = Number(myRoleRow?.level  ?? 0);
    const targetLevel = Number(before.role_level ?? 0);
    const newLevel    = Number(newRoleRow?.level  ?? 0);

    /* ── กฎ: ห้ามแก้ไข user ที่มี level > ตนเอง (ยกเว้นแก้ตัวเอง) ── */
    if (targetUUID !== me.uuid && targetLevel > myLevel) {
      return Response.json(
        { success: false, message: `ไม่มีสิทธิ์แก้ไข: ระดับของผู้ใช้ (${before.role}) สูงกว่าของคุณ` },
        { status: 403, headers: CORS }
      );
    }

    /* ── กฎ: ห้ามกำหนด role ที่มี level > ตนเอง ── */
    if (newLevel > myLevel) {
      return Response.json(
        { success: false, message: `ไม่มีสิทธิ์กำหนด role "${role}": ระดับสูงกว่าของคุณ` },
        { status: 403, headers: CORS }
      );
    }

    /* ── ตรวจซ้ำ email ── */
    if (email?.trim()) {
      const dup = await env.DB.prepare(
        'SELECT uuid FROM users WHERE email=? AND uuid<>? LIMIT 1'
      ).bind(email.trim().toLowerCase(), targetUUID).first();
      if (dup) {
        return Response.json(
          { success: false, message: 'อีเมลนี้มีในระบบแล้ว' },
          { status: 409, headers: CORS }
        );
      }
    }

    /* ── resolve affiliation / department name ── */
    const affRow = await env.DB.prepare(
      'SELECT affiliation FROM users WHERE aff_code=? AND affiliation IS NOT NULL LIMIT 1'
    ).bind(aff_code).first();
    const depRow = await env.DB.prepare(
      'SELECT department FROM users WHERE dep_code=? AND department IS NOT NULL LIMIT 1'
    ).bind(dep_code).first();
    const affName = affRow?.affiliation ?? aff_code;
    const depName = depRow?.department  ?? dep_code;

    /* ── resolve supervisor / approver / payer name ── */
    const resolveName = async (uuid) => {
      if (!uuid) return null;
      const r = await env.DB.prepare(
        `SELECT firstName||' '||lastName AS n FROM users WHERE uuid=? LIMIT 1`
      ).bind(uuid).first();
      return r?.n ?? null;
    };
    const [supervisorName, approverName, payerName] = await Promise.all([
      resolveName(supervisor_code || null),
      resolveName(approver_code   || null),
      resolveName(payer_code      || null),
    ]);

    const now         = new Date().toISOString();
    const finalIdCard = idCard?.trim() || before.idCard || '';

    /* ── UPDATE ── */
    await env.DB.prepare(`
      UPDATE users SET
        prefix=?, firstName=?, lastName=?, name=?,
        email=?, idCard=?,
        role=?, status=?, position=?, personnelType=?,
        aff_code=?, dep_code=?, affiliation=?, department=?,
        supervisor=?, supervisor_code=?,
        approver=?,   approver_code=?,
        payer=?,      payer_code=?,
        ot_rate_per_day=?, ot_rate_per_hour=?, ot_max_hours_per_day=?,
        updated_at=?
      WHERE uuid=?
    `).bind(
      prefix.trim(),
      firstName.trim(),
      lastName.trim(),
      `${firstName.trim()} ${lastName.trim()}`,
      email?.trim().toLowerCase() || null,
      finalIdCard,
      role, status || 'Active',
      position.trim(), personnelType.trim(),
      aff_code, dep_code, affName, depName,
      supervisorName, supervisor_code || null,
      approverName,   approver_code   || null,
      payerName,      payer_code      || null,
      ot_rate_per_day      != null ? Number(ot_rate_per_day)      : null,
      ot_rate_per_hour     != null ? Number(ot_rate_per_hour)     : null,
      ot_max_hours_per_day != null ? Number(ot_max_hours_per_day) : null,
      now,
      targetUUID,
    ).run();

    /* ══════════════════════════════════════════
     * AUDIT LOG
     * ══════════════════════════════════════════ */
    const afterSnap = {
      role, status,
      position:      position.trim(),
      personnelType: personnelType.trim(),
      aff_code, dep_code,
      supervisor_code: supervisor_code || null,
      approver_code:   approver_code   || null,
      payer_code:      payer_code      || null,
      ot_rate_per_day:      ot_rate_per_day      != null ? Number(ot_rate_per_day)      : null,
      ot_rate_per_hour:     ot_rate_per_hour     != null ? Number(ot_rate_per_hour)     : null,
      ot_max_hours_per_day: ot_max_hours_per_day != null ? Number(ot_max_hours_per_day) : null,
      email:     email?.trim().toLowerCase() || null,
      firstName: firstName.trim(),
      lastName:  lastName.trim(),
      prefix:    prefix.trim(),
    };

    const WATCH = [
      'role', 'status',
      'position', 'personnelType',
      'aff_code', 'dep_code',
      'supervisor_code', 'approver_code', 'payer_code',
      'ot_rate_per_day', 'ot_rate_per_hour', 'ot_max_hours_per_day',
      'email', 'firstName', 'lastName', 'prefix',
    ];

    const changes = diffFields(before, afterSnap, WATCH);

    let action = 'user.update';
    const changedKeys = Object.keys(changes);
    if (changedKeys.length === 1 && changedKeys[0] === 'role')   action = 'user.role';
    if (changedKeys.length === 1 && changedKeys[0] === 'status') action = 'user.status';
    if (changedKeys.length > 0 &&
        changedKeys.every(k => ['supervisor_code','approver_code','payer_code'].includes(k))) {
      action = 'user.chain';
    }

    const actorName  = me.name || me.role;
    const targetName = `${before.firstName || ''} ${before.lastName || ''}`.trim();

    // fire-and-forget — ไม่บล็อก response
    writeAuditLog(
      env, request,
      { uuid: me.uuid, name: actorName, role: me.role },
      action,
      { uuid: targetUUID, name: targetName },
      changes,
    );
    /* ══════════════════════════════════════════ */

    return Response.json(
      { success: true, message: 'อัปเดตผู้ใช้งานสำเร็จ' },
      { headers: CORS }
    );

  } catch (err) {
    console.error('[dash/users/[uuid] PUT]', err);
    return Response.json(
      { success: false, message: 'Internal Server Error' },
      { status: 500, headers: CORS }
    );
  }
}