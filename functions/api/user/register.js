// POST /api/user/register
export async function onRequest(context) {
  const { request, env } = context;
  
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    
    // Validation — ฟิลด์บังคับ
    const requiredFields = ['uuid', 'social_id', 'social_type', 'name', 'affiliation', 
                            'department', 'idCard', 'prefix', 'firstName', 'lastName', 
                            'position', 'personnelType'];
    
    for (const field of requiredFields) {
      if (!body[field] && body[field] !== 0) {
        return new Response(JSON.stringify({ 
          success: false, 
          message: `กรุณากรอกข้อมูล ${field}` 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (!env.DB) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'ระบบไม่สามารถเชื่อมต่อฐานข้อมูลได้' 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ตรวจสอบ ID Card ซ้ำ
    const existingIdCard = await env.DB.prepare(
      'SELECT id FROM users WHERE idCard = ?'
    ).bind(body.idCard).first();
    
    if (existingIdCard) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'เลขบัตรประชาชนนี้ลงทะเบียนแล้ว' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ตรวจสอบ social_id ซ้ำ
    const existingSocial = await env.DB.prepare(
      'SELECT id FROM users WHERE social_id = ?'
    ).bind(body.social_id).first();
    
    if (existingSocial) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'บัญชีนี้ลงทะเบียนแล้ว กรุณาเข้าสู่ระบบ' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── แปลงค่า OT (optional) ────────────────────────────────────────────────
    const ot_rate_per_day      = body.ot_rate_per_day      != null && body.ot_rate_per_day !== ''
                                  ? parseFloat(body.ot_rate_per_day)   : null;
    const ot_rate_per_hour     = body.ot_rate_per_hour     != null && body.ot_rate_per_hour !== ''
                                  ? parseFloat(body.ot_rate_per_hour)  : null;
    const ot_max_hours_per_day = body.ot_max_hours_per_day != null && body.ot_max_hours_per_day !== ''
                                  ? parseInt(body.ot_max_hours_per_day, 10) : null;

    // บันทึกข้อมูล (35 ฟิลด์ รวม OT 5 ฟิลด์ใหม่)
    const registered_at = new Date().toISOString();
    
    await env.DB.prepare(`
      INSERT INTO users (
        uuid, social_id, social_id_google, social_id_line, social_id_telegram,
        social_type, name, email, picture, status, role,
        affiliation, department, aff_code, dep_code,
        idCard, prefix, firstName, lastName, position,
        personnelType, signature, profileImage,
        supervisor, approver, payer,
        supervisor_code, approver_code, payer_code,
        ot_doc_number, ot_rate_per_day, ot_rate_per_hour,
        ot_max_hours_per_day, ot_bank_account,
        registered_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?
      )
    `).bind(
      body.uuid,
      body.social_id,
      body.social_id_google        || null,
      body.social_id_line          || null,
      body.social_id_telegram      || null,
      body.social_type,
      body.name,
      body.email                   || null,
      body.picture                 || null,
      body.status                  || 'Active',
      body.role                    || 'user',
      body.affiliation,
      body.department,
      body.aff_code                || null,
      body.dep_code                || null,
      body.idCard,
      body.prefix,
      body.firstName,
      body.lastName,
      body.position,
      body.personnelType,
      body.signature               || null,
      body.profileImage            || null,
      body.supervisor              || null,
      body.approver                || null,
      body.payer                   || null,
      body.supervisor_code         || null,
      body.approver_code           || null,
      body.payer_code              || null,
      body.ot_doc_number           || null,
      ot_rate_per_day,
      ot_rate_per_hour,
      ot_max_hours_per_day,
      body.ot_bank_account         || null,
      registered_at
    ).run();

    console.log(`User registered: ${body.uuid} (${body.social_type}) - ${body.name}`);

    return new Response(JSON.stringify({ 
      success: true, 
      message: 'สมัครสมาชิกสำเร็จ',
      userId: body.uuid
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Register error:', error.message, error.stack);
    return new Response(JSON.stringify({ 
      success: false, 
      message: 'เกิดข้อผิดพลาด: ' + error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}