// GET /api/user/stats

import { authUser, extractToken } from '../_auth.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const json = (d, s = 200) => Response.json(d, { status: s, headers: corsHeaders });

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (request.method !== 'GET')     return json({ success: false, message: 'Method not allowed' }, 405);

  try {
    const token   = extractToken(request);
    const session = await authUser(env, token);

    if (!session) return json({ success: false, message: 'Token ไม่ถูกต้องหรือหมดอายุ กรุณาเข้าสู่ระบบใหม่' }, 401);

    // ── คำนวณช่วงเดือนปัจจุบัน (เวลาประเทศไทย UTC+7) ──
    const now = new Date();
    // แปลงเวลาเป็น timezone กรุงเทพฯ แบบเรียลไทม์ใน Edge Function
    const bangkokTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
    const currentYear = bangkokTime.getFullYear();
    const currentMonth = bangkokTime.getMonth() + 1; // JS month is 0-indexed
    
    const monthStart = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
    
    // คำนวณเดือนถัดไปเพื่อกำหนดขอบเขต (date < nextMonthStart)
    const nextMonthDate = new Date(Date.UTC(currentYear, currentMonth, 1)); // month is already +1
    const nextYearStr = nextMonthDate.getUTCFullYear();
    const nextMonthStr = String(nextMonthDate.getUTCMonth() + 1).padStart(2, '0');
    const nextMonthStart = `${nextYearStr}-${nextMonthStr}-01`;

    // ── Query สถิติจากตาราง attendance ──
    // ใช้ COALESCE เพื่อป้องกันค่า null กรณีที่ยังไม่มีข้อมูลในเดือนนั้นๆ
    const stats = await env.DB.prepare(`
      SELECT 
        COUNT(*) AS workall,
         COALESCE(SUM(CASE WHEN checkin_work_type = 'ปกติ' THEN 1 ELSE 0 END), 0) AS workDays,
        COALESCE(SUM(CASE WHEN checkin_work_type IN ('นอกสถานที่', 'ไปราชการ') THEN 1 ELSE 0 END), 0) AS outOffice,
        COALESCE(SUM(CASE WHEN checkin_work_type = 'ทำงานที่บ้าน' THEN 1 ELSE 0 END), 0) AS wfh
      FROM attendance 
      WHERE uuid = ? AND date >= ? AND date < ?
    `).bind(session.uuid, monthStart, nextMonthStart).first();

    // กำหนดค่าเริ่มต้นหากยังไม่มีข้อมูลการลงเวลาเลย
    const result = {
      workDays: stats?.workDays || 0,
      outOffice: stats?.outOffice || 0,
      wfh: stats?.wfh || 0
    };

    return json({ success: true, stats: result });

  } catch (error) {
    console.error('[stats] error:', error);
    return json({ success: false, message: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' }, 500);
  }
}