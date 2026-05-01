// functions/api/attendance/supervisor-pending.js
// GET /api/attendance/supervisor-pending?limit=50&offset=0&date_from=&date_to=
// ดึง attendance rows ที่ approver_uuid = ตัวเอง และ supervisor_status = 'pending'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const json = (d, s = 200) => Response.json(d, { status: s, headers: CORS });

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (request.method !== 'GET')     return json({ success: false, message: 'Method not allowed' }, 405);

  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return json({ success: false, message: 'กรุณาเข้าสู่ระบบ' }, 401);

  const reviewer = await env.DB.prepare(
    `SELECT uuid, role, dep_code, aff_code, name
     FROM users WHERE auth_token = ? AND token_expires_at > CURRENT_TIMESTAMP AND status = 'Active'`
  ).bind(auth.slice(7)).first();
  if (!reviewer) return json({ success: false, message: 'Token ไม่ถูกต้องหรือหมดอายุ' }, 401);

  const url       = new URL(request.url);
  const limit     = Math.min(parseInt(url.searchParams.get('limit')  || '50'), 200);
  const offset    = parseInt(url.searchParams.get('offset') || '0');
  const date_from = url.searchParams.get('date_from') || '';
  const date_to   = url.searchParams.get('date_to')   || '';
  const status    = url.searchParams.get('status')    || 'pending'; // pending|approved|rejected|all

  const cond = [], bind = [];

  // กรองตาม role
cond.push('a.approver_uuid = ?');
bind.push(reviewer.uuid);

  cond.push('a.checkin_time IS NOT NULL');

  if (status !== 'all') { cond.push('a.supervisor_status = ?'); bind.push(status); }
  if (date_from)        { cond.push('a.date >= ?');             bind.push(date_from); }
  if (date_to)          { cond.push('a.date <= ?');             bind.push(date_to); }

  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';

  try {
    const countRow = await env.DB.prepare(
      `SELECT COUNT(*) as total FROM attendance a LEFT JOIN users u ON u.uuid = a.uuid ${where}`
    ).bind(...bind).first();

    const rows = await env.DB.prepare(`
      SELECT
        a.id, a.uuid, a.date,
        a.checkin_time,  a.checkin_work_type, a.checkin_note,
        a.checkin_latitude, a.checkin_longitude,
        a.checkin_distance_m, a.checkin_in_range,
        a.checkin_reference,
        a.checkout_time, a.checkout_type, a.checkout_work_type,
        a.request_ref, a.request_type, a.request_reason, a.request_at,
        a.approver_uuid, a.supervisor_name,
        a.supervisor_status, a.supervisor_note, a.reviewed_at,
        a.created_at,
        u.name, u.firstName, u.lastName, u.prefix,
        u.picture, u.profileImage,
        u.position, u.personnelType, u.dep_code, u.affiliation
      FROM attendance a
      LEFT JOIN users u ON u.uuid = a.uuid
      ${where} 
      ORDER BY
        CASE a.supervisor_status WHEN 'pending' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END,
        a.date DESC
      LIMIT ? OFFSET ?
    `).bind(...bind, limit, offset).all();

    return json({
      success: true,
      total:   countRow?.total || 0,
      limit, offset,
      data:    rows.results || [],
    });
  } catch (err) {
    return json({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message }, 500);
  }
}