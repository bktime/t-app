// functions/api/user/unlink-social.js

import { authUser, extractToken } from '../_auth.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const PLATFORM_COL = {
  google: 'social_id_google',
  line: 'social_id_line',
  telegram: 'social_id_telegram',
};

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (request.method !== 'POST') {
    return json({
      success: false,
      message: 'Method not allowed',
    }, 405);
  }

  if (!env.DB) {
    return json({
      success: false,
      message: 'Database not configured',
    }, 500);
  }

  // auth
  const token = extractToken(request);
  const session = await authUser(env, token);

  if (!session) {
    return json({
      success: false,
      message: 'Unauthorized',
    }, 401);
  }

  try {
    const body = await request.json();
    const { uuid, platform } = body;

    if (!uuid || !platform) {
      return json({
        success: false,
        message: 'Missing required fields',
      }, 400);
    }

    // owner check
    if (uuid !== session.uuid) {
      return json({
        success: false,
        message: 'UUID ไม่ตรงกับ session',
      }, 403);
    }

    const col = PLATFORM_COL[platform];

    if (!col) {
      return json({
        success: false,
        message: `Unsupported platform: ${platform}`,
      }, 400);
    }

    // user
    const user = await env.DB.prepare(`
      SELECT
        social_type,
        social_id_google,
        social_id_line,
        social_id_telegram
      FROM users
      WHERE uuid = ?
    `).bind(uuid).first();

    if (!user) {
      return json({
        success: false,
        message: 'ไม่พบข้อมูลผู้ใช้',
      }, 404);
    }

    // prevent unlink main account
    if (user.social_type === platform) {
      return json({
        success: false,
        message: `ไม่สามารถยกเลิกบัญชีหลัก (${platform}) ได้`,
      }, 403);
    }

    // count linked socials
    const linkedCount = [
      user.social_id_google,
      user.social_id_line,
      user.social_id_telegram,
    ].filter(Boolean).length;

    if (linkedCount <= 1) {
      return json({
        success: false,
        message: 'ต้องมีบัญชีเชื่อมต่ออย่างน้อย 1 บัญชี',
      }, 403);
    }

    // unlink
    await env.DB.prepare(`
      UPDATE users
      SET
        ${col} = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE uuid = ?
    `).bind(uuid).run();

    return json({
      success: true,
      message: `ยกเลิกการเชื่อมต่อ ${platform} สำเร็จ`,
    });

  } catch (err) {
    console.error('[unlink-social] error:', err);

    return json({
      success: false,
      message: err.message || 'Internal Server Error',
    }, 500);
  }
}

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: corsHeaders,
  });
}