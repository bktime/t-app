// functions/api/user/devices.js
// GET  /api/user/devices        — ดูอุปกรณ์ทั้งหมด
// POST /api/user/devices/revoke — ยกเลิก session อื่น

import { authUser, extractToken } from '../_auth.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

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

    // ทำ mask token และ mark อุปกรณ์ปัจจุบัน
    const devices = results.map(s => ({
      id:             s.id,
      is_current:     s.token === token,
      device_name:    s.device_name,
      device_type:    s.device_type,
      browser:        s.browser,
      os:             s.os,
      ip:             s.ip,
      social_type:    s.social_type,
      expires_at:     s.expires_at,
      last_active_at: s.last_active_at,
      created_at:     s.created_at,
    }));

    return json({ success: true, devices, current_session_id: currentSession.id });
  }

  // ── POST: revoke session ──────────────────────────────────────────────────
  if (request.method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch (_) {}

    const { session_id, revoke_all_others } = body;

    if (revoke_all_others) {
      // ลบทุก session ยกเว้นปัจจุบัน
      await env.DB.prepare(`
        DELETE FROM user_sessions WHERE uuid = ? AND token != ?
      `).bind(uuid, token).run();

      return json({ success: true, message: 'นำออกจากระบบทุกอุปกรณ์อื่นแล้ว' });
    }

    if (!session_id) {
      return json({ success: false, message: 'Missing session_id' }, 400);
    }

    // ลบ session ที่ระบุ (ต้องเป็นของ user เดียวกัน ห้ามลบอุปกรณ์ปัจจุบัน)
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