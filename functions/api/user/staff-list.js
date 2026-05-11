// GET /api/user/staff-list
export async function onRequest(context) {
  const { request, env } = context;
  
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    if (!env.DB) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Database not available' 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // รับค่า aff_code และ def_code จาก query parameter
    const url = new URL(request.url);
    const aff_code = url.searchParams.get('aff_code');
    const def_code = url.searchParams.get('def_code');
    
    let query = `
      SELECT id, uuid, CONCAT(firstName, ' ', lastName) AS name, position, department 
      FROM users 
      WHERE status = 'Active'
    `;
    
    const params = [];
    
    // กรองตาม aff_code ถ้ามีการระบุ
    if (aff_code && aff_code.trim() !== '') {
      query += ` AND aff_code = ?`;
      params.push(aff_code);
    }
    
    // กรองตาม def_code (department_code) ถ้ามีการระบุ
    if (def_code && def_code.trim() !== '') {
      query += ` AND dep_code = ?`;
      params.push(def_code);
    }
    
    query += ` ORDER BY name LIMIT 100`;
    
    const result = await env.DB.prepare(query).bind(...params).all();
    const staff = result.results || [];

    return new Response(JSON.stringify({
      success: true,
      data: staff
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Staff list error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: 'Internal Server Error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}