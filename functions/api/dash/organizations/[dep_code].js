// functions/api/dash/organizations/[dep_code].js
// PUT /api/dash/organizations/:dep_code
//
// แก้ไขได้: affiliation, department, district, latitude, longitude, doc_no
// ห้ามแก้:  affiliation_code, department_code

import { authUser, extractToken, unauthorized } from '../../_auth.js';
import { writeAuditLog, diffFields } from '../_audit.js';

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

  // session มี can_edit, access_scope, aff_code ครบแล้ว
  const me = session;

  if (!me.can_edit) {
    return Response.json({ success: false, message: 'Permission denied' }, { status: 403, headers: CORS });
  }

  const dep_code = params?.dep_code;
  if (!dep_code) {
    return Response.json({ success: false, message: 'ระบุ department_code' }, { status: 400, headers: CORS });
  }

  let body;
  try { body = await request.json(); }
  catch { return Response.json({ success: false, message: 'Invalid JSON' }, { status: 400, headers: CORS }); }

  const { affiliation, department, district, latitude, longitude, doc_no } = body;

  if (!affiliation?.trim()) {
    return Response.json({ success: false, message: 'affiliation จำเป็น' }, { status: 400, headers: CORS });
  }
  if (!department?.trim()) {
    return Response.json({ success: false, message: 'department จำเป็น' }, { status: 400, headers: CORS });
  }

  try {
    const before = await env.DB.prepare(
      `SELECT * FROM organizations WHERE department_code=? LIMIT 1`
    ).bind(dep_code).first();

    if (!before) {
      return Response.json({ success: false, message: 'ไม่พบหน่วยงาน' }, { status: 404, headers: CORS });
    }

    /* ── ตรวจ scope: หน่วยงานต้องอยู่ใน access_scope ของ actor ── */
    const scope = me.access_scope;
    if (scope === 'ตนเอง') {
      // user ธรรมดาไม่มีสิทธิ์แก้ไขหน่วยงาน (can_edit=0 อยู่แล้ว แต่กัน double)
      return Response.json({ success: false, message: 'Permission denied' }, { status: 403, headers: CORS });
    }
    if (scope === 'หน่วยงาน') {
      // แก้ได้เฉพาะ dep ใน aff ตัวเอง
      if (before.affiliation_code !== me.aff_code) {
        return Response.json(
          { success: false, message: 'ไม่มีสิทธิ์แก้ไขหน่วยงานนอก affiliation ของคุณ' },
          { status: 403, headers: CORS }
        );
      }
    }
    if (scope === 'สังกัด') {
      // แก้ได้เฉพาะ dep ใน aff ตัวเอง (เช่น hr/it/finance ของ สสจ.)
      if (before.affiliation_code !== me.aff_code) {
        return Response.json(
          { success: false, message: 'ไม่มีสิทธิ์แก้ไขหน่วยงานนอกสังกัดของคุณ' },
          { status: 403, headers: CORS }
        );
      }
    }
    // scope === 'ทั้งหมด' → admin/ceo → ผ่านได้ทุก org

    const now = new Date().toISOString();
    const lat = latitude  != null && latitude  !== '' ? Number(latitude)  : null;
    const lng = longitude != null && longitude !== '' ? Number(longitude) : null;

    await env.DB.prepare(`
      UPDATE organizations SET
        affiliation=?, department=?,
        district=?, latitude=?, longitude=?,
        doc_no=?, updated_at=?
      WHERE department_code=?
    `).bind(
      affiliation.trim(), department.trim(),
      district?.trim() || null, lat, lng,
      doc_no?.trim() || null, now,
      dep_code,
    ).run();

    // sync ชื่อ affiliation / department ใน users table ด้วย
    await env.DB.prepare(`
      UPDATE users SET
        affiliation=?, department=?, updated_at=?
      WHERE aff_code=? AND dep_code=?
    `).bind(affiliation.trim(), department.trim(), now, before.affiliation_code, dep_code).run();

    // audit log
    const changes = diffFields(before, {
      affiliation: affiliation.trim(),
      department:  department.trim(),
      district:    district?.trim() || null,
      latitude:    lat,
      longitude:   lng,
      doc_no:      doc_no?.trim() || null,
    }, ['affiliation','department','district','latitude','longitude','doc_no']);

    writeAuditLog(
      env, request,
      { uuid: me.uuid, name: me.name || me.role, role: me.role },
      'org.update',
      { uuid: dep_code, name: `${before.affiliation} › ${before.department}` },
      changes,
    );

    return Response.json({ success: true, message: 'อัปเดตหน่วยงานสำเร็จ' }, { headers: CORS });

  } catch (err) {
    console.error('[dash/organizations PUT]', err);
    return Response.json({ success: false, message: 'Internal Server Error' }, { status: 500, headers: CORS });
  }
}