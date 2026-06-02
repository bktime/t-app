/* ════════════════════════════════════════
   WORKFORCE DASHBOARD
════════════════════════════════════════ */

class WorkforceDashboard {

  constructor(){

    this.slider =
      document.getElementById('wfSlider');

    this.dots =
      document.getElementById('wfDots');

    if(!this.slider || !this.dots){
      console.error('[WorkforceDashboard] DOM not found');
      return;
    }

    this.current = 0;
    this.interval = null;
    this.slides = [];
    this.touchStartX = 0;
    this.touchEndX = 0;

    this.apiUrl = '/api/user/workforce-dashboard';

    // Swipe Support
    this.slider.addEventListener('touchstart', (e) => {
      this.touchStartX = e.changedTouches[0].screenX;
      this.stopAutoSlide();
    }, { passive: true });

    this.slider.addEventListener('touchend', (e) => {
      this.touchEndX = e.changedTouches[0].screenX;
      this.handleSwipe();
      this.startAutoSlide();
    }, { passive: true });

    // Pause on Hover
    this.slider.addEventListener('mouseenter', () => this.stopAutoSlide());
    this.slider.addEventListener('mouseleave', () => this.startAutoSlide());

    this.init();
  }

  async init(){
    this.renderLoading();
    try{
      await this.loadDashboard();
      this.render();
      this.startAutoSlide();
      this.startRealtimeRefresh();
    }catch(error){
      console.error('[WorkforceDashboard]', error);
      this.renderError();
    }
  }

  async loadDashboard(){
    const token = localStorage.getItem('auth_token');
    const response = await fetch(this.apiUrl,{
      method:'GET',
      headers:{
        'Content-Type':'application/json',
        'Authorization':`Bearer ${token}`
      }
    });

    const result = await response.json();

    if(!response.ok || !result.success){
      throw new Error(result.message || 'API Error');
    }

    const dashboard = result.dashboard;

    const scoreMood =
      dashboard.score >= 90 ? 'excellent'
      : dashboard.score >= 75 ? 'great'
      : dashboard.score >= 60 ? 'good'
      : 'warning';

this.slides = [
  {
    label: 'WORKFORCE',
    icon: 'fa-solid fa-id-card',
    theme: 'blue',
    title: 'สรุปการปฏิบัติงาน',
    value: `${new Date().toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })}`,
    subtitle: `${dashboard.name} · ${dashboard.department}`,
    progress: dashboard.attendanceRate
  },

  {
    label:'STREAK',
    icon:'fa-solid fa-fire',
    theme:'orange',
    title:'ความต่อเนื่อง',
    value:`${dashboard.streak} วัน`,
    subtitle:
      dashboard.streak >= 30 ? 'รักษาความสม่ำเสมอได้อย่างยอดเยี่ยม' :
      dashboard.streak >= 14 ? 'มีวินัยในการปฏิบัติงานอย่างต่อเนื่อง' :
      dashboard.streak >= 7 ? 'กำลังสร้างนิสัยการทำงานที่ดี' :
      'ทุกการเริ่มต้นคือก้าวที่สำคัญ',
    progress: Math.min(100, dashboard.streak * 5)
  },
  {
    label:'ATTENDANCE',
    icon:'fa-solid fa-calendar-check',
    theme:'blue',
    title:'การมาปฏิบัติงาน',
    value:`${dashboard.attendedDays}/${dashboard.workingDays}`,
    subtitle:
      dashboard.attendanceRate >= 90 ? 'มีความรับผิดชอบและตรงต่อเวลาอย่างดีเยี่ยม' :
      dashboard.attendanceRate >= 75 ? 'รักษามาตรฐานการปฏิบัติงานได้ดี' :
      dashboard.attendanceRate >= 60 ? 'มีพัฒนาการที่ดีอย่างต่อเนื่อง' :
      'ขอเป็นกำลังใจในการรักษาความสม่ำเสมอ',
    progress: dashboard.attendanceRate
  },
  {
    label:'GOAL',
    icon:'fa-solid fa-bullseye',
    theme:'purple',
    title:'การมาปฏิบัติงานครบ',
    value: dashboard.remainingDays <= 0 ? 'สำเร็จแล้ว' : `อีก ${dashboard.remainingDays} วัน`,
    subtitle:
      dashboard.remainingDays <= 0 ? 'ขอบคุณสำหรับความทุ่มเทและความสม่ำเสมอ' :
      dashboard.remainingDays <= 3 ? 'ใกล้ถึงเป้าหมายแล้ว สู้ต่ออีกนิด' :
      'ทุกวันคือโอกาสในการสร้างความสำเร็จ',
    progress: Math.max(10, 100 - ((dashboard.remainingDays / dashboard.workingDays) * 100))
  },
  {
    label:'SCORE',
    icon:'fa-solid fa-medal',
    theme:scoreMood,
    title:'คะแนนการปฏิบัติงาน',
    value:`${dashboard.score}`,
    subtitle:
      dashboard.score >= 95 ? 'มีวินัยและความรับผิดชอบในระดับยอดเยี่ยม' :
      dashboard.score >= 85 ? 'แสดงถึงความตั้งใจในการปฏิบัติงานอย่างดี' :
      dashboard.score >= 70 ? 'มีพัฒนาการที่น่าชื่นชม' :
      'ยังมีโอกาสพัฒนาได้อีกมาก',
    progress: dashboard.score
  },
  {
    label:'DEDICATION',
    icon:'fa-solid fa-award',
    theme:'green',
    title:'การปฏิบัติงานวันหยุด',
    value:`${dashboard.holidayContribution} ครั้ง`,
    subtitle:
      dashboard.holidayContribution > 5 ? 'ขอบคุณสำหรับการช่วยดูแลงานในวันหยุด' :
      dashboard.holidayContribution > 0 ? 'มีส่วนร่วมในการสนับสนุนงานเป็นอย่างดี' :
      'ไม่มีภารกิจปฏิบัติงานในวันหยุด',
    progress: Math.min(100, dashboard.holidayContribution * 15)
  }
];
  }

