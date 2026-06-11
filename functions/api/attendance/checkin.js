// functions/api/attendance/checkin.js
// POST /api/attendance/checkin  — checkin & checkout

import { authUser, extractToken } from '../_auth.js';
import {  BUENGKAN_POLYGON,  BUENGKAN_BOUNDS} from '../../lib/buengkan.js';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const json = (d, s = 200) => Response.json(d, { status: s, headers: CORS });

function getThaiDateTime() {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(new Date());

  const get = type =>
    parts.find(p => p.type === type)?.value || '';

  const dateISO =
    `${get('year')}-${get('month')}-${get('day')}`;

  const timeStr =
    `${get('hour')}:${get('minute')}:${get('second')}`;

  const isoString =
    `${dateISO}T${timeStr}+07:00`;

  return {
    dateISO,
    timeStr,
    isoString
  };
}

function generateRef(prefix = 'ATT') {
  const { dateISO } = getThaiDateTime();

  const datePart = dateISO
    .replace(/-/g, '')
    .slice(2);

  const randPart = crypto.randomUUID()
    .replace(/-/g, '')
    .slice(0, 6)
    .toUpperCase();

  return `${prefix}-${datePart}-${randPart}`;
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


function pointInPolygon(lat, lon, polygon) {
  let inside = false;

  for (
    let i = 0, j = polygon.length - 1;
    i < polygon.length;
    j = i++
  ) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];

    const xj = polygon[j][0];
    const yj = polygon[j][1];

    const intersect =
      ((yi > lat) !== (yj > lat)) &&
      (
        lon <
        ((xj - xi) * (lat - yi)) /
        (yj - yi) +
        xi
      );

    if (intersect) inside = !inside;
  }

  return inside;
}

function isBuengKanByBoundingBox(lat, lon) {
  return (
    lat >= BUENGKAN_BOUNDS.minLat &&
    lat <= BUENGKAN_BOUNDS.maxLat &&
    lon >= BUENGKAN_BOUNDS.minLon &&
    lon <= BUENGKAN_BOUNDS.maxLon
  );
}

