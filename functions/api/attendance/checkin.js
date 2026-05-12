// functions/api/attendance/checkin.js
// POST /api/attendance/checkin  — checkin & checkout

import { authUser, extractToken } from '../_auth.js';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const json = (d, s = 200) => Response.json(d, { status: s, headers: CORS });

// ref: AT-{UUID8}-{YYYYMMDD}-{HHmmss}
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

    if (!res.ok) {
      console.error(`LocationIQ API error: ${res.status} ${res.statusText}`);
      throw new Error(`API ERROR: ${res.status}`);
    }

    const data = await res.json();
    const addr = data.address || {};

    let province = addr.province || addr.state || addr.region || "";
    const p = cleanText(province);

    const isProvince = p.includes("บึงกาฬ") || p.includes("bueng kan");

    return {
      inProvince: isProvince,
      displayName: data.display_name || "-",
      province: province,
      city: addr.city || addr.town || addr.village || "-"
    };
  } catch (e) {
    console.error('Location check error:', e.message);
    return {
      inProvince: false,
      displayName: "-",
      error: e.message
    };
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (request.method !== 'POST')    return json({ success: false, message: 'Method not allowed' }, 405);

  const token   = extractToken(request);
  const userRow = await authUser(env, token);
  if (!userRow) return json({ success: false, message: 'Token ไม่ถูกต้องหรือหมดอายุ' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ success: false, message: 'Invalid JSON' }, 400); }

  const {
    uuid, action, work_type, note,
    latitude, longitude, distance_m, is_in_range,
    timestamp_iso
  } = body;

  if (!uuid || !action) return json({ success: false, message: 'ข้อมูลไม่ครบถ้วน' }, 400);
  if (uuid !== userRow.uuid) return json({ success: false, message: 'UUID ไม่ตรงกัน' }, 403);
  if (!['checkin', 'checkout'].includes(action)) return json({ success: false, message: 'action ไม่ถูกต้อง' }, 400);

  const now = timestamp_iso ? new Date(timestamp_iso) : new Date();

  if (isNaN(now.getTime())) {
    return json({ success: false, message: 'รูปแบบเวลาไม่ถูกต้อง' }, 400);
  }

  // UTC+7
  const offsetMs = 7 * 60 * 60 * 1000;
  const thaiNow = new Date(Date.now() + offsetMs);

  const dateISO = thaiNow.toISOString().slice(0, 10);
  const timeStr = thaiNow.toISOString().slice(11, 19);

  const todayISO = new Date().toISOString().slice(0, 10);
  if (dateISO !== todayISO) {
    return json({ success: false, message: 'ไม่สามารถลงเวลาย้อนหลังหรือข้ามวันได้' }, 400);
  }

  // ── อ่าน approver_uuid จาก user_data (supervisor_code)
  const userInfo = await env.DB.prepare(
    `SELECT supervisor_code, supervisor FROM users WHERE uuid = ? LIMIT 1`
  ).bind(uuid).first();
  const approverUuid   = userInfo?.supervisor_code || null;
  const supervisorName = userInfo?.supervisor || null;

  // ── ตรวจสอบพื้นที่ จ.บึงกาฬ ──────────────────────────────────────────────
  let finalDistanceM = distance_m;
  let finalIsInRange = is_in_range;
  let locationDisplay = null;
  let locationDetail = null;

  // ✅ ส่ง env เข้าไปในฟังก์ชัน checkBuengKan
  if (latitude && longitude) {
    const loc = await checkBuengKan(latitude, longitude, env);
    
    if (loc.inProvince) {
      // อยู่ใน จ.บึงกาฬ บังคับ distance = 0 และ in_range = 1
      finalDistanceM = 0;
      finalIsInRange = true;
      locationDisplay = `📍 อยู่ในพื้นที่จังหวัดบึงกาฬ`;
      locationDetail = {
        inBuengKan: true,
        province: loc.province,
        city: loc.city,
        displayName: loc.displayName,
        message: '✅ ตรวจพบว่าอยู่ในพื้นที่จังหวัดบึงกาฬ'
      };
    } else {
      locationDisplay = `📍 นอกพื้นที่จังหวัดบึงกาฬ`;
      locationDetail = {
        inBuengKan: false,
        province: loc.province,
        city: loc.city,
        displayName: loc.displayName,
        message: loc.error ? `⚠️ ไม่สามารถตรวจสอบพื้นที่ได้: ${loc.error}` : '📍 อยู่นอกพื้นที่จังหวัดบึงกาฬ'
      };
    }
  }

  // แปลงค่าให้เหมาะสมกับ Database (1/0/null)
  const inRangeVal = finalIsInRange != null ? (finalIsInRange ? 1 : 0) : null;

  // ── CHECKIN ───────────────────────────────────────────────────────────────
  if (action === 'checkin') {
    const existing = await env.DB.prepare(
      `SELECT id, checkin_time FROM attendance WHERE uuid = ? AND date = ? LIMIT 1`
    ).bind(uuid, dateISO).first();

    if (existing?.checkin_time) {
      return json({ success: false, message: 'คุณได้ลงเวลาเข้าในวันนี้แล้ว', duplicate: true }, 409);
    }

    const ref = generateRef(uuid, now);

    try {
      if (existing) {
        await env.DB.prepare(`
          UPDATE attendance SET
            checkin_time      = ?,
            checkin_work_type = ?,
            checkin_note      = ?,
            checkin_latitude  = ?,
            checkin_longitude = ?,
            checkin_distance_m = ?,
            checkin_in_range  = ?,
            checkin_reference = ?,
            checkin_iso       = ?,
            checkin_at        = CURRENT_TIMESTAMP,
            updated_at        = CURRENT_TIMESTAMP
          WHERE uuid = ? AND date = ?
        `).bind(
          timeStr, work_type || 'ปกติ', note || null,
          latitude ?? null, longitude ?? null,
          finalDistanceM ?? null, inRangeVal,
          ref, now.toISOString(),
          uuid, dateISO
        ).run();
      } else {
        await env.DB.prepare(`
          INSERT INTO attendance (
            uuid, date,
            checkin_time, checkin_work_type, checkin_note,
            checkin_latitude, checkin_longitude, checkin_distance_m, checkin_in_range,
            checkin_reference, checkin_iso, checkin_at,
            checkout_time, checkout_type, checkout_work_type, checkout_iso,
            approver_uuid, supervisor_name, supervisor_status,
            created_at, updated_at
          ) VALUES (
            ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, CURRENT_TIMESTAMP,
            '16:30:00', 'auto', ?, ?,
            ?, ?, 'none',
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          )
        `).bind(
          uuid, dateISO,
          timeStr, work_type || 'ปกติ', note || null,
          latitude ?? null, longitude ?? null, finalDistanceM ?? null, inRangeVal,
          ref, now.toISOString(),
          work_type || 'ปกติ', `${dateISO}T16:30:00`,
          approverUuid, supervisorName
        ).run();
      }

      // ✅ ส่งข้อมูล location กลับไปด้วย
      return json({
        success: true,
        message: locationDetail?.inBuengKan 
          ? '✅ บันทึกเวลาเข้าสำเร็จ (อยู่ในพื้นที่จังหวัดบึงกาฬ)'
          : 'บันทึกเวลาเข้าสำเร็จ',
        data: {
          action: 'checkin',
          reference: ref,
          date: dateISO,
          time_str: timeStr,
          auto_checkout_at: '16:30',
          supervisor_status: 'none',
          location_display: locationDisplay,
          location_detail: locationDetail // ส่งรายละเอียดเพิ่มเติม
        },
      });
    } catch (err) {
      console.error('[checkin]', err);
      return json({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message }, 500);
    }
  }

  // ── CHECKOUT ──────────────────────────────────────────────────────────────
  if (action === 'checkout') {
    const row = await env.DB.prepare(
      `SELECT id, checkin_time, checkout_type FROM attendance WHERE uuid = ? AND date = ? LIMIT 1`
    ).bind(uuid, dateISO).first();

    if (!row) return json({ success: false, message: 'ยังไม่ได้ลงเวลาเข้าวันนี้' }, 400);
    if (!row.checkin_time) return json({ success: false, message: 'ยังไม่ได้ลงเวลาเข้าวันนี้' }, 400);

    if (row.checkout_type === 'manual') {
      return json({ success: false, message: 'คุณได้ลงเวลาออกในวันนี้แล้ว', duplicate: true }, 409);
    }

    try {
      await env.DB.prepare(`
        UPDATE attendance SET
          checkout_time      = ?,
          checkout_type      = 'manual',
          checkout_work_type = ?,
          checkout_note      = ?,
          checkout_latitude  = ?,
          checkout_longitude = ?,
          checkout_distance_m = ?,
          checkout_in_range  = ?,
          checkout_iso       = ?,
          checkout_at        = CURRENT_TIMESTAMP,
          updated_at         = CURRENT_TIMESTAMP
        WHERE uuid = ? AND date = ?
      `).bind(
        timeStr, work_type || 'ปกติ', note || null,
        latitude ?? null, longitude ?? null,
        finalDistanceM ?? null, inRangeVal,
        now.toISOString(),
        uuid, dateISO
      ).run();

      // ✅ ส่งข้อมูล location กลับไปด้วย
      return json({
        success: true,
        message: locationDetail?.inBuengKan
          ? '✅ บันทึกเวลาออกสำเร็จ (อยู่ในพื้นที่จังหวัดบึงกาฬ)'
          : 'บันทึกเวลาออกสำเร็จ',
        data: { 
          action: 'checkout', 
          checkout_type: 'manual', 
          date: dateISO, 
          time_str: timeStr,
          location_display: locationDisplay,
          location_detail: locationDetail // ส่งรายละเอียดเพิ่มเติม
        },
      });
    } catch (err) {
      console.error('[checkout]', err);
      return json({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message }, 500);
    }
  }
}