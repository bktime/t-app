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
        AND dep_code = ?
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
      AND dep_code = ?
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

    if (aff && dep) {
      return {
        scopeSQL: `
          AND aff_code = ?
          AND dep_code = ?
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
          AND aff_code = ?
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
          AND dep_code = ?
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
        scope: 'organization',
      },

      canFilter: {
        aff: true,
        dep: true,
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
        AND aff_code = ?
        AND dep_code = ?
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
        AND aff_code = ?
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
        AND dep_code = ?
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
    FROM users
    WHERE status = 'Active'
    ${scopeSQL}
  `;
}