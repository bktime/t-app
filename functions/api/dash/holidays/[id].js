// functions/api/dash/holidays/[id].js
// PUT    /api/dash/holidays/:id  → update (admin only)
// DELETE /api/dash/holidays/:id  → delete (admin only)

import { authUser, extractToken, unauthorized, forbidden } from '../../_auth.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS,
      'Access-Control-Allow-Methods': 'PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    },
  });
}

/* ─────────────────────────────────────────
 * PUT /api/dash/holidays/:id
 * body: { name, date, type, note?, is_recurring? }
 * ───────────────────────────────────────── */
export async function onRequestPut({ request, env, params }) {
  const token = extractToken(request);
  const session = await authUser(env, token);
  if (!session) return unauthorized(CORS);
  if (session.role !== 'admin') return forbidden(CORS);

  const id = Number(params.id);
  if (!id || isNaN(id)) {
    return Response.json({ success: false, message: 'Invalid id' }, { status: 400, headers: CORS });
  }

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

  // ตรวจว่ามี record นี้ในระบบ
  const existing = await env.DB.prepare(`SELECT id FROM holidays WHERE id = ? LIMIT 1`).bind(id).first();
  if (!existing) {
    return Response.json({ success: false, message: 'ไม่พบวันหยุดที่ต้องการแก้ไข' }, { status: 404, headers: CORS });
  }

  // ✅ ตรวจซ้ำ (ยกเว้นตัวเอง) — เช็คแค่วันที่
  const dup = await env.DB.prepare(`
    SELECT id FROM holidays WHERE date = ? AND id != ? LIMIT 1
  `).bind(date.trim(), id).first();

  if (dup) {
    return Response.json(
      { success: false, message: 'วันที่นี้มีวันหยุดอยู่แล้วในระบบ' },
      { status: 409, headers: CORS }
    );
  }

  try {
    await env.DB.prepare(`
      UPDATE holidays
      SET name = ?, date = ?, type = ?, note = ?, is_recurring = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      name.trim(),
      date.trim(),
      type.trim(),
      note || null,
      is_recurring ? 1 : 0,
      id,
    ).run();

    return Response.json({ success: true, message: 'แก้ไขวันหยุดสำเร็จ' }, { headers: CORS });

  } catch (err) {
    console.error('[dash/holidays PUT]', err);
    return Response.json(
      { success: false, message: 'Internal Server Error' },
      { status: 500, headers: CORS }
    );
  }
}

/* ─────────────────────────────────────────
 * DELETE /api/dash/holidays/:id
 * ───────────────────────────────────────── */
export async function onRequestDelete({ request, env, params }) {
  const token = extractToken(request);
  const session = await authUser(env, token);
  if (!session) return unauthorized(CORS);
  if (session.role !== 'admin') return forbidden(CORS);

  const id = Number(params.id);
  if (!id || isNaN(id)) {
    return Response.json({ success: false, message: 'Invalid id' }, { status: 400, headers: CORS });
  }

  // ตรวจว่ามี record นี้ในระบบ
  const existing = await env.DB.prepare(`SELECT id, name FROM holidays WHERE id = ? LIMIT 1`).bind(id).first();
  if (!existing) {
    return Response.json({ success: false, message: 'ไม่พบวันหยุดที่ต้องการลบ' }, { status: 404, headers: CORS });
  }

  try {
    await env.DB.prepare(`DELETE FROM holidays WHERE id = ?`).bind(id).run();

    return Response.json({
      success: true,
      message: `ลบ "${existing.name}" สำเร็จ`,
    }, { headers: CORS });

  } catch (err) {
    console.error('[dash/holidays DELETE]', err);
    return Response.json(
      { success: false, message: 'Internal Server Error' },
      { status: 500, headers: CORS }
    );
  }
}