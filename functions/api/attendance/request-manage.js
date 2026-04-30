// functions/api/attendance/request-manage.js
// GET  /api/attendance/request-manage?status=pending&limit=50&offset=0&search=
// PATCH /api/attendance/request-manage  {reference, action:'approve'|'reject', reviewer_note}
//
// เพิ่ม: เมื่อ approve/reject → อัปเดต supervisor_status ในตาราง attendance ด้วย

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const json = (d, s = 200) => Response.json(d, { status: s, headers: CORS });

async function getReviewer(env, token) {
  return env.DB.prepare(
    `SELECT uuid, role, dep_code, aff_code, name, firstName, lastName, prefix
     FROM users
     WHERE auth_token = ? AND token_expires_at > CURRENT_TIMESTAMP AND status = 'Active'`
  ).bind(token).first();
}

function canReview(reviewer) {
  return ['admin', 'supervisor', 'approver'].includes(reviewer?.role);
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return json({ success: false, message: 'กรุณาเข้าสู่ระบบ' }, 401);
  const reviewer = await getReviewer(env, auth.slice(7));
  if (!reviewer) return json({ success: false, message: 'Token ไม่ถูกต้องหรือหมดอายุ' }, 401);

  // ── GET ─────────────────────────────────────────────────────────────────
  if (request.method === 'GET') {
    const url      = new URL(request.url);
    const status   = url.searchParams.get('status') || 'all';
    const limit    = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
    const offset   = parseInt(url.searchParams.get('offset') || '0');
    const search   = (url.searchParams.get('search') || '').trim();
    const dep_code = url.searchParams.get('dep_code') || '';

    const cond = [], bind = [];

    if (status !== 'all') { cond.push('r.status = ?'); bind.push(status); }

    if (reviewer.role === 'admin') {
      if (dep_code) { cond.push('u.dep_code = ?'); bind.push(dep_code); }
    } else if (canReview(reviewer)) {
      cond.push('(r.approver_uuid = ? OR u.dep_code = ? OR u.aff_code = ?)');
      bind.push(reviewer.uuid, reviewer.dep_code || '', reviewer.aff_code || '');
    } else {
      cond.push('r.approver_uuid = ?');
      bind.push(reviewer.uuid);
    }

    if (search) {
      cond.push('(r.name LIKE ? OR r.reference LIKE ? OR r.request_type LIKE ? OR r.department LIKE ?)');
      const q = `%${search}%`; bind.push(q, q, q, q);
    }

    const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';

    try {
      const countRow = await env.DB.prepare(
        `SELECT COUNT(*) as total FROM attendance_requests r
         LEFT JOIN users u ON u.uuid = r.uuid ${where}`
      ).bind(...bind).first();

      const rows = await env.DB.prepare(`
        SELECT r.id, r.uuid, r.approver_uuid, r.reference, r.request_type,
               r.req_date, r.req_time, r.reason,
               r.name, r.department, r.supervisor_name,
               r.status, r.submitted_at, r.reviewed_at, r.reviewer_note,
               u.profileImage, u.picture, u.position, u.personnelType,
               u.dep_code, u.aff_code, u.affiliation,
               -- ดึง supervisor_status + ข้อมูลลงเวลาจาก attendance (single-row)
               a.supervisor_status,
               a.supervisor_note  AS att_supervisor_note,
               a.checkin_time, a.checkout_time, a.checkout_type,
               a.checkin_in_range, a.checkin_distance_m
        FROM attendance_requests r
        LEFT JOIN users u ON u.uuid = r.uuid
        LEFT JOIN attendance a ON a.uuid = r.uuid AND a.date = r.req_date
        ${where}
        ORDER BY CASE r.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
                 r.submitted_at DESC
        LIMIT ? OFFSET ?
      `).bind(...bind, limit, offset).all();

      // แปลง attendance เป็น array สำหรับ UI
      const items = (rows.results || []).map(item => ({
        ...item,
        attendance: buildAttendanceArray(item),
      }));

      return json({ success: true, total: countRow?.total || 0, limit, offset, data: items });
    } catch (err) {
      return json({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message }, 500);
    }
  }

  // ── PATCH ────────────────────────────────────────────────────────────────
  if (request.method === 'PATCH') {
    let body;
    try { body = await request.json(); } catch { return json({ success: false, message: 'Invalid JSON' }, 400); }

    const { reference, action, reviewer_note } = body;
    if (!reference || !action) return json({ success: false, message: 'ขาด reference หรือ action' }, 400);
    if (!['approve', 'reject'].includes(action)) return json({ success: false, message: 'action ไม่ถูกต้อง' }, 400);

    const reqRow = await env.DB.prepare(`
      SELECT r.*, u.dep_code, u.aff_code
      FROM attendance_requests r
      LEFT JOIN users u ON u.uuid = r.uuid
      WHERE r.reference = ?
    `).bind(reference).first();

    if (!reqRow) return json({ success: false, message: 'ไม่พบคำขอ' }, 404);
    if (reqRow.status !== 'pending')
      return json({ success: false, message: `ดำเนินการไปแล้ว (${reqRow.status})` }, 409);

    const isApprover = reqRow.approver_uuid === reviewer.uuid;
    const isAdmin    = reviewer.role === 'admin';
    const isSameUnit = reviewer.role === 'supervisor' &&
      (reqRow.dep_code === reviewer.dep_code || reqRow.aff_code === reviewer.aff_code);

    if (!isApprover && !isAdmin && !isSameUnit)
      return json({ success: false, message: 'ไม่มีสิทธิ์จัดการคำขอนี้' }, 403);

    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    const supStatus = action === 'approve' ? 'approved' : 'rejected';

    try {
      // 1. อัปเดต attendance_requests (เดิม)
      await env.DB.prepare(
        `UPDATE attendance_requests SET status = ?, reviewed_at = CURRENT_TIMESTAMP, reviewer_note = ? WHERE reference = ?`
      ).bind(newStatus, reviewer_note || null, reference).run();

      // 2. อัปเดต supervisor_status ในตาราง attendance (single-row)
      await env.DB.prepare(`
        UPDATE attendance SET
          supervisor_status = ?,
          supervisor_note   = ?,
          reviewed_at       = CURRENT_TIMESTAMP,
          updated_at        = CURRENT_TIMESTAMP
        WHERE uuid = ? AND date = ?
      `).bind(supStatus, reviewer_note || null, reqRow.uuid, reqRow.req_date).run();

      // 3. ถ้า approve → แก้ไขเวลาใน attendance (single-row)
      if (action === 'approve') await applyApprovedV2(env, reqRow);

      const reviewerName = reviewer.name ||
        `${reviewer.prefix || ''}${reviewer.firstName || ''} ${reviewer.lastName || ''}`.trim();

      return json({
        success: true,
        message: action === 'approve' ? 'อนุมัติสำเร็จ' : 'ปฏิเสธสำเร็จ',
        data: {
          reference,
          status:            newStatus,
          supervisor_status: supStatus,
          reviewed_by:       reviewerName,
        },
      });
    } catch (err) {
      return json({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message }, 500);
    }
  }

  return json({ success: false, message: 'Method not allowed' }, 405);
}

