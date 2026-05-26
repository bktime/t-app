// functions/api/dash/_scope.js
// Shared RBAC scope helper

export function buildScope(me, url, alias = '') {
  const scope = me.access_scope;
  const c = alias ? `${alias}.` : ''; // ← สร้าง prefix ถ้ามี alias ก็จะเป็น "u." ถ้าไม่มีก็จะเป็น ""

  const aff = url?.searchParams.get('aff') || null;
  const dep = url?.searchParams.get('dep') || null;

  /* ─────────────────────────────
   * ตนเอง
   * user
   * ───────────────────────────── */
  if (scope === 'ตนเอง') {
    return {
      scopeSQL: `
        AND ${c}dep_code = ?
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
      AND ${c}dep_code = ?
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

    // ✅ ป้องกันช่องโหว่: บังคับใช้ me.aff_code เสมอ
    const baseSQL = `AND ${c}aff_code = ?`;
    const baseParams = [me.aff_code];

    if (dep) {
      return {
        scopeSQL: `
          ${baseSQL}
          AND ${c}dep_code = ?
        `,
        scopeParams: [...baseParams, dep],

        scopeMeta: {
          scope: 'department',
          aff_code: me.aff_code,
          dep_code: dep,
        },

        canFilter: {
          aff: false,
          dep: true,
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
        AND ${c}aff_code = ?
        AND ${c}dep_code = ?
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
        AND ${c}aff_code = ?
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
        AND ${c}dep_code = ?
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
 * scopedUUIDsSQL(scopeSQL, alias)
 */
export function scopedUUIDsSQL(scopeSQL = '', alias = '') {
  const c = alias ? `${alias}.` : '';
  const tbl = alias ? `AS ${alias}` : '';
  return `
    SELECT uuid
    FROM users ${tbl}
    WHERE ${c}status = 'Active'
    ${scopeSQL}
  `;
}
