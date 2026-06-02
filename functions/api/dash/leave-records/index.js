// functions/api/dash/leave-records/index.js
import { authUser, extractToken, unauthorized } from '../../_auth.js';
import { buildScope } from '../_scope.js';
import { writeAuditLog } from '../_audit.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' },
  });
}

export async function onRequestGet({ request, env }) {
  const token = extractToken(request);
  const session = await authUser(env, token);
  if (!session) return unauthorized(CORS);

  const me = session;
  const url = new URL(request.url);
  const { scopeSQL, scopeParams, scopeMeta } = buildScope(me, url, 'u');

  try {
    const [recordsRes, summaryRow] = await Promise.all([
      env.DB.prepare(`
        SELECT 
          lr.id, lr.uuid, lr.user_uuid, lr.leave_type, lr.start_date, lr.end_date, lr.days, lr.reason, lr.status,
          lr.supervisor_uuid, lr.supervisor_note, lr.approver_uuid, lr.delegate_uuid,
          lr.approval_note, lr.approved_by, lr.approved_at,

          concat(u.firstName, ' ', u.lastName) AS user_name,
          u.department, u.position,
          concat(sup.firstName, ' ', sup.lastName) AS supervisor_name,
          concat(app.firstName, ' ', app.lastName) AS approver_name,
          concat(del.firstName, ' ', del.lastName) AS delegate_name,
          concat(apv.firstName, ' ', apv.lastName) AS approved_by_name

        FROM leave_records lr
        JOIN users u ON lr.user_uuid = u.uuid
        LEFT JOIN users sup ON lr.supervisor_uuid = sup.uuid
        LEFT JOIN users app ON lr.approver_uuid = app.uuid
        LEFT JOIN users del ON lr.delegate_uuid = del.uuid
        LEFT JOIN users apv ON lr.approved_by = apv.uuid
        WHERE 1=1 ${scopeSQL}
        ORDER BY lr.start_date DESC
      `).bind(...scopeParams).all(),

      // ✅ เพิ่มการนับจำนวนวันของทุกประเภทการลา
      env.DB.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN lr.status='pending' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN lr.status='approved' THEN 1 ELSE 0 END) AS approved,
          SUM(CASE WHEN lr.leave_type='sick' THEN lr.days ELSE 0 END) AS sick,
          SUM(CASE WHEN lr.leave_type='maternity' THEN lr.days ELSE 0 END) AS maternity,
          SUM(CASE WHEN lr.leave_type='paternity' THEN lr.days ELSE 0 END) AS paternity,
          SUM(CASE WHEN lr.leave_type='personal' THEN lr.days ELSE 0 END) AS personal,
          SUM(CASE WHEN lr.leave_type='vacation' THEN lr.days ELSE 0 END) AS vacation,
          SUM(CASE WHEN lr.leave_type='ordain' THEN lr.days ELSE 0 END) AS ordain,
          SUM(CASE WHEN lr.leave_type='military' THEN lr.days ELSE 0 END) AS military,
          SUM(CASE WHEN lr.leave_type='study' THEN lr.days ELSE 0 END) AS study,
          SUM(CASE WHEN lr.leave_type='intl' THEN lr.days ELSE 0 END) AS intl,
          SUM(CASE WHEN lr.leave_type='spouse' THEN lr.days ELSE 0 END) AS spouse,
          SUM(CASE WHEN lr.leave_type='rehab' THEN lr.days ELSE 0 END) AS rehab
        FROM leave_records lr
        JOIN users u ON lr.user_uuid = u.uuid
        WHERE 1=1 ${scopeSQL}
      `).bind(...scopeParams).first()
    ]);


    return Response.json({
      success: true,
      data: {
        records: recordsRes.results ?? [],
        summary: {
          total:    Number(summaryRow?.total    ?? 0),
          pending:  Number(summaryRow?.pending  ?? 0),
          approved: Number(summaryRow?.approved ?? 0),
          sick:     Number(summaryRow?.sick     ?? 0),
          vacation: Number(summaryRow?.vacation ?? 0),
        }
      },
      meta: { role: me.role, role_level: me.role_level, can_edit: !!me.can_edit, ...scopeMeta },
    }, { headers: CORS });

  } catch (err) {
    console.error('[dash/leave-records GET]', err);
    return Response.json({ success: false, message: 'Internal Server Error' }, { status: 500, headers: CORS });
  }
}

export async function onRequestPost({ request, env }) {
  const token = extractToken(request);
  const session = await authUser(env, token);
  if (!session) return unauthorized(CORS);

  let body;
  try { body = await request.json(); } catch { return Response.json({ success: false, message: 'Invalid JSON' }, { status: 400, headers: CORS }); }

  let { user_uuid, leave_type, start_date, end_date, supervisor_uuid, approver_uuid, delegate_uuid, reason, supervisor_note, status } = body;
  
  if (!user_uuid || !leave_type || !start_date || !end_date || !supervisor_uuid || !approver_uuid) {
    return Response.json({ success: false, message: 'ข้อมูลไม่ครบถ้วน (ผู้ลา, ประเภท, วันที่, หัวหน้า, ผู้อนุมัติ)' }, { status: 400, headers: CORS });
  }

  // ตรวจสอบสิทธิ์
  if (!session.can_edit) {
    if (user_uuid !== session.uuid) {
      return Response.json({ success: false, message: 'คุณสามารถบันทึกการลาได้เฉพาะตัวเองเท่านั้น' }, { status: 403, headers: CORS });
    }
    status = 'pending';
  }

  if (new Date(end_date) < new Date(start_date)) {
    return Response.json({ success: false, message: 'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น' }, { status: 400, headers: CORS });
  }

  // ─── เพิ่ม: ตรวจสอบการลาซ้ำ (Overlapping) ───
  const overlap = await env.DB.prepare(`
    SELECT id FROM leave_records 
    WHERE user_uuid = ? 
      AND status != 'rejected'
      AND (
        (start_date <= ? AND end_date >= ?)  -- วันเริ่มตรงกัน
        OR 
        (start_date <= ? AND end_date >= ?)  -- วันสิ้นสุดตรงกัน
        OR
        (start_date >= ? AND end_date <= ?)  -- อยู่ในช่วงเดียวกัน
      )
    LIMIT 1
  `).bind(user_uuid, start_date, start_date, end_date, end_date, start_date, end_date).first();

  if (overlap) {
    return Response.json({ 
      success: false, 
      message: 'มีการลาในช่วงวันที่นี้อยู่แล้ว ไม่สามารถบันทึกซ้ำได้' 
    }, { status: 409, headers: CORS });
  }

  try {
    const days = Math.round((new Date(end_date) - new Date(start_date)) / 86400000) + 1;
    const uuid = crypto.randomUUID();
    const now = new Date().toISOString();

    await env.DB.prepare(`
      INSERT INTO leave_records (uuid, user_uuid, leave_type, start_date, end_date, days, reason, supervisor_uuid, supervisor_note, approver_uuid, delegate_uuid, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      uuid, user_uuid, leave_type, start_date, end_date, days, reason || null,
      supervisor_uuid, supervisor_note || null, approver_uuid, delegate_uuid || null,
      status || 'pending', now, now
    ).run();

    writeAuditLog(env, request, { uuid: session.uuid, name: session.name, role: session.role }, 'leave.create', { uuid: user_uuid }, { leave_type, start_date, end_date, days });

    return Response.json({ success: true, message: 'บันทึกการลาสำเร็จ' }, { headers: CORS });

  } catch (err) {
    console.error('[dash/leave-records POST]', err);
    return Response.json({ success: false, message: 'Internal Server Error' }, { status: 500, headers: CORS });
  }
}