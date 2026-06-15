/* ═══════════ CONFIG ═══════════ */
    const API_BASE = '/api';

    /* ═══════════ PARTICLES ═══════════ */
    function spawnParticles() {
      const c = document.getElementById('particleContainer');
      if (!c) return;
      const colors = ['rgba(0,245,176,', 'rgba(34,211,240,', 'rgba(139,124,248,'];
      for (let i = 0; i < 18; i++) {
        const p = document.createElement('div');
        const size = Math.random() * 3 + 1;
        const color = colors[Math.floor(Math.random() * colors.length)];
        const dur = Math.random() * 20 + 12;
        const delay = Math.random() * dur;
        const dx = (Math.random() - 0.5) * 80;
        const dy = -(Math.random() * 200 + 80);
        p.className = 'particle';
        p.style.cssText = `
          width:${size}px;height:${size}px;
          background:${color}${Math.random() * 0.5 + 0.3});
          left:${Math.random() * 100}%;
          top:${Math.random() * 100}%;
          --dx:${dx}px;--dy:${dy}px;
          animation-duration:${dur}s;
          animation-delay:-${delay}s;
        `;
        c.appendChild(p);
      }
    }
    spawnParticles();

    /* ═══════════ CLOCK ═══════════ */
    const thDays = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
    const thMonths = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
                      'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

    function updateClock() {
      const now = new Date();
      const liveEl = document.getElementById('liveTime');
      if (liveEl) {
        liveEl.textContent = now.toLocaleTimeString('th-TH', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        });
      }
      const be = now.getFullYear() + 543;
      document.getElementById('currentDate').textContent =
        `วัน${thDays[now.getDay()]}ที่ ${now.getDate()} ${thMonths[now.getMonth()]} ${be}`;
      document.getElementById('footerYear').textContent = be;
    }
    updateClock();
    setInterval(updateClock, 1000);

    /* ═══════════ THEME ═══════════ */
(function() {
  const btn = document.getElementById('themeBtn');
  const icon = document.getElementById('themeIcon');
  const meta = document.getElementById('themeColorMeta');

  let isLight = localStorage.getItem('theme')
    ? localStorage.getItem('theme') === 'light'
    : true;

  function apply(light) {
    isLight = light;

    document.documentElement.setAttribute(
      'data-theme',
      light ? 'light' : 'dark'
    );

    icon.className = light
      ? 'fas fa-sun'
      : 'fas fa-moon';

    meta.content = light
      ? '#e8edf4'
      : '#0b1220';

    localStorage.setItem(
      'theme',
      light ? 'light' : 'dark'
    );
  }

  apply(isLight);

  btn.addEventListener('click', () => apply(!isLight));
})();

    /* ═══════════ TOAST ═══════════ */
    function showToast(msg, type = 'default') {
      const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', default: 'fa-circle-info' };
      const tc = document.getElementById('toastContainer');
      const t = document.createElement('div');
      t.className = `toast${type !== 'default' ? ' ' + type : ''}`;
      t.innerHTML = `<i class="fas ${icons[type] || icons.default}" aria-hidden="true"></i><span>${msg}</span>`;
      tc.appendChild(t);
      setTimeout(() => {
        t.classList.add('exit');
        setTimeout(() => t.remove(), 300);
      }, 3500);
    }

    /* ═══════════ GREETING ═══════════ */
