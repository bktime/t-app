
// ============================================
// GET /api/user/workforce-dashboard
// ============================================

import {
  authUser,
  extractToken
} from '../_auth.js';

const corsHeaders = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'GET, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization',
};

const json = (data,status=200)=>
  Response.json(data,{
    status,
    headers:corsHeaders
  });

export async function onRequest(context){

  const { request, env } = context;

  // ========================================
  // OPTIONS
  // ========================================

  if(request.method === 'OPTIONS'){

    return new Response(null,{
      headers:corsHeaders
    });

  }

  // ========================================
  // METHOD
  // ========================================

  if(request.method !== 'GET'){

    return json({
      success:false,
      message:'Method not allowed'
    },405);

  }

  try{

    // ======================================
    // AUTH
    // ======================================

    const token =
      extractToken(request);

    const session =
      await authUser(env, token);

    if(!session){

      return json({
        success:false,
        message:'Unauthorized'
      },401);

    }

    // ======================================
    // DATE
    // ======================================

    const now = new Date();

    const bangkok =
      new Date(
        now.toLocaleString(
          'en-US',
          {
            timeZone:'Asia/Bangkok'
          }
        )
      );

    const year =
      bangkok.getFullYear();

    const month =
      bangkok.getMonth() + 1;

    const monthStart =
      `${year}-${String(month)
        .padStart(2,'0')}-01`;

    const nextMonthDate =
      new Date(year, month, 1);

    const nextMonthStart =
      `${nextMonthDate.getFullYear()}-${
        String(
          nextMonthDate.getMonth()+1
        ).padStart(2,'0')
      }-01`;

    // ======================================
    // WORKING DAYS
    // ======================================

    const workingDaysQuery =
      await env.DB.prepare(`

        WITH RECURSIVE dates(date) AS (

          VALUES(date(?))

          UNION ALL

          SELECT date(date,'+1 day')
          FROM dates
          WHERE date < date(?,'-1 day')

        )

        SELECT COUNT(*) total

        FROM dates

        WHERE strftime('%w', date)
        NOT IN ('0','6')

        AND date NOT IN (

          SELECT date
          FROM holidays

        )

      `)
      .bind(
        monthStart,
        nextMonthStart
      )
      .first();

    const workingDays =
      Number(
        workingDaysQuery?.total || 0
      );

    // ======================================
    // ATTENDANCE STATS
    // ======================================

    const stats =
      await env.DB.prepare(`

        SELECT

          COUNT(*) AS attendedDays,

          -- มาตรงเวลา
          COALESCE(
            SUM(
              CASE
                WHEN time(checkin_time)
                  <= time('08:30:00')
                THEN 1
                ELSE 0
              END
            ),
            0
          ) AS ontimeDays,

          -- ลงเวลากลับ
          COALESCE(
            SUM(
              CASE
                WHEN checkout_at IS NOT NULL
                THEN 1
                ELSE 0
              END
            ),
            0
          ) AS completeDays,

          -- อยู่ในพื้นที่
          COALESCE(
            SUM(
              CASE
                WHEN checkin_in_range = 1
                THEN 1
                ELSE 0
              END
            ),
            0
          ) AS inRangeDays

        FROM attendance

        WHERE uuid = ?
        AND date >= ?
        AND date < ?

      `)
      .bind(
        session.uuid,
        monthStart,
        nextMonthStart
      )
      .first();

    // ======================================
    // HOLIDAY WORK
    // ======================================

    const holidayWork =
      await env.DB.prepare(`

        SELECT COUNT(*) total

        FROM holiday_logs

        WHERE uuid = ?
        AND action = 'in'
        AND date >= ?
        AND date < ?

      `)
      .bind(
        session.uuid,
        monthStart,
        nextMonthStart
      )
      .first();

    // ======================================
    // HOLIDAY SET
    // ======================================

    const holidayRows =
      await env.DB.prepare(`
        SELECT date
        FROM holidays
      `).all();

    const holidaySet =
      new Set(
        (holidayRows?.results || [])
        .map(r => r.date)
      );

    // ======================================
    // ATTENDANCE DATES
    // ======================================

    const attendanceRows =
      await env.DB.prepare(`

        SELECT DISTINCT date

        FROM attendance

        WHERE uuid = ?

        ORDER BY date DESC

      `)
      .bind(session.uuid)
      .all();

    const attendanceSet =
      new Set(
        (attendanceRows?.results || [])
        .map(r => r.date)
      );

    // ======================================
    // HELPERS
    // ======================================

    function formatDate(d){

      return d
        .toISOString()
        .split('T')[0];

    }

    function isWeekend(d){

      return (
        d.getDay() === 0 ||
        d.getDay() === 6
      );

    }

    function isHoliday(d){

      return holidaySet.has(
        formatDate(d)
      );

    }

    function isWorkingDay(d){

      return (
        !isWeekend(d) &&
        !isHoliday(d)
      );

    }

    // ======================================
    // STREAK
    // ======================================

    let streak = 0;

    const cursor =
      new Date(bangkok);

    while(true){

      const dateStr =
        formatDate(cursor);

      if(!isWorkingDay(cursor)){

        cursor.setDate(
          cursor.getDate() - 1
        );

        continue;

      }

      if(attendanceSet.has(dateStr)){

        streak++;

        cursor.setDate(
          cursor.getDate() - 1
        );

      }else{

        break;

      }

    }

    // ======================================
    // SCORE
    // ======================================

    let score = 0;

    score +=
      Number(stats?.ontimeDays || 0) * 5;

    score +=
      Number(stats?.completeDays || 0) * 3;

    score +=
      Number(stats?.inRangeDays || 0) * 2;

    score +=
      Number(holidayWork?.total || 0) * 4;

    score += streak;

    score =
      Math.max(
        0,
        Math.min(100, score)
      );

    // ======================================
    // ATTENDANCE RATE
    // ======================================

    const attendedDays =
      Number(
        stats?.attendedDays || 0
      );

    const attendanceRate =
      workingDays > 0
      ? Math.round(
          (
            attendedDays /
            workingDays
          ) * 100
        )
      : 0;

    // ======================================
    // RESPONSE
    // ======================================

    return json({

      success:true,

      dashboard:{

        name:       session.name,
        department: session.department,
        streak,

        score,

        attendanceRate,

        workingDays,

        attendedDays,

        remainingDays:
          Math.max(
            0,
            workingDays - attendedDays
          ),

        holidayContribution:
          Number(
            holidayWork?.total || 0
          )

      }

    });

  }catch(error){

    console.error(
      '[workforce-dashboard]',
      error
    );

    return json({

      success:false,

      message:error.message,

      stack:error.stack

    },500);

  }

}

