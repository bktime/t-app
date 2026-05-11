// functions/api/user/update.js
// POST /api/user/update — อัปเดตข้อมูลผู้ใช้ (ทุก field ที่แก้ไขได้ ยกเว้น idCard, uuid, social_*)

import { authUser, extractToken } from '../_auth.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const json = (d, s = 200) => Response.json(d, { status: s, headers: corsHeaders });

// map: ชื่อ field ใน body → ชื่อ column ใน DB
const ALLOWED_FIELDS = {
  affiliation:          'affiliation',
  aff_code:             'aff_code',
  department:           'department',
  dep_code:             'dep_code',
  prefix:               'prefix',
  firstName:            'firstName',
  lastName:             'lastName',
  name:                 'name',
  email:                'email',
  position:             'position',
  personnelType:        'personnelType',
  signature:            'signature',
  profileImage:         'profileImage',
  supervisor:           'supervisor',
  supervisor_code:      'supervisor_code',
  approver:             'approver',
  approver_code:        'approver_code',
  payer:                'payer',
  payer_code:           'payer_code',
  ot_doc_number:        'ot_doc_number',
  ot_rate_per_day:      'ot_rate_per_day',
  ot_rate_per_hour:     'ot_rate_per_hour',
  ot_max_hours_per_day: 'ot_max_hours_per_day',
  ot_bank_account:      'ot_bank_account',
};

const REQUIRED_PERSONAL = ['affiliation', 'department', 'prefix', 'firstName', 'lastName', 'position', 'personnelType'];

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== 'POST')   return json({ success: false, message: 'Method not allowed' }, 405);

  const token   = extractToken(request);
  const session = await authUser(env, token);
  if (!session) return json({ success: false, message: 'Unauthorized' }, 401);

  try {
    const body = await request.json();
    const { uuid } = body;

    if (!uuid) return json({ success: false, message: 'Missing uuid' }, 400);

    // ตรวจสอบว่า uuid ตรงกับ session
    if (uuid !== session.uuid) return json({ success: false, message: 'UUID ไม่ตรงกัน' }, 403);

    // ── แปลงค่า OT numeric fields ───────────────────────────────────────────
    if ('ot_rate_per_day' in body)
      body.ot_rate_per_day = (body.ot_rate_per_day !== null && body.ot_rate_per_day !== '')
        ? parseFloat(body.ot_rate_per_day) : null;

    if ('ot_rate_per_hour' in body)
      body.ot_rate_per_hour = (body.ot_rate_per_hour !== null && body.ot_rate_per_hour !== '')
        ? parseFloat(body.ot_rate_per_hour) : null;

    if ('ot_max_hours_per_day' in body)
      body.ot_max_hours_per_day = (body.ot_max_hours_per_day !== null && body.ot_max_hours_per_day !== '')
        ? parseInt(body.ot_max_hours_per_day, 10) : null;

    // Build dynamic SET clause
    const setClauses = [];
    const bindings   = [];

    for (const [field, col] of Object.entries(ALLOWED_FIELDS)) {
      if (field in body) {
        setClauses.push(`${col} = ?`);
        bindings.push(body[field] ?? null);
      }
    }

    if (setClauses.length === 0) {
      return json({ success: false, message: 'ไม่มีข้อมูลที่จะอัปเดต' }, 400);
    }

    // Validate required personal fields
    const isPersonalUpdate = REQUIRED_PERSONAL.some(f => f in body);
    if (isPersonalUpdate) {
      for (const field of REQUIRED_PERSONAL) {
        if (field in body && !String(body[field] || '').trim()) {
          return json({ success: false, message: `กรุณากรอกข้อมูล: ${field}` }, 400);
        }
      }
    }

    setClauses.push('updated_at = CURRENT_TIMESTAMP');
    bindings.push(uuid);

    const existing = await env.DB.prepare('SELECT id FROM users WHERE uuid = ?').bind(uuid).first();
    if (!existing) return json({ success: false, message: 'ไม่พบข้อมูลผู้ใช้' }, 404);

    await env.DB.prepare(
      `UPDATE users SET ${setClauses.join(', ')} WHERE uuid = ?`
    ).bind(...bindings).run();

    const updated = await env.DB.prepare(`
      SELECT uuid, social_id_google, social_id_line, social_id_telegram,
             social_type, name, email, picture, status, role,
             affiliation, aff_code, department, dep_code, prefix, firstName, lastName,
             position, personnelType, signature, profileImage,
             supervisor, supervisor_code, approver, approver_code, payer, payer_code,
             ot_doc_number, ot_rate_per_day, ot_rate_per_hour, ot_max_hours_per_day, ot_bank_account,
             updated_at
      FROM users WHERE uuid = ?
    `).bind(uuid).first();

    return json({ success: true, message: 'บันทึกข้อมูลสำเร็จ', user: updated });

  } catch (err) {
    console.error('[update] error:', err.message, err.stack);
    return json({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message }, 500);
  }
}