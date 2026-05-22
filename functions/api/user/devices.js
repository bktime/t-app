// functions/api/user/devices.js
// GET  /api/user/devices        — ดูอุปกรณ์ทั้งหมด
// POST /api/user/devices/revoke — ยกเลิก session อื่น

import { authUser, extractToken } from '../_auth.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ── Helper: แปลงเวลาจาก UTC เป็นเวลาประเทศไทย (UTC+7) ────────────────────────
function toThaiTime(utcDateStr) {
  if (!utcDateStr) return utcDateStr;
  try {
    // D1 ส่งมาเป็นรูปแบบ "YYYY-MM-DD HH:MM:SS" (ซึ่งเป็น UTC)
    const utcStr = utcDateStr.endsWith('Z') ? utcDateStr : utcDateStr + 'Z';
    const date = new Date(utcStr);
    
    // บวกเพิ่ม 7 ชั่วโมงสำหรับประเทศไทย
    const thaiTimeMs = date.getTime() + (7 * 60 * 60 * 1000);
    
    // แปลงกลับเป็นรูปแบบ ISO String และเปลี่ยนตัว Z ท้ายสุดเป็น +07:00 
    // เพื่อให้ Javascript บน Frontend รู้ว่านี่คือเวลา +7
    return new Date(thaiTimeMs).toISOString().replace('Z', '+07:00');
  } catch (e) {
    return utcDateStr;
  }
}
// ──────────────────────────────────────────────────────────────────────────────

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // ── Auth ───────────────────────────────────────────────────────────────────
  const token          = extractToken(request);
  const currentSession = await authUser(env, token);
  if (!currentSession) return json({ success: false, message: 'Unauthorized' }, 401);

  const uuid = currentSession.uuid;
  const url  = new URL(request.url);

  // ── GET: ดูรายการอุปกรณ์ทั้งหมด ──────────────────────────────────────────
  if (request.method === 'GET') {
    const { results } = await env.DB.prepare(`
      SELECT
        id,
        token,
        device_name,
        device_type,
        browser,
        os,
        ip,
        social_type,
        expires_at,
        last_active_at,
        created_at
      FROM user_sessions
      WHERE uuid = ?
        AND expires_at > CURRENT_TIMESTAMP
      ORDER BY last_active_at DESC
    `).bind(uuid).all();

    // ทำ mask token, mark อุปกรณ์ปัจจุบัน และ แปลงเวลาเป็น +7
    const devices = results.map(s => ({
      id:             s.id,
      is_current:     s.token === token,
      device_name:    s.device_name,
      device_type:    s.device_type,
      browser:        s.browser,
      os:             s.os,
      ip:             s.ip,
      social_type:    s.social_type,
      expires_at:     toThaiTime(s.expires_at),      // ✅ แปลงเวลา
      last_active_at: toThaiTime(s.last_active_at),  // ✅ แปลงเวลา
      created_at:     toThaiTime(s.created_at),      // ✅ แปลงเวลา
    }));

    return json({ success: true, devices, current_session_id: currentSession.id });
  }

  // ── POST: revoke session ──────────────────────────────────────────────────
  if (request.method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch (_) {}

    const { session_id, revoke_all_others } = body;

    if (revoke_all_others) {
      await env.DB.prepare(`
        DELETE FROM user_sessions WHERE uuid = ? AND token != ?
      `).bind(uuid, token).run();

      return json({ success: true, message: 'นำออกจากระบบทุกอุปกรณ์อื่นแล้ว' });
    }

    if (!session_id) {
      return json({ success: false, message: 'Missing session_id' }, 400);
    }

    const target = await env.DB.prepare(`
      SELECT id, token FROM user_sessions WHERE id = ? AND uuid = ?
    `).bind(session_id, uuid).first();

    if (!target) {
      return json({ success: false, message: 'ไม่พบ session นี้' }, 404);
    }

    if (target.token === token) {
      return json({ success: false, message: 'ไม่สามารถนำอุปกรณ์ปัจจุบันออกได้ กรุณาใช้ logout แทน' }, 400);
    }

    await env.DB.prepare(`
      DELETE FROM user_sessions WHERE id = ? AND uuid = ?
    `).bind(session_id, uuid).run();

    return json({ success: true, message: 'นำอุปกรณ์ออกจากระบบแล้ว' });
  }

  return json({ success: false, message: 'Method not allowed' }, 405);
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: corsHeaders });
}