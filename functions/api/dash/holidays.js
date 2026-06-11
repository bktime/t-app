// functions/api/dash/holidays.js
// GET  /api/dash/holidays  → list + summary
// POST /api/dash/holidays  → create (admin only)

import { authUser, extractToken, unauthorized, forbidden } from '../_auth.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    },
  });
}

/* ─────────────────────────────────────────
 * GET /api/dash/holidays
 * ทุก role ดูได้
 * ───────────────────────────────────────── */
export async function onRequestGet({ request, env }) {
  const token = extractToken(request);
  const session = await authUser(env, token);
  if (!session) return unauthorized(CORS);

  try {
    const [holidaysRes, summaryRow] = await Promise.all([

      env.DB.prepare(`
        SELECT
          id, name, date, type, note, is_recurring,
          created_by, created_at, updated_at
        FROM holidays
        ORDER BY date DESC
      `).all(),

      env.DB.prepare(`
        SELECT
          COUNT(*)                                              AS total,
          SUM(CASE WHEN type='national' THEN 1 ELSE 0 END)    AS national,
          SUM(CASE WHEN type='royal'    THEN 1 ELSE 0 END)    AS royal,
          SUM(CASE WHEN type='special'  THEN 1 ELSE 0 END)    AS special,
          SUM(CASE WHEN strftime('%Y', date) = strftime('%Y','now')
                   THEN 1 ELSE 0 END)                         AS this_year
        FROM holidays
      `).first(),
    ]);

    return Response.json({
      success: true,
      data: {
        holidays: holidaysRes.results ?? [],
        summary: {
          total:     Number(summaryRow?.total     ?? 0),
          national:  Number(summaryRow?.national  ?? 0),
          royal:     Number(summaryRow?.royal     ?? 0),
          special:   Number(summaryRow?.special   ?? 0),
          this_year: Number(summaryRow?.this_year ?? 0),
        },
      },
      meta: {
        role:      session.role,
        role_level: session.role_level,
        can_edit:  session.role === 'admin',
      },
    }, { headers: CORS });

  } catch (err) {
    console.error('[dash/holidays GET]', err);
    return Response.json(
      { success: false, message: 'Internal Server Error' },
      { status: 500, headers: CORS }
    );
  }
}

/* ─────────────────────────────────────────
 * POST /api/dash/holidays
 * เฉพาะ admin เท่านั้น
 * body: { name, date, type, note?, is_recurring? }
 * ───────────────────────────────────────── */
export async function onRequestPost({ request, env }) {
  const token = extractToken(request);
  const session = await authUser(env, token);
  if (!session) return unauthorized(CORS);
  if (session.role !== 'admin') return forbidden(CORS);

  let body;
  try { body = await request.json(); }
  catch { return Response.json({ success: false, message: 'Invalid JSON' }, { status: 400, headers: CORS }); }

  const { name, date, type, note = null, is_recurring = 0 } = body;

  // Validate
  const errs = [];
  if (!name?.trim())  errs.push('name');
  if (!date?.trim())  errs.push('date');
  if (!type?.trim())  errs.push('type');
  if (!['national', 'royal', 'special'].includes(type)) errs.push('type (invalid value)');

  if (errs.length) {
    return Response.json(
      { success: false, message: `กรุณากรอก: ${errs.join(', ')}` },
      { status: 400, headers: CORS }
    );
  }

  // ✅ ตรวจสอบวันเสาร์-อาทิตย์
  const dateObj = new Date(date.trim() + 'T00:00:00Z');
  const dayOfWeek = dateObj.getUTCDay(); // 0 = อาทิตย์, 6 = เสาร์
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return Response.json(
      { success: false, message: 'ไม่สามารถบันทึกวันเสาร์หรืออาทิตย์เป็นวันหยุดได้' },
      { status: 400, headers: CORS }
    );
  }

  // ✅ ตรวจซ้ำ — เช็คแค่วันที่ (เพราะ UNIQUE(date))
  const dup = await env.DB.prepare(`
    SELECT id FROM holidays WHERE date = ? LIMIT 1
  `).bind(date.trim()).first();

  if (dup) {
    return Response.json(
      { success: false, message: 'วันที่นี้มีวันหยุดอยู่แล้วในระบบ' },
      { status: 409, headers: CORS }
    );
  }

  try {
    const result = await env.DB.prepare(`
      INSERT INTO holidays (name, date, type, note, is_recurring, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(
      name.trim(),
      date.trim(),
      type.trim(),
      note || null,
      is_recurring ? 1 : 0,
      session.uuid,
    ).run();

    return Response.json({
      success: true,
      message: 'เพิ่มวันหยุดสำเร็จ',
      data: { id: result.meta?.last_row_id ?? null },
    }, { headers: CORS });

  } catch (err) {
    console.error('[dash/holidays POST]', err);
    return Response.json(
      { success: false, message: 'Internal Server Error' },
      { status: 500, headers: CORS }
    );
  }
}