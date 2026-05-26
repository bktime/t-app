// functions/api/dash/_scope.js
// Shared RBAC scope helper

/**
 * buildScope(me, url)
 *
 * me:
 * {
 *   uuid,
 *   role,
 *   role_level,
 *   access_scope,
 *   can_edit,
 *   dep_code,
 *   aff_code,
 *   department,
 *   affiliation
 * }
 */

export function buildScope(me, url) {
  const scope = me.access_scope;

  const aff = url?.searchParams.get('aff') || null;
  const dep = url?.searchParams.get('dep') || null;

  /* ─────────────────────────────
   * ตนเอง
   * user
   * ───────────────────────────── */
  if (scope === 'ตนเอง') {
    return {
      scopeSQL: `
        AND u.dep_code = ?
      `,
      scopeParams: [me.dep_code],

      scopeMeta: {
        scope: 'department',
        dep_code: me.dep_code,
        department: me.department,
      },

      canFilter: {
        aff: false,
        dep: false,
      },
    };
  }

/* ─────────────────────────────
 * หน่วยงาน
 * staff / support / supervisor
 * เห็นเฉพาะหน่วยงานตัวเอง
 * ───────────────────────────── */
if (scope === 'หน่วยงาน') {

  return {
    scopeSQL: `
      AND u.dep_code = ?
    `,
    scopeParams: [me.dep_code],

    scopeMeta: {
      scope: 'department',
      dep_code: me.dep_code,
      department: me.department,
    },

    canFilter: {
      aff: false,
      dep: false,
    },
  };
}

  /* ─────────────────────────────
   * สังกัด
   * hr / it / finance / executive
   * ───────────────────────────── */
  if (scope === 'สังกัด') {

    // ✅ ป้องกันช่องโหว่: บังคับใช้ me.aff_code เสมอ ห้ามให้ HR เห็นทั้งหมดถ้าไม่ส่ง Parameter
    const baseSQL = `AND u.aff_code = ?`;
    const baseParams = [me.aff_code];

    if (dep) {
      return {
        scopeSQL: `
          ${baseSQL}
          AND u.dep_code = ?
        `,
        scopeParams: [...baseParams, dep],

        scopeMeta: {
          scope: 'department',
          aff_code: me.aff_code,
          dep_code: dep,
        },

        canFilter: {
          aff: false,
          dep: true, // กรองหน่วยงานในสังกัดตัวเองได้
        },
      };
    }

    return {
      scopeSQL: baseSQL,
      scopeParams: baseParams,

      scopeMeta: {
        scope: 'affiliation',
        aff_code: me.aff_code,
      },

      canFilter: {
        aff: false,
        dep: true, // กรองหน่วยงานในสังกัดตัวเองได้
      },
    };
  }

  /* ─────────────────────────────
   * ทั้งหมด
   * admin / ceo
   * ───────────────────────────── */

  if (aff && dep) {
    return {
      scopeSQL: `
        AND u.aff_code = ?
        AND u.dep_code = ?
      `,
      scopeParams: [aff, dep],

      scopeMeta: {
        scope: 'department',
        aff_code: aff,
        dep_code: dep,
      },

      canFilter: {
        aff: true,
        dep: true,
      },
    };
  }

  if (aff) {
    return {
      scopeSQL: `
        AND u.aff_code = ?
      `,
      scopeParams: [aff],

      scopeMeta: {
        scope: 'affiliation',
        aff_code: aff,
      },

      canFilter: {
        aff: true,
        dep: true,
      },
    };
  }

  if (dep) {
    return {
      scopeSQL: `
        AND u.dep_code = ?
      `,
      scopeParams: [dep],

      scopeMeta: {
        scope: 'department',
        dep_code: dep,
      },

      canFilter: {
        aff: true,
        dep: true,
      },
    };
  }

  return {
    scopeSQL: '',
    scopeParams: [],

    scopeMeta: {
      scope: 'all',
    },

    canFilter: {
      aff: true,
      dep: true,
    },
  };
}

/**
 * getMe(env, uuid)
 * ดึงข้อมูล user + RBAC
 */
export async function getMe(env, uuid) {
  return env.DB.prepare(`
    SELECT
      u.uuid,
      u.role,
      u.dep_code,
      u.aff_code,
      u.department,
      u.affiliation,

      r.role_name,
      r.level           AS role_level,
      r.access_scope,
      r.can_edit

    FROM users u

    LEFT JOIN roles r
      ON r.role = u.role

    WHERE u.uuid = ?
      AND u.status = 'Active'

    LIMIT 1
  `).bind(uuid).first();
}

/**
 * scopedUUIDsSQL(scopeSQL)
 *
 * ใช้สำหรับ:
 *
 * AND a.uuid IN (${scopedUUIDsSQL(scopeSQL)})
 */
export function scopedUUIDsSQL(scopeSQL = '') {
  return `
    SELECT uuid
    FROM users AS u
    WHERE u.status = 'Active'
    ${scopeSQL}
  `;
}
