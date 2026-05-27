// functions/api/attendance/today.js
import { authUser, extractToken } from '../_auth.js';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const json = (d, s = 200) => Response.json(d, { status: s, headers: CORS });

// ✅ Helper: แปลง UTC ISO String เป็น Asia/Bangkok (+07:00) ISO String
const toBangkokISO = (utcIsoStr) => {
  if (!utcIsoStr) return null;
  try {
    const d = new Date(utcIsoStr);
    // 'sv-SE' locale จะจัด Format เป็น YYYY-MM-DD HH:mm:ss ตาม Timezone ที่ระบุ
    const bangkokStr = d.toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' });
    // เอามาต่อให้เป็น ISO Format ที่ถูกต้อง (YYYY-MM-DDTHH:mm:ss+07:00)
    return bangkokStr.replace(' ', 'T') + '+07:00';
  } catch (e) {
    return utcIsoStr; // กรณี Error ก็ส่งของเดิมไปก่อน
  }
};

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (request.method !== 'GET')     return json({ success: false, message: 'Method not allowed' }, 405);

  const token   = extractToken(request);
  const userRow = await authUser(env, token);
  if (!userRow) return json({ success: false, message: 'Token ไม่ถูกต้องหรือหมดอายุ' }, 401);

  const url  = new URL(request.url);
  const uuid = url.searchParams.get('uuid');
  const date = url.searchParams.get('date'); // ✅ แนะนำให้ Frontend ส่ง en-CA เข้ามา

  if (!uuid || !date)         return json({ success: false, message: 'ขาด uuid หรือ date' }, 400);
  if (uuid !== userRow.uuid)  return json({ success: false, message: 'UUID ไม่ตรงกัน' }, 403);

  try {
    const row = await env.DB.prepare(`
      SELECT
        uuid, date,
        checkin_time, checkin_work_type, checkin_note,
        checkin_latitude, checkin_longitude, checkin_distance_m, checkin_in_range,
        checkin_reference, checkin_iso,
        checkout_time, checkout_type, checkout_work_type, checkout_note,
        checkout_latitude, checkout_longitude, checkout_distance_m, checkout_in_range,
        checkout_iso,
        request_ref, request_type, request_reason, request_at,
        approver_uuid, supervisor_name, supervisor_status, supervisor_note, reviewed_at
      FROM attendance
      WHERE uuid = ? AND date = ?
      LIMIT 1
    `).bind(uuid, date).first();

    if (!row) {
      return json({
        success: true,
        data: {
          date,
          has_checkin: false,
          has_checkout: false,
          checkin: null,
          checkout: null,
          request: null,
          supervisor: null,
        },
      });
    }

    const checkin  = row.checkin_time ? {
      action:     'checkin',
      time_str:   row.checkin_time,
      work_type:  row.checkin_work_type,
      note:       row.checkin_note,
      latitude:   row.checkin_latitude,
      longitude:  row.checkin_longitude,
      distance_m: row.checkin_distance_m,
      is_in_range: row.checkin_in_range != null ? !!row.checkin_in_range : null,
      reference:  row.checkin_reference,
      timestamp_iso: toBangkokISO(row.checkin_iso), // ✅ แปลงเป็น +07:00 ตรงนี้
    } : null;

    const checkout = row.checkout_time ? {
      action:        'checkout',
      time_str:      row.checkout_time,
      checkout_type: row.checkout_type,
      work_type:     row.checkout_work_type,
      note:          row.checkout_note,
      latitude:      row.checkout_latitude,
      longitude:     row.checkout_longitude,
      distance_m:    row.checkout_distance_m,
      is_in_range:   row.checkout_in_range != null ? !!row.checkout_in_range : null,
      timestamp_iso: toBangkokISO(row.checkout_iso), // ✅ แปลงเป็น +07:00 ตรงนี้
    } : null;

    const requestInfo = row.request_ref ? {
      reference:    row.request_ref,
      request_type: row.request_type,
      reason:       row.request_reason,
      submitted_at: toBangkokISO(row.request_at), // ✅ แปลงเป็น +07:00
    } : null;

    const supervisorInfo = {
      status:          row.supervisor_status || 'pending',
      approver_uuid:   row.approver_uuid,
      supervisor_name: row.supervisor_name,
      supervisor_note: row.supervisor_note,
      reviewed_at:     toBangkokISO(row.reviewed_at), // ✅ แปลงเป็น +07:00
    };

    return json({
      success: true,
      data: {
        date,
        has_checkin:  !!checkin,
        has_checkout: !!checkout,
        checkin,
        checkout,
        request:    requestInfo,
        supervisor: supervisorInfo,
      },
    });
  } catch (err) {
    console.error('[today]', err);
    return json({ success: false, message: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' }, 500);
  }
}
