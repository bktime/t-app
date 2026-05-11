// functions/api/attendance/request.js

import { authUser, extractToken } from '../_auth.js';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const json = (d, s = 200) => Response.json(d, { status: s, headers: CORS });


function generateRef(uuid = '') {
  const now = new Date();
  const d = now.toISOString().slice(2, 10).replace(/-/g, '');
  const t = now.toTimeString().slice(0, 8).replace(/:/g, '');
  const u = (uuid || 'NOUID').replace(/-/g, '').slice(0, 8).toUpperCase();
  const base = d + t;

  let sum = 0;
  for (let i = 0; i < base.length; i++) {
    sum += parseInt(base[i]) * (i + 1);
  }
  let check = sum % 11;
  if (check === 10) check = 'X';

  return `REQ-${d}-${t}-${u}-${check}`;
}

function generateRefAT(uuid = '') {
  const now = new Date();
  const d = now.toISOString().slice(2, 10).replace(/-/g, '');
  const t = now.toTimeString().slice(0, 8).replace(/:/g, '');
  const u = (uuid || 'NOUID').replace(/-/g, '').slice(0, 8).toUpperCase();
  const base = d + t;

  let sum = 0;
  for (let i = 0; i < base.length; i++) {
    sum += parseInt(base[i]) * (i + 1);
  }
  let check = sum % 11;
  if (check === 10) check = 'X';

  return `ATT-${d}-${t}-${u}-${check}`;
}

// ===== ฟังก์ชันเกี่ยวกับพื้นที่ =====
function cleanText(text) {
  return text
    .toLowerCase()
    .replace("จังหวัด", "")
    .replace("changwat", "")
    .replace("province", "")
    .trim();
}

// ✅ แก้ไข: ส่ง env เข้าไปในฟังก์ชัน
async function checkBuengKan(lat, lon, env) {
  try {
    // ✅ ใช้ env ที่ส่งเข้ามา
    const apiKey = env.LOCATIONIQ_KEY;
    const res = await fetch(
      `https://us1.locationiq.com/v1/reverse?key=${apiKey}&lat=${lat}&lon=${lon}&format=json`
    );

    if (!res.ok) throw new Error("API ERROR");

    const data = await res.json();
    const addr = data.address || {};

    let province = addr.province || addr.state || addr.region || "";
    const p = cleanText(province);

    const isProvince = p.includes("บึงกาฬ") || p.includes("bueng kan");

    return {
      inProvince: isProvince,
      displayName: data.display_name || "-"
    };
  } catch (e) {
    console.error("Location check error:", e);
    return {
      inProvince: false,
      displayName: "-"
    };
  }
}

async function checkDuplicateRequest(env, uuid, request_type, req_date) {
  return env.DB.prepare(`
    SELECT reference, status
    FROM attendance_requests
    WHERE uuid = ?
      AND request_type = ?
      AND req_date = ?
      AND status IN ('pending','approved')
    LIMIT 1
  `).bind(uuid, request_type, req_date).first();
}

