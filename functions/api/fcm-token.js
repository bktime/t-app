// functions/api/fcm-token.js
// POST   /api/fcm-token  — บันทึก FCM token (UPSERT)
// DELETE /api/fcm-token  — ลบ token เมื่อ logout

import { authUser, extractToken, unauthorized } from './_auth.js';

const CORS = { 'Content-Type': 'application/json' };

export async function onRequestPost(context) {
  const { request, env } = context;

  const token = extractToken(request);
  const session = await authUser(env, token);
  if (!session) return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, message: 'Invalid JSON' }, { status: 400, headers: CORS });
  }

  const { fcm_token } = body;
  if (!fcm_token || typeof fcm_token !== 'string' || fcm_token.length < 10) {
    return Response.json({ success: false, message: 'Invalid fcm_token' }, { status: 400, headers: CORS });
  }

  const deviceUA = request.headers.get('User-Agent')?.slice(0, 200) ?? null;

  try {
// UPSERT — ใช้ session.uuid โดยตรง
await env.DB.prepare(`
  INSERT INTO fcm_tokens (uuid, token, device_ua, updated_at)
  VALUES (?1, ?2, ?3, datetime('now','localtime'))
  ON CONFLICT(token) DO UPDATE SET
    uuid       = excluded.uuid,
    device_ua  = excluded.device_ua,
    updated_at = excluded.updated_at
`).bind(session.uuid, fcm_token, deviceUA).run();

    return Response.json({ success: true }, { headers: CORS });
  } catch (err) {
    console.error('[fcm-token POST]', err);
    return Response.json({ success: false, message: 'Database error' }, { status: 500, headers: CORS });
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;

  const token = extractToken(request);
  const session = await authUser(env, token);
  if (!session) return unauthorized();

  let body = {};
  try {
    body = await request.json();
  } catch {
    // body ว่างก็ได้ — ถือว่าลบทุก token ของ user
  }

  const { fcm_token } = body;

  if (fcm_token) {
    // ลบเฉพาะ device นี้
// DELETE เฉพาะ token นี้
await env.DB.prepare(`
  DELETE FROM fcm_tokens
  WHERE token = ?1 AND uuid = ?2
`).bind(fcm_token, session.uuid).run();

// DELETE ทุก token (logout)
await env.DB.prepare(`
  DELETE FROM fcm_tokens WHERE uuid = ?1
`).bind(session.uuid).run();
  }

  return Response.json({ success: true }, { headers: CORS });
}