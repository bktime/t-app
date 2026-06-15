// /js/android-install-banner.js

;(function () {
  // Guard: ป้องกัน script ทำงานซ้ำ
  if (window.__androidBannerLoaded) return;
  window.__androidBannerLoaded = true;

  let deferredPrompt = null; // อยู่ใน scope ของ IIFE ไม่ชนกัน

  // รับ event จาก browser ก่อน — ต้องทำก่อน DOMContentLoaded
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showAndroidBanner();
  });

  function showAndroidBanner() {
    const isInstalled =
      window.matchMedia('(display-mode: standalone)').matches;
    const dismissedAt = localStorage.getItem('android_banner_dismissed');

    if (isInstalled) return;
    if (dismissedAt) {
      const daysSince =
        (Date.now() - parseInt(dismissedAt)) / (1000 * 60 * 60 * 24);
      if (daysSince < 7) return;
    }

    // ลบ banner เก่าถ้ามี
    document.getElementById('android-install-banner')?.remove();

    const banner = document.createElement('div');
    banner.id = 'android-install-banner';
    banner.innerHTML = `
      <div class="aib-header">
        <div class="aib-icon">
          <img src="/icons/icon-72.png" alt="" width="36" height="36"/>
        </div>
        <div>
          <p class="aib-title">ระบบลงเวลาปฏิบัติงาน</p>
          <p class="aib-sub">เพิ่มลงหน้าจอหลักได้เลย</p>
        </div>
        <button class="aib-close" id="aib-close" aria-label="ปิด">✕</button>
      </div>
      <div class="aib-body">
        <p class="aib-desc">เปิดได้เร็วขึ้น รับแจ้งเตือนได้ทันที</p>
        <div class="aib-features">
          <div class="aib-feat">⚡ เปิดเร็ว</div>
          <div class="aib-feat">🔔 แจ้งเตือน</div>
        </div>
        <div class="aib-footer">
          <button id="aib-dismiss">ไม่ต้องแล้ว</button>
          <button id="aib-install" class="primary">⬇ ติดตั้งแอป</button>
        </div>
      </div>
    `;

    document.body.appendChild(banner);

    document.getElementById('aib-close').onclick = dismiss;
    document.getElementById('aib-dismiss').onclick = dismiss;

    document.getElementById('aib-install').onclick = async () => {
      if (!deferredPrompt) return;

      deferredPrompt.prompt();

      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      banner.remove();

      if (outcome === 'accepted') {
        console.log('✅ ผู้ใช้ติดตั้งแอปแล้ว');
        localStorage.setItem('pwa_installed', '1');
      } else {
        console.log('❌ ผู้ใช้ปฏิเสธการติดตั้ง');
        localStorage.setItem('android_banner_dismissed', Date.now().toString());
      }
    };

    function dismiss() {
      localStorage.setItem('android_banner_dismissed', Date.now().toString());
      banner.remove();
    }
  }

  window.addEventListener('appinstalled', () => {
    console.log('✅ PWA installed successfully');
    localStorage.setItem('pwa_installed', '1');
    document.getElementById('android-install-banner')?.remove();
  });

  // CSS — เช็คก่อนว่าใส่ไปแล้วหรือยัง
  if (!document.getElementById('android-install-banner-style')) {
    const style = document.createElement('style');
    style.id = 'android-install-banner-style';
    style.textContent = `
      #android-install-banner {
        position: fixed; bottom: 0; left: 0; right: 0; z-index: 9999;
        background: #fff; border-top: 0.5px solid #e2e8f0;
        border-radius: 16px 16px 0 0;
        font-family: 'Sarabun', sans-serif;
        animation: slideUp 0.3s ease-out forwards;
      }
      @keyframes slideUp {
        from { transform: translateY(100%); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      .aib-header {
        background: #0f6e56; padding: 12px 16px;
        display: flex; align-items: center; gap: 10px;
        border-radius: 16px 16px 0 0;
      }
      .aib-icon { width:36px; height:36px; background:#fff; border-radius:8px; overflow:hidden; flex-shrink:0; }
      .aib-icon img { width:100%; height:100%; object-fit:cover; }
      .aib-title { margin:0; font-size:14px; font-weight:600; color:#fff; }
      .aib-sub   { margin:0; font-size:12px; color:#a7f3d0; }
      .aib-close { margin-left:auto; background:none; border:none; color:#fff; font-size:18px; cursor:pointer; }
      .aib-body  { padding: 14px 16px 20px; }
      .aib-desc  { margin: 0 0 12px; font-size: 13px; color: #64748b; }
      .aib-features { display:flex; gap:8px; margin-bottom:14px; }
      .aib-feat {
        flex:1; background:#f1faf6; color:#0f6e56;
        border-radius:8px; padding:8px 4px;
        font-size:12px; text-align:center; font-weight:500;
      }
      .aib-footer { display:flex; gap:8px; }
      .aib-footer button { flex:1; padding:10px; border-radius:8px; font-size:13px; cursor:pointer; font-family:'Sarabun',sans-serif; transition: background 0.2s; }
      .aib-footer button:not(.primary) { background:none; border:0.5px solid #e2e8f0; color:#64748b; }
      .aib-footer button:not(.primary):hover { background:#f8fafc; }
      .aib-footer button.primary { flex:2; background:#0f6e56; border:none; color:#fff; font-weight:600; font-size:14px; }
      .aib-footer button.primary:hover { background:#0d5a47; }
    `;
    document.head.appendChild(style);
  }
})();