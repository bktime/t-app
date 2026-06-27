// ==========================================
// 1. ฟังก์ชันแปลง Base64 เป็น File (สำรองใช้กรณีทั่วไป)
// ==========================================
function dataURLtoFile(dataurl, filename) {
  var arr = dataurl.split(','),
      mime = arr[0].match(/:(.*?);/)[1],
      bstr = atob(arr[1]),
      n = bstr.length,
      u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], filename, { type: mime });
}

// ==========================================
// 2. ฟังก์ชันแปลง Lat/Lon เป็น UTM (Zone, X, Y)
// ==========================================
function convertLatLngToUtm(lat, lon) {
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const eSquared = f * (2 - f);
  const zone = Math.floor((lon + 180) / 6) + 1;

  let letter = '';
  if      (lat >= 72)  letter = 'X';
  else if (lat >= 64)  letter = 'W';
  else if (lat >= 56)  letter = 'V';
  else if (lat >= 48)  letter = 'U';
  else if (lat >= 40)  letter = 'T';
  else if (lat >= 32)  letter = 'S';
  else if (lat >= 24)  letter = 'R';
  else if (lat >= 16)  letter = 'Q';
  else if (lat >= 8)   letter = 'P';
  else if (lat >= 0)   letter = 'N';
  else if (lat >= -8)  letter = 'M';
  else if (lat >= -16) letter = 'L';
  else if (lat >= -24) letter = 'K';
  else if (lat >= -32) letter = 'J';
  else if (lat >= -40) letter = 'H';
  else if (lat >= -48) letter = 'G';
  else if (lat >= -56) letter = 'F';
  else if (lat >= -64) letter = 'E';
  else if (lat >= -72) letter = 'D';
  else letter = 'C';

  const lonRad = lon * Math.PI / 180;
  const latRad = lat * Math.PI / 180;
  const lonOrigin = (zone - 1) * 6 - 180 + 3;
  const lonOriginRad = lonOrigin * Math.PI / 180;

  const N = a / Math.sqrt(1 - eSquared * Math.sin(latRad) * Math.sin(latRad));
  const T = Math.tan(latRad) * Math.tan(latRad);
  const C = eSquared / (1 - eSquared) * Math.cos(latRad) * Math.cos(latRad);
  const A = Math.cos(latRad) * (lonRad - lonOriginRad);
  const M = a * (
    (1 - eSquared / 4 - 3 * eSquared * eSquared / 64 - 5 * eSquared * eSquared * eSquared / 256) * latRad
    - (3 * eSquared / 8 + 3 * eSquared * eSquared / 32 + 45 * eSquared * eSquared * eSquared / 1024) * Math.sin(2 * latRad)
    + (15 * eSquared * eSquared / 256 + 45 * eSquared * eSquared * eSquared / 1024) * Math.sin(4 * latRad)
    - (35 * eSquared * eSquared * eSquared / 3072) * Math.sin(6 * latRad)
  );

  let x = k0 * N * (A + (1 - T + C) * A * A * A / 6
    + (5 - 18 * T + T * T + 72 * C - 58 * eSquared) * Math.pow(A, 5) / 120) + 500000.0;
  let y = k0 * (M + N * Math.tan(latRad) * (
    A * A / 2
    + (5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4) / 24
    + (61 - 58 * T + T * T + 600 * C - 330 * eSquared) * Math.pow(A, 6) / 720
  ));

  if (lat < 0) y += 10000000.0;
  return { zone: zone + letter, x: Math.round(x), y: Math.round(y) };
}

