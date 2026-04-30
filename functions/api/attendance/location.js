// functions/api/attendance/location.js
// GET /api/attendance/location

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const json = (d, s = 200) => Response.json(d, { status: s, headers: CORS });

// ── Haversine (เมตร) ─────────────────────────────────────────────────────
function haversine(lat1, lon1, lat2, lon2) {
  const R    = 6371000;
  const toR  = d => d * Math.PI / 180;
  const dLat = toR(lat2 - lat1);
  const dLon = toR(lon2 - lon1);
  const a    = Math.sin(dLat/2)**2 +
               Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon/2)**2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

// ── Bounding-box จังหวัดบึงกาฬ ──────────────────────────────────────────
// พิกัดจริง: ~17.50–18.10°N, 103.50–104.40°E
const BK_BBOX = { latMin: 17.40, latMax: 18.20, lonMin: 103.40, lonMax: 104.50 };
function inBuengKan(lat, lon) {
  return lat  >= BK_BBOX.latMin && lat  <= BK_BBOX.latMax &&
         lon  >= BK_BBOX.lonMin && lon  <= BK_BBOX.lonMax;
}
 
export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (request.method !== 'GET')     return json({ success: false, message: 'Method not allowed' }, 405);

  // Auth
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer '))
    return json({ success: false, message: 'กรุณาเข้าสู่ระบบ' }, 401);

  const userRow = await env.DB.prepare(`
    SELECT u.uuid, u.aff_code, u.dep_code,
           o.latitude  AS lat,
           o.longitude AS lon,
           o.district  AS district,
           o.affiliation_code, o.department_code
    FROM users u
    LEFT JOIN organizations o
      ON o.affiliation_code = u.aff_code
     AND o.department_code  = u.dep_code
    WHERE u.auth_token = ?
      AND u.token_expires_at > CURRENT_TIMESTAMP
      AND u.status = 'Active'
    LIMIT 1
  `).bind(auth.slice(7)).first();

  if (!userRow) return json({ success: false, message: 'Token ไม่ถูกต้องหรือหมดอายุ' }, 401);

  const url      = new URL(request.url);
  const userLat  = parseFloat(url.searchParams.get('lat')   || '');
  const userLon  = parseFloat(url.searchParams.get('lon')   || '');
  const rangeM   = parseInt(url.searchParams.get('range')   || '1000'); // รัศมี (ม.)

  const officeLat = parseFloat(userRow.lat  || 0);
  const officeLon = parseFloat(userRow.lon  || 0);
  const hasOffice = !isNaN(officeLat) && officeLat !== 0 && !isNaN(officeLon) && officeLon !== 0;
  const hasUser   = !isNaN(userLat)   && !isNaN(userLon);

  const office = hasOffice
    ? { lat: officeLat, lon: officeLon, district: userRow.district || null,
        dep_code: userRow.dep_code, aff_code: userRow.aff_code }
    : null;

  // ── คำนวณระยะทาง ──────────────────────────────────────────────────────
  let distance_m  = null;
  let is_in_range = null;
  let in_province = null;

  if (hasUser) {
    in_province = inBuengKan(userLat, userLon);

    if (in_province) {
      // อยู่ในจังหวัดบึงกาฬ → ถือว่าอยู่ในพื้นที่ ระยะ = 0
      distance_m  = 0;
      is_in_range = true;
    } else if (hasOffice) {
      distance_m  = haversine(userLat, userLon, officeLat, officeLon);
      is_in_range = distance_m <= rangeM;
    }
  }

  return json({
    success: true,
    office,
    ...(hasUser ? {
      user:       { lat: userLat, lon: userLon },
      distance_m,
      is_in_range,
      in_province,
    } : {}),
  });
}