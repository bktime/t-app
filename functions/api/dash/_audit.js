// functions/api/dash/_audit.js
// ─────────────────────────────────────────────────────
// writeAuditLog(env, request, actor, action, target, changes)
//
// actor  = { uuid, name, role }
// action = 'user.update' | 'user.role' | 'user.status' | 'user.chain'
// target = { uuid, name }
// changes = { field: [oldVal, newVal], … }   ← เฉพาะ field ที่เปลี่ยน
// ─────────────────────────────────────────────────────

/**
 * เปรียบเทียบ old/new object และคืน changes object
 * เฉพาะ field ที่ระบุใน watchFields ที่ค่าเปลี่ยนจริง
 *
 * @param {Object} oldObj
 * @param {Object} newObj
 * @param {string[]} watchFields
 * @returns {Object} { field: [old, new] }
 */
export function diffFields(oldObj, newObj, watchFields) {
  const changes = {};
  for (const field of watchFields) {
    const ov = oldObj?.[field] ?? null;
    const nv = newObj?.[field] ?? null;
    // normalize: '' → null
    const ovn = ov === '' ? null : ov;
    const nvn = nv === '' ? null : nv;
    if (String(ovn) !== String(nvn)) {
      changes[field] = [ovn, nvn];
    }
  }
  return changes;
}

/**
 * บันทึก audit log ลง D1
 * — ไม่ throw ถ้า insert ล้มเหลว (log error เงียบ ๆ)
 *
 * @param {object} env         - Cloudflare env
 * @param {Request} request    - original request (ดึง IP)
 * @param {object} actor       - { uuid, name, role }
 * @param {string} action      - action key
 * @param {object} target      - { uuid, name }
 * @param {object} changes     - { field: [old, new] }
 */
export async function writeAuditLog(env, request, actor, action, target, changes) {
  // ไม่บันทึกถ้า changes ว่าง (ไม่มีอะไรเปลี่ยน)
  if (changes && Object.keys(changes).length === 0) return;

  const ip = request?.headers?.get('CF-Connecting-IP')
          || request?.headers?.get('X-Forwarded-For')?.split(',')[0]?.trim()
          || null;

  try {
    await env.DB.prepare(`
      INSERT INTO audit_logs
        (actor_uuid, actor_name, actor_role, action, target_uuid, target_name, changes, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      actor?.uuid  ?? null,
      actor?.name  ?? null,
      actor?.role  ?? null,
      action,
      target?.uuid ?? null,
      target?.name ?? null,
      changes ? JSON.stringify(changes) : null,
      ip,
    ).run();
  } catch (err) {
    // ไม่หยุดการทำงานหลักถ้า log ล้มเหลว
    console.error('[audit] insert failed:', err?.message ?? err);
  }
}