// GET /api/user/staff-list
import { authUser, extractToken, unauthorized } from '../_auth.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

export async function onRequestGet({ request, env }) {
  const token = extractToken(request);
  const session = await authUser(env, token);
  if (!session) return unauthorized(CORS);

  const url = new URL(request.url);
  const type = url.searchParams.get('type') || 'staff'; // orgs | leaver | supervisor | approver | delegate
  const req_aff = url.searchParams.get('aff_code');
  const req_dep = url.searchParams.get('def_code');

  const myScope = session.access_scope;
  const myAffCode = session.aff_code;
  const myDepCode = session.dep_code;
  const myUuid = session.uuid;

  // ────────────────────────────────────────
  // โหมดดึงข้อมูลสำหรับ Dropdown (กรองเฉพาะที่มีคน)
  // ────────────────────────────────────────
  if (type === 'orgs') {
    try {
      let affWhere = `status = 'Active' AND aff_code IS NOT NULL AND aff_code != '' AND affiliation IS NOT NULL AND affiliation != ''`;
      const affParams = [];
      
      if (myScope === 'ตนเอง' || myScope === 'หน่วยงาน') {
        affWhere += ` AND dep_code = ?`;
        affParams.push(myDepCode);
      } else if (myScope === 'สังกัด') {
        affWhere += ` AND aff_code = ?`;
        affParams.push(myAffCode);
      }

      const affs = await env.DB.prepare(`SELECT DISTINCT aff_code, affiliation FROM users WHERE ${affWhere} ORDER BY affiliation ASC`).bind(...affParams).all();
      
      let depWhere = `status = 'Active' AND dep_code IS NOT NULL AND dep_code != '' AND department IS NOT NULL AND department != ''`;
      const depParams = [];
      
      if (myScope === 'ตนเอง' || myScope === 'หน่วยงาน') {
        depWhere += ` AND dep_code = ?`;
        depParams.push(myDepCode);
      } else if (myScope === 'สังกัด') {
        depWhere += ` AND aff_code = ?`;
        depParams.push(myAffCode);
      }

      const deps = await env.DB.prepare(`SELECT DISTINCT dep_code, department, aff_code FROM users WHERE ${depWhere} ORDER BY department ASC`).bind(...depParams).all();

      return new Response(JSON.stringify({
        success: true,
        data: {
          affiliations: affs.results || [],
          departments: deps.results || []
        }
      }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });

    } catch (error) {
      console.error('Orgs list error:', error);
      return new Response(JSON.stringify({ success: false, error: 'Internal Server Error' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
  }

  // ────────────────────────────────────────
  // โหมดดึงรายชื่อบุคลากร
  // ────────────────────────────────────────
  let query = `
    SELECT id, uuid, CONCAT(firstName, ' ', lastName) AS name, position, department, aff_code, dep_code, affiliation, role
    FROM users 
    WHERE status = 'Active'
  `;
  const params = [];

// ในส่วนของ type === 'approver'
if (type === 'approver') {
  // ✅ เพิ่มตัวพิมพ์ใหญ่และคำที่ใช้กันบ่อยเข้าไปด้วย
  query += ` AND LOWER(role) IN ('ceo', 'exclusive', 'executive', 'director', 'admin', 'hr', 'it')`; 
  
  const targetAff = (myScope === 'ทั้งหมด' && req_aff) ? req_aff : myAffCode;
  if (targetAff && targetAff.trim() !== '') {
    query += ` AND aff_code = ?`;
    params.push(targetAff);
  }
}
  
  else if (type === 'leaver') {
    if (myScope === 'ตนเอง') {
      query += ` AND uuid = ?`;
      params.push(myUuid);
    } else if (myScope === 'หน่วยงาน') {
      query += ` AND dep_code = ?`;
      params.push(myDepCode);
    } else if (myScope === 'สังกัด') {
      query += ` AND aff_code = ?`;
      params.push(myAffCode);
    } else if (myScope === 'ทั้งหมด') {
      if (req_aff) { query += ` AND aff_code = ?`; params.push(req_aff); }
      if (req_dep) { query += ` AND dep_code = ?`; params.push(req_dep); }
    } else {
      query += ` AND 1=0`; 
    }
  } 
  
  else {
    if (myScope === 'ตนเอง' || myScope === 'หน่วยงาน') {
      query += ` AND dep_code = ?`;
      params.push(myDepCode);
    } else if (myScope === 'สังกัด') {
      query += ` AND aff_code = ?`;
      params.push(myAffCode);
      if (req_dep) { query += ` AND dep_code = ?`; params.push(req_dep); }
    } else if (myScope === 'ทั้งหมด') {
      if (req_aff) { query += ` AND aff_code = ?`; params.push(req_aff); }
      if (req_dep) { query += ` AND dep_code = ?`; params.push(req_dep); }
    } else {
      query += ` AND 1=0`; 
    }
  }

  query += ` ORDER BY name LIMIT 500`;

  try {
    if (!env.DB) {
      return new Response(JSON.stringify({ success: false, error: 'Database not available' }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const result = await env.DB.prepare(query).bind(...params).all();
    const staff = result.results || [];

    return new Response(JSON.stringify({
      success: true,
      data: staff
    }), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Staff list error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: 'Internal Server Error' 
    }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
}