(() => {
  const TOTAL = 10;
  const STATE_KEY = 'exam_nav_answered_v6';

  const frac = (n,d) => `<span class="frac"><span class="n">${n}</span><span class="d">${d}</span></span>`;
  const math = (s='') => String(s).replace(/(\d+)\/(\d+)/g,(_,n,d)=>frac(n,d));
  const esc = (s='') => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const renderSteps = steps => `<ol class="simple-review-steps">${steps.map(x=>`<li>${math(esc(x))}</li>`).join('')}</ol>`;

  const simple = {
    1:{s:['نريد كسرًا يساوي 3/8.','نضرب 3 و8 في 2، فنحصل على 6 و16.','إذن 3/8 = 6/16.'],l:['الكسر المكافئ يعني نفس الكمية.','نطبّق العملية نفسها على البسط والمقام.','نختار الضرب في 2.','3 × 2 = 6.','8 × 2 = 16.','إذن 6/16 هو الجواب الصحيح.']},
    2:{s:['نوحّد المقامين حتى نقارن بسهولة.','2/3 = 4/6، و1/2 = 3/6.','4 أكبر من 3، إذن 2/3 أكبر.'],l:['المقامات مختلفة.','نستخدم 6 كمقام مشترك.','2/3 تصبح 4/6.','1/2 تصبح 3/6.','نقارن 4 و3.','إذن 2/3 > 1/2.']},
    3:{s:['نوحّد المقامين إلى 15.','2/5 = 6/15، و1/3 = 5/15.','6 أكبر من 5، إذن 2/5 أكبر.'],l:['نريد أجزاءً من الحجم نفسه.','15 مقام مشترك مناسب.','2/5 تصبح 6/15.','1/3 تصبح 5/15.','نقارن 6 و5.','إذن 2/5 > 1/3.']},
    4:{s:['نحوّل الكسور إلى مقام 12.','تصبح البسوط: 9، 4، 10، 7.','نرتب 4، 7، 9، 10.'],l:['التصاعدي يعني من الأصغر للأكبر.','نستخدم المقام 12.','3/4 = 9/12.','1/3 = 4/12، و5/6 = 10/12، و7/12 كما هو.','نرتب البسوط: 4 ثم 7 ثم 9 ثم 10.','إذن 1/3 < 7/12 < 3/4 < 5/6.']},
    5:{s:['الأقرب يعني المسافة الأصغر.','5/7 = 25/35، و3/5 = 21/35.','21 أصغر، إذن منزل رهام أقرب.'],l:['نبحث عن المسافة الأقل.','نوحّد المقامين إلى 35.','5/7 تصبح 25/35.','3/5 تصبح 21/35.','21 أصغر من 25.','إذن منزل رهام هو الأقرب.']},
    6:{s:['نوحّد المقامين إلى 100.','13/20 = 65/100، و16/25 = 64/100.','65 أكبر، إذن 13/20 أكبر.'],l:['المقامات مختلفة.','نستخدم 100 مقامًا مشتركًا.','13/20 تصبح 65/100.','16/25 تصبح 64/100.','نقارن 65 و64.','إذن 13/20 هو الأكبر.']},
    7:{s:['الأكثر اقتصادية تستهلك وقودًا أقل.','13/40 = 39/120، و23/60 = 46/120.','39 أقل، إذن المركبة الأولى أكثر اقتصادية.'],l:['نبحث عن الأقل استهلاكًا.','نوحّد المقامين إلى 120.','13/40 تصبح 39/120.','23/60 تصبح 46/120.','39 أقل من 46.','إذن المركبة الأولى أكثر اقتصادية.']},
    8:{s:['نوحّد المقامين إلى 15.','3/5 = 9/15، و2/3 = 10/15.','9 أقل، إذن 3/5 أصغر.'],l:['المقامات مختلفة.','نستخدم 15 مقامًا مشتركًا.','3/5 تصبح 9/15.','2/3 تصبح 10/15.','نقارن 9 و10.','إذن 3/5 < 2/3.']},
    9:{s:['نوحّد الكسور إلى مقام 12.','تصبح 6/12، 8/12، 9/12، 10/12.','إذن الترتيب من الأصغر للأكبر واضح.'],l:['نرتب من الأصغر للأكبر.','نستخدم المقام 12.','1/2 = 6/12.','2/3 = 8/12، و3/4 = 9/12، و5/6 = 10/12.','نرتب 6 ثم 8 ثم 9 ثم 10.','إذن 1/2 < 2/3 < 3/4 < 5/6.']},
    10:{s:['نريد كسرًا مساويًا لـ4/10.','نقسم 4 و10 على 2.','نحصل على 2/5.'],l:['الكسر المكافئ له نفس القيمة.','نستطيع التبسيط بالقسمة على العدد نفسه.','4 و10 يقبلان القسمة على 2.','4 ÷ 2 = 2.','10 ÷ 2 = 5.','إذن 2/5 هو الجواب الصحيح.']}
  };

  const fun = [
    '🧩 خطوة خطوة… السؤال ما رح يهرب 😄',
    '⚖️ خلّي الكسور على ميزان عادل وبتمشي!',
    '🔍 ركّز على الفكرة، مو على شكل الأرقام.',
    '🪜 من الأصغر للأكبر… سلّم بسيط!',
    '🏫 الأقرب هو اللي طريقه أقصر 😉',
    '🎯 فرق صغير جدًا… ركّز شوي!',
    '⛽ الأقل استهلاكًا هو البطل هون 😄',
    '🧠 مقام واحد، والمقارنة بتصير أسهل.',
    '🚀 رتبهم بهدوء، ما في سباق!',
    '✂️ تبسيط صغير ونوصل.'
  ];

  function loadAnswered(){
    try {
      const x = JSON.parse(sessionStorage.getItem(STATE_KEY) || '[]');
      return Array.from({length: TOTAL}, (_, i) => !!x[i]);
    } catch {
      return Array(TOTAL).fill(false);
    }
  }

  function saveAnswered(a){
    sessionStorage.setItem(STATE_KEY, JSON.stringify(a));
  }

  function currentIndex(){
    const t = document.querySelector('.exam-status .topline b')?.textContent || '';
    const m = t.match(/السؤال\s+(\d+)\s+من/);
    return m ? Number(m[1]) : 0;
  }

  function renderNavigator(){
    const status = document.querySelector('.exam-status');
    const idx = currentIndex();
    if(!status || !idx) return;

    const answered = loadAnswered();
    let nav = document.getElementById('examQuestionNavigator');
    if(!nav){
      nav = document.createElement('div');
      nav.id = 'examQuestionNavigator';
      nav.className = 'exam-question-navigator';
      const progress = status.querySelector('.progress');
      status.insertBefore(nav, progress || null);
    }

    const signature = `${idx}:${answered.map(x=>x?'1':'0').join('')}`;
    if(nav.dataset.signature !== signature){
      nav.dataset.signature = signature;
      nav.innerHTML = `<div class="exam-nav-title">🗺️ الأسئلة</div><div class="exam-nav-buttons">${Array.from({length:TOTAL},(_,i)=>{
        const n=i+1;
        const cls=n===idx?'current':answered[i]?'answered':'unanswered';
        const icon=answered[i]?'✓':'•';
        return `<button type="button" class="exam-nav-btn ${cls}" data-q="${n}" aria-label="السؤال ${n} ${answered[i]?'مجاب':'غير مجاب'}"><span>${n}</span><small>${icon}</small></button>`;
      }).join('')}</div><div class="exam-nav-legend"><span>✅ مجاب</span><span>○ غير مجاب</span><span>🟣 الحالي</span></div>`;
      nav.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => jumpTo(Number(b.dataset.q))));
    }

    let funEl = document.getElementById('examFunLine');
    if(!funEl){
      funEl = document.createElement('div');
      funEl.id = 'examFunLine';
      funEl.className = 'exam-fun-line';
      nav.insertAdjacentElement('afterend', funEl);
    }
    funEl.textContent = fun[idx-1] || '🙂 خذ وقتك وفكّر بهدوء.';
  }

  function jumpTo(target){
    let steps = 0;
    const move = () => {
      const cur = currentIndex();
      if(!cur || cur === target || steps++ > TOTAL + 2){
        renderNavigator();
        return;
      }
      const btn = document.getElementById(target > cur ? 'examNext' : 'examPrev');
      if(!btn || btn.disabled) return;
      btn.click();
      setTimeout(move, 0);
    };
    move();
  }

  function markCurrentAnswered(){
    const idx = currentIndex();
    if(!idx) return;
    const answered = loadAnswered();
    answered[idx-1] = true;
    saveAnswered(answered);
  }

  function enhanceResults(){
    const reviews = [...document.querySelectorAll('.exam-review')];
    if(!reviews.length) return false;

    reviews.forEach((d,i) => {
      if(!d.dataset.accordionInit){
        d.removeAttribute('open');
        d.dataset.accordionInit = '1';
      }

      const summary = d.querySelector('summary');
      if(summary && !summary.dataset.statusStyled){
        const good = d.classList.contains('review-good');
        summary.dataset.statusStyled = '1';
        summary.classList.add(good ? 'review-summary-good' : 'review-summary-bad');
      }

      if(!d.classList.contains('review-bad') || d.dataset.simpleExplained) return;
      const box = d.querySelector('.review-explanation');
      const cfg = simple[i+1];
      if(!box || !cfg) return;

      d.dataset.simpleExplained = '1';
      box.innerHTML = `<b>🙂 خلينا نفكها ببساطة — 3 خطوات:</b>${renderSteps(cfg.s)}<button type="button" class="btn btn-warning simple-more-btn">🔍 بدي شرح أوضح شوي</button><div class="simple-more-area"></div>`;
      const btn = box.querySelector('.simple-more-btn');
      btn.addEventListener('click', () => {
        const area = box.querySelector('.simple-more-area');
        area.innerHTML = `<div class="simple-expanded"><b>🧠 نفس الفكرة، بس على 6 خطوات:</b>${renderSteps(cfg.l)}</div>`;
        btn.disabled = true;
        btn.textContent = '✅ فتحنا الشرح الأوسع';
      });
    });
    return true;
  }

  function waitForResults(){
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if(enhanceResults() || tries >= 100) clearInterval(timer);
    }, 100);
  }

  document.addEventListener('click', e => {
    const target = e.target instanceof Element ? e.target : null;
    if(!target) return;

    if(target.closest('#fractionExam')){
      sessionStorage.removeItem(STATE_KEY);
      setTimeout(renderNavigator, 0);
      setTimeout(renderNavigator, 80);
      return;
    }

    if(target.closest('#examAnswers .answer')){
      markCurrentAnswered();
      setTimeout(renderNavigator, 0);
      return;
    }

    if(target.closest('#examNext, #examPrev')){
      setTimeout(renderNavigator, 0);
      return;
    }

    if(target.closest('#examSubmit')){
      waitForResults();
      return;
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    if(document.querySelector('.exam-status')) renderNavigator();
    if(document.querySelector('.exam-review')) enhanceResults();
  });
})();
