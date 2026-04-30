// GET /api/organizations
export async function onRequest(context) {
  const { request, env } = context;

  console.log("DB:", env.DB);

  return new Response("ok");

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  // Handle preflight OPTIONS request
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Only allow GET method
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
    // Optional: Check authentication (สามารถเลือกใช้หรือไม่ใช้ก็ได้)
    // สำหรับหน้า register อาจไม่จำเป็นต้องตรวจสอบ token
    // แต่ถ้าต้องการให้เฉพาะผู้ที่ login แล้วเท่านั้นที่เห็นข้อมูล ให้ uncomment ส่วนนี้
    /*
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
    */

    let organizations = [];

    if (env.DB) {
      // ดึงข้อมูลทั้งหมดจากตาราง organizations
      const result = await env.DB.prepare(`
        SELECT 
          affiliation, 
          department, 
          latitude, 
          longitude, 
          affiliation_code, 
          department_code, 
          district
        FROM organizations 
        WHERE affiliation IS NOT NULL AND department IS NOT NULL
        ORDER BY affiliation, department
      `).all();
      
      organizations = result.results || [];
      
      // ถ้าไม่มีข้อมูลในตาราง ให้ return ข้อมูลเปล่า
      if (organizations.length === 0) {
        return new Response(JSON.stringify({
          success: true,
          data: [],
          message: 'ไม่พบข้อมูลสังกัดและหน่วยงาน'
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else {
      // Mock data สำหรับการทดสอบ (fallback)
      organizations = [
        { 
          affiliation: 'สำนักงานสาธารณสุขจังหวัด', 
          department: 'สำนักงานสาธารณสุขจังหวัด', 
          latitude: 13.736717, 
          longitude: 100.523186, 
          affiliation_code: 'MOPH001', 
          department_code: 'OFF001', 
          district: 'เมือง' 
        },
        { 
          affiliation: 'สำนักงานสาธารณสุขจังหวัด', 
          department: 'กลุ่มงานเวชกรรมสังคม', 
          latitude: 13.736717, 
          longitude: 100.523186, 
          affiliation_code: 'MOPH001', 
          department_code: 'SOC001', 
          district: 'เมือง' 
        },
        { 
          affiliation: 'สำนักงานสาธารณสุขจังหวัด', 
          department: 'กลุ่มงานควบคุมโรค', 
          latitude: 13.736717, 
          longitude: 100.523186, 
          affiliation_code: 'MOPH001', 
          department_code: 'DIS001', 
          district: 'เมือง' 
        },
        { 
          affiliation: 'โรงพยาบาลศูนย์', 
          department: 'โรงพยาบาลศูนย์', 
          latitude: 13.736717, 
          longitude: 100.523186, 
          affiliation_code: 'HOSP001', 
          department_code: 'HOSP001', 
          district: 'เมือง' 
        },
        { 
          affiliation: 'โรงพยาบาลศูนย์', 
          department: 'ฝ่ายการพยาบาล', 
          latitude: 13.736717, 
          longitude: 100.523186, 
          affiliation_code: 'HOSP001', 
          department_code: 'NUR001', 
          district: 'เมือง' 
        },
        { 
          affiliation: 'โรงพยาบาลศูนย์', 
          department: 'กลุ่มงานอายุรกรรม', 
          latitude: 13.736717, 
          longitude: 100.523186, 
          affiliation_code: 'HOSP001', 
          department_code: 'MED001', 
          district: 'เมือง' 
        },
        { 
          affiliation: 'โรงพยาบาลทั่วไป', 
          department: 'โรงพยาบาลทั่วไป', 
          latitude: 13.736717, 
          longitude: 100.523186, 
          affiliation_code: 'HOSP002', 
          department_code: 'HOSP002', 
          district: 'เมือง' 
        },
        { 
          affiliation: 'โรงพยาบาลทั่วไป', 
          department: 'แผนกฉุกเฉิน', 
          latitude: 13.736717, 
          longitude: 100.523186, 
          affiliation_code: 'HOSP002', 
          department_code: 'ER001', 
          district: 'เมือง' 
        },
        { 
          affiliation: 'โรงพยาบาลชุมชน', 
          department: 'โรงพยาบาลชุมชน', 
          latitude: 13.736717, 
          longitude: 100.523186, 
          affiliation_code: 'HOSP003', 
          department_code: 'HOSP003', 
          district: 'อำเภอ' 
        },
        { 
          affiliation: 'สำนักงานสาธารณสุขอำเภอ', 
          department: 'สำนักงานสาธารณสุขอำเภอ', 
          latitude: 13.736717, 
          longitude: 100.523186, 
          affiliation_code: 'MOPH002', 
          department_code: 'DIST001', 
          district: 'อำเภอ' 
        },
        { 
          affiliation: 'สำนักงานสาธารณสุขอำเภอ', 
          department: 'กลุ่มงานส่งเสริมสุขภาพ', 
          latitude: 13.736717, 
          longitude: 100.523186, 
          affiliation_code: 'MOPH002', 
          department_code: 'PROM001', 
          district: 'อำเภอ' 
        }
      ];
    }

    return new Response(JSON.stringify({
      success: true,
      data: organizations,
      total: organizations.length
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in /api/organizations:', error);
    
    return new Response(JSON.stringify({ 
      success: false, 
      message: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์',
      error: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