function getGreeting() {
  const h = new Date().getHours();
  if (h >= 4 && h < 6) return 'เช้าตรู่ — พร้อมเริ่มวันใหม่';
  if (h >= 6 && h < 12) return 'สวัสดีตอนเช้า — ขอให้เป็นวันที่ดี';
  if (h >= 12 && h < 14) return 'สวัสดีตอนเที่ยง';
  if (h >= 14 && h < 17) return 'สวัสดีตอนบ่าย';
  if (h >= 17 && h < 19) return 'สวัสดีตอนเย็น';
  if (h >= 19 && h < 22) return 'ค่ำแล้ว — พักผ่อนบ้างนะ';
  return 'ดึกแล้ว — อย่าลืมพักผ่อน';
}

    /* ═══════════ WORDMARK ═══════════ */
    const prefixMap = [
      { a: 'สสจ.', f: 'สำนักงานสาธารณสุขจังหวัด' },
      { a: 'สสอ.', f: 'สำนักงานสาธารณสุขอำเภอ' },
      { a: 'รพ.สต.', f: 'โรงพยาบาลส่งเสริมสุขภาพตำบล' },
      { a: 'รพช.', f: 'โรงพยาบาลชุมชน' },
      { a: 'รพ.', f: 'โรงพยาบาล' },
    ];

    function expand(name) {
      if (!name) return name;
      for (const { a, f } of prefixMap) {
        if (name.startsWith(a)) return f + name.slice(a.length);
      }
      return name;
    }

    function setWordmark(u) {
      const orgEl = document.getElementById('wordmarkOrg');
      const deptEl = document.getElementById('wordmarkDept');
      if (!orgEl || !deptEl) return;
      if (u && u.affiliation) {
        orgEl.textContent = expand(u.affiliation);
        const dept = expand(u.department) || '';
        deptEl.textContent = dept ;
      } else {
        orgEl.textContent = 'ลงเวลาปฏิบัติงาน';
        deptEl.textContent = 'รพ.สต.หนองทุ่ม · อำเภอเซกา';
      }
    }

    /* ═══════════ STATS ═══════════ */
    function setStats(s) {
      document.getElementById('statWorkDays').textContent  = s?.workDays  ?? '—';
      document.getElementById('statOutOffice').textContent = s?.outOffice ?? '—';
      document.getElementById('statWfh').textContent      = s?.wfh       ?? '—';
    }

    async function fetchStats(token) {
      const cached = (() => { try { return JSON.parse(localStorage.getItem('user_stats') || 'null'); } catch { return null; } })();
      if (cached) setStats(cached);
      try {
        const res  = await fetch(`${API_BASE}/user/stats`, {
          headers: { 'Authorization': `Bearer ${token}` },
          cache: 'no-store',
        });
        const data = await res.json();
        if (data.success && data.stats) {
          setStats(data.stats);
          localStorage.setItem('user_stats', JSON.stringify(data.stats));
        }
      } catch (e) { console.warn('[fetchStats]', e); }
    }

    /* ═══════════ NOTIFICATION SYSTEM ═══════════ */
    let _notifTab    = 'mine';
    let _notifLoaded = false;
    let _mineItems   = [];   
    let _pendItems   = [];   
    let _supItems    = [];   

    function AUTH_HEADER() {
      const t = localStorage.getItem('auth_token');
      return t ? { 'Authorization': `Bearer ${t}` } : {};
    }

    async function loadNotifications() {
      const raw = localStorage.getItem('user_data');
      const ud  = raw ? JSON.parse(raw) : null;
      const uuid = ud?.uuid || '';
      if (!uuid) return;

      try {
        const res = await fetch(`${API_BASE}/attendance/request?uuid=${encodeURIComponent(uuid)}&limit=20`, { headers: AUTH_HEADER() });
        const d   = await res.json();
        if (d.success) _mineItems = d.data || [];
      } catch (_) {}

      _pendItems = [];
      try {
        const res = await fetch(`${API_BASE}/attendance/request-manage?status=pending&limit=50`, { headers: AUTH_HEADER() });
        const d   = await res.json();
        if (d.success) _pendItems = d.data || [];
      } catch (_) {}

_supItems = [];

try {
  const res = await fetch(
    `${API_BASE}/attendance/supervisor-pending?status=pending&limit=50`,
    {
      headers: AUTH_HEADER()
    }
  );

  if (res.status === 401) {
    console.warn('Unauthorized');
    return;
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const text = await res.text();

  let d;
  try {
    d = JSON.parse(text);
  } catch {
    console.error('Response is not JSON:', text);
    return;
  }

  if (!d.success) {
    throw new Error(d.message || 'โหลดข้อมูลไม่สำเร็จ');
  }

  _supItems = d.data || [];

} catch (err) {
  console.error('load supervisor pending error:', err);
}

      const prevRead   = new Set(JSON.parse(localStorage.getItem('notifRead') || '[]'));
      const unreadMine = _mineItems.filter(i => ['approved','rejected'].includes(i.status) && !prevRead.has(i.reference)).length;
      const unreadPend = _pendItems.filter(i => !prevRead.has(i.reference)).length;
      const unreadSup  = _supItems.filter(i => !prevRead.has('sup-' + i.id)).length;
      const total      = unreadMine + unreadPend + unreadSup;

      updateNotifBadge(total, unreadPend, unreadSup);

      _notifLoaded = true;
      if (document.getElementById('notifPanel').classList.contains('open')) renderNotifBody();
    }

    function updateNotifBadge(total, unreadPend, unreadSup) {
      const badge = document.getElementById('notifDotCount');
      const dot   = document.getElementById('notifDot');
      if (total > 0) {
        badge.textContent   = total > 99 ? '99+' : total;
        badge.classList.add('show');
        dot.style.display   = 'none';
      } else {
        badge.classList.remove('show');
        dot.style.display   = 'none';
      }
      const pc = document.getElementById('ntabPendingCount');
      if (pc) { pc.textContent = unreadPend || ''; pc.classList.toggle('show', unreadPend > 0); }
      const sc = document.getElementById('ntabSupervisorCount');
      if (sc) { sc.textContent = unreadSup || ''; sc.classList.toggle('show', unreadSup > 0); }
    }

    function openNotifPanel() {
      document.getElementById('notifPanel').classList.add('open');
      document.getElementById('notifOverlay').classList.add('open');
      renderNotifBody();
      setTimeout(markCurrentTabRead, 800);
    }

    function closeNotifPanel() {
      document.getElementById('notifPanel').classList.remove('open');
      document.getElementById('notifOverlay').classList.remove('open');
    }

    function switchNotifTab(tab) {
      _notifTab = tab;
      document.querySelectorAll('.ntab').forEach(t => t.classList.remove('active'));
      document.getElementById('ntab-' + tab)?.classList.add('active');
      renderNotifBody();
      setTimeout(markCurrentTabRead, 600);
    }

    function markCurrentTabRead() {
      const read = new Set(JSON.parse(localStorage.getItem('notifRead') || '[]'));
      if (_notifTab === 'mine')       _mineItems.forEach(i => read.add(i.reference));
      else if (_notifTab === 'pending')    _pendItems.forEach(i => read.add(i.reference));
      else if (_notifTab === 'supervisor') _supItems.forEach(i => read.add('sup-' + i.id));
      localStorage.setItem('notifRead', JSON.stringify([...read].slice(-300)));
      loadNotifications();
    }

    function renderNotifBody() {
      const body = document.getElementById('notifBody');
      if (!_notifLoaded) {
        body.innerHTML = '<div class="notif-empty"><i class="fas fa-spinner fa-spin" aria-hidden="true"></i> กำลังโหลด...</div>';
        return;
      }
      const emptyMap = {
        mine:       '<i class="fas fa-paper-plane" aria-hidden="true"></i>ยังไม่มีคำขอที่ส่ง',
        pending:    '<i class="fas fa-inbox" aria-hidden="true"></i>ไม่มีคำขอรออนุมัติ',
        supervisor: '<i class="fas fa-shield-halved" aria-hidden="true"></i>ไม่มีรายการรอรับรอง',
      };
      const items = _notifTab === 'mine' ? _mineItems
                  : _notifTab === 'pending' ? _pendItems : _supItems;
                  
      if (!items.length) {
        body.innerHTML = `<div class="notif-empty">${emptyMap[_notifTab] || ''}</div>`;
        return;
      }
      
      const read = new Set(JSON.parse(localStorage.getItem('notifRead') || '[]'));
      body.innerHTML = items.map(item => renderNotifItem(item, read)).join('');

      // FIX: Attach click handlers for "mine" tab items
      if (_notifTab === 'mine') {
        body.querySelectorAll('.nitem[data-ref]').forEach(el => {
          el.addEventListener('click', () => {
            showMineDetail(el.dataset.ref);
          });
        });
      }
    }

    // FIX: Escape single quotes for inline handlers to prevent XSS
    function _esc(s) { 
      return String(s||'')
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;')
        .replace(/'/g, '&#39;'); 
    }

    function _fmtDate(s) {
      try { return new Date(s+'T00:00:00').toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric'}); }
      catch { return s; }
    }

    function _ago(iso) {
      if (!iso) return '';
      const diff = Date.now() - new Date(iso).getTime();
      const m = Math.floor(diff / 60000);
      if (m < 1)   return 'เมื่อสักครู่';
      if (m < 60)  return `${m} นาทีที่แล้ว`;
      const h = Math.floor(m / 60);
      if (h < 24)  return `${h} ชั่วโมงที่แล้ว`;
      return `${Math.floor(h/24)} วันที่แล้ว`;
    }

    function renderNotifItem(item, read) {
      const stColor = { pending:'ni-pending', approved:'ni-approved', rejected:'ni-rejected', cancelled:'ni-cancelled' };
      const stIcon  = { pending:'fa-hourglass-half', approved:'fa-circle-check', rejected:'fa-circle-xmark', cancelled:'fa-ban' };
      const stLabel = { pending:'รอดำเนินการ', approved:'อนุมัติแล้ว', rejected:'ปฏิเสธ', cancelled:'ยกเลิกแล้ว' };
      const stPill  = { pending:'nis-pending', approved:'nis-approved', rejected:'nis-rejected', cancelled:'nis-cancelled' };

      if (_notifTab === 'mine') {
        const typ   = item.status || 'pending';
        const isNew = !read.has(item.reference) && ['approved','rejected'].includes(typ);
        const ago   = _ago(item.submitted_at);

        const supSt = item.status === 'cancelled' ? 'cancelled' : (item.supervisor_status || 'none');
        const supCfg = {
          pending:   { c:'var(--amber)',    i:'fa-hourglass-half', l:'รอรับรอง' },
          approved:  { c:'var(--mint-text)',i:'fa-shield-halved',  l:'รับรองแล้ว' },
          rejected:  { c:'var(--rose)',     i:'fa-shield-xmark',   l:'ไม่รับรอง' },
          cancelled: { c:'var(--t3)',       i:'fa-ban',            l:'ยกเลิก' },
        };
        const sb = supSt !== 'none' && supCfg[supSt]
          ? `<span style="display:inline-flex;align-items:center;gap:3px;font-size:.63rem;padding:1px 7px;border-radius:20px;background:${supCfg[supSt].c}20;color:${supCfg[supSt].c};border:1px solid ${supCfg[supSt].c}50;margin-left:4px;font-weight:600"><i class="fas ${supCfg[supSt].i}" style="font-size:.5rem" aria-hidden="true"></i>${supCfg[supSt].l}</span>` : '';

        const cancelBtn = typ === 'pending'
          ? `<button onclick="event.stopPropagation();cancelRequest('${_esc(item.reference||'')}','${_esc(item.request_type||'')}','${_esc(item.req_date||'')}')"
               style="margin-top:6px;display:inline-flex;align-items:center;gap:4px;font-size:.7rem;padding:3px 10px;border-radius:20px;background:rgba(248,113,113,0.1);color:var(--rose);border:1px solid var(--rose-border);font-weight:700;cursor:pointer;line-height:1.4">
               <i class="fas fa-xmark" style="font-size:.65rem" aria-hidden="true"></i> ยกเลิกคำขอ</button>` : '';

        return `<div class="nitem${isNew?' unread':''}" data-ref="${_esc(item.reference||'')}">
          <div class="ni-icon ${stColor[typ]||'ni-info'}" aria-hidden="true"><i class="fas ${stIcon[typ]||'fa-file'}"></i></div>
          <div class="ni-body">
            <div class="ni-title">${_esc(item.request_type||'—')} ${sb}</div>
            <div class="ni-sub">${item.req_date ? _fmtDate(item.req_date) : ''} ${item.req_time ? ' เวลา '+_esc(item.req_time) : ''}</div>
            <div class="ni-sub">${_esc(item.reason||'')}</div>
            ${item.reviewer_note ? `<div class="ni-sub" style="color:var(--t3);font-style:italic"><i class="fas fa-quote-left" style="font-size:.6rem" aria-hidden="true"></i> ${_esc(item.reviewer_note)}</div>` : ''}
            <div class="ni-time">${ago} &nbsp;<span class="ni-status ${stPill[typ]||'nis-pending'}"><i class="fas ${stIcon[typ]}" style="font-size:.55rem" aria-hidden="true"></i> ${stLabel[typ]||typ}</span></div>
            <div style="font-size:.63rem;color:var(--t4);margin-top:2px;font-family:'DM Mono',monospace">${_esc(item.reference||'')}</div>
            ${cancelBtn}
          </div></div>`;
      }

      if (_notifTab === 'pending') {
        const isNew = !read.has(item.reference);
        const avSrc = item.profileImage || item.picture ||
          `https://ui-avatars.com/api/?background=8b7cf8&color=fff&size=64&bold=true&name=${encodeURIComponent((item.name||'U').charAt(0))}`;
        const ago = _ago(item.submitted_at);
        return `<div class="nitem${isNew?' unread':''}" onclick="gotoRequests('${_esc(item.reference||'')}')">
          <img src="${_esc(avSrc)}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:2px solid var(--b1);flex-shrink:0;margin-top:1px"
            onerror="this.src='https://ui-avatars.com/api/?background=8b7cf8&color=fff&size=64&bold=true&name=U'" alt="">
          <div class="ni-body">
            <div class="ni-title">${_esc(((item.firstName||'') + ' ' + (item.lastName||'')).trim() || item.name||'—')}</div>
            <div class="ni-sub">${_esc(item.request_type||'')} · ${item.req_date ? _fmtDate(item.req_date) : ''}</div>
            <div class="ni-sub" style="color:var(--t3)">${_esc(item.reason||'')}</div>
            <div class="ni-time">${ago} &nbsp;<span class="ni-status nis-pending"><i class="fas fa-hourglass-half" style="font-size:.55rem" aria-hidden="true"></i> รอดำเนินการ</span></div>
          </div>
          <i class="fas fa-chevron-right" style="color:var(--t4);font-size:.7rem;margin-top:8px;flex-shrink:0" aria-hidden="true"></i>
          </div>`;
      }

      if (_notifTab === 'supervisor') {
        const key    = 'sup-' + item.id;
        const isNew  = !read.has(key);
        const fname  = ((item.firstName||'') + ' ' + (item.lastName||'')).trim()  || item.name || '—';
        const avSrc  = item.picture ||
          `https://ui-avatars.com/api/?background=60a5fa&color=fff&size=64&bold=true&name=${encodeURIComponent((fname||'U').charAt(0))}`;
        const ciTime = item.checkin_time  || '—';
        const coTime = item.checkout_time || '—';
        const coType =
  item.checkout_type === 'auto'
    ? ' <i class="fa-solid fa-robot"></i>'
    : item.checkout_type === 'manual'
    ? ' <i class="fa-solid fa-user-check"></i>'
    : '';
const dist = item.checkin_distance_m != null
  ? (
      item.checkin_distance_m >= 1000
        ? (item.checkin_distance_m / 1000).toFixed(1) + ' กม.'
        : item.checkin_distance_m + ' ม.'
    ) +
    ' ' +
    (
      item.checkin_in_range
        ? '<i class="fa-solid fa-circle-check" style="color:#22c55e"></i>'
        : '<i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b"></i>'
    )
  : '';
        const ago = _ago(item.checkin_at || item.submitted_at);
        return `
<div class="nitem${isNew ? ' unread' : ''}"
     onclick='gotoSupervisor(${JSON.stringify(item.checkin_reference)})'>
          <img src="${_esc(avSrc)}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:2px solid var(--b1);flex-shrink:0;margin-top:1px"
            onerror="this.src='https://ui-avatars.com/api/?background=60a5fa&color=fff&size=64&bold=true&name=U'" alt="">
          <div class="ni-body">
            <div class="ni-title">${_esc(fname)}</div>
            <div class="ni-sub">${item.date ? _fmtDate(item.date) : ''} · เข้า <b>${_esc(ciTime)}</b> ออก ${_esc(coTime)}${coType}</div>
            ${dist ? `<div class="ni-sub"><i class="fa-solid fa-location-dot"></i> ${(dist)}</div>` : ''}
            ${item.request_type ? `<div class="ni-sub" style="color:var(--amber)"><i class="fas fa-file-pen" style="font-size:.6rem" aria-hidden="true"></i> ${_esc(item.request_type)}</div>` : ''}
            <div class="ni-time">${ago} &nbsp;<span class="ni-status nis-pending"><i class="fas fa-hourglass-half" style="font-size:.55rem" aria-hidden="true"></i> รอรับรอง</span></div>
          </div>
          <i class="fas fa-chevron-right" style="color:var(--t4);font-size:.7rem;margin-top:8px;flex-shrink:0" aria-hidden="true"></i>
          </div>`;
      }
      return '';
    }

    function showMineDetail(reference) {
      const item = _mineItems.find(i => i.reference === reference);
      if (!item) return;
      const stColor = { pending:'#fb8c00', approved:'#00c98a', rejected:'#f87171', cancelled:'#94a3b8' };
      const stLabel = { pending:'รอดำเนินการ', approved:'อนุมัติแล้ว', rejected:'ปฏิเสธ', cancelled:'ยกเลิกแล้ว' };
      const isDark  = document.documentElement.getAttribute('data-theme') !== 'light';
      const color   = stColor[item.status] || '#94a3b8';
      const ciTime  = item.checkin_time  ? `<b>${_esc(item.checkin_time.slice(0,5))}</b>` : '<span style="color:#94a3b8">—</span>';
      const coTime  = item.checkout_time ? `<b>${_esc(item.checkout_time.slice(0,5))}</b> <span style="font-size:.75rem;color:#94a3b8">${item.checkout_type==='auto'?'<i class="fa-solid fa-robot"></i> Auto':'<i class="fa-solid fa-hand"></i>'}</span>` : '<span style="color:#94a3b8">—</span>';
      const supSt   = item.supervisor_status;
      const supLine = supSt ? `<tr><td style="color:#94a3b8;padding:4px 10px 4px 0;white-space:nowrap;font-size:.82rem">รับรองโดย</td><td style="font-size:.82rem;font-weight:600">${_esc(item.supervisor_name||'—')}</td></tr>
        <tr><td style="color:#94a3b8;padding:4px 10px 4px 0;white-space:nowrap;font-size:.82rem">สถานะรับรอง</td><td><span style="font-size:.72rem;font-weight:700;padding:2px 9px;border-radius:20px;background:${supSt==='approved'?'rgba(0,245,176,.12)':supSt==='rejected'?'rgba(248,113,133,.12)':'rgba(251,191,36,.12)'};color:${supSt==='approved'?'#00c98a':supSt==='rejected'?'#f87171':'#fbbf24'}">${supSt==='approved'?'รับรองแล้ว':supSt==='rejected'?'ไม่รับรอง':'รอรับรอง'}</span></td></tr>` : '';
      const noteRow = item.reviewer_note ? `<tr><td colspan="2" style="padding-top:8px;font-size:.8rem;color:#94a3b8;font-style:italic"><i class="fas fa-quote-left" style="font-size:.6rem" aria-hidden="true"></i> ${_esc(item.reviewer_note)}</td></tr>` : '';

      Swal.fire({
        html: `
          <div style="text-align:left;font-family:'IBM Plex Sans Thai','Sarabun',sans-serif">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
              <div style="width:42px;height:42px;border-radius:12px;background:${color}20;display:flex;align-items:center;justify-content:center;font-size:1.2rem;color:${color};flex-shrink:0">
                <i class="fas ${item.status==='approved'?'fa-circle-check':item.status==='rejected'?'fa-circle-xmark':item.status==='cancelled'?'fa-ban':'fa-hourglass-half'}" aria-hidden="true"></i>
              </div>
              <div>
                <div style="font-size:.92rem;font-weight:700;color:${isDark?'#f0f8ff':'#0f1d30'}">${_esc(item.request_type||'—')}</div>
                <span style="font-size:.72rem;font-weight:700;padding:2px 10px;border-radius:20px;background:${color}20;color:${color}">${stLabel[item.status]||item.status}</span>
              </div>
            </div>
            <table style="width:100%;border-collapse:collapse">
              <tr><td style="color:#94a3b8;padding:4px 10px 4px 0;white-space:nowrap;font-size:.82rem">วันที่</td><td style="font-size:.85rem;font-weight:600;color:${isDark?'#f0f8ff':'#0f1d30'}">${_fmtDate(item.req_date)}</td></tr>
              <tr><td style="color:#94a3b8;padding:4px 10px 4px 0;white-space:nowrap;font-size:.82rem">เวลาที่ขอ</td><td style="font-size:.85rem">${_esc(item.req_time||'—')}</td></tr>
              <tr><td style="color:#94a3b8;padding:4px 10px 4px 0;white-space:nowrap;font-size:.82rem">เวลาเข้า</td><td style="font-size:.85rem">${ciTime}</td></tr>
              <tr><td style="color:#94a3b8;padding:4px 10px 4px 0;white-space:nowrap;font-size:.82rem">เวลาออก</td><td style="font-size:.85rem">${coTime}</td></tr>
              <tr><td style="color:#94a3b8;padding:4px 10px 4px 0;white-space:nowrap;font-size:.82rem">เหตุผล</td><td style="font-size:.82rem">${_esc(item.reason||'—')}</td></tr>
              ${supLine}
              ${noteRow}
            </table>
            <div style="margin-top:12px;font-size:.65rem;color:#94a3b8;font-family:'DM Mono',monospace;word-break:break-all">${_esc(item.reference||'')}</div>
          </div>`,
        showConfirmButton: item.status === 'pending',
        confirmButtonText: '<i class="fas fa-xmark"></i> ยกเลิกคำขอ',
        confirmButtonColor: '#ef4444',
        showCancelButton: true,
        cancelButtonText: 'ปิด',
        cancelButtonColor: '#6c757d',
        background: isDark ? '#050e22' : '#fff',
        color:      isDark ? '#f0f8ff' : '#0f1d30',
        width: 'min(92vw, 420px)',
        customClass: { popup: 'swal-notif-detail' },
      }).then(r => {
        if (r.isConfirmed && item.status === 'pending') {
          cancelRequest(item.reference, item.request_type, item.req_date);
        }
      });
    }

    async function cancelRequest(reference, reqType, reqDate) {
      const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
      const cf = await Swal.fire({
        icon: 'warning',
        title: 'ยืนยันการยกเลิก?',
        html: `<div style="font-size:.88rem;color:#94a3b8">คำขอ: <b>${_esc(reqType)}</b><br>วันที่: ${_fmtDate(reqDate)}</div>`,
        showCancelButton: true,
        confirmButtonText: 'ยืนยันยกเลิก',
        cancelButtonText:  'ไม่ยกเลิก',
        confirmButtonColor: '#ef4444',
        cancelButtonColor:  '#6c757d',
        background: isDark ? '#050e22' : '#fff',
        color:      isDark ? '#f0f8ff' : '#0f1d30',
      });
      if (!cf.isConfirmed) return;
      Swal.fire({ title: 'กำลังยกเลิก...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
      const ud   = JSON.parse(localStorage.getItem('user_data') || '{}');
      const uuid = ud?.uuid || localStorage.getItem('uuid');
      try {
        const r = await fetch(`${API_BASE}/attendance/request`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', ...AUTH_HEADER() },
          body: JSON.stringify({uuid, reference }),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.message);
        Swal.fire({ icon: 'success', title: 'ยกเลิกสำเร็จ', timer: 1500, showConfirmButton: false })
          .then(() => loadNotifications());
      } catch (err) {
        Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: err.message });
      }
    }

    function gotoRequests(reference) {
      closeNotifPanel();
      markCurrentTabRead();
      window.location.href = `requests.html?ref=${encodeURIComponent(reference)}`;
    }

function gotoSupervisor(ref) {
  closeNotifPanel();
  markCurrentTabRead();
  window.location.href = `supervisor.html?ref=${ref}`;
}

    document.getElementById('notifBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      const panel = document.getElementById('notifPanel');
      if (panel.classList.contains('open')) {
        closeNotifPanel();
      } else {
        if (!_notifLoaded) loadNotifications();
        openNotifPanel();
      }
    });

    /* ═══════════ PWA ═══════════ */
    // let deferredPrompt;
    // window.addEventListener('beforeinstallprompt', (e) => {
    //   e.preventDefault();
    //   deferredPrompt = e;
    //   if (window.matchMedia('(display-mode: standalone)').matches) return;
    //   const banner = document.createElement('div');
    //   banner.className = 'pwa-banner';
    //   banner.innerHTML = `
    //     <div style="flex:1;min-width:0">
    //       <div style="font-family:'Outfit',sans-serif;font-size:0.88rem;font-weight:700;color:var(--t1)">ติดตั้งแอปพลิเคชัน</div>
    //       <div style="font-size:0.72rem;color:var(--t3);margin-top:2px">เพิ่มเข้าหน้าจอหลักเพื่อประสบการณ์ที่ดีกว่า</div>
    //     </div>
    //     <button id="installBtn" class="btn btn-primary" style="padding:0.65rem 1.1rem;font-size:0.8rem;flex-shrink:0">ติดตั้ง</button>
    //     <button id="dismissBanner" style="background:none;border:none;color:var(--t3);cursor:pointer;padding:4px 8px;font-size:1rem" aria-label="ปิด">✕</button>
    //   `;
    //   document.body.appendChild(banner);
    //   document.getElementById('installBtn').onclick = async () => {
    //     if (!deferredPrompt) return;
    //     deferredPrompt.prompt();
    //     await deferredPrompt.userChoice;
    //     deferredPrompt = null;
    //     banner.remove();
    //   };
    //   document.getElementById('dismissBanner').onclick = () => banner.remove();
    // });

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
          .then(r => console.log('✅ SW:', r.scope))
          .catch(e => console.warn('⚠️ SW:', e));
      });
    }

    /* ═══════════ AUTH STATE ═══════════ */
    async function checkAuth() {
      const token = localStorage.getItem('auth_token');
      if (!token) { renderLoggedOut(); return; }

      const cached = (() => { try { return JSON.parse(localStorage.getItem('user_data') || 'null'); } catch { return null; } })();
      if (cached) { setWordmark(cached); renderLoggedIn(cached); }

         if (!navigator.onLine) {
          return;
        }
      try {
        const res = await fetch(`${API_BASE}/user/me`, {
          headers: { 'Authorization': `Bearer ${token}` },
          cache: 'no-store',
        });
        if (navigator.onLine && (res.status === 401 || res.status === 403)) {
          localStorage.removeItem('auth_token'); localStorage.removeItem('user_data');
          renderLoggedOut();
          if (cached) showToast('Session หมดอายุ กรุณาเข้าสู่ระบบใหม่', 'error');
          return;
        }
        const data = await res.json();
        if (!data.success || !data.user) {

  // มี cache → ใช้ cache ต่อ
  if (cached) {

    showToast?.(
      'ไม่สามารถตรวจสอบข้อมูลล่าสุดได้',
      'error'
    );

    return;
  }

  // ไม่มี cache จริงๆ ค่อย logout
  localStorage.removeItem('auth_token');
  localStorage.removeItem('user_data');

  renderLoggedOut();

  return;
}

        localStorage.setItem('user_data', JSON.stringify(data.user));
        setWordmark(data.user);
        renderLoggedIn(data.user);
      } catch (e) {
        console.warn('[checkAuth] network error:', e);
        if (!cached) renderLoggedOut();
      }
    }

    function renderLoggedIn(u) {
      document.getElementById('authSection').style.display = 'none';
      const app = document.getElementById('appSection');
      const topUser = document.getElementById('topbarUser');
      document.getElementById('notifBtn').style.display = 'flex';
      app.hidden = false;
      if (topUser) topUser.hidden = false;

      const fullName = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || u.name || '—';
      const firstName = (u.firstName || fullName.split(' ')[0] || 'คุณ').trim();

      const headline = document.getElementById('greetingHeadline');
      if (headline) headline.textContent = `คุณ${fullName}`;

      const userNameEl = document.getElementById('userName');
      if (userNameEl) userNameEl.textContent = fullName;

      const userNameTop = document.getElementById('userNameTop');
      if (userNameTop) userNameTop.textContent = firstName;

      const greetMeta = document.getElementById('userGreeting');
      if (greetMeta) greetMeta.textContent = getGreeting();

      const emailEl = document.getElementById('userEmail');
      if (emailEl) emailEl.textContent = u.position || u.email || '—';

      const roleMap = {
        user: 'บุคลากร',
        staff: 'เจ้าหน้าที่',
        admin: 'ผู้ดูแลระบบ',
        manager: 'ผู้จัดการ',
        hr: 'ฝ่ายทรัพยากรบุคคล',
        it: 'ฝ่ายเทคโนโลยีสารสนเทศ',
        support: 'ฝ่ายสนับสนุน',
        legal: 'ฝ่ายกฎหมาย',
        finance: 'ฝ่ายการเงิน',
        supervisor: 'หัวหน้างาน',
        executive: 'ผู้บริหาร',
        ceo: 'ผู้บริหารสูงสุด',
      };
      const roleEl = document.getElementById('userRole');
      if (roleEl) roleEl.textContent = roleMap[u.role] || roleMap.user;

      const av = document.getElementById('userAvatar');
      // FIX: Add onerror fallback for avatar
      av.onerror = function() {
        this.src = `https://ui-avatars.com/api/?background=00f5b0&color=020c18&bold=true&size=128&name=${encodeURIComponent(fullName)}`;
        this.onerror = null;
      };
      av.src = u.profileImage || u.picture || `https://ui-avatars.com/api/?background=00f5b0&color=020c18&bold=true&size=128&name=${encodeURIComponent(fullName)}`;

      const tok = localStorage.getItem('auth_token');
      if (tok) fetchStats(tok);

      loadNotifications();

      bindLogout();
    }

    function renderLoggedOut() {
      setWordmark(null);
      document.getElementById('authSection').style.display = 'block';
      const app = document.getElementById('appSection');
      if (app) app.hidden = true;
      const topUser = document.getElementById('topbarUser');
      if (topUser) topUser.hidden = true;
      document.getElementById('notifBtn').style.display = 'none';
    }

    function bindLogout() {
      const btn    = document.getElementById('logoutBtn');
      const btnAll = document.getElementById('logoutAllBtn');
      // FIX: Use onclick to prevent handler stacking
      if (btn)    btn.onclick    = () => logout(false);
      if (btnAll) btnAll.onclick = () => logout(true);
    }

    /* ═══════════ LOGOUT IMPLEMENTATION ═══════════ */
