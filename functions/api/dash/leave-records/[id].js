// functions/api/dash/leave-records/[id].js
import { authUser, extractToken, unauthorized } from '../../_auth.js';
import { writeAuditLog } from '../_audit.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: { ...CORS, 'Access-Control-Allow-Methods': 'PUT, PATCH, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' },
  });
}

export async function onRequestPut({ request, env, params }) {
  const token = extractToken(request);
  const session = await authUser(env, token);
  if (!session) return unauthorized(CORS);

  const id = params?.id;
  let body;
  try { body = await request.json(); } catch { return Response.json({ success: false, message: 'Invalid JSON' }, { status: 400, headers: CORS }); }

  try {
    // ─── ตรวจสอบสิทธิ์: แอดมินแก้ได้ทั้งหมด, User แก้ได้เฉพาะของตัวเองที่ยัง pending ───
    const existing = await env.DB.prepare(`SELECT user_uuid, status FROM leave_records WHERE id=?`).bind(id).first();
    if (!existing) return Response.json({ success: false, message: 'ไม่พบรายการ' }, { status: 404, headers: CORS });

    const isOwner = existing.user_uuid === session.uuid;
    const isPending = existing.status === 'pending';

    if (!session.can_edit && !(isOwner && isPending)) {
      return Response.json({ success: false, message: 'คุณไม่มีสิทธิ์แก้ไขรายการนี้ หรือรายการนี้ถูกอนุมัติไปแล้ว' }, { status: 403, headers: CORS });
    }

    const { user_uuid, leave_type, start_date, end_date, supervisor_uuid, approver_uuid, delegate_uuid, reason, supervisor_note, status } = body;

    // User ทั่วไปห้ามเปลี่ยนสถานะเอง และห้ามเปลี่ยนเป็นคนอื่น
    const finalUserUuid = session.can_edit ? user_uuid : existing.user_uuid;
    const finalStatus = session.can_edit ? status : 'pending'; // บังคับ pending ถ้าไม่ใช่แอดมิน

    if (new Date(end_date) < new Date(start_date)) {
      return Response.json({ success: false, message: 'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น' }, { status: 400, headers: CORS });
    }

    const days = Math.round((new Date(end_date) - new Date(start_date)) / 86400000) + 1;
    const now = new Date().toISOString();

    await env.DB.prepare(`
      UPDATE leave_records SET 
        user_uuid=?, leave_type=?, start_date=?, end_date=?, days=?, reason=?,
        supervisor_uuid=?, supervisor_note=?, approver_uuid=?, delegate_uuid=?, status=?,
        updated_at=?
      WHERE id=?
    `).bind(
      finalUserUuid, leave_type, start_date, end_date, days, reason || null,
      supervisor_uuid, supervisor_note || null, approver_uuid, delegate_uuid || null, finalStatus,
      now, id
    ).run();

    writeAuditLog(env, request, { uuid: session.uuid, name: session.name, role: session.role }, 'leave.update', { id }, { leave_type, days });

    return Response.json({ success: true, message: 'แก้ไขรายการสำเร็จ' }, { headers: CORS });
  } catch (err) {
    console.error('[dash/leave-records PUT]', err);
    return Response.json({ success: false, message: 'Internal Server Error' }, { status: 500, headers: CORS });
  }
}

export async function onRequestPatch({ request, env, params }) {
  // สำหรับการอนุมัติ / ปฏิเสธ (Approve/Reject/Reset)
  const token = extractToken(request);
  const session = await authUser(env, token);
  if (!session) return unauthorized(CORS);
  if (!session.can_edit) return Response.json({ success: false, message: 'Permission denied' }, { status: 403, headers: CORS });

  const id = params?.id;
  let body;
  try { body = await request.json(); } catch { return Response.json({ success: false, message: 'Invalid JSON' }, { status: 400, headers: CORS }); }

  const { status, approval_note } = body;
  if (!['approved', 'rejected', 'pending'].includes(status)) {
    return Response.json({ success: false, message: 'สถานะไม่ถูกต้อง' }, { status: 400, headers: CORS });
  }

  try {
    const now = new Date().toISOString();
    
    // หากเป็น pending (คืนสถานะ) ให้ลบข้อมูลผู้อนุมัติ ถ้าเป็น approved/rejected ให้บันทึกผู้อนุมัติ
    const approved_by = status === 'pending' ? null : session.uuid;
    const approved_at = status === 'pending' ? null : now;

    await env.DB.prepare(`
      UPDATE leave_records SET 
        status=?, approval_note=?, approved_by=?, approved_at=?, updated_at=?
      WHERE id=?
    `).bind(status, approval_note || null, approved_by, approved_at, now, id).run();

    writeAuditLog(env, request, { uuid: session.uuid, name: session.name, role: session.role }, 'leave.approve', { id }, { status, approval_note });

    return Response.json({ success: true, message: 'บันทึกสถานะสำเร็จ' }, { headers: CORS });
  } catch (err) {
    console.error('[dash/leave-records PATCH]', err);
    return Response.json({ success: false, message: 'Internal Server Error' }, { status: 500, headers: CORS });
  }
}

export async function onRequestDelete({ request, env, params }) {
  const token = extractToken(request);
  const session = await authUser(env, token);
  if (!session) return unauthorized(CORS);

  const id = params?.id;

  try {
    // ─── ตรวจสอบสิทธิ์: แอดมินลบได้ทั้งหมด, User ลบได้เฉพาะของตัวเองที่ยัง pending ───
    const existing = await env.DB.prepare(`SELECT user_uuid, status FROM leave_records WHERE id=?`).bind(id).first();
    if (!existing) return Response.json({ success: false, message: 'ไม่พบรายการ' }, { status: 404, headers: CORS });

    const isOwner = existing.user_uuid === session.uuid;
    const isPending = existing.status === 'pending';

    if (!session.can_edit && !(isOwner && isPending)) {
      return Response.json({ success: false, message: 'คุณไม่มีสิทธิ์ลบรายการนี้ หรือรายการนี้ถูกอนุมัติไปแล้ว' }, { status: 403, headers: CORS });
    }

    await env.DB.prepare(`DELETE FROM leave_records WHERE id=?`).bind(id).run();
    writeAuditLog(env, request, { uuid: session.uuid, name: session.name, role: session.role }, 'leave.delete', { id }, {});

    return Response.json({ success: true, message: 'ลบรายการสำเร็จ' }, { headers: CORS });
  } catch (err) {
    console.error('[dash/leave-records DELETE]', err);
    return Response.json({ success: false, message: 'Internal Server Error' }, { status: 500, headers: CORS });
  }
}