// ==========================================
// 3. ฟังก์ชันโหลดแผนที่ 2×2 Tiles
// FIX: resolve canvas โดยตรง (ไม่ toDataURL → new Image วนซ้ำ)
// FIX: guard compose ให้ตรวจ done === 4 ก่อนเสมอ แล้วค่อย build
// ==========================================
function loadMapImage(lat, lon, outputSize) {
  return new Promise((resolve) => {
    const zoom = 16;
    const n = 1 << zoom;
    const latRad = lat * Math.PI / 180;

    const xtileF = (lon + 180) / 360 * n;
    const ytileF = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;

    // tile กลางที่พิกัดอยู่ใน และ fraction ภายใน tile นั้น
    const centerTileX = Math.floor(xtileF);
    const centerTileY = Math.floor(ytileF);
    const fx = xtileF - centerTileX;  // 0–1: ตำแหน่งแนวนอนใน tile กลาง
    const fy = ytileF - centerTileY;  // 0–1: ตำแหน่งแนวตั้งใน tile กลาง

    const T = 256;           // ขนาด 1 tile px
    const GRID = 3;          // โหลด 3×3 tiles → grid 768×768 px
    const gridPx = T * GRID;
    const total = GRID * GRID;

    const imgs = {};
    let done = 0;

    for (let dy = 0; dy < GRID; dy++) {
      for (let dx = 0; dx < GRID; dx++) {
        const key = `${dx}_${dy}`;
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload  = () => { imgs[key] = img; if (++done === total) compose(); };
        img.onerror = () => {                  if (++done === total) compose(); };
        // tile กลาง (dx=1,dy=1) = centerTile; offset dx-1, dy-1
        img.src = `https://mt1.google.com/vt/lyrs=m&x=${centerTileX + dx - 1}&y=${centerTileY + dy - 1}&z=${zoom}`;
      }
    }

    function compose() {
      if (Object.keys(imgs).length === 0) { resolve(null); return; }

      // รวม 3×3 tiles เป็น grid 768×768
      const grid = document.createElement('canvas');
      grid.width  = gridPx;
      grid.height = gridPx;
      const gc = grid.getContext('2d');
      gc.fillStyle = '#e0e0e0';
      gc.fillRect(0, 0, gridPx, gridPx);
      for (let dy = 0; dy < GRID; dy++)
        for (let dx = 0; dx < GRID; dx++)
          if (imgs[`${dx}_${dy}`])
            gc.drawImage(imgs[`${dx}_${dy}`], dx * T, dy * T);

      // จุดพิกัดอยู่ที่ pixel (T + fx*T, T + fy*T) บน grid
      // tile กลาง (index 1,1) เริ่มที่ pixel T,T
      const centerPxX = T + fx * T;
      const centerPxY = T + fy * T;

      // crop outputSize×outputSize โดยให้ centerPx อยู่กลาง output
      // srcX อยู่ใน [T-half, 2T-half] ≈ [186, 442] → ไม่ติดลบ ไม่เกิน 768 แน่นอน
      const half = outputSize / 2;
      const srcX = centerPxX - half;
      const srcY = centerPxY - half;

      const out = document.createElement('canvas');
      out.width  = outputSize;
      out.height = outputSize;
      const oc = out.getContext('2d');
      oc.imageSmoothingEnabled = true;
      oc.imageSmoothingQuality = 'high';

      oc.drawImage(grid,
        srcX, srcY, outputSize, outputSize,
        0,    0,    outputSize, outputSize
      );

      // วาด marker จุดแดงตรงกลาง
      const mr = Math.max(5, Math.round(outputSize / 15));
      oc.fillStyle   = '#e53935';
      oc.strokeStyle = '#ffffff';
      oc.lineWidth   = Math.max(2, Math.round(outputSize / 40));
      oc.beginPath();
      oc.arc(outputSize / 2, outputSize / 2, mr, 0, Math.PI * 2);
      oc.fill();
      oc.stroke();

      resolve(out);
    }
  });
}


