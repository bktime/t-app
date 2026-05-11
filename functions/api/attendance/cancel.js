// functions/api/attendance/cancel.js
// DELETE /api/attendance/cancel
// ยกเลิกการลงเวลาของวันนั้น — ทำได้เฉพาะเมื่อ supervisor_status = 'none'

import { authUser, extractToken } from '../_auth.js';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const json = (d, s = 200) => Response.json(d, { status: s, headers: CORS });

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (request.method !== 'DELETE')  return json({ success: false, message: 'Method not allowed' }, 405);

  // ── Auth ──────────────────────────────────────────────────────
  const token   = extractToken(request);
  const userRow = await authUser(env, token);
  if (!userRow) return json({ success: false, message: 'Token ไม่ถูกต้องหรือหมดอายุ' }, 401);

  // ── Body ──────────────────────────────────────────────────────
  let body;
  try { body = await request.json(); } catch { return json({ success: false, message: 'Invalid JSON' }, 400); }

  const { uuid, date } = body;

  if (!uuid || !date) return json({ success: false, message: 'ข้อมูลไม่ครบถ้วน (uuid, date)' }, 400);
  if (uuid !== userRow.uuid) return json({ success: false, message: 'UUID ไม่ตรงกัน' }, 403);

  // ── ตรวจรูปแบบ date ──────────────────────────────────────────
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ success: false, message: 'รูปแบบ date ไม่ถูกต้อง (YYYY-MM-DD)' }, 400);
  }

  // ── ป้องกัน ย้อนหลังเกิน 1 วัน ──────────────────────────────
  const todayISO = new Date().toISOString().slice(0, 10);
  if (date !== todayISO) {
    return json({ success: false, message: 'ยกเลิกได้เฉพาะการลงเวลาของวันนี้เท่านั้น' }, 400);
  }

  // ── อ่านแถวปัจจุบัน ──────────────────────────────────────────
  const row = await env.DB.prepare(`
    SELECT id, checkin_time, supervisor_status
    FROM attendance
    WHERE uuid = ? AND date = ?
    LIMIT 1
  `).bind(uuid, date).first();

  if (!row) {
    return json({ success: false, message: 'ไม่พบข้อมูลการลงเวลาของวันนี้' }, 404);
  }

  if (!row.checkin_time) {
    return json({ success: false, message: 'ยังไม่มีการลงเวลาเข้า' }, 400);
  }

  // ── ตรวจสอบสิทธิ์: ยกเลิกได้เฉพาะ supervisor_status = 'none' ──
  if (row.supervisor_status !== 'none') {
    const statusLabel = {
      pending:  'อยู่ระหว่างรอ Supervisor รับรอง',
      approved: 'Supervisor รับรองแล้ว',
      rejected: 'Supervisor ไม่รับรองแล้ว',
    };
    const msg = statusLabel[row.supervisor_status] || `สถานะปัจจุบัน: ${row.supervisor_status}`;
    return json({ success: false, message: `ไม่สามารถยกเลิกได้ — ${msg}` }, 409);
  }

  // ── ลบแถว ────────────────────────────────────────────────────
  try {
    await env.DB.prepare(`
      DELETE FROM attendance
      WHERE uuid = ? AND date = ? AND supervisor_status = 'none'
    `).bind(uuid, date).run();

    return json({
      success: true,
      message: 'ยกเลิกการลงเวลาสำเร็จ',
      data: { uuid, date },
    });
  } catch (err) {
    console.error('[cancel attendance]', err);
    return json({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message }, 500);
  }
}