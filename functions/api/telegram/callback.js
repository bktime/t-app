// functions/api/telegram/callback.js
// Cloudflare Pages Function — Telegram OAuth Callback + Verify

// ─── CORS Headers ────────────────────────────────────────────────────────────
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

// ─── Entry Point ──────────────────────────────────────────────────────────────
export async function onRequest(context) {
  const { request, env } = context;

  // ─── Resolve credentials ────────────────────────────────────────────────────
  const BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
  const BOT_ID    = env.TELEGRAM_BOT_ID || (BOT_TOKEN ? BOT_TOKEN.split(':')[0] : null);

  if (!BOT_TOKEN) {
    return jsonResponse(
      { success: false, message: 'TELEGRAM_BOT_TOKEN environment variable is not set.' },
      500
    );
  }

  // ─── CORS Preflight ─────────────────────────────────────────────────────────
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // ─── Route ──────────────────────────────────────────────────────────────────
  if (request.method === 'GET')  return handleGet(request, env, BOT_TOKEN, BOT_ID);
  if (request.method === 'POST') return handlePost(request, env, BOT_TOKEN);

  return jsonResponse({ success: false, message: `Method ${request.method} not allowed` }, 405);
}

// ─── GET: รับ callback จาก Telegram OAuth ────────────────────────────────────
async function handleGet(request, env, BOT_TOKEN, BOT_ID) {
  const url    = new URL(request.url);
  const tgUser = url.searchParams.get('tgUser');
  const hash   = url.searchParams.get('hash');
  const code   = url.searchParams.get('code');

  // ── กรณี 1: tgUser (Telegram Login Widget ส่งมาโดยตรง) ────────────────────
  if (tgUser) {
    let userData;
    try {
      userData = JSON.parse(decodeURIComponent(tgUser));
    } catch {
      return jsonResponse({ success: false, message: 'Invalid tgUser JSON' }, 400);
    }

    if (!userData?.id) {
      return jsonResponse({ success: false, message: 'Missing user id in tgUser' }, 400);
    }

    // ตรวจสอบ hash ถ้ามี
    if (hash) {
      const valid = await verifyTelegramAuth(userData, hash, BOT_TOKEN);
      if (!valid) {
        return jsonResponse({ success: false, message: 'Invalid authentication hash' }, 401);
      }
    }

    await maybeStoreUser(env, userData);
    return jsonResponse({ success: true, user: normalizeUser(userData), session_token: makeToken() });
  }

  // ── กรณี 2: code (OAuth authorization code) ──────────────────────────────
  if (code) {
    const origin  = url.searchParams.get('origin') || new URL(request.url).origin;
    const userData = await exchangeCode(code, BOT_ID, origin);
    if (!userData) {
      return jsonResponse({ success: false, message: 'Failed to exchange Telegram code' }, 400);
    }
    await maybeStoreUser(env, userData);
    return jsonResponse({ success: true, user: userData, session_token: makeToken() });
  }

  return jsonResponse({ success: false, message: 'No authorization data received' }, 400);
}

// ─── POST: ตรวจสอบ / บันทึกข้อมูลจาก frontend ─────────────────────────────
async function handlePost(request, env, BOT_TOKEN) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, message: 'Invalid JSON body' }, 400);
  }

  const { action, auth_hash, ...fields } = body;
  const { id: user_id, first_name, last_name, username, photo_url, auth_date } = fields;

  // ── ตรวจสอบ auth hash ────────────────────────────────────────────────────
  if (auth_hash) {
    const valid = await verifyTelegramAuth(fields, auth_hash, BOT_TOKEN);
    if (!valid) {
      return jsonResponse({ success: false, message: 'Invalid authentication hash' }, 401);
    }
  }

  if (!user_id) {
    return jsonResponse({ success: false, message: 'Missing user id' }, 400);
  }

  const userData = {
    id:         user_id.toString(),
    first_name: first_name  || '',
    last_name:  last_name   || '',
    username:   username    || '',
    photo_url:  photo_url   || null,
    auth_date:  auth_date   || Math.floor(Date.now() / 1000),
  };

  await maybeStoreUser(env, userData);

  return jsonResponse({
    success:       true,
    user:          userData,
    session_token: makeToken(),
    message:       'เชื่อมต่อ Telegram สำเร็จ',
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * ตรวจสอบ Telegram Login Widget hash
 * ใช้ Web Crypto API (ทำงานได้บน Cloudflare Workers)
 */
async function verifyTelegramAuth(userData, hash, botToken) {
  try {
    const enc = new TextEncoder();

    // secret = SHA-256(botToken)
    const secretRaw = await crypto.subtle.digest('SHA-256', enc.encode(botToken));

    // สร้าง data-check-string
    const checkString = Object.entries(userData)
      .filter(([k, v]) => k !== 'hash' && v !== undefined && v !== null && v !== '')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    // HMAC-SHA256(checkString, secret)
    const key = await crypto.subtle.importKey(
      'raw', secretRaw,
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(checkString));

    // แปลง ArrayBuffer → hex
    const calcHash = Array.from(new Uint8Array(sig))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    return calcHash === hash;
  } catch (e) {
    console.error('[Telegram] verifyTelegramAuth error:', e);
    return false;
  }
}

/** แลก code เป็น user data (Telegram OAuth) */
async function exchangeCode(code, botId, origin) {
  try {
    const res  = await fetch(
      `https://oauth.telegram.org/auth/check?bot_id=${botId}&origin=${encodeURIComponent(origin)}&token=${code}`
    );
    const data = await res.json();
    if (data.ok && data.user) {
      return normalizeUser({ ...data.user, auth_date: data.auth_date });
    }
    return null;
  } catch (e) {
    console.error('[Telegram] exchangeCode error:', e);
    return null;
  }
}

/** Normalize user object */
function normalizeUser(u) {
  return {
    id:         u.id?.toString(),
    first_name: u.first_name  || '',
    last_name:  u.last_name   || '',
    username:   u.username    || '',
    photo_url:  u.photo_url   || null,
    auth_date:  u.auth_date   || Math.floor(Date.now() / 1000),
  };
}

/** บันทึกลง D1 ถ้ามี */
async function maybeStoreUser(env, userData) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(`
      INSERT OR REPLACE INTO telegram_users
        (id, first_name, last_name, username, photo_url, auth_date, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(
      userData.id?.toString(),
      userData.first_name || '',
      userData.last_name  || '',
      userData.username   || '',
      userData.photo_url  || null,
      userData.auth_date  || Math.floor(Date.now() / 1000),
    ).run();
  } catch (e) {
    console.error('[Telegram] D1 save error:', e);
  }
}

/** สร้าง session token แบบ Web Crypto */
async function makeToken() {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** JSON response helper */
function jsonResponse(data, status = 200) {
  return Response.json(data, { status, headers: corsHeaders });
}