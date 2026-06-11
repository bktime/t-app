// functions/api/cron-notification.js
// wrangler.toml:
//   [triggers]
//   crons = ["30 0 * * 1-5", "30 9 * * 1-5"]
//   (07:30 และ 16:30 เวลาไทย UTC+7)

const FCM_URL = 'https://fcm.googleapis.com/v1/projects/attendance-app-c1aeb/messages:send';

export default {
  // ✅ เพิ่ม fetch handler (จำเป็น)
  async fetch(request, env, ctx) {
    return new Response('worktime-cron worker is running', { status: 200 });
  },

  async scheduled(_event, env, _ctx) {
    const localHour = getLocalHour();

    if (localHour === 7) {
      await sendReminders(env, 'checkin_reminder', {
        title: '🕒 ถึงเวลาลงเวลาเข้างานแล้ว',
        body: 'กรุณากดลงเวลาเข้างานวันนี้ครับ'
      });
    } else if (localHour === 16) {
      await sendReminders(env, 'checkout_reminder', {
        title: '🕒 ใกล้ถึงเวลาออกงานแล้ว',
        body: 'อย่าลืมลงเวลาออกงานก่อนกลับบ้านนะครับ'
      });
    } else {
      console.log(`[cron] localHour=${localHour} — ไม่มี trigger`);
    }
  }
};

// ─────────────────────────────────────
// Core: ค้นหาผู้ใช้ที่ต้องแจ้งเตือน + ส่ง FCM
// ─────────────────────────────────────
async function sendReminders(env, type, notification) {
  const todayStr = getLocalDateStr(); // "2025-06-09"

  // query แยกตาม type
const query = type === 'checkin_reminder'
  ? `
      SELECT DISTINCT u.uuid, ft.token
      FROM fcm_tokens ft
      JOIN users u ON u.uuid = ft.uuid
      WHERE u.status = 'Active'
        AND u.uuid NOT IN (
          SELECT DISTINCT uuid
          FROM attendance
          WHERE date = ?1
            AND checkin_time IS NOT NULL
        )
    `
  : `
      SELECT DISTINCT u.uuid, ft.token
      FROM fcm_tokens ft
      JOIN users u ON u.uuid = ft.uuid
      WHERE u.status = 'Active'
        AND u.uuid IN (
          SELECT DISTINCT uuid
          FROM attendance
          WHERE date = ?1
            AND checkin_time IS NOT NULL
            AND (checkout_at IS NULL OR checkout_at = '')
        )
    `;

  const { results } = await env.DB.prepare(query).bind(todayStr).all();

  if (!results?.length) {
    console.log(`[${type}] ไม่มีผู้ใช้ที่ต้องแจ้งเตือน`);
    return;
  }

  console.log(`[${type}] จะส่งให้ ${results.length} token`);

  const accessToken = await getAccessToken(env);
  if (!accessToken) {
    console.error('[cron] ไม่สามารถดึง FCM Access Token ได้');
    return;
  }

  // ส่งพร้อมกัน ไม่เกิน 20 token ต่อ batch เพื่อป้องกัน rate limit
  const BATCH = 20;
  for (let i = 0; i < results.length; i += BATCH) {
    const batch = results.slice(i, i + BATCH);
    await Promise.allSettled(
      batch.map(row => sendOneFCM(accessToken, row, notification, type, env))
    );
  }
}

async function sendOneFCM(accessToken, row, notification, type, env) {
  const { uuid, token } = row;

  let status = 'failed';
  let errorMsg = null;

  try {
    const res = await fetch(FCM_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: {
          token,
          notification: {
            title: notification.title,
            body: notification.body
          },
          android: {
            priority: 'high',
            notification: {
              sound: 'default',
              channel_id: 'attendance_reminder'
            }
          },
          apns: {
            payload: {
              aps: { sound: 'default', badge: 1 }
            }
          }
        }
      })
    });

    const data = await res.json();

    if (res.ok) {
      status = 'sent';
    } else {
      errorMsg = data?.error?.message ?? JSON.stringify(data);

      // token หมดอายุ → ลบทิ้งทันที
      if (data?.error?.status === 'UNREGISTERED') {
        await env.DB.prepare(
          `DELETE FROM fcm_tokens WHERE token = ?1`
        ).bind(token).run().catch(() => {});
        console.log(`[FCM] ลบ token UNREGISTERED ของ uuid=${uuid}`);
      }
    }
  } catch (err) {
    errorMsg = err?.message ?? 'unknown error';
  }

  // log ผลทุกครั้ง — fire-and-forget
  env.DB.prepare(`
    INSERT INTO notification_logs (uuid, type, token, status, error_msg)
    VALUES (?1, ?2, ?3, ?4, ?5)
  `).bind(uuid, type, token, status, errorMsg).run().catch(() => {});
}

// ─────────────────────────────────────
// Google Service Account → FCM Access Token
// ─────────────────────────────────────
async function getAccessToken(env) {
  try {
    const sa = JSON.parse(env.FCM_SERVICE_ACCOUNT);
    const now = Math.floor(Date.now() / 1000);

    const header  = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = b64url(JSON.stringify({
      iss:   sa.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud:   'https://oauth2.googleapis.com/token',
      iat:   now,
      exp:   now + 3600
    }));

    const unsigned   = `${header}.${payload}`;
    const privateKey = await importPrivateKey(sa.private_key);
    const sig        = await signRS256(unsigned, privateKey);
    const jwt        = `${unsigned}.${sig}`;

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt
      })
    });

    const data = await res.json();
    return data.access_token ?? null;
  } catch (err) {
    console.error('[getAccessToken]', err);
    return null;
  }
}

async function importPrivateKey(pem) {
  const pemBody = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  return crypto.subtle.importKey(
    'pkcs8', der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
}

async function signRS256(data, key) {
  const encoded = new TextEncoder().encode(data);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoded);
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64url(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ─────────────────────────────────────
// Helpers
// ─────────────────────────────────────
function getLocalHour() {
  return (new Date().getUTCHours() + 7) % 24;
}

function getLocalDateStr() {
  const d = new Date(Date.now() + 7 * 3600000);
  return d.toISOString().slice(0, 10);
}