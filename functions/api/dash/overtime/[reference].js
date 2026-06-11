// functions/api/dash/overtime/[reference].js
// GET    /api/dash/overtime/:reference
// PATCH  /api/dash/overtime/:reference  → action: supervisor | finance

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
      'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    },
  });
}

/* ── GET single record ── */
export async function onRequestGet({ request, env, params }) {
  const token = extractToken(request);
  const session = await authUser(env, token);
  if (!session) return unauthorized(CORS);

  const ref = params.reference;
  try {
    const row = await env.DB.prepare(
      `SELECT ot.*, u.aff_code, u.dep_code, u.affiliation
       FROM attendance_overtime ot
       INNER JOIN users u ON u.uuid = ot.uuid
       WHERE ot.reference = ?`
    ).bind(ref).first();

    if (!row) return Response.json(
      { success: false, message: 'ไม่พบรายการ OT' },
      { status: 404, headers: CORS }
    );

    return Response.json({ success: true, data: row }, { headers: CORS });
  } catch (err) {
    console.error('[overtime/[reference] GET]', err);
    return Response.json({ success: false, message: 'Internal Server Error' }, { status: 500, headers: CORS });
  }
}

/* ── PATCH ── */
export async function onRequestPatch({ request, env, params }) {
  const token = extractToken(request);
  const session = await authUser(env, token);
  if (!session) return unauthorized(CORS);

  const me = session;

  if (!me.can_edit) {
    return Response.json(
      { success: false, message: 'คุณไม่มีสิทธิ์ดำเนินการนี้' },
      { status: 403, headers: CORS }
    );
  }

  const ref = params.reference;
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, message: 'Body ไม่ถูกต้อง' }, { status: 400, headers: CORS });
  }

  const { action } = body;

  /* ────────────────────────────────────────
   * mode 1 : supervisor approve / reject
   * ──────────────────────────────────────── */
  if (action === 'supervisor' || !action) {
    const { supervisor_status, supervisor_note } = body;

    if (!['approved', 'rejected', 'pending'].includes(supervisor_status)) {
      return Response.json(
        { success: false, message: 'supervisor_status ต้องเป็น approved / rejected / pending' },
        { status: 400, headers: CORS }
      );
    }

    try {
      const old = await env.DB.prepare(
        `SELECT * FROM attendance_overtime WHERE reference = ?`
      ).bind(ref).first();

      if (!old) return Response.json(
        { success: false, message: 'ไม่พบรายการ OT' },
        { status: 404, headers: CORS }
      );

      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

      await env.DB.prepare(`
        UPDATE attendance_overtime
        SET supervisor_status = ?,
            supervisor_note   = ?,
            reviewed_at       = ?,
            updated_at        = ?
        WHERE reference = ?
      `).bind(
        supervisor_status,
        supervisor_note ?? old.supervisor_note,
        supervisor_status !== 'pending' ? now : null,
        now,
        ref
      ).run();

      const newData = {
        ...old,
        supervisor_status,
        supervisor_note: supervisor_note ?? old.supervisor_note,
        reviewed_at: supervisor_status !== 'pending' ? now : null,
        updated_at: now,
      };

      const changes = diffFields(old, newData, ['supervisor_status', 'supervisor_note', 'reviewed_at']);

      await writeAuditLog(
        env,
        request,
        { uuid: me.uuid, name: me.name, role: me.role },
        `OT_${supervisor_status.toUpperCase()}`,
        { uuid: ref, name: old.name ?? ref },
        changes
      );

      return Response.json({
        success: true,
        message: supervisor_status === 'approved' ? 'อนุมัติ OT สำเร็จ' : 'อัปเดตสถานะ OT สำเร็จ',
        data: { reference: ref, supervisor_status },
      }, { headers: CORS });

    } catch (err) {
      console.error('[overtime/[reference] PATCH supervisor]', err);
      return Response.json({ success: false, message: 'Internal Server Error' }, { status: 500, headers: CORS });
    }
  }

  /* ────────────────────────────────────────
   * mode 2 : finance แก้ไขข้อมูล OT
   *   — เฉพาะ role admin หรือ finance
   * ──────────────────────────────────────── */
  if (action === 'finance') {
    const isAdminOrFinance =
      me.role === 'admin' ||
      me.role === 'finance' ||
      String(me.role).toLowerCase() === 'admin' ||
      String(me.role).toLowerCase() === 'finance';

    if (!isAdminOrFinance) {
      return Response.json(
        { success: false, message: 'เฉพาะ Admin หรือ Finance เท่านั้นที่แก้ไขข้อมูลได้' },
        { status: 403, headers: CORS }
      );
    }

    const {
      ot_date,
      ot_start,
      ot_end,
      ot_hours,
      ot_days,
      ot_rate_per_hour,
      ot_rate_per_day,
      ot_max_hours,
      amount_hour,
      amount_day,
      work_type,        // ประเภท OT
      finance_status,   // verified | rejected | pending
      finance_note,     // หมายเหตุจากการเงิน
    } = body;

    // validate
    if (!ot_date || !ot_start || !ot_end) {
      return Response.json(
        { success: false, message: 'กรุณากรอกวันที่ เวลาเริ่ม และเวลาสิ้นสุด' },
        { status: 400, headers: CORS }
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ot_date)) {
      return Response.json(
        { success: false, message: 'รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)' },
        { status: 400, headers: CORS }
      );
    }
    if (finance_status && !['verified', 'rejected', 'pending'].includes(finance_status)) {
      return Response.json(
        { success: false, message: 'finance_status ต้องเป็น verified / rejected / pending' },
        { status: 400, headers: CORS }
      );
    }

    try {
      const old = await env.DB.prepare(
        `SELECT * FROM attendance_overtime WHERE reference = ?`
      ).bind(ref).first();

      if (!old) return Response.json(
        { success: false, message: 'ไม่พบรายการ OT' },
        { status: 404, headers: CORS }
      );

      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

      await env.DB.prepare(`
        UPDATE attendance_overtime
        SET ot_date          = ?,
            ot_start         = ?,
            ot_end           = ?,
            ot_hours         = ?,
            ot_days          = ?,
            work_type        = ?,
            ot_rate_per_hour = ?,
            ot_rate_per_day  = ?,
            ot_max_hours     = ?,
            amount_hour      = ?,
            amount_day       = ?,
            finance_status   = ?,
            finance_note     = ?,
            finance_code     = ?,
            finance_name     = ?,
            finance_at       = ?,
            updated_at       = ?
        WHERE reference = ?
      `).bind(
        ot_date,
        ot_start,
        ot_end,
        ot_hours         != null ? Number(ot_hours)         : old.ot_hours,
        ot_days          != null ? Number(ot_days)          : old.ot_days,
        work_type        || old.work_type,
        ot_rate_per_hour != null ? Number(ot_rate_per_hour) : old.ot_rate_per_hour,
        ot_rate_per_day  != null ? Number(ot_rate_per_day)  : old.ot_rate_per_day,
        ot_max_hours     != null ? Number(ot_max_hours)     : old.ot_max_hours,
        amount_hour != null ? Number(amount_hour) : old.amount_hour,
        amount_day  != null ? Number(amount_day)  : old.amount_day,
        finance_status ?? old.finance_status ?? 'pending',
        finance_note   !== undefined ? finance_note   : old.finance_note,
        me.uuid,
        me.name,
        now,   // finance_at = เวลาที่แก้ไขล่าสุด
        now,
        ref
      ).run();

      const newData = {
        ...old,
        ot_date, ot_start, ot_end,
        ot_hours, ot_days,
        work_type: work_type || old.work_type,
        ot_rate_per_hour, ot_rate_per_day, ot_max_hours,
        amount_hour, amount_day,
        finance_status: finance_status ?? old.finance_status,
        finance_note:   finance_note   !== undefined ? finance_note : old.finance_note,
        finance_code:   me.uuid,
        finance_name:   me.name,
        finance_at:     now,
        updated_at:     now,
      };

      const changes = diffFields(old, newData, [
        'ot_date','ot_start','ot_end',
        'ot_hours','ot_days','work_type',
        'ot_rate_per_hour','ot_rate_per_day','ot_max_hours',
        'amount_hour','amount_day',
        'finance_status','finance_note',
        'finance_code','finance_name',
      ]);

      await writeAuditLog(
        env,
        request,
        { uuid: me.uuid, name: me.name, role: me.role },
        `OT_FINANCE_${(finance_status || 'EDIT').toUpperCase()}`,
        { uuid: ref, name: old.name ?? ref },
        changes
      );

      return Response.json({
        success: true,
        message: 'บันทึกข้อมูล OT สำเร็จ',
        data: { reference: ref, finance_status: finance_status ?? old.finance_status },
      }, { headers: CORS });

    } catch (err) {
      console.error('[overtime/[reference] PATCH finance]', err);
      return Response.json({ success: false, message: 'Internal Server Error' }, { status: 500, headers: CORS });
    }
  }

  return Response.json(
    { success: false, message: 'action ไม่ถูกต้อง (supervisor | finance)' },
    { status: 400, headers: CORS }
  );
}