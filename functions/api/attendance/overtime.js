// functions/api/attendance/overtime.js
import { authUser, extractToken } from '../_auth.js';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const json = (d, s = 200) => Response.json(d, { status: s, headers: CORS });

const DEFAULT_OT_MAX_HOURS  = 7;
const OT_DEFAULT_START_TIME = '16:30';

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

function generateRef(workType = '') {
    const { dateISO } = getThaiDateTime();

  const prefix = workType === 'เวรวันหยุด'
    ? 'PH'
    : 'OT';

  const datePart = dateISO
    .replace(/-/g, '')
    .slice(2);

  const randPart = crypto.randomUUID()
    .replace(/-/g, '')
    .slice(0, 6)
    .toUpperCase();

  return `${prefix}-${datePart}-${randPart}`;
}



function calcOtHours(start, end) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60;
  return Math.round((mins / 60) * 100) / 100;
}

function calcOtEnd(start, maxHours) {
  const [sh, sm] = start.split(':').map(Number);
  const totalMins = sh * 60 + sm + Math.round(maxHours * 60);
  const hh = Math.floor(totalMins / 60) % 24;
  const mm = totalMins % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// ===== ฟังก์ชันเกี่ยวกับพื้นที่ (เพิ่มเข้ามา) =====
function cleanText(text) {
  return text
    .toLowerCase()
    .replace("จังหวัด", "")
    .replace("changwat", "")
    .replace("province", "")
    .trim();
}

async function checkBuengKan(lat, lon, env) {
  try {
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

  const token   = extractToken(request);
  const userRow = await authUser(env, token);
  if (!userRow) return json({ success: false, message: 'Token ไม่ถูกต้องหรือหมดอายุ' }, 401);

  // GET
  if (request.method === 'GET') {
    const url    = new URL(request.url);
    const mode   = url.searchParams.get('mode') || 'mine';
    const limit  = Math.min(parseInt(url.searchParams.get('limit') || '30'), 100);
    const offset = parseInt(url.searchParams.get('offset') || '0');

    if (mode === 'supervisor') {
      const status    = url.searchParams.get('status')    || 'all';
      const date_from = url.searchParams.get('date_from') || '';
      const date_to   = url.searchParams.get('date_to')   || '';
      const search    = url.searchParams.get('search')    || '';

      const cond = ['o.approver_code = ?'];
      const bind = [userRow.uuid];
      if (status !== 'all') { cond.push('o.supervisor_status = ?'); bind.push(status); }
      if (date_from) { cond.push('o.ot_date >= ?'); bind.push(date_from); }
      if (date_to)   { cond.push('o.ot_date <= ?'); bind.push(date_to); }
      if (search)    {
        cond.push('(o.name LIKE ? OR o.department LIKE ?)');
        bind.push(`%${search}%`, `%${search}%`);
      }
      const where = 'WHERE ' + cond.join(' AND ');

      try {
        const countRow = await env.DB.prepare(
          `SELECT COUNT(*) as total FROM attendance_overtime o ${where}`
        ).bind(...bind).first();

        const rows = await env.DB.prepare(`
          SELECT o.*, u.picture, u.profileImage, u.position, u.firstName, u.lastName, u.prefix
          FROM attendance_overtime o
          LEFT JOIN users u ON u.uuid = o.uuid
          ${where}
          ORDER BY
            CASE o.supervisor_status WHEN 'pending' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END,
            o.ot_date DESC, o.submitted_at DESC
          LIMIT ? OFFSET ?
        `).bind(...bind, limit, offset).all();

        const counts = await env.DB.prepare(
          `SELECT supervisor_status, COUNT(*) as cnt FROM attendance_overtime WHERE approver_code = ? GROUP BY supervisor_status`
        ).bind(userRow.uuid).all();
        const statusCount = { pending: 0, approved: 0, rejected: 0, cancelled: 0 };
        (counts.results || []).forEach(r => { statusCount[r.supervisor_status] = (statusCount[r.supervisor_status] || 0) + r.cnt; });

        return json({ success: true, total: countRow?.total || 0, limit, offset, statusCount, data: rows.results || [] });
      } catch (err) {
        return json({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message }, 500);
      }
    }

    // mode: mine
    const uuid = url.searchParams.get('uuid') || userRow.uuid;
    if (uuid !== userRow.uuid) return json({ success: false, message: 'UUID ไม่ตรงกัน' }, 403);

    const status    = url.searchParams.get('status')    || 'all';
    const date_from = url.searchParams.get('date_from') || '';
    const date_to   = url.searchParams.get('date_to')   || '';

    const cond = ['uuid = ?'];
    const bind = [uuid];
    if (status !== 'all') { cond.push('supervisor_status = ?'); bind.push(status); }
    if (date_from) { cond.push('ot_date >= ?'); bind.push(date_from); }
    if (date_to)   { cond.push('ot_date <= ?'); bind.push(date_to); }
    const where = 'WHERE ' + cond.join(' AND ');

    try {
      const countRow = await env.DB.prepare(
        `SELECT COUNT(*) as total FROM attendance_overtime ${where}`
      ).bind(...bind).first();

      const rows = await env.DB.prepare(`
        SELECT * FROM attendance_overtime ${where}
        ORDER BY ot_date DESC, submitted_at DESC LIMIT ? OFFSET ?
      `).bind(...bind, limit, offset).all();

      const counts = await env.DB.prepare(
        `SELECT supervisor_status, COUNT(*) as cnt FROM attendance_overtime WHERE uuid = ? GROUP BY supervisor_status`
      ).bind(uuid).all();
      const statusCount = { pending: 0, approved: 0, rejected: 0, cancelled: 0 };
      (counts.results || []).forEach(r => { statusCount[r.supervisor_status] = (statusCount[r.supervisor_status] || 0) + r.cnt; });

      const sumCond = ['uuid = ?', "supervisor_status = 'approved'"];
      const sumBind = [uuid];
      if (date_from) { sumCond.push('ot_date >= ?'); sumBind.push(date_from); }
      if (date_to)   { sumCond.push('ot_date <= ?'); sumBind.push(date_to); }
      const sumWhere = 'WHERE ' + sumCond.join(' AND ');

      const sumRow = await env.DB.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN work_type != 'เวรวันหยุด' THEN amount_hour ELSE 0 END), 0) as total_amount_hour,
          COALESCE(SUM(CASE WHEN work_type  = 'เวรวันหยุด' THEN amount_day  ELSE 0 END), 0) as total_amount_day,
          COALESCE(SUM(CASE WHEN work_type != 'เวรวันหยุด' THEN ot_hours    ELSE 0 END), 0) as total_ot_hours,
          COALESCE(SUM(CASE WHEN work_type  = 'เวรวันหยุด' THEN IFNULL(ot_days, 1) ELSE 0 END), 0) as total_ot_days,
          COUNT(*) as total_approved
        FROM attendance_overtime ${sumWhere}
      `).bind(...sumBind).first();

      return json({
        success: true, total: countRow?.total || 0, limit, offset, statusCount,
        summary: sumRow || { total_amount_hour: 0, total_amount_day: 0, total_ot_hours: 0, total_ot_days: 0, total_approved: 0 },
        data: rows.results || [],
      });
    } catch (err) {
      return json({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message }, 500);
    }
  }

  // POST
  if (request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ success: false, message: 'Invalid JSON' }, 400); }

    const {
      uuid, ot_date, ot_start, ot_end, note, name, department, affiliation,
      latitude, longitude, distance_m, is_in_range, timestamp_iso, ot_max_hr,
      work_type: bodyWorkType, approver_code, approver,
    } = body;

    if (!uuid || !ot_date || !ot_start)
      return json({ success: false, message: 'ข้อมูลไม่ครบถ้วน (uuid, ot_date, ot_start)' }, 400);
    if (uuid !== userRow.uuid)
      return json({ success: false, message: 'UUID ไม่ตรงกัน' }, 403);

    const userInfo = await env.DB.prepare(`
      SELECT approver_code, approver, name, firstName, lastName, prefix,
             department as dep, affiliation as aff,
             ot_rate_per_hour, ot_rate_per_day, ot_max_hours_per_day
      FROM users WHERE uuid = ? LIMIT 1
    `).bind(uuid).first();

    const ratePerHour = userInfo?.ot_rate_per_hour     ?? null;
    const ratePerDay  = userInfo?.ot_rate_per_day      ?? null;

    const workType  = (bodyWorkType && bodyWorkType.trim()) ? bodyWorkType.trim() : 'นอกเวลาราชการ (OT)';
    const isHoliday = workType === 'เวรวันหยุด';

    const maxHours = isHoliday
  ? DEFAULT_OT_MAX_HOURS
  : (userInfo?.ot_max_hours_per_day ?? DEFAULT_OT_MAX_HOURS);

    const startTime = ot_start || OT_DEFAULT_START_TIME;
    const endTime   = ot_end   || calcOtEnd(startTime, maxHours);

    const ot_hours = isHoliday
  ? ot_max_hr
  : calcOtHours(startTime, endTime);

    const ot_days  = isHoliday ? 1.0 : null;

    const amount_hour = (!isHoliday && ratePerHour != null)
      ? Math.round(ot_hours * ratePerHour * 100) / 100
      : null;

    const amount_day = (isHoliday && ratePerDay != null)
      ? Math.round(ratePerDay * 100) / 100
      : null;

    const approverCode   = approver_code || userInfo?.approver_code || null;
    const supervisorName = approver      || userInfo?.approver      || null;

    const displayName = name || userInfo?.name ||
      `${userInfo?.prefix || ''}${userInfo?.firstName || ''} ${userInfo?.lastName || ''}`.trim();
    const deptVal  = department || userInfo?.dep || null;
    const affilVal = affiliation|| userInfo?.aff || null;
    const dept     = [deptVal, affilVal].filter(Boolean).join(' • ') || null;

    const dup = await env.DB.prepare(`
      SELECT reference FROM attendance_overtime
      WHERE uuid = ? AND ot_date = ? AND ot_start = ? AND ot_end = ?
        AND supervisor_status IN ('pending','approved') LIMIT 1
    `).bind(uuid, ot_date, startTime, endTime).first();
    if (dup) return json({ success: false, message: 'มีรายการ OT ซ้ำในช่วงเวลานี้แล้ว', duplicate: true }, 409);

    // ── ตรวจสอบพื้นที่ จ.บึงกาฬ (เพิ่มเข้ามา) ──────────────────────────────────────────────
    let finalDistanceM = distance_m;
    let finalIsInRange = is_in_range;
    let locationDisplay = null;
    let locationDetail = null;

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

    const inRange = finalIsInRange != null ? (finalIsInRange ? 1 : 0) : null;
    const now     = timestamp_iso ? new Date(timestamp_iso) : new Date();
    const ref     = generateRef(workType);

    try {
      await env.DB.prepare(`
        INSERT INTO attendance_overtime (
          uuid, reference, ot_date, ot_start, ot_end, ot_hours, ot_days,
          work_type, note,
          latitude, longitude, distance_m, is_in_range,
          name, department,
          ot_rate_per_hour, ot_rate_per_day, ot_max_hours,
          amount_hour, amount_day,
          approver_code, supervisor_name, supervisor_status,
          submitted_at, updated_at
        ) VALUES (
          ?,?,?,?,?,?,?,
          ?,?,
          ?,?,?,?,
          ?,?,
          ?,?,?,
          ?,?,
          ?,?,'pending',
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `).bind(
        uuid, ref, ot_date, startTime, endTime, ot_hours, ot_days,
        workType, note || null,
        latitude ?? null, longitude ?? null, finalDistanceM ?? null, inRange,
        displayName, dept,
        ratePerHour, ratePerDay, maxHours,
        amount_hour, amount_day,
        approverCode, supervisorName
      ).run();

      // ✅ ส่งข้อมูล location กลับไปด้วย
      return json({
        success: true,
        message: locationDetail?.inBuengKan
          ? '✅ บันทึกเวลา OT สำเร็จ (อยู่ในพื้นที่จังหวัดบึงกาฬ)'
          : 'บันทึกเวลา OT สำเร็จ',
        data: {
          reference: ref, ot_date,
          ot_start: startTime, ot_end: endTime,
          ot_hours, ot_days,
          ot_rate_per_hour: ratePerHour,
          ot_rate_per_day:  ratePerDay,
          ot_max_hours:     maxHours,
          amount_hour, amount_day,
          supervisor_status: 'pending',
          supervisor_name:   supervisorName,
          location_display: locationDisplay,
          location_detail: locationDetail
        },
      });
    } catch (err) {
      console.error('[overtime POST]', err);
      return json({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message }, 500);
    }
  }

  // PATCH
  if (request.method === 'PATCH') {
    let body;
    try { body = await request.json(); } catch { return json({ success: false, message: 'Invalid JSON' }, 400); }

    const { reference, action, supervisor_note } = body;
    if (!reference || !action)
      return json({ success: false, message: 'ขาด reference หรือ action' }, 400);
      
    if (!['approve', 'reject', 'cancel'].includes(action))
      return json({ success: false, message: 'action ต้องเป็น approve, reject หรือ cancel' }, 400);

    const otRow = await env.DB.prepare(
      `SELECT * FROM attendance_overtime WHERE reference = ? LIMIT 1`
    ).bind(reference).first();
    if (!otRow) return json({ success: false, message: 'ไม่พบรายการ OT' }, 404);
    
    if (action === 'cancel') {
      if (otRow.uuid !== userRow.uuid) 
        return json({ success: false, message: 'ไม่มีสิทธิ์ยกเลิกรายการนี้' }, 403);
    } else {
      if (otRow.approver_code !== userRow.uuid)
        return json({ success: false, message: 'ไม่มีสิทธิ์อนุมัติรายการนี้' }, 403);
    }
    
    if (otRow.supervisor_status !== 'pending')
      return json({ success: false, message: `ดำเนินการไปแล้ว (${otRow.supervisor_status})` }, 409);

    let newStatus;
    if (action === 'approve') newStatus = 'approved';
    else if (action === 'reject') newStatus = 'rejected';
    else if (action === 'cancel') newStatus = 'cancelled';

    try {
      await env.DB.prepare(`
        UPDATE attendance_overtime SET
          supervisor_status = ?,
          supervisor_note   = ?,
          reviewed_at       = CURRENT_TIMESTAMP,
          updated_at        = CURRENT_TIMESTAMP
        WHERE reference = ?
      `).bind(newStatus, supervisor_note || null, reference).run();

      return json({
        success: true,
        message: action === 'approve' ? 'อนุมัติ OT สำเร็จ' : action === 'cancel' ? 'ยกเลิก OT สำเร็จ' : 'ปฏิเสธ OT สำเร็จ',
        data: {
          reference, supervisor_status: newStatus,
          amount_hour: otRow.amount_hour,
          amount_day:  otRow.amount_day,
        },
      });
    } catch (err) {
      return json({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message }, 500);
    }
  }

  return json({ success: false, message: 'Method not allowed' }, 405);
}
