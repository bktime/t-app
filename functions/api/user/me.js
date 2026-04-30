// GET /api/user/me
export async function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ 
      success: false, 
      message: 'Method not allowed' 
    }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'กรุณาเข้าสู่ระบบ' 
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.split(' ')[1];

    // ✅ SELECT ทุกฟิลด์ที่จำเป็น รวมถึง supervisor, approver, payer และ code ต่างๆ
    const user = await env.DB.prepare(`
      SELECT 
        id, uuid, social_id, social_id_google, social_id_line, social_id_telegram,
        social_type, name, email, picture, status, role,
        affiliation, aff_code, department, dep_code, idCard, prefix, firstName, lastName,
        position, personnelType, signature, profileImage,
        supervisor, supervisor_code, approver, approver_code, payer, payer_code,
        ot_doc_number, ot_rate_per_day, ot_rate_per_hour, ot_max_hours_per_day, ot_bank_account,
        registered_at, created_at, updated_at,
        auth_token, token_expires_at, last_login_at
      FROM users 
      WHERE auth_token = ?
        AND token_expires_at > CURRENT_TIMESTAMP
        AND status = 'Active'
    `).bind(token).first();

    if (!user) {
      // ตรวจสอบว่า token มีอยู่ในระบบไหม
      const existingToken = await env.DB.prepare(`
        SELECT auth_token, token_expires_at, status 
        FROM users 
        WHERE auth_token = ?
      `).bind(token).first();
      
      if (!existingToken) {
        return new Response(JSON.stringify({ 
          success: false, 
          message: 'Token ไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่อีกครั้ง' 
        }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      // ตรวจสอบว่าหมดอายุหรือไม่
      if (existingToken.token_expires_at) {
        const expiresAt = new Date(existingToken.token_expires_at);
        const now = new Date();
        
        if (expiresAt <= now) {
          return new Response(JSON.stringify({ 
            success: false, 
            message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง',
            expired: true
          }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
      
      // ตรวจสอบว่า status ไม่ใช่ Active
      if (existingToken.status !== 'Active') {
        return new Response(JSON.stringify({ 
          success: false, 
          message: 'บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ' 
        }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'Token ไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่อีกครั้ง' 
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ลบ auth_token และ token_expires_at ออกจาก response เพื่อความปลอดภัย
    const { auth_token, token_expires_at, ...safeUser } = user;

    return new Response(JSON.stringify({
      success: true,
      user: safeUser
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in /api/user/me:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      message: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}