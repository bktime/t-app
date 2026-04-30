// functions/api/user/update.js
// POST /api/user/update — อัปเดตข้อมูลผู้ใช้ (ทุก field ที่แก้ไขได้ ยกเว้น idCard, uuid, social_*)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// map: ชื่อ field ใน body → ชื่อ column ใน DB
const ALLOWED_FIELDS = {
  // ข้อมูลส่วนตัว
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
  // ลายเซ็น
  signature:            'signature',
  // รูปภาพ
  profileImage:         'profileImage',
  // ผู้เกี่ยวข้อง
  supervisor:           'supervisor',
  supervisor_code:      'supervisor_code',
  approver:             'approver',
  approver_code:        'approver_code',
  payer:                'payer',
  payer_code:           'payer_code',
  // โอที (OT)
  ot_doc_number:        'ot_doc_number',
  ot_rate_per_day:      'ot_rate_per_day',
  ot_rate_per_hour:     'ot_rate_per_hour',
  ot_max_hours_per_day: 'ot_max_hours_per_day',
  ot_bank_account:      'ot_bank_account',
};

// fields ที่บังคับต้องมีค่าเมื่อส่ง personal info
const REQUIRED_PERSONAL = ['affiliation', 'department', 'prefix', 'firstName', 'lastName', 'position', 'personnelType'];

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== 'POST')   return json({ success: false, message: 'Method not allowed' }, 405);

  try {
    const body = await request.json();
    const { uuid } = body;

    if (!uuid) return json({ success: false, message: 'Missing uuid' }, 400);

    // ── แปลงค่า OT numeric fields ───────────────────────────────────────────
    if ('ot_rate_per_day' in body) {
      body.ot_rate_per_day = (body.ot_rate_per_day !== null && body.ot_rate_per_day !== '')
        ? parseFloat(body.ot_rate_per_day) : null;
    }
    if ('ot_rate_per_hour' in body) {
      body.ot_rate_per_hour = (body.ot_rate_per_hour !== null && body.ot_rate_per_hour !== '')
        ? parseFloat(body.ot_rate_per_hour) : null;
    }
    if ('ot_max_hours_per_day' in body) {
      body.ot_max_hours_per_day = (body.ot_max_hours_per_day !== null && body.ot_max_hours_per_day !== '')
        ? parseInt(body.ot_max_hours_per_day, 10) : null;
    }

    // Build dynamic SET clause — only update fields that are present in body
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

    // Validate required personal fields when personal info is being updated
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

    if (env.DB) {
      const existing = await env.DB.prepare('SELECT id FROM users WHERE uuid = ?').bind(uuid).first();
      if (!existing) return json({ success: false, message: 'ไม่พบข้อมูลผู้ใช้' }, 404);

      await env.DB.prepare(
        `UPDATE users SET ${setClauses.join(', ')} WHERE uuid = ?`
      ).bind(...bindings).run();

      const updated = await env.DB.prepare('SELECT * FROM users WHERE uuid = ?').bind(uuid).first();
      return json({ success: true, message: 'บันทึกข้อมูลสำเร็จ', user: sanitize(updated) });
    }

    // Demo mode (no DB)
    return json({ success: true, message: 'บันทึกข้อมูลสำเร็จ (demo)' });

  } catch (err) {
    console.error('[update] error:', err.message, err.stack);
    return json({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message }, 500);
  }
}

function sanitize(u) {
  if (!u) return null;
  // ไม่ส่ง id (auto increment) และ social_id ดิบกลับ
  const { id, ...safe } = u;
  return safe;
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: corsHeaders });
}