// ── แปลงข้อมูล attendance (single-row) → array สำหรับ UI เดิม ──────────
function buildAttendanceArray(item) {
  const arr = [];
  if (item.checkin_time) {
    arr.push({ action: 'checkin', time_str: item.checkin_time });
  }
  if (item.checkout_time) {
    arr.push({ action: 'checkout', time_str: item.checkout_time, checkout_type: item.checkout_type });
  }
  return arr;
}

// ── Apply approved: แก้ไขเวลาใน attendance (single-row) ────────────────
async function applyApprovedV2(env, req) {
  const { uuid, request_type, req_date, req_time } = req;
  if (!req_time) return;
  const ts = req_time.length === 5 ? req_time + ':00' : req_time;

  try {
    if (['ลืมลงเวลาเข้า', 'แก้ไขเวลาเข้า'].includes(request_type)) {
      await env.DB.prepare(`
        UPDATE attendance SET
          checkin_time = ?,
          updated_at   = CURRENT_TIMESTAMP
        WHERE uuid = ? AND date = ?
      `).bind(ts, uuid, req_date).run();
    }

    if (['ลืมลงเวลาออก', 'แก้ไขเวลาออก'].includes(request_type)) {
      await env.DB.prepare(`
        UPDATE attendance SET
          checkout_time = ?,
          checkout_type = 'manual',
          updated_at    = CURRENT_TIMESTAMP
        WHERE uuid = ? AND date = ?
      `).bind(ts, uuid, req_date).run();
    }
  } catch (err) {
    console.error('[applyApprovedV2]', err);
  }
}