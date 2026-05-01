// functions/api/attendance/supervisor-review.js
// PATCH /api/attendance/supervisor-review
// Body: { uuid, date, action: 'approve'|'reject', supervisor_note }
// Supervisor รับรอง/ไม่รับรอง การลงเวลาของพนักงาน

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const json = (d, s = 200) => Response.json(d, { status: s, headers: CORS });

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (request.method !== 'PATCH')   return json({ success: false, message: 'Method not allowed' }, 405);

  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return json({ success: false, message: 'กรุณาเข้าสู่ระบบ' }, 401);

  const reviewer = await env.DB.prepare(
    `SELECT uuid, role, dep_code, aff_code, name, firstName, lastName, prefix
     FROM users WHERE auth_token = ? AND token_expires_at > CURRENT_TIMESTAMP AND status = 'Active'`
  ).bind(auth.slice(7)).first();
  if (!reviewer) return json({ success: false, message: 'Token ไม่ถูกต้องหรือหมดอายุ' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ success: false, message: 'Invalid JSON' }, 400); }

  const { uuid, date, action, supervisor_note } = body;
  if (!uuid || !date || !action)
    return json({ success: false, message: 'ขาด uuid, date หรือ action' }, 400);
  if (!['approve', 'reject'].includes(action))
    return json({ success: false, message: 'action ต้องเป็น approve หรือ reject' }, 400);

  // โหลด attendance row
  const attRow = await env.DB.prepare(
    `SELECT a.*, u.dep_code, u.aff_code
     FROM attendance a LEFT JOIN users u ON u.uuid = a.uuid
     WHERE a.uuid = ? AND a.date = ? LIMIT 1`
  ).bind(uuid, date).first();

  if (!attRow) return json({ success: false, message: 'ไม่พบข้อมูลการลงเวลา' }, 404);

  // ตรวจสิทธิ์
if (attRow.approver_uuid !== reviewer.uuid)
  return json({ success: false, message: 'ไม่มีสิทธิ์รับรองรายการนี้ ผู้มีสิทธิ์คือ ' + attRow.supervisor_name }, 403);

  if (attRow.supervisor_status !== 'pending')
    return json({ success: false, message: `ดำเนินการไปแล้ว (${attRow.supervisor_status})` }, 409);

  const newStatus  = action === 'approve' ? 'approved' : 'rejected';
  const revName    = reviewer.name ||
    `${reviewer.prefix||''}${reviewer.firstName||''} ${reviewer.lastName||''}`.trim();

  try {
    await env.DB.prepare(`
      UPDATE attendance SET
        supervisor_status = ?,
        supervisor_note   = ?,
        reviewed_at       = CURRENT_TIMESTAMP,
        updated_at        = CURRENT_TIMESTAMP
      WHERE uuid = ? AND date = ?
    `).bind(newStatus, supervisor_note || null, uuid, date).run();

    return json({
      success: true,
      message:  action === 'approve' ? 'รับรองการลงเวลาสำเร็จ' : 'บันทึกการไม่รับรองสำเร็จ',
      data: {
        uuid, date,
        supervisor_status: newStatus,
        reviewed_by:       revName,
        supervisor_note:   supervisor_note || null,
      },
    });
  } catch (err) {
    return json({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message }, 500);
  }
}