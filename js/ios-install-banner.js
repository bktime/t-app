// /js/ios-install-banner.js (แนะนำให้เปลี่ยนชื่อไฟล์เป็น apple-install-banner.js ก็ได้ครับ)

;(function () {
  // Guard: ป้องกัน script ทำงานซ้ำ
  if (window.__appleBannerLoaded) return;
  window.__appleBannerLoaded = true;

  function showAppleInstallBanner() {
    const ua = navigator.userAgent;
    
    // ตรวจสอบว่าเป็น Safari แท้ (ไม่ใช่ Chrome, Edge หรือ Firefox บน iOS/macOS)
    const isSafari = /safari/i.test(ua) && !/chrome|crios|fxios|edg|opr/i.test(ua);
    
    // ตรวจสอบอุปกรณ์ iOS (iPhone, iPad, iPod) รวมถึง iPad ที่ขอ Desktop site
    const isMobileApple = /iphone|ipad|ipod/i.test(ua) || (navigator.maxTouchPoints > 1 && /macintosh/i.test(ua));
    
    // ตรวจสอบ macOS Desktop (รองรับการติดตั้ง PWA "Add to Dock" ตั้งแต่ macOS Sonoma)
    const isMac = /macintosh/i.test(ua) && !isMobileApple;
    
    const isAppleDevice = isMobileApple || isMac;
    
    const isInstalled = window.navigator.standalone === true 
                        || window.matchMedia('(display-mode: standalone)').matches;
                        
    const isDismissed = localStorage.getItem('apple_banner_dismissed') === '1';

    // เงื่อนไข: ไม่แสดงถ้าไม่ใช่อุปกรณ์ Apple, ไม่ใช่ Safari, ติดตั้งแล้ว หรือเคยกดปิดถาวร
    if (!isAppleDevice || !isSafari || isInstalled || isDismissed) return;

    // ลบ banner เก่าถ้ามี
    document.getElementById('apple-install-banner')?.remove();

    // ปรับข้อความแนะนำวิธีติดตั้งตามอุปกรณ์
    let stepsHtml = '';
    if (isMobileApple) {
      stepsHtml = `
        <div class="apple-step">
          <span class="apple-step-num">1</span>
          <span>กดปุ่ม <b>Share</b> 
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#378add" stroke-width="2" style="vertical-align:-3px"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/></svg>
            ที่แถบล่างของ Safari
          </span>
        </div>
        <div class="apple-step">
          <span class="apple-step-num">2</span>
          <span>เลื่อนลงมาเลือก <b>"เพิ่มไปที่หน้าจอโฮม"</b></span>
        </div>
        <div class="apple-step">
          <span class="apple-step-num">3</span>
          <span>กด <b>"เพิ่ม"</b> ที่มุมขวาบน</span>
        </div>
      `;
    } else if (isMac) {
      stepsHtml = `
        <div class="apple-step">
          <span class="apple-step-num">1</span>
          <span>คลิกปุ่ม <b>Share</b> <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#378add" stroke-width="2" style="vertical-align:-2px"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/></svg> ในแถบเครื่องมือด้านบน หรือเปิดเมนู <b>ไฟล์ (File)</b></span>
        </div>
        <div class="apple-step">
          <span class="apple-step-num">2</span>
          <span>เลือก <b>"เพิ่มใน Dock (Add to Dock)"</b></span>
        </div>
      `;
    }

    const banner = document.createElement('div');
    banner.id = 'apple-install-banner';
    banner.innerHTML = `
      <div class="apple-banner-header">
        <div class="apple-banner-icon">
          <img src="/icons/icon-72.png" alt="icon" width="36" height="36"/>
        </div>
        <div>
          <p class="apple-banner-title">ระบบลงเวลาปฏิบัติงาน</p>
          <p class="apple-banner-sub">ติดตั้งแอปพลิเคชันเพื่อใช้งานได้เต็มประสิทธิภาพ</p>
        </div>
        <button class="apple-banner-close" id="apple-banner-close" aria-label="ปิด">✕</button>
      </div>
      <div class="apple-banner-body">
        ${stepsHtml}
        <div class="apple-banner-footer">
          <button id="apple-banner-done">ติดตั้งแล้ว ไม่ต้องแสดงอีก</button>
          <button id="apple-banner-ok" class="primary">เข้าใจแล้ว</button>
        </div>
      </div>
    `;

    document.body.appendChild(banner);

    // dismiss handlers
    const dismiss = (permanent) => {
      if (permanent) localStorage.setItem('apple_banner_dismissed', '1');
      banner.remove();
    };

    document.getElementById('apple-banner-close').onclick = () => dismiss(false);
    document.getElementById('apple-banner-ok').onclick    = () => dismiss(false);
    document.getElementById('apple-banner-done').onclick  = () => dismiss(true);
  }

  // CSS — เปลี่ยนคลาสเป็น apple- และเช็คก่อนว่าใส่ CSS ไปแล้วหรือยัง
  if (!document.getElementById('apple-install-banner-style')) {
    const style = document.createElement('style');
    style.id = 'apple-install-banner-style';
    style.textContent = `
      #apple-install-banner {
        position: fixed; bottom: 0; left: 0; right: 0; z-index: 9999;
        background: #fff; border-top: 0.5px solid #e2e8f0;
        border-radius: 16px 16px 0 0;
        box-shadow: 0 -4px 24px rgba(0,0,0,0.12);
        font-family: 'Sarabun', sans-serif;
        animation: slideUp 0.3s ease-out forwards;
      }
      @keyframes slideUp {
        from { transform: translateY(100%); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      .apple-banner-header {
        background: #0f6e56; padding: 12px 16px;
        display: flex; align-items: center; gap: 10px;
        border-radius: 16px 16px 0 0;
      }
      .apple-banner-icon { width:36px; height:36px; background:#fff; border-radius:8px; overflow:hidden; flex-shrink:0; }
      .apple-banner-icon img { width:100%; height:100%; object-fit:cover; }
      .apple-banner-title { margin:0; font-size:14px; font-weight:600; color:#fff; }
      .apple-banner-sub   { margin:0; font-size:12px; color:#a7f3d0; }
      .apple-banner-close { margin-left:auto; background:none; border:none; color:#fff; font-size:18px; cursor:pointer; padding:4px; }
      .apple-banner-body  { padding: 16px; }
      .apple-step { display:flex; align-items:center; gap:12px; margin-bottom:10px; font-size:14px; color:#334155; }
      .apple-step b { color: #0f6e56; }
      .apple-step-num {
        width:26px; height:26px; border-radius:50%;
        background:#e1f5ee; color:#0f6e56;
        display:flex; align-items:center; justify-content:center;
        font-size:13px; font-weight:600; flex-shrink:0;
      }
      .apple-banner-footer { display:flex; gap:8px; padding-top:12px; border-top:0.5px solid #e2e8f0; margin-top:4px; }
      .apple-banner-footer button { flex:1; padding:10px; border-radius:8px; font-size:13px; cursor:pointer; font-family:'Sarabun',sans-serif; transition: background 0.2s; }
      .apple-banner-footer button:not(.primary) { background:none; border:0.5px solid #e2e8f0; color:#64748b; }
      .apple-banner-footer button:not(.primary):hover { background:#f8fafc; }
      .apple-banner-footer button.primary { background:#0f6e56; border:none; color:#fff; font-weight:600; }
      .apple-banner-footer button.primary:hover { background:#0d5a47; }
    `;
    document.head.appendChild(style);
  }

  // รัน
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showAppleInstallBanner);
  } else {
    showAppleInstallBanner();
  }
})();