const REQUIRE_CHECKIN = ['ลืมลงเวลาออก','แก้ไขเวลาออก'];

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS')
    return new Response(null, { headers: CORS });

  const token   = extractToken(request);
  const userRow = await authUser(env, token);
  if (!userRow) return json({ success: false, message: 'Token ไม่ถูกต้องหรือหมดอายุ' }, 401);

  // ================= GET =================
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const uuid = url.searchParams.get('uuid');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);

    if (uuid !== userRow.uuid)
      return json({ success: false, message: 'UUID ไม่ตรงกัน' }, 403);

    const rows = await env.DB.prepare(`
      SELECT r.*, 
             a.checkin_time, a.checkout_time, a.checkout_type,
             a.checkin_latitude, a.checkin_longitude,
             a.checkout_latitude, a.checkout_longitude,
             a.supervisor_status
      FROM attendance_requests r
      LEFT JOIN attendance a
        ON a.uuid = r.uuid AND a.date = r.req_date
      WHERE r.uuid = ?
      ORDER BY r.submitted_at DESC
      LIMIT ?
    `).bind(uuid, limit).all();

    return json({ success: true, data: rows.results || [] });
  }

  // ================= POST =================
  if (request.method === 'POST') {
    const body = await request.json();

    const {
      uuid, request_type, req_date, req_time, reason,
      name, department, approver_uuid, supervisor_name,
      work_type, note, latitude, longitude, distance_m, is_in_range,
    } = body;

    if (!uuid || !request_type || !req_date || !reason)
      return json({ success: false, message: 'ข้อมูลไม่ครบ' }, 400);

    if (uuid !== userRow.uuid)
      return json({ success: false, message: 'UUID ไม่ตรงกัน' }, 403);

    const attRow = await env.DB.prepare(`
      SELECT * FROM attendance
      WHERE uuid = ? AND date = ?
    `).bind(uuid, req_date).first();

    const hasCheckin = !!attRow?.checkin_time;
    const hasCheckout = !!attRow?.checkout_time;

    // ===== VALIDATION =====
    if (REQUIRE_CHECKIN.includes(request_type) && !hasCheckin) {
      return json({ success: false, message: 'ต้องมีเวลาเข้า ก่อน' }, 400);
    }

    if (request_type === 'ลืมลงเวลาเข้า' && hasCheckin)
      return json({ success: false, message: 'มีเวลาเข้าแล้ว' }, 400);

    if (request_type === 'ลืมลงเวลาออก' && hasCheckout)
      return json({ success: false, message: 'มีเวลาออกแล้ว' }, 400);

    if (request_type === 'แก้ไขเวลาออก' && !hasCheckout)
      return json({ success: false, message: 'ยังไม่มีเวลาออก' }, 400);

    const dup = await checkDuplicateRequest(env, uuid, request_type, req_date);
    if (dup)
      return json({ success: false, message: 'มีคำขอซ้ำ' }, 400);

    const approver = await env.DB.prepare(`
      SELECT name FROM users WHERE uuid = ?
    `).bind(approver_uuid).first();

    const ref = generateRef(uuid);
    const refAT = generateRefAT(uuid);
    const supName = supervisor_name || approver?.name;

    // ── ตรวจสอบพื้นที่ จ.บึงกาฬ ──────────────────────────────────────────────
    let finalDistanceM = distance_m;
    let finalIsInRange = is_in_range;
    let locationDisplay = null;
    let locationCheckResult = null; // เก็บรายละเอียดเพิ่มเติม

    // ✅ ส่ง env เข้าไปในฟังก์ชัน checkBuengKan
    if (latitude && longitude) {
      const loc = await checkBuengKan(latitude, longitude, env);
      
      if (loc.inProvince) {
        // อยู่ใน จ.บึงกาฬ บังคับ distance = 0 และ in_range = 1
        finalDistanceM = 0;
        finalIsInRange = true;
        locationDisplay = `📍 อยู่ในพื้นที่จังหวัดบึงกาฬ`;
        locationCheckResult = {
          inBuengKan: true,
          displayName: loc.displayName,
         message: 'ตรวจพบว่าอยู่ในพื้นที่จังหวัดบึงกาฬ'
        };
      } else {
        locationDisplay = `📍 นอกพื้นที่จังหวัดบึงกาฬ`;
        locationCheckResult = {
          inBuengKan: false,
          displayName: loc.displayName,
          message: 'อยู่นอกพื้นที่จังหวัดบึงกาฬ'
        };
      }
    }

    // แปลงค่าให้เหมาะสมกับ Database (1/0/null)
    const inRangeVal = finalIsInRange != null ? (finalIsInRange ? 1 : 0) : null;

    // ===== INSERT REQUEST =====
     await env.DB.prepare(`
        INSERT INTO attendance_requests
          (uuid, approver_uuid, reference, request_type, req_date, req_time,
           reason, name, department, supervisor_name, status, submitted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)
      `).bind(
        uuid, approver_uuid, ref, request_type,
        req_date, req_time || null, reason,
        name || null, department || null, supName
      ).run();

    // ===== UPDATE ATTENDANCE =====
    if (attRow) {

      // ===== CHECKIN =====
      if (request_type.includes('เวลาเข้า')) {
        await env.DB.prepare(`
          UPDATE attendance SET
            checkin_work_type  = COALESCE(checkin_work_type, ?),
            checkin_note       = COALESCE(checkin_note, ?),
            checkin_latitude   = COALESCE(checkin_latitude, ?),
            checkin_longitude  = COALESCE(checkin_longitude, ?),
            checkin_distance_m = COALESCE(checkin_distance_m, ?),
            checkin_in_range   = COALESCE(checkin_in_range, ?),

            request_ref        = ?,
            request_type       = ?,
            request_reason     = ?,
            request_at         = CURRENT_TIMESTAMP,

            approver_uuid      = ?,
            supervisor_name    = ?,
            supervisor_status  = 'pending',
            updated_at         = CURRENT_TIMESTAMP
          WHERE uuid = ? AND date = ?
        `).bind(
          work_type || 'ปกติ',
          note || null,
          latitude ?? null,
          longitude ?? null,
          finalDistanceM ?? null,
          inRangeVal,
          ref, request_type, reason,
          approver_uuid, supName,
          uuid, req_date
        ).run();
      }

      // ===== CHECKOUT =====
      if (request_type.includes('เวลาออก')) {
        await env.DB.prepare(`
          UPDATE attendance SET
            checkout_work_type  = COALESCE(checkout_work_type, ?),
            checkout_note       = COALESCE(checkout_note, ?),
            checkout_latitude   = COALESCE(checkout_latitude, ?),
            checkout_longitude  = COALESCE(checkout_longitude, ?),
            checkout_distance_m = COALESCE(checkout_distance_m, ?),
            checkout_in_range   = COALESCE(checkout_in_range, ?),

            request_ref        = ?,
            request_type       = ?,
            request_reason     = ?,
            request_at         = CURRENT_TIMESTAMP,

            approver_uuid      = ?,
            supervisor_name    = ?,
            supervisor_status  = 'pending',
            updated_at         = CURRENT_TIMESTAMP
          WHERE uuid = ? AND date = ?
        `).bind(
          work_type || 'ปกติ',
          note || null,
          latitude ?? null,
          longitude ?? null,
          finalDistanceM ?? null,
          inRangeVal,
          ref, request_type, reason,
          approver_uuid, supName,
          uuid, req_date
        ).run();
      }

    } else {
      // ===== CREATE ROW =====
      await env.DB.prepare(`
        INSERT INTO attendance (
          uuid, date,
          checkin_work_type, checkin_note,
          checkin_latitude, checkin_longitude,
          checkin_distance_m, checkin_in_range,
          checkin_reference,
          request_ref, request_type, request_reason, request_at,
          approver_uuid, supervisor_name, supervisor_status,

          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(
        uuid, req_date,
        work_type || 'ปกติ',
        note || null,
        latitude ?? null,
        longitude ?? null,
        finalDistanceM ?? null,
        inRangeVal,
        refAT,
        ref, request_type, reason,
        approver_uuid, supName
      ).run();
    }

    const now = new Date();

    // ✅ ส่งข้อมูล location กลับไปด้วย
    return json({
      success: true,
      message: 'ส่งคำขอสำเร็จ',
      data: {
        reference: ref,
        status: 'pending',
        supervisor_status: 'pending',
        approver: approver?.name || null,
        supervisor_name: supName,
        submitted_at: now.toISOString(),
        location_display: locationDisplay, // ส่งข้อความสำหรับแสดงผล
        location_check: locationCheckResult, // ส่งรายละเอียดเพิ่มเติม
        attendance: {
          has_checkin:  hasCheckin,
          has_checkout: hasCheckout,
          checkin_time: attRow?.checkin_time || null,
          checkout_time: attRow?.checkout_time || null,
        }
      }
    });

  }

  // ================= DELETE (cancel) =================
  if (request.method === 'DELETE') {
    const body = await request.json();
    const { uuid, reference } = body;

    if (!uuid || !reference)
      return json({ success: false, message: 'ข้อมูลไม่ครบ' }, 400);

    if (uuid !== userRow.uuid)
      return json({ success: false, message: 'UUID ไม่ตรงกัน' }, 403);

    const row = await env.DB.prepare(`
      SELECT id, status, req_date, request_type
      FROM attendance_requests
      WHERE reference = ? AND uuid = ?
      LIMIT 1
    `).bind(reference, uuid).first();

    if (!row)
      return json({ success: false, message: 'ไม่พบคำขอ' }, 404);

    if (row.status !== 'pending')
      return json({ success: false, message: `ไม่สามารถยกเลิกได้ (สถานะ: ${row.status})` }, 400);

    await env.DB.prepare(`
      UPDATE attendance_requests
      SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
      WHERE reference = ? AND uuid = ?
    `).bind(reference, uuid).run();

    await env.DB.prepare(`
      UPDATE attendance
      SET request_ref       = NULL,
          request_type      = NULL,
          request_reason    = NULL,
          request_at        = NULL,
          approver_uuid     = NULL,
          supervisor_name   = NULL,
          supervisor_status = NULL,
          updated_at        = CURRENT_TIMESTAMP
      WHERE uuid = ? AND date = ? AND request_ref = ?
    `).bind(uuid, row.req_date, reference).run();

    return json({
      success: true,
      message: 'ยกเลิกคำขอสำเร็จ',
      data: { reference, status: 'cancelled' }
    });
  }

  return json({ success: false, message: 'Method not allowed' }, 405);
}