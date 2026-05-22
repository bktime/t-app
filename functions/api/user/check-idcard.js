// POST /api/user/check-idcard
// ตรวจสอบเลขบัตรประชาชนผ่าน NHSO API + ตรวจซ้ำในตาราง users + บันทึก log
export async function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json({ success: false, error: 'Method not allowed' }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: 'Invalid JSON body' }, 400);
  }

  const { idCard, social_id, social_type } = body;

  // ── Validate input ─────────────────────────────────────────────────────────
  if (!idCard || typeof idCard !== 'string' || idCard.length !== 13 || !/^\d{13}$/.test(idCard)) {
    return json({ success: false, error: 'เลขบัตรประชาชนต้องมี 13 หลัก (ตัวเลขเท่านั้น)' }, 400);
  }
  if (!social_id || !social_type) {
    return json({ success: false, error: 'Missing social_id or social_type' }, 400);
  }

  const now        = new Date().toISOString();
  const checkDate  = now.slice(0, 10) + 'T00:00:00';

  let nhsoData     = null;
  let nhsoStatus   = 'ok';
  let nhsoMessage  = null;
  let idCardExists = false;

  // ── 1. ตรวจซ้ำในตาราง users ───────────────────────────────────────────────
  try {
    const existing = await env.DB.prepare(
      'SELECT id, uuid FROM users WHERE idCard = ? LIMIT 1'
    ).bind(idCard).first();

    if (existing) {
      idCardExists = true;
    }
  } catch (dbErr) {
    console.error('[check-idcard] DB error:', dbErr);
  }

  // ── 2. เรียก NHSO API ──────────────────────────────────────────────────────
  const NHSO_TOKEN = env.NHSO_API_TOKEN || '807f3e5f-1343-4afa-afc0-df2f13d0b2f3';
  const nhsoUrl    = `https://nhsoapi.nhso.go.th/nhsoendpoint/api/v2/right-search?pid=${encodeURIComponent(idCard)}&checkDate=${encodeURIComponent(checkDate)}`;

  try {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 10000);

    const nhsoRes = await fetch(nhsoUrl, {
      method:  'GET',
      headers: {
        'accept':        '*/*',
        'Authorization': `Bearer ${NHSO_TOKEN}`,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (nhsoRes.ok) {
      nhsoData    = await nhsoRes.json();
      nhsoStatus  = 'ok';
    } else {
      nhsoStatus  = 'api_error';
      nhsoMessage = `NHSO HTTP ${nhsoRes.status}`;
      console.warn('[check-idcard] NHSO non-ok:', nhsoRes.status);
    }
  } catch (fetchErr) {
    nhsoStatus  = fetchErr.name === 'AbortError' ? 'timeout' : 'error';
    nhsoMessage = fetchErr.message;
    console.error('[check-idcard] NHSO fetch error:', fetchErr);
  }

  // ── ★ 2.5 ตรวจว่า NHSO ตอบ ok แต่ไม่พบข้อมูลบุคคล ──────────────────────────
  //    ตัวอย่าง response ที่ไม่พบ: { checkDate: ..., nation: {}, sex: {}, funds: [] }
  //    ไม่มี fname/lname และ funds ว่าง
  let nhsoNotFound = false;

  if (nhsoData && nhsoStatus === 'ok') {
    const hasName  = !!(nhsoData.fname || nhsoData.lname || nhsoData.tname);
    const hasFunds = Array.isArray(nhsoData.funds) && nhsoData.funds.length > 0;
    const hasSex   = !!(nhsoData.sex && nhsoData.sex.name);

    if (!hasName && !hasFunds && !hasSex) {
      nhsoNotFound = true;
      nhsoStatus   = 'not_found';
      nhsoMessage  = 'ไม่พบข้อมูลเลขบัตรประชาชนในระบบ';
    }
  }

  // ── 3. บันทึก log ─────────────────────────────────────────────────────────
  try {
    const nhsoName   = nhsoData ? `${nhsoData.tname || ''}${nhsoData.fname || ''} ${nhsoData.lname || ''}`.trim() : null;
    const nhsoSex    = nhsoData?.sex?.name || null;
    const nhsoFund   = nhsoData?.funds?.[0]?.mainInscl?.name || null;
    const nhsoHosp   = nhsoData?.funds?.[0]?.hospMain?.hname || null;
    const nhsoBirth  = nhsoData?.birthDate || null;
    const nhsoNation = nhsoData?.nation?.id || null;

    await env.DB.prepare(`
      INSERT INTO registration_logs (
        idCard, social_id, social_type,
        nhso_status, nhso_message,
        nhso_name, nhso_sex, nhso_birth_date,
        nhso_fund, nhso_hospital, nhso_nation,
        id_card_exists_in_users,
        nhso_raw_response,
        checked_at
      ) VALUES (
        ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?,
        ?,
        ?
      )
    `).bind(
      idCard,
      social_id,
      social_type,
      nhsoStatus,
      nhsoMessage || null,
      nhsoName,
      nhsoSex,
      nhsoBirth,
      nhsoFund,
      nhsoHosp,
      nhsoNation,
      idCardExists ? 1 : 0,
      nhsoData ? JSON.stringify(nhsoData) : null,
      now
    ).run();
  } catch (logErr) {
    console.error('[check-idcard] Log insert error:', logErr);
  }

    // ── 4. ตอบกลับ ────────────────────────────────────────────────────────────

  // กรณีเลขบัตรซ้ำในระบบ
  if (idCardExists) {
    return json({
      success:       false,
      error:         'idcard_duplicate',
      message:       'เลขบัตรประชาชนนี้ลงทะเบียนในระบบแล้ว',
      nhso_status:   nhsoStatus,
    });
  }

  // กรณี NHSO ตอบกลับแต่ไม่พบข้อมูลบุคคล — ไม่อนุญาตให้ดำเนินการต่อ
  if (nhsoNotFound) {
    return json({
      success:       false,
      verified:      false,
      error:         'nhso_not_found',
      nhso_status:   nhsoStatus,
      nhso_message:  nhsoMessage,
      message:       'ไม่พบข้อมูลเลขบัตรประชาชนในระบบ กรุณาตรวจสอบเลขบัตรประชาชนอีกครั้ง',
    });
  }

  // ── ★ กรณี NHSO ไม่ตอบสนอง (timeout/error) — ไม่อนุญาตให้ดำเนินการต่อ ──
  if (!nhsoData || nhsoStatus !== 'ok') {
    return json({
      success:       false,
      verified:      false,
      error:         'nhso_unavailable',
      nhso_status:   nhsoStatus,
      nhso_message:  nhsoMessage || 'ไม่สามารถเชื่อมต่อระบบตรวจสอบ',
      message:       'ไม่สามารถเชื่อมต่อระบบตรวจสอบได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง',
    });
  }

  // ── แปลงวันเกิด ────────────────────────────────────────────────────────────
  let birthDateStr = null;
  if (nhsoData.birthDateNew) {
    const { year, month, day } = nhsoData.birthDateNew;
    const adYear = year > 2400 ? year - 543 : year;
    birthDateStr = `${String(day).padStart(2,'0')}/${String(month).padStart(2,'0')}/${adYear + 543}`;
  }

  // ── สิทธิ์การรักษา ─────────────────────────────────────────────────────────
  const funds = (nhsoData.funds || []).map(f => ({
    fundType:   f.fundType,
    mainInscl:  f.mainInscl?.name || null,
    subInscl:   f.subInscl?.name  || null,
    hospMain:   f.hospMain?.hname || null,
    hospSss:    f.hospSss?.hname  || null,
    province:   f.purchaseProvince?.name || null,
    relation:   f.relation || null,
  }));

  return json({
    success:       true,
    verified:      true,
    nhso_status:   nhsoStatus,
    idCard:        idCard,
    tname:         nhsoData.tname    || null,
    fname:         nhsoData.fname    || null,
    lname:         nhsoData.lname    || null,
    sex:           nhsoData.sex?.name || null,
    // birthDate:     nhsoData.birthDate || null,
    // birthDateNew:  nhsoData.birthDateNew || null,
    // birthDateStr:  birthDateStr,
    nation:        nhsoData.nation?.id || null,
    // funds,
    // mainFund:      funds[0]?.mainInscl || null,
    // mainHospital:  funds[0]?.hospMain  || null,
    // mainProvince:  funds[0]?.province  || null,
  });
}