  render(){
    this.renderSlides();
    this.renderDots();
  }

  renderSlides(){

    const radius = 26;
    const circumference = 2 * Math.PI * radius;

    this.slider.innerHTML =
      this.slides.map((slide,index)=>{

        const progress = slide.progress || 0;
        const offset = circumference - (progress / 100) * circumference;

        return `
        <div class="wf-slide wf-${slide.theme || 'default'} ${index===0 ? 'active':''}">
          <div class="wf-content-left">
            
            <div class="wf-head">
              <div class="wf-icon"><i class="${slide.icon}"></i></div>
              
              <!-- เพิ่ม wf-meta ครอบไว้ -->
              <div class="wf-meta">
                <div class="wf-label">${slide.label}</div>
                <div class="wf-title">${slide.title}</div>
              </div>
              
            </div>
            
            <div class="wf-value">${slide.value}</div>
            <div class="wf-sub">${slide.subtitle}</div>
          </div>
          
          <div class="wf-chart-right">
            <svg width="100%" height="100%" viewBox="0 0 68 68">
              <circle class="wf-circle-bg" cx="34" cy="34" r="${radius}"></circle>
              <circle class="wf-circle-progress" cx="34" cy="34" r="${radius}"
                stroke-dasharray="${circumference}"
                stroke-dashoffset="${offset}">
              </circle>
            </svg>
            <div class="wf-circle-text">${Math.round(progress)}%</div>
          </div>
          
        </div>
      `}).join('');
  }

  renderDots(){
    this.dots.innerHTML =
      this.slides.map((_,index)=>`
        <div class="wf-dot ${index===0 ? 'active':''}"></div>
      `).join('');
  }

  updateData(){
    const slideEls = document.querySelectorAll('.wf-slide');
    const radius = 26;
    const circumference = 2 * Math.PI * radius;

    this.slides.forEach((slide,index)=>{
      const slideEl = slideEls[index];
      if(!slideEl) return;

      const valueEl = slideEl.querySelector('.wf-value');
      if(valueEl) valueEl.textContent = slide.value;

      const subEl = slideEl.querySelector('.wf-sub');
      if(subEl) subEl.textContent = slide.subtitle;

      const progressBar = slideEl.querySelector('.wf-circle-progress');
      const progressText = slideEl.querySelector('.wf-circle-text');
      const progress = slide.progress || 0;
      const offset = circumference - (progress / 100) * circumference;

      if(progressBar) progressBar.style.strokeDashoffset = offset;
      if(progressText) progressText.textContent = `${Math.round(progress)}%`;
    });
  }

  showSlide(index){
    const slides = document.querySelectorAll('.wf-slide');
    const dots = document.querySelectorAll('.wf-dot');

    slides.forEach(slide => slide.classList.remove('active'));
    dots.forEach(dot => dot.classList.remove('active'));

    slides[index]?.classList.add('active');
    dots[index]?.classList.add('active');
  }

  nextSlide(){
    this.current++;
    if(this.current >= this.slides.length) this.current = 0;
    this.showSlide(this.current);
  }

  prevSlide(){
    this.current--;
    if(this.current < 0) this.current = this.slides.length - 1;
    this.showSlide(this.current);
  }

  handleSwipe(){
    const diff = this.touchStartX - this.touchEndX;
    if(diff > 50) this.nextSlide();
    else if(diff < -50) this.prevSlide();
  }

  startAutoSlide(){
    this.stopAutoSlide();
    this.interval = setInterval(()=> this.nextSlide(), 5200);
  }

  stopAutoSlide(){
    if(this.interval) clearInterval(this.interval);
  }

  startRealtimeRefresh(){
    setInterval(async ()=>{
      try{
        await this.loadDashboard();
        this.updateData();
      }catch(error){
        console.error('[Dashboard Refresh]', error);
      }
    },300000);
  }

  renderLoading(){
    this.slider.innerHTML = `
      <div class="wf-slide active wf-default">
        <div class="wf-content-left">
          <div class="wf-head">
            <div class="wf-icon"><i class="fa-solid fa-spinner fa-spin"></i></div>
            <div class="wf-label">LOADING</div>
          </div>
          <div class="wf-value">...</div>
          <div class="wf-sub">กำลังโหลดข้อมูลการปฏิบัติงาน</div>
        </div>
        <div class="wf-chart-right">
          <svg width="100%" height="100%" viewBox="0 0 68 68">
            <circle class="wf-circle-bg" cx="34" cy="34" r="26"></circle>
          </svg>
        </div>
      </div>
    `;
  }

  renderError(){
    this.slider.innerHTML = `
      <div class="wf-slide active wf-warning">
        <div class="wf-content-left">
          <div class="wf-head">
            <div class="wf-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
            <div class="wf-label">ERROR</div>
          </div>
          <div class="wf-value">Offline</div>
          <div class="wf-sub">กรุณาลองใหม่อีกครั้ง</div>
        </div>
        <div class="wf-chart-right">
          <svg width="100%" height="100%" viewBox="0 0 68 68">
            <circle class="wf-circle-bg" cx="34" cy="34" r="26"></circle>
          </svg>
        </div>
      </div>
    `;
  }
}

window.addEventListener('DOMContentLoaded', ()=>{ new WorkforceDashboard(); });