// functions/api/attendance/checkin.js
// POST /api/attendance/checkin  — checkin & checkout
// โครงสร้างใหม่: 1 แถวต่อ (uuid, date) ใน attendance_v2
// เมื่อ checkin → INSERT แถวใหม่ + auto-checkout 16:30
// เมื่อ checkout → UPDATE แถวเดิม

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const json = (d, s = 200) => Response.json(d, { status: s, headers: CORS });

// ref: AT-{UUID8}-{YYYYMMDD}-{HHmmss}
function generateRef(uuid, now = new Date()) {
  const u = (uuid || 'NOUID').replace(/-/g, '').slice(0, 8).toUpperCase();
  const d = now.toISOString().slice(0, 10).replace(/-/g, '');
  const t = now.toTimeString().slice(0, 8).replace(/:/g, '');
  return `AT-${u}-${d}-${t}`;
}

async function authUser(env, token) {
  return env.DB.prepare(
    `SELECT uuid FROM users
     WHERE auth_token = ? AND token_expires_at > CURRENT_TIMESTAMP AND status = 'Active'`
  ).bind(token).first();
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (request.method !== 'POST')    return json({ success: false, message: 'Method not allowed' }, 405);

  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return json({ success: false, message: 'กรุณาเข้าสู่ระบบ' }, 401);
  const userRow = await authUser(env, auth.slice(7));
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

  const now     = timestamp_iso ? new Date(timestamp_iso) : new Date();
  const dateISO = now.toISOString().slice(0, 10);
  const timeStr = now.toTimeString().slice(0, 8);

  // ── อ่าน approver_uuid จาก user_data (supervisor_code)
  const userInfo = await env.DB.prepare(
    `SELECT supervisor_code, supervisor FROM users WHERE uuid = ? LIMIT 1`
  ).bind(uuid).first();
  const approverUuid   = userInfo?.supervisor_code || null;
  const supervisorName = userInfo?.supervisor || null;

  // ── CHECKIN ───────────────────────────────────────────────────────────────
  if (action === 'checkin') {
    // ตรวจสอบว่ามีแถวของวันนี้แล้วหรือยัง
    const existing = await env.DB.prepare(
      `SELECT id, checkin_time FROM attendance WHERE uuid = ? AND date = ? LIMIT 1`
    ).bind(uuid, dateISO).first();

    if (existing?.checkin_time) {
      return json({ success: false, message: 'คุณได้ลงเวลาเข้าในวันนี้แล้ว', duplicate: true }, 409);
    }

    const ref = generateRef(uuid, now);
    const inRangeVal = is_in_range != null ? (is_in_range ? 1 : 0) : null;

    try {
      if (existing) {
        // มีแถวอยู่แล้ว (อาจสร้างจาก request) → UPDATE checkin fields
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
          distance_m ?? null, inRangeVal,
          ref, now.toISOString(),
          uuid, dateISO
        ).run();
      } else {
        // สร้างแถวใหม่ พร้อม auto-checkout 16:30
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
          latitude ?? null, longitude ?? null, distance_m ?? null, inRangeVal,
          ref, now.toISOString(),
          work_type || 'ปกติ', `${dateISO}T16:30:00`,
          approverUuid, supervisorName
        ).run();
      }

      return json({
        success: true,
        message: 'บันทึกเวลาเข้าสำเร็จ',
        data: {
          action: 'checkin',
          reference: ref,
          date: dateISO,
          time_str: timeStr,
          auto_checkout_at: '16:30',
          supervisor_status: 'none',
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

    // ป้องกัน manual checkout ซ้ำ
    if (row.checkout_type === 'manual') {
      return json({ success: false, message: 'คุณได้ลงเวลาออกในวันนี้แล้ว', duplicate: true }, 409);
    }

    const inRangeVal = is_in_range != null ? (is_in_range ? 1 : 0) : null;

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
        distance_m ?? null, inRangeVal,
        now.toISOString(),
        uuid, dateISO
      ).run();

      return json({
        success: true,
        message: 'บันทึกเวลาออกสำเร็จ',
        data: { action: 'checkout', checkout_type: 'manual', date: dateISO, time_str: timeStr },
      });
    } catch (err) {
      console.error('[checkout]', err);
      return json({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message }, 500);
    }
  }
}