// ==========================================
// 4. ฟังก์ชันดึงชื่อสถานที่จากพิกัด (Reverse Geocoding)
// FIX P3: เพิ่ม AbortController + timeout 8 วินาที
// ==========================================
async function fetchAddressFromCoords(lat, lon) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`,
      { signal: controller.signal }
    );
    const data = await response.json();
    return data.display_name || 'ไม่พบชื่อสถานที่';
  } catch (err) {
    if (err.name === 'AbortError') return 'ระบุที่อยู่ใช้เวลานานเกินไป';
    return 'ไม่สามารถระบุที่อยู่ได้';
  } finally {
    clearTimeout(timer);
  }
}

// ==========================================
// 5. ฟังก์ชันหลัก: เปิดกล้อง ถ่ายภาพ พร้อม Watermark คมชัด รองรับ 4K → PNG
// ==========================================
async function takeAttendancePhoto(data = {}) {
  const ref       = data.ref       || 'TEST-001';
  const checkType = data.checkType || 'checkin';
  const workType  = data.work_type || 'ปกติ';
  let address     = data.address   || 'กำลังระบุตำแหน่ง...';

  let videoStream = null;
  let gpsData     = null;
  // FIX BUG1: ใช้ stopStream() แทนการกระจาย getTracks ซ้ำๆ
  function stopStream() {
    if (videoStream) {
      videoStream.getTracks().forEach(t => t.stop());
      videoStream = null;
    }
  }

  const checkTypeMap = {
    checkin:     { label: 'ลงเวลาเข้า',       color: '#3dba5c' },
    checkout:    { label: 'ลงเวลาออก',       color: '#e53935' },
    reqcheckin:  { label: 'ขอแก้ไขเวลา',     color: '#ff9800' },
    reqcheckout: { label: 'ขอแก้ไขเวลาออก',  color: '#9c27b0' }
  };
  const cfg = checkTypeMap[checkType] || checkTypeMap.checkin;

  Swal.fire({
    title: 'ถ่ายภาพ',
    html: `
      <div style="position:relative;width:100%;max-width:400px;margin:auto;">
        <p style="font-size:0.8rem;color:#666;text-align:center;">
          ถ่ายภาพนี้จะไม่ส่งไปยังเซิร์ฟเวอร์ (สำหรับจัดเก็บในอุปกรณ์และแชร์เท่านั้น)
        </p>
        <video id="cameraVideo" autoplay playsinline
               style="width:100%;border-radius:8px;background:#000;
                      transform:scaleX(-1);-webkit-transform:scaleX(-1);"></video>
        <div id="liveOverlay"
             style="position:absolute;bottom:10px;left:10px;right:10px;
                    text-align:left;background:rgba(0,0,0,0.6);color:#fff;
                    padding:8px;font-size:0.8rem;border-radius:5px;pointer-events:none;">
          <div style="color:${cfg.color};font-weight:bold;">
            ${cfg.label}${workType ? ` — ${workType}` : ''}
          </div>
          <div style="font-size:0.7rem;color:#ccc;">GPS Map Camera</div>
          <div id="liveAddress">${address}</div>
          <div id="gpsLiveText">
            <i class="fa-solid fa-satellite-dish"></i> กำลังค้นหาพิกัด GPS...
          </div>
        </div>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: 'ถ่ายภาพ',
    cancelButtonText: 'ยกเลิก',
    allowOutsideClick: false,

    willOpen: async () => {
      try {
        videoStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 3840 }, height: { ideal: 2160 } }
        });
        const video = document.getElementById('cameraVideo');
        video.srcObject = videoStream;
      } catch (err) {
        Swal.showValidationMessage('ไม่สามารถเปิดกล้องได้ กรุณาอนุญาตการเข้าถึงกล้องในเบราว์เซอร์');
      }

      try {
        navigator.geolocation.getCurrentPosition(async (position) => {
          const lat  = position.coords.latitude;
          const lon  = position.coords.longitude;
          const elev = position.coords.altitude  != null ? position.coords.altitude.toFixed(1)  : '-';
          const acc  = position.coords.accuracy  != null ? Math.round(position.coords.accuracy) : '-';
          const utm  = convertLatLngToUtm(lat, lon);

          const realAddress = await fetchAddressFromCoords(lat, lon);
          address = realAddress;
          gpsData = { lat, lon, elev, acc, utm, address };

          const addrDiv = document.getElementById('liveAddress');
          if (addrDiv) {
            let shortAddr = address;
            if (shortAddr.length > 45) shortAddr = shortAddr.substring(0, 45) + '...';
            addrDiv.innerText = shortAddr;
          }
          const liveText = document.getElementById('gpsLiveText');
          if (liveText) {
            liveText.innerHTML = `
              Lat: ${lat.toFixed(6)}, Lon: ${lon.toFixed(6)}<br>
              Zone ${utm.zone}, X = ${utm.x}, Y = ${utm.y}<br>
              elev = ${elev} m, acc. ${acc} m<br>
              ${new Date().toLocaleString('en-GB')}
            `;
          }
        }, () => {
          Swal.showValidationMessage('ไม่สามารถเข้าถึง GPS ได้ กรุณาอนุญาต Location/GPS ในเบราว์เซอร์');
        }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
      } catch (err) {
        console.error('Geolocation error', err);
      }
    },

    // FIX BUG1: ปิด stream ใน willClose เสมอ ไม่ว่าผู้ใช้จะกดอะไร
    willClose: () => { stopStream(); },

    preConfirm: async () => {
      if (!gpsData) {
        Swal.showValidationMessage('กำลังรอข้อมูล GPS อยู่ กรุณารอสักครู่...');
        return false;
      }

      const video = document.getElementById('cameraVideo');
      if (!video || !video.videoWidth) {
        Swal.showValidationMessage('กล้องไม่พร้อมใช้งาน');
        return false;
      }

      const canvas = document.createElement('canvas');
      const w = video.videoWidth;
      const h = video.videoHeight;
      canvas.width  = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');

      ctx.textRendering = 'geometricPrecision';
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      ctx.drawImage(video, 0, 0, w, h);

      // ════════════════════════════════════════
      //  WATERMARK
      // ════════════════════════════════════════
      const S     = w / 640;
      const pad   = Math.round(16 * S);
      const lh    = Math.round(22 * S);
      const fsz   = Math.round(13 * S);
      const fszB  = Math.round(14 * S);
      const fszS  = Math.round(12 * S);
      const fszT  = Math.round(11 * S);
      const btnH  = Math.round(26 * S);
      const mapSize = Math.round(140 * S);

      let ud = {};
      try { ud = JSON.parse(localStorage.getItem('user_data') || '{}'); } catch (e) {}
      const fullName    = `${ud.prefix || ''}${ud.firstName || ''} ${ud.lastName || ''}`.trim();
      const position    = ud.position    || '';
      const department  = ud.department  || '';
      const affiliation = ud.affiliation || '';

      // FIX P2: รับ canvas โดยตรง (ไม่ผ่าน toDataURL → Image อีกรอบ)
      const mapCanvas = await loadMapImage(gpsData.lat, gpsData.lon, mapSize);

      const personH = (fullName ? fszB + Math.round(3 * S) : 0)
                    + (position || department || affiliation ? fszS + Math.round(8 * S) : 0);
      const blockH  = personH + btnH + Math.round(8 * S) + fszB + lh * 4 + Math.round(6 * S);
      const blockY  = h - pad - Math.max(mapSize, blockH);
      const mapY    = h - pad - mapSize;
      const mapX    = pad;

      const gradTop = Math.min(blockY, mapY) - Math.round(40 * S);
      const grad = ctx.createLinearGradient(0, gradTop, 0, h);
      grad.addColorStop(0,   'rgba(0,0,0,0)');
      grad.addColorStop(0.2, 'rgba(0,0,0,0.45)');
      grad.addColorStop(0.5, 'rgba(0,0,0,0.70)');
      grad.addColorStop(1,   'rgba(0,0,0,0.85)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, gradTop, w, h - gradTop);

      // FIX BUG4: maxW default = 0, guard ด้วย maxW > 0
      function wText(text, x, y, font, color, maxW = 0, outline = false) {
        ctx.save();
        ctx.font        = font;
        ctx.textAlign   = 'left';
        ctx.textBaseline = 'alphabetic';
        if (outline) {
          ctx.lineJoin   = 'round';
          ctx.miterLimit  = 2;
          ctx.strokeStyle = 'rgba(0,0,0,0.65)';
          ctx.lineWidth   = Math.round(3 * S);
          maxW > 0 ? ctx.strokeText(text, x, y, maxW) : ctx.strokeText(text, x, y);
        }
        ctx.shadowColor   = 'rgba(0,0,0,0.95)';
        ctx.shadowBlur    = Math.round(3 * S);
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        ctx.fillStyle = color;
        maxW > 0 ? ctx.fillText(text, x, y, maxW) : ctx.fillText(text, x, y);
        ctx.restore();
      }

      // ── แผนที่ ──
      // วิธี: สร้าง offscreen canvas ขนาด mapSize แล้ว clip rounded corner ใน context นั้น
      // จากนั้น drawImage offscreen → main canvas พร้อม shadow (shadow ไม่รบกวน clip)
      if (mapCanvas) {
        const r = Math.round(8 * S);

        // 1) สร้าง offscreen canvas พร้อม rounded clip
        const off = document.createElement('canvas');
        off.width  = mapSize;
        off.height = mapSize;
        const oc2 = off.getContext('2d');

        // clip rounded rect ด้วย arc path (รองรับทุก browser ไม่ต้องใช้ roundRect)
        oc2.beginPath();
        oc2.moveTo(r, 0);
        oc2.lineTo(mapSize - r, 0);
        oc2.arcTo(mapSize, 0,       mapSize, r,           r);
        oc2.lineTo(mapSize, mapSize - r);
        oc2.arcTo(mapSize, mapSize,  mapSize - r, mapSize, r);
        oc2.lineTo(r, mapSize);
        oc2.arcTo(0, mapSize,        0, mapSize - r,       r);
        oc2.lineTo(0, r);
        oc2.arcTo(0, 0,              r, 0,                 r);
        oc2.closePath();
        oc2.clip();
        oc2.drawImage(mapCanvas, 0, 0, mapSize, mapSize);

        // 2) วาด offscreen → main canvas พร้อม drop shadow (shadow อยู่นอก clip)
        ctx.save();
        ctx.shadowColor   = 'rgba(0,0,0,0.55)';
        ctx.shadowBlur    = Math.round(10 * S);
        ctx.shadowOffsetX = Math.round(2 * S);
        ctx.shadowOffsetY = Math.round(2 * S);
        ctx.drawImage(off, mapX, mapY);
        ctx.restore();

        // 3) วาดขอบ
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth   = Math.max(1.5, S * 1.5);
        ctx.beginPath();
        ctx.moveTo(mapX + r, mapY);
        ctx.lineTo(mapX + mapSize - r, mapY);
        ctx.arcTo(mapX + mapSize, mapY,           mapX + mapSize, mapY + r,           r);
        ctx.lineTo(mapX + mapSize, mapY + mapSize - r);
        ctx.arcTo(mapX + mapSize, mapY + mapSize,  mapX + mapSize - r, mapY + mapSize, r);
        ctx.lineTo(mapX + r, mapY + mapSize);
        ctx.arcTo(mapX,           mapY + mapSize,  mapX, mapY + mapSize - r,           r);
        ctx.lineTo(mapX, mapY + r);
        ctx.arcTo(mapX,           mapY,             mapX + r, mapY,                    r);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();

        wText('Google Maps', mapX + Math.round(6 * S), mapY + mapSize - Math.round(6 * S),
          `bold ${Math.round(8 * S)}px Arial`, 'rgba(255,255,255,0.65)');
      }

      ctx.save();
      ctx.font      = `bold ${fszT}px Arial`;
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.textAlign = 'right';
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur  = Math.round(4 * S);
      ctx.fillText('📷 GPS Map Camera Check-In/Out', w - pad, gradTop + Math.round(20 * S));
      ctx.restore();

      const tx    = mapX + mapSize + pad;
      const maxTW = w - tx - pad;
      let   ty    = blockY;

      if (fullName) {
        wText(fullName, tx, ty + fszB * 0.85, `bold ${fszB}px Tahoma, sans-serif`, '#ffffff', maxTW);
        ty += fszB + Math.round(3 * S);
      }
      const orgLine = [position, department, affiliation].filter(Boolean).join('  •  ');
      if (orgLine) {
        wText(orgLine, tx, ty + fszS * 0.85, `${fszS}px Tahoma, sans-serif`,
          'rgba(245,244,243,0.9)', maxTW);
        ty += fszS + Math.round(10 * S);
      }

      const now   = new Date();
      const dayTH = ['วันอาทิตย์','วันจันทร์','วันอังคาร','วันพุธ',
                     'วันพฤหัสบดี','วันศุกร์','วันเสาร์'][now.getDay()];
      const monTH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.',
                     'ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'][now.getMonth()];
      const offH  = -(now.getTimezoneOffset() / 60);
      const gmtStr = `GMT ${offH >= 0 ? '+' : ''}${offH}:00`;
      const timeTH = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

      wText(
        `${dayTH}, ${now.getDate()} ${monTH} ${now.getFullYear() + 543}  ${timeTH} น.  ${gmtStr}`,
        tx, ty + fszB * 0.85,
        `bold ${fszB}px Tahoma, sans-serif`, 'rgba(255,220,150,0.90)', maxTW, true
      );
      ty += fszB + Math.round(10 * S);

      const btnLabel = cfg.label;
      const btnColor = cfg.color;
      const btnW     = Math.round(90 * S);
      const btnR     = Math.round(6 * S);
      const btnFsz   = Math.round(14 * S);

      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur  = Math.round(8 * S);
      ctx.fillStyle   = btnColor;
      ctx.beginPath();
      ctx.roundRect(tx, ty, btnW, btnH, btnR);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.fillStyle    = '#ffffff';
      ctx.font         = `bold ${btnFsz}px Tahoma, sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(btnLabel, tx + btnW / 2, ty + btnH / 2);
      ctx.restore();

      const workRefText = [workType, ref ? `Ref: ${ref}` : ''].filter(Boolean).join('   |   ');
      if (workRefText) {
        wText(workRefText, tx + btnW + Math.round(12 * S), ty + btnH * 0.55,
          `bold ${fsz}px Tahoma, sans-serif`, '#ffe082', maxTW - btnW - Math.round(12 * S));
      }
      ty += btnH + Math.round(10 * S);

      // ── ที่อยู่ wrap 2 บรรทัด ──
      // FIX P4: set font ก่อน measureText เสมอ
      const addrFont = `bold ${fszB}px Tahoma, sans-serif`;
      ctx.font = addrFont;
      const fullAddr = gpsData.address || 'ไม่พบที่อยู่';
      const addrWords = fullAddr.split(', ');
      let addrLine1 = '', addrLine2 = '';
      for (const word of addrWords) {
        const test = addrLine1 ? addrLine1 + ', ' + word : word;
        if (ctx.measureText(test).width <= maxTW && !addrLine2) {
          addrLine1 = test;
        } else {
          addrLine2 = addrLine2 ? addrLine2 + ', ' + word : word;
        }
      }

      wText(addrLine1, tx, ty + fszB * 0.85, addrFont, '#ffffff', maxTW);
      ty += fszB + Math.round(3 * S);
      if (addrLine2) {
        wText(addrLine2, tx, ty + fsz * 0.85, `${fsz}px Tahoma, sans-serif`,
          'rgba(255,255,255,0.90)', maxTW);
        ty += fsz + Math.round(4 * S);
      } else {
        ty += Math.round(4 * S);
      }

      wText(
        `Lat: ${gpsData.lat.toFixed(6)}\u00B0   Long: ${gpsData.lon.toFixed(6)}\u00B0`,
        tx, ty + fsz * 0.85,
        `${fsz}px "Courier New", monospace`, '#80d8ff', maxTW, true
      );
      ty += lh;

      wText(
        `Zone ${gpsData.utm.zone}   X: ${gpsData.utm.x}   Y: ${gpsData.utm.y}`,
        tx, ty + fsz * 0.85,
        `${fsz}px "Courier New", monospace`, '#80d8ff', maxTW, true
      );
      ty += lh;

      wText(
        `elev: ${gpsData.elev} m   acc: ${gpsData.acc} m`,
        tx, ty + fsz * 0.85,
        `${fsz}px "Courier New", monospace`, 'rgba(255,255,255,0.85)', maxTW, true
      );

      // ════════════════════════════════════════
      //  ส่งออกเป็น PNG (ใช้ toBlob — ชุดเดียว ไม่ซ้ำ)
      //  FIX BUG3: ลบ block ซ้ำออก
      // ════════════════════════════════════════
      return new Promise((resolve) => {
        canvas.toBlob((blob) => {
          if (!blob) { resolve(false); return; }
          const file = new File([blob], `Attendance_${ref}.png`, { type: 'image/png' });
          resolve({ blob, file });
        }, 'image/png');
      });
    }

  }).then((result) => {
    // FIX BUG1: stopStream ใน willClose แล้ว ตรงนี้ไม่ต้องซ้ำ

    if (result.isConfirmed && result.value) {
      const { blob, file } = result.value;
      const previewUrl = URL.createObjectURL(blob);

      Swal.fire({
        title: 'แสดงภาพถ่าย',
        html: `
          <img src="${previewUrl}"
               style="width:100%;border-radius:8px;border:1px solid #ccc;margin-bottom:15px;" />
          <div style="display:flex;gap:10px;justify-content:center;margin-bottom:15px;">
            <a href="${previewUrl}" download="Attendance_${ref}.png"
               style="flex:1;text-decoration:none;background:#6c757d;color:white;
                      padding:10px;border-radius:5px;display:flex;align-items:center;
                      justify-content:center;gap:8px;font-weight:bold;">
              <i class="fa-solid fa-download"></i> บันทึกภาพ
            </a>
            <button id="btnShareImg"
               style="flex:1;background:#0d6efd;color:white;border:none;
                      padding:10px;border-radius:5px;cursor:pointer;
                      display:flex;align-items:center;justify-content:center;
                      gap:8px;font-weight:bold;">
              <i class="fa-solid fa-share-nodes"></i> แชร์ภาพ
            </button>
          </div>
          <p style="font-size:0.8rem;color:#cf1d1d;">
            ภาพนี้ไม่ถูกส่งไปยังเซิร์ฟเวอร์ ใช้สำหรับบันทึกลงเครื่องหรือแชร์เท่านั้น
          </p>
          <p style="font-size:0.8rem;color:#666;">Ref: ${ref}</p>
        `,
        showCancelButton: true,
        confirmButtonText: 'ปิด',
        cancelButtonText: 'ถ่ายใหม่',
        allowOutsideClick: false,
        didOpen: () => {
          const shareBtn = document.getElementById('btnShareImg');
          if (shareBtn) {
            shareBtn.addEventListener('click', async () => {
              if (navigator.canShare && navigator.canShare({ files: [file] })) {
                try {
                  await navigator.share({
                    files: [file],
                    title: 'บันทึกเวลาเข้างาน',
                    text: `ภาพ Check-in ของฉัน (Ref: ${ref})`
                  });
                } catch (err) {
                  if (err.name !== 'AbortError') console.error('แชร์ไม่สำเร็จ:', err);
                }
              } else {
                Swal.fire({
                  icon: 'info',
                  title: 'ไม่รองรับการแชร์',
                  text: 'อุปกรณ์นี้ไม่รองรับการแชร์ไฟล์โดยตรง กรุณากดปุ่ม "บันทึกภาพ" เพื่อบันทึกลงเครื่องแล้วแชร์เองครับ',
                  timer: 3000
                });
              }
            });
          }
        }
      }).then((finalRes) => {
        // FIX BUG2: revoke ทุก branch เสมอ (ทั้ง ปิด และ ถ่ายใหม่)
        URL.revokeObjectURL(previewUrl);

        if (finalRes.dismiss === Swal.DismissReason.cancel) {
          takeAttendancePhoto(data);
        }
      });
    }
  });
}