async function logout(logoutAll = false) {

  const result = await Swal.fire({
    icon: 'warning',
    title: logoutAll
      ? 'ออกจากระบบทุกอุปกรณ์?'
      : 'ออกจากระบบ?',

    text: logoutAll
      ? 'คุณต้องเข้าสู่ระบบใหม่ทุกอุปกรณ์'
      : 'คุณต้องเข้าสู่ระบบใหม่อีกครั้ง',

    showCancelButton: true,
    confirmButtonText: 'ยืนยัน',
    cancelButtonText: 'ยกเลิก',

    confirmButtonColor: '#e53935',
    cancelButtonColor: '#6c757d',
    reverseButtons: true
  });

  if (!result.isConfirmed) return;

  const token = localStorage.getItem('auth_token');

  // ไม่มี token → logout local ทันที
  if (!token) {
    renderLoggedOut();
    window.location.replace('/');
    return;
  }

  const btnId = logoutAll
    ? 'logoutAllBtn'
    : 'logoutBtn';

  const btn = document.getElementById(btnId);

  const originalText = logoutAll
    ? 'ลงชื่อออกทุกอุปกรณ์'
    : 'ออกจากระบบ';

  try {

    // loading state
    if (btn) {
      btn.disabled = true;
      btn.classList.add('loading');

      const text = btn.querySelector('span:last-child');
      if (text) {
        text.textContent = 'กำลังออกจากระบบ...';
      }
    }

    const res = await fetch(`${API_BASE}/user/logout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        all: logoutAll
      })
    });

    // กัน API ส่ง html/error page กลับมา
    let data = {};

    try {
      data = await res.json();
    } catch (_) {}

    // ถึง API fail ก็ล้าง local ออก
    // เพื่อไม่ให้ user ค้างหน้า login
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user_data');

showToast(
  logoutAll
    ? 'ออกจากระบบทุกอุปกรณ์แล้ว'
    : 'ออกจากระบบสำเร็จ',
  'success'
);

setTimeout(() => {
  window.location.reload();
}, 500);

    renderLoggedOut();

    // sync ทุก tab
    localStorage.setItem('logout_event', Date.now());

    setTimeout(() => {
      window.location.replace('/');
    }, 700);

  } catch (err) {

    console.error('[logout]', err);

    // offline ก็ logout local ได้
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user_data');

    renderLoggedOut();

    showToast('ออกจากระบบสำเร็จ', 'success');

    setTimeout(() => {
      window.location.replace('/');
    }, 700);

  } finally {

    if (btn) {
      btn.disabled = false;
      btn.classList.remove('loading');

      const text = btn.querySelector('span:last-child');

      if (text) {
        text.textContent = originalText;
      }
    }
  }
}
    
    /* ═══════════ NETWORK STATUS ═══════════ */
    function updateConnectionStatus() {
      if (!navigator.onLine) {
        showToast('ไม่มีการเชื่อมต่ออินเทอร์เน็ต — ข้อมูลอาจไม่อัปเดต', 'error');
      }
    }
    window.addEventListener('offline', updateConnectionStatus);
    window.addEventListener('online', () => showToast('เชื่อมต่ออินเทอร์เน็ตแล้ว', 'success'));

    /* ═══════════ INIT ═══════════ */
    document.addEventListener('DOMContentLoaded', checkAuth);

    /* ═══════════ ATTENDANCE ACTION ROUTING ═══════════ */

    function formatThaiDate(date = new Date()) {
  return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear() + 543}`;
}

function getAttendanceAction() {
  const now = new Date(),
        total = now.getHours() * 60 + now.getMinutes(),
        today = formatThaiDate(now),
        dateCheckIn = localStorage.getItem('datecheck'),
        dateCheckOut = localStorage.getItem('datecheckout');

  if (dateCheckOut === today) return 'checktodayX';

  if (dateCheckIn === today) {
    if (total <= 16 * 60 + 30) return 'checktodayX';
    return 'checkOut';
  }

  if (total < 8 * 60 + 31) return 'checkIn';

  if (total <= 16 * 60 + 30) return 'sendRequest';

  return 'checkOut';
}

const profileMenuBtn = document.getElementById('profileMenuBtn');
const profileSubmenu = document.getElementById('profileSubmenu');

if (profileMenuBtn && profileSubmenu) {
  profileMenuBtn.addEventListener('click', () => {
    profileSubmenu.classList.toggle('show');
    profileMenuBtn.classList.toggle('active');
  });
}



function updateAttendanceBtnLabel() {
  const action = getAttendanceAction();
  const subEl = document.getElementById('attendanceSubLabel');
  const btnEl = document.getElementById('attendanceBtn');
  const iconWrap = btnEl?.querySelector('.card-icon');
  const iconEl = btnEl?.querySelector('.card-icon i');

  if (!subEl || !btnEl) return;

  const labels = {
    checkIn: 'แตะเพื่อลงเวลาเข้างาน',
    sendRequest: 'ส่งคำขอ / แก้ไขเวลา',
    checkOut: 'แตะเพื่อลงเวลาออกงาน',
    checktodayX: 'วันนี้บันทึกเวลาแล้ว',
  };

  const toneClass = {
    checkIn: 'card-featured-mint',
    sendRequest: 'card-featured-amber',
    checkOut: 'card-featured-red',
    checktodayX: 'card-featured-blue',
  };

  const iconTone = {
    checkIn: 'ic-mint',
    sendRequest: 'ic-amber',
    checkOut: 'ic-rose',
    checktodayX: 'ic-cyan',
  };

  const iconClass = {
    checkIn: 'fa-solid fa-right-to-bracket',
    sendRequest: 'fa-solid fa-pen-to-square',
    checkOut: 'fa-solid fa-right-from-bracket',
    checktodayX: 'fa-solid fa-circle-check',
  };

  subEl.textContent = labels[action] || 'เข้า-ออกงาน';

  btnEl.classList.remove(
    'card-featured-mint',
    'card-featured-green',
    'card-featured-amber',
    'card-featured-red',
    'card-featured-blue'
  );

  if (toneClass[action]) {
    btnEl.classList.add(toneClass[action]);
  }

  if (iconWrap) {
    iconWrap.classList.remove(
      'ic-mint', 'ic-green', 'ic-amber', 'ic-rose',
      'ic-red', 'ic-cyan', 'ic-blue', 'ic-muted',
      'ic-gray', 'ic-violet'
    );
    iconWrap.classList.add(iconTone[action] || 'ic-mint');
  }

  if (iconEl) {
    iconEl.className = iconClass[action] || 'fa-solid fa-fingerprint';
  }
}


function handleAttendanceClick(event) {
  event.preventDefault();

  const action = getAttendanceAction();
  window.location.href = `attendance.html?action=${action}`;
}

updateAttendanceBtnLabel();
setInterval(updateAttendanceBtnLabel, 60000);