async function checkBuengKan(lat, lon, env) {

  // STEP 1 : LocationIQ
  try {

    const apiKey = env.LOCATIONIQ_KEY;

    const res = await fetch(
      `https://us1.locationiq.com/v1/reverse?key=${apiKey}&lat=${lat}&lon=${lon}&format=json`,
      {
        signal: AbortSignal.timeout(5000)
      }
    );

    if (res.ok) {

      const data = await res.json();
      const addr = data.address || {};

      const province =
        addr.province ||
        addr.state ||
        addr.region ||
        "";

      const p = cleanText(province);

      if (
        p.includes("บึงกาฬ") ||
        p.includes("bueng kan")
      ) {

        return {
          inProvince: true,
          source: "locationiq",
          province,
          city: addr.city || addr.town || addr.village || "-",
          displayName: data.display_name || "-"
        };

      }
    }

  } catch (err) {

    console.warn(
      "LocationIQ failed:",
      err.message
    );

  }

  // STEP 2 : Polygon
  try {

    if (
      pointInPolygon(
        lat,
        lon,
        BUENGKAN_POLYGON
      )
    ) {

      return {
        inProvince: true,
        source: "polygon",
        province: "บึงกาฬ",
        city: "-",
        displayName: "Polygon จังหวัดบึงกาฬ"
      };

    }

  } catch (err) {

    console.warn(
      "Polygon failed:",
      err.message
    );

  }

  // STEP 3 : Bounding Box
  if (
    isBuengKanByBoundingBox(
      lat,
      lon
    )
  ) {

return {
  inProvince: true,
  source: "bounding-box",
  province: "บึงกาฬ",
  city: "-",
  displayName: "Bounding Box จังหวัดบึงกาฬ"
};

  }

  return {
    inProvince: false,
    source: "none",
    province: "-",
    city: "-"
  };
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
    latitude, longitude, distance_m, is_in_range
    // ✅ ลบ timestamp_iso ออกเพื่อความปลอดภัย (ป้องกันการปลอมเวลา)
  } = body;

  if (!uuid || !action) return json({ success: false, message: 'ข้อมูลไม่ครบถ้วน' }, 400);
  if (uuid !== userRow.uuid) return json({ success: false, message: 'UUID ไม่ตรงกัน' }, 403);
  if (!['checkin', 'checkout'].includes(action)) return json({ success: false, message: 'action ไม่ถูกต้อง' }, 400);

  // เรียกจากฟังก์ชัน getThaiDateTime
  const { dateISO, timeStr, isoString } = getThaiDateTime();

  // ── อ่าน approver_uuid จาก user_data (supervisor_code)
  const userInfo = await env.DB.prepare(
    `SELECT supervisor_code, supervisor FROM users WHERE uuid = ? LIMIT 1`
  ).bind(uuid).first();
  const approverUuid   = userInfo?.supervisor_code || null;
  const supervisorName = userInfo?.supervisor || null;
  if (!approverUuid || !supervisorName) {
    return json({ success: false, message: 'กรุณากำหนดหัวหน้าก่อน' }, 400);
  }

  // ✅ เพิ่ม Validation: ตรวจสอบค่าพิกัดให้ถูกต้องก่อนไปใช้งาน
  let lat = latitude ? parseFloat(latitude) : null;
  let lon = longitude ? parseFloat(longitude) : null;
  if (lat !== null && (isNaN(lat) || lat < -90 || lat > 90)) lat = null;
  if (lon !== null && (isNaN(lon) || lon < -180 || lon > 180)) lon = null;

  // ── ตรวจสอบพื้นที่ จ.บึงกาฬ ──────────────────────────────────────────────
  let finalDistanceM = distance_m != null ? parseFloat(distance_m) : null;
  let finalIsInRange = is_in_range;
  let locationDisplay = null;
  let locationDetail = null;

 if (lat !== null && lon !== null) {
    const loc = await checkBuengKan(lat, lon, env);
    
    if (loc.inProvince) {
      finalDistanceM = 0;
      finalIsInRange = true;
      locationDisplay = `📍 อยู่ในพื้นที่จังหวัดบึงกาฬ`;
      locationDetail = {
        inBuengKan: true,
        province: loc.province,
        city: loc.city,
        source: loc.source,
        displayName: loc.displayName,
        message:
          loc.source === "locationiq"
            ? "✅ ตรวจสอบจาก LocationIQ"
            : loc.source === "polygon"
            ? "✅ ตรวจสอบจาก Polygon จังหวัดบึงกาฬ"
            : "✅ ตรวจสอบจาก Bounding Box จังหวัดบึงกาฬ"
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

  const inRangeVal = finalIsInRange != null ? (finalIsInRange ? 1 : 0) : null;

  // ── CHECKIN ───────────────────────────────────────────────────────────────
  if (action === 'checkin') {
    const existing = await env.DB.prepare(
      `SELECT id, checkin_time FROM attendance WHERE uuid = ? AND date = ? LIMIT 1`
    ).bind(uuid, dateISO).first();

    if (existing?.checkin_time) {
      return json({ success: false, message: 'คุณได้ลงเวลาเข้าในวันนี้แล้ว', duplicate: true }, 409);
    }

    const ref = generateRef('ATT');

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
          lat, lon,
          finalDistanceM, inRangeVal,
          ref, isoString, // ✅ ใช้ isoString ที่คำนวณไว้
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
            ?, ?, 'pending',
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          )
        `).bind(
          uuid, dateISO,
          timeStr, work_type || 'ปกติ', note || null,
          lat, lon, finalDistanceM, inRangeVal,
          ref, isoString, // ✅ ใช้ isoString ที่คำนวณไว้
          work_type || 'ปกติ', `${dateISO}T16:30:00+07:00`,
          approverUuid, supervisorName
        ).run();
      }

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
          supervisor_status: 'pending',
          location_display: locationDisplay,
          location_detail: locationDetail
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
        lat, lon,
        finalDistanceM, inRangeVal,
        isoString, // ✅ ใช้ isoString ที่คำนวณไว้
        uuid, dateISO
      ).run();

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
          location_detail: locationDetail
        },
      });
    } catch (err) {
      console.error('[checkout]', err);
      return json({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message }, 500);
    }
  }
}