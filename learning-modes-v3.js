(() => {
  const SUPABASE_URL = 'https://gkpoylfozvuwuwqeoduc.supabase.co';
  const PUBLISHABLE_KEY = 'sb_publishable_-ysUtue-9LpsJ8gabyrQaA_IaUf4F0W';
  const FAMILY_API = `${SUPABASE_URL}/functions/v1/family-api`;
  const EXAM_API = `${SUPABASE_URL}/functions/v1/exam-api`;
  let syncQueued = false;

  const learnerToken = () => localStorage.getItem('learner_session') || sessionStorage.getItem('learner_session') || '';
  const parentToken = () => { try { return JSON.parse(localStorage.getItem('parent_session') || 'null')?.access_token || ''; } catch { return ''; } };
  const esc = (s='') => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const frac = (n,d) => `<span class="frac"><span class="n">${n}</span><span class="d">${d}</span></span>`;
  const math = s => String(s).replace(/(\d+)\/(\d+)/g, (_,n,d) => frac(n,d));
  const stepList = steps => `<ol class="review-step-list">${steps.map(s => `<li>${math(esc(s))}</li>`).join('')}</ol>`;

  async function familyApi(action, payload={}, token='') {
    const headers = {'content-type':'application/json','apikey':PUBLISHABLE_KEY};
    if(token) headers.authorization = `Bearer ${token}`;
    const r = await fetch(FAMILY_API, {method:'POST', headers, body:JSON.stringify({action,...payload})});
    const d = await r.json().catch(()=>({error:'SERVER_ERROR'}));
    if(!r.ok) throw new Error(d.error || 'SERVER_ERROR');
    return d;
  }

  async function saveExamDetails(payload, token) {
    const r = await fetch(EXAM_API, {
      method:'POST',
      headers:{'content-type':'application/json','apikey':PUBLISHABLE_KEY,'authorization':`Bearer ${token}`},
      body:JSON.stringify({action:'save_exam_details',...payload})
    });
    const d = await r.json().catch(()=>({error:'SERVER_ERROR'}));
    if(!r.ok) throw new Error(d.error || 'SERVER_ERROR');
    return d;
  }

  function arabizeUi(){
    const root = document.getElementById('app');
    if(!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while(walker.nextNode()) nodes.push(walker.currentNode);
    for(const node of nodes){
      if(!node.parentElement || ['SCRIPT','STYLE'].includes(node.parentElement.tagName)) continue;
      const old = node.nodeValue || '';
      const next = old
        .replace(/\bHints\b/g, 'تلميحات')
        .replace(/\bHint\b/g, 'تلميح')
        .replace(/Learning Mode/g, 'وضع التعلّم')
        .replace(/Exam Mode/g, 'وضع الامتحان');
      if(next !== old) node.nodeValue = next;
    }
  }

  function humanizeBadgeReasons(){
    document.querySelectorAll('.badge .muted').forEach(el => {
      const t = el.textContent.trim();
      if(!/^quiz:/.test(t)) return;
      const title = el.closest('.badge')?.querySelector('b')?.textContent?.trim() || '';
      const copy = {
        'من أول محاولة':'أجبت إجابات صحيحة من أول محاولة في كويز الكسور (1).',
        'ما استسلمت':'ثابرت واستخدمت التلميحات حتى أكملت كويز الكسور (1).',
        'أتقنت المفهوم':'حققت نتيجة قوية وأظهرت إتقانًا في كويز الكسور (1).'
      };
      el.textContent = copy[title] || 'حققت إنجازًا في كويز الكسور (1).';
    });
  }

  function fixStudentFooterLink(){
    document.querySelectorAll('.footer-links a[href="#student"]').forEach(a => {
      const signedIn = !!learnerToken();
      const desired = signedIn ? 'تبديل / اختيار الطالب' : 'دخول الطالب';
      if(a.textContent !== desired) a.textContent = desired;
      if(a.dataset.studentSwitchBound) return;
      a.dataset.studentSwitchBound = '1';
      a.addEventListener('click', e => {
        if(!learnerToken()) return;
        e.preventDefault();
        localStorage.removeItem('learner_session');
        sessionStorage.removeItem('learner_session');
        location.hash = 'student';
        location.reload();
      });
    });
  }

  const EXAM = [
    {
      id:'e1', concept:'الكسور المتكافئة', source:'مكيّف من الكتاب — PDF 55',
      q:'أي كسر يكافئ 3/8؟', a:['6/16','3/16','6/8','8/16','9/16'], ok:0,
      why:'3/8 = 6/16 لأننا ضربنا البسط والمقام بالعدد نفسه.',
      short:['نبحث عن كسر له نفس قيمة 3/8، وليس مجرد أرقام تشبهه.','نضرب البسط 3 والمقام 8 بالعدد نفسه؛ إذا ضربنا الاثنين في 2 نحصل على 6/16.','إذن الإجابة الصحيحة هي 6/16.'],
      long:['الكسر المكافئ يمثل الكمية نفسها حتى لو تغير شكله.','حتى لا تتغير قيمة الكسر، نطبق العملية نفسها على البسط والمقام.','نختار هنا الضرب في 2.','3 × 2 = 6.','8 × 2 = 16.','إذن 3/8 = 6/16، ولذلك 6/16 هو الخيار الصحيح.']
    },
    {
      id:'e2', concept:'مقارنة الكسور', source:'مكيّف من الكتاب — PDF 55',
      q:'أي علاقة صحيحة بين 2/3 و1/2؟', a:['2/3 > 1/2','2/3 < 1/2','2/3 = 1/2','لا يمكن المقارنة','المقام الأكبر يعني الكسر أكبر'], ok:0,
      why:'عند توحيد المقام إلى 6 نحصل على 4/6 و3/6، لذلك 2/3 أكبر.',
      short:['لأن المقامين مختلفان، نوحدهما أولًا حتى نقارن أجزاءً من الحجم نفسه.','2/3 = 4/6، و1/2 = 3/6.','بما أن 4/6 أكبر من 3/6، إذن 2/3 > 1/2.'],
      long:['المقارنة المباشرة بين 3 و2 في المقام لا تكفي.','المقام المشترك المناسب للمقامين 3 و2 هو 6.','نحوّل 2/3 إلى 4/6 بضرب البسط والمقام في 2.','نحوّل 1/2 إلى 3/6 بضرب البسط والمقام في 3.','الآن المقامان متساويان، فنقارن البسطين 4 و3.','4 أكبر من 3، لذلك 2/3 أكبر من 1/2.']
    },
    {
      id:'e3', concept:'مقارنة الكسور', source:'مكيّف من الكتاب — PDF 56',
      q:'أي علاقة صحيحة بين 2/5 و1/3؟', a:['2/5 > 1/3','2/5 < 1/3','2/5 = 1/3','لا يمكن المقارنة','1/3 أكبر لأن مقامه أصغر دائمًا'], ok:0,
      why:'2/5 = 6/15 و1/3 = 5/15، لذلك 2/5 أكبر.',
      short:['نوحد المقامين 5 و3؛ المقام المشترك المناسب هو 15.','2/5 = 6/15، و1/3 = 5/15.','6/15 أكبر من 5/15، لذلك 2/5 > 1/3.'],
      long:['اختلاف المقامين يعني أن حجم الجزء مختلف في الكسرين.','نختار 15 لأنه يقبل القسمة على 5 وعلى 3.','نضرب 2/5 في 3/3 فنحصل على 6/15.','نضرب 1/3 في 5/5 فنحصل على 5/15.','بعد توحيد المقام نقارن البسطين 6 و5.','6 أكبر من 5، إذن 2/5 أكبر من 1/3.']
    },
    {
      id:'e4', concept:'ترتيب الكسور', source:'مكيّف من الكتاب — PDF 56',
      q:'أي ترتيب تصاعدي صحيح للكسور 3/4 ، 1/3 ، 5/6 ، 7/12؟',
      a:['1/3 < 7/12 < 3/4 < 5/6','7/12 < 1/3 < 3/4 < 5/6','1/3 < 3/4 < 7/12 < 5/6','5/6 < 3/4 < 7/12 < 1/3','3/4 < 7/12 < 1/3 < 5/6'], ok:0,
      why:'بالمقام 12 تصبح البسوط 4، 7، 9، 10؛ لذلك هذا هو الترتيب التصاعدي.',
      short:['التصاعدي يعني أن نبدأ بالأصغر وننتهي بالأكبر.','بالمقام 12 تصبح الكسور: 9/12، 4/12، 10/12، 7/12.','نرتب البسوط 4 ثم 7 ثم 9 ثم 10، فنحصل على 1/3 < 7/12 < 3/4 < 5/6.'],
      long:['نحتاج أن تكون كل الكسور بوحدة أجزاء واحدة حتى يسهل ترتيبها.','المقام 12 مناسب للمقامات 4 و3 و6 و12.','3/4 = 9/12.','1/3 = 4/12، و5/6 = 10/12، أما 7/12 فيبقى كما هو.','نرتب البسوط من الأصغر إلى الأكبر: 4، 7، 9، 10.','نعيد كل بسط إلى كسره الأصلي: 1/3 < 7/12 < 3/4 < 5/6.']
    },
    {
      id:'e5', concept:'تطبيق مقارنة الكسور', source:'مكيّف من الكتاب — PDF 57',
      q:'يبعد منزل بسّام 5/7 كم عن المدرسة، ومنزل رهام 3/5 كم. أيهما أقرب؟',
      a:['منزل بسّام','منزل رهام','المسافتان متساويتان','لا يمكن المقارنة','كلاهما أبعد من 1 كم'], ok:1,
      why:'3/5 = 21/35 وهي أصغر من 5/7 = 25/35، لذلك منزل رهام أقرب.',
      short:['كلمة «أقرب» تعني أننا نبحث عن المسافة الأصغر.','5/7 = 25/35، و3/5 = 21/35.','21/35 أصغر من 25/35، لذلك منزل رهام أقرب.'],
      long:['المطلوب هنا ليس اختيار الكسر الأكبر، بل اختيار المسافة الأقصر.','نوحد مقامي 7 و5 إلى 35.','5/7 = 25/35.','3/5 = 21/35.','نقارن 25 و21؛ العدد 21 أصغر.','إذن 3/5 كم هي المسافة الأقصر، ومنزل رهام هو الأقرب.']
    },
    {
      id:'e6', concept:'تطبيق مقارنة الكسور', source:'مكيّف من الكتاب — PDF 57',
      q:'أي الكسرين أكبر: 13/20 أم 16/25؟', a:['13/20','16/25','متساويان','لا يمكن المقارنة','يعتمد على المقام فقط'], ok:0,
      why:'13/20 = 65/100 بينما 16/25 = 64/100، لذلك 13/20 أكبر.',
      short:['نوحد المقامين حتى تصبح المقارنة مباشرة.','13/20 = 65/100، و16/25 = 64/100.','65/100 أكبر من 64/100، إذن 13/20 هو الأكبر.'],
      long:['المقامات 20 و25 مختلفة، فلا نحكم من شكل الرقمين فقط.','نختار 100 مقامًا مشتركًا مناسبًا.','نضرب 13/20 في 5/5 فنحصل على 65/100.','نضرب 16/25 في 4/4 فنحصل على 64/100.','عند المقام نفسه نقارن 65 و64.','65 أكبر من 64، لذلك 13/20 أكبر من 16/25.']
    },
    {
      id:'e7', concept:'تطبيق مقارنة الكسور', source:'مكيّف من الكتاب — PDF 57',
      q:'استهلكت مركبة أولى 13/40 من الوقود، والثانية 23/60 للمسافة نفسها. أيهما أكثر اقتصادية؟',
      a:['المركبة الأولى','المركبة الثانية','متساويتان','لا يمكن المقارنة','الأكثر استهلاكًا هو الأكثر اقتصادية'], ok:0,
      why:'13/40 = 39/120 و23/60 = 46/120؛ الأولى استهلكت نسبة أقل، فهي أكثر اقتصادية.',
      short:['الأكثر اقتصادية هي التي تستهلك كمية أقل للمسافة نفسها.','13/40 = 39/120، و23/60 = 46/120.','39/120 أقل من 46/120، إذن المركبة الأولى أكثر اقتصادية.'],
      long:['نثبت معنى السؤال أولًا: الاقتصاد يعني استهلاك وقود أقل.','نوحد المقامين 40 و60 إلى 120.','13/40 = 39/120.','23/60 = 46/120.','نقارن الاستهلاك: 39 أقل من 46.','إذن المركبة الأولى استهلكت أقل، وهي الأكثر اقتصادية.']
    },
    {
      id:'e8', concept:'مقارنة الكسور', source:'سؤال جديد مولّد على نمط الدرس',
      q:'أي علاقة صحيحة بين 3/5 و2/3؟', a:['3/5 < 2/3','3/5 > 2/3','3/5 = 2/3','لا يمكن المقارنة','المقام 5 يجعل الأول أكبر'], ok:0,
      why:'3/5 = 9/15 و2/3 = 10/15، لذلك 3/5 أصغر.',
      short:['نوحد المقامين 5 و3 إلى 15.','3/5 = 9/15، و2/3 = 10/15.','9/15 أصغر من 10/15، لذلك 3/5 < 2/3.'],
      long:['لا نقارن 5 و3 وحدهما لأن المقام الأكبر لا يعني كسرًا أكبر.','نستخدم 15 مقامًا مشتركًا.','3/5 = 9/15 بضرب البسط والمقام في 3.','2/3 = 10/15 بضرب البسط والمقام في 5.','نقارن البسطين 9 و10.','9 أصغر من 10، إذن 3/5 أصغر من 2/3.']
    },
    {
      id:'e9', concept:'ترتيب الكسور', source:'سؤال جديد مولّد على نمط الدرس',
      q:'أي ترتيب تصاعدي صحيح؟',
      a:['1/2 < 2/3 < 3/4 < 5/6','2/3 < 1/2 < 3/4 < 5/6','1/2 < 3/4 < 2/3 < 5/6','5/6 < 3/4 < 2/3 < 1/2','3/4 < 1/2 < 2/3 < 5/6'], ok:0,
      why:'بالمقام 12 تصبح 6/12، 8/12، 9/12، 10/12؛ وهذا ترتيبها التصاعدي.',
      short:['نستخدم مقامًا مشتركًا حتى نقارن بسهولة.','تصبح الكسور 6/12، 8/12، 9/12، 10/12.','ترتيب البسوط 6 < 8 < 9 < 10 يعطي 1/2 < 2/3 < 3/4 < 5/6.'],
      long:['التصاعدي يعني من الأصغر إلى الأكبر.','المقام 12 مناسب للمقامات 2 و3 و4 و6.','1/2 = 6/12.','2/3 = 8/12، و3/4 = 9/12، و5/6 = 10/12.','نرتب البسوط 6 ثم 8 ثم 9 ثم 10.','إذن الترتيب الصحيح هو 1/2 < 2/3 < 3/4 < 5/6.']
    },
    {
      id:'e10', concept:'الكسور المتكافئة', source:'سؤال جديد مولّد على نمط الدرس',
      q:'أي كسر يكافئ 4/10؟', a:['2/5','4/5','2/10','8/10','5/2'], ok:0,
      why:'بقسمة البسط والمقام على 2 نحصل على 2/5.',
      short:['نبحث عن تبسيط للكسر من دون تغيير قيمته.','نقسم البسط 4 والمقام 10 على العدد نفسه، وهو 2.','4 ÷ 2 = 2 و10 ÷ 2 = 5، لذلك 4/10 = 2/5.'],
      long:['الكسر المكافئ يمكن أن ينتج من الضرب أو القسمة على العدد نفسه.','نلاحظ أن 4 و10 يقبلان القسمة على 2.','نقسم البسط: 4 ÷ 2 = 2.','نقسم المقام: 10 ÷ 2 = 5.','إذن الكسر المبسط هو 2/5.','وبما أننا قسمنا البسط والمقام على العدد نفسه، بقيت قيمة الكسر كما هي.']
    }
  ];

  function addModeCards(){
    if(location.hash !== '#student' || !learnerToken()) return;
    const learningCard = document.getElementById('fractionQuiz');
    if(!learningCard) return;

    if(!learningCard.dataset.modeStyled){
      learningCard.dataset.modeStyled = '1';
      learningCard.classList.add('mode-card','learning-mode-card');
      learningCard.innerHTML = '<div class="mode-icon">🧠</div><b>الكسور (1) — وضع التعلّم</b><div class="muted">تصحيح مباشر، محاولات، تلميحات، وشرح خطوة بخطوة.</div><span class="mode-tag">وضع التعلّم</span>';
    }

    if(document.getElementById('fractionExam')) return;
    const exam = document.createElement('button');
    exam.id = 'fractionExam';
    exam.className = 'quiz-card mode-card exam-mode-card';
    exam.innerHTML = '<div class="mode-icon">📝</div><b>الكسور (1) — وضع الامتحان</b><div class="muted">10 أسئلة وراء بعض، بدون تلميحات أو تصحيح أثناء الحل. النتيجة والتحليل بالنهاية.</div><span class="mode-tag">وضع الامتحان</span>';
    exam.onclick = startExam;
    learningCard.insertAdjacentElement('afterend', exam);
  }

  function examShell(title, subtitle, content){
    const app = document.getElementById('app');
    if(!app) return;
    app.innerHTML = `<section class="hero exam-hero"><h1>${title}</h1><p>${subtitle}</p></section>${content}<div class="footer-links"><a href="#student" id="examBackHome">صفحة الطالب</a><a href="#parents">دخول الأهل</a></div>`;
    document.getElementById('examBackHome')?.addEventListener('click', e => {
      e.preventDefault();
      location.hash='student';
      location.reload();
    });
  }

  function startExam(){
    const token = learnerToken();
    if(!token){ location.hash='student'; return; }

    const answers = Array(EXAM.length).fill(null);
    let index = 0;
    const started = Date.now();
    let timerId = null;

    const formatElapsed = seconds => {
      const m = Math.floor(seconds / 60).toString().padStart(2,'0');
      const s = Math.floor(seconds % 60).toString().padStart(2,'0');
      return `${m}:${s}`;
    };

    const updateTimer = () => {
      const el = document.getElementById('examTimer');
      if(el) el.textContent = formatElapsed(Math.floor((Date.now()-started)/1000));
    };

    timerId = setInterval(updateTimer, 1000);

    function renderQuestion(){
      const q = EXAM[index];
      const selected = answers[index];
      const pct = Math.round((index / EXAM.length) * 100);
      examShell('📝 وضع الامتحان — الكسور', 'ما في تلميحات ولا تصحيح أثناء الحل. جاوب بهدوء، والنتيجة والشرح الكامل بيطلعوا بعد التسليم.', `
        <section class="panel exam-status">
          <div class="topline exam-topline">
            <b>السؤال ${index+1} من ${EXAM.length}</b>
            <span>${answers.filter(v=>v!==null).length}/${EXAM.length} مجاب</span>
            <span class="exam-timer">⏱️ الوقت: <b id="examTimer">00:00</b></span>
          </div>
          <div class="progress"><span style="width:${pct}%"></span></div>
        </section>
        <section class="card exam-question-card">
          <div class="quiz-head"><span>${esc(q.source)}</span><span>${esc(q.concept)}</span></div>
          <div class="question">${math(q.q)}</div>
          <div class="answers" id="examAnswers">${q.a.map((a,n)=>`<button class="answer ${selected===n?'selected':''}" data-n="${n}">${math(a)}</button>`).join('')}</div>
          <div class="actions exam-actions">
            <button class="btn btn-soft" id="examPrev" ${index===0?'disabled':''}>السابق</button>
            ${index<EXAM.length-1?'<button class="btn btn-primary" id="examNext">التالي</button>':'<button class="btn btn-primary" id="examSubmit">تسليم الامتحان</button>'}
            <button class="btn btn-soft" id="examQuit">خروج</button>
          </div>
          <div id="examMsg"></div>
        </section>`);

      updateTimer();

      document.querySelectorAll('#examAnswers .answer').forEach(b => b.onclick = () => {
        answers[index]=Number(b.dataset.n);
        document.querySelectorAll('#examAnswers .answer').forEach(x=>x.classList.remove('selected'));
        b.classList.add('selected');
      });

      document.getElementById('examPrev')?.addEventListener('click',()=>{ if(index>0){index--;renderQuestion();} });
      document.getElementById('examNext')?.addEventListener('click',()=>{ index++;renderQuestion(); });
      document.getElementById('examQuit')?.addEventListener('click',()=>{
        clearInterval(timerId);
        location.hash='student';
        location.reload();
      });
      document.getElementById('examSubmit')?.addEventListener('click',()=>{
        const missing=answers.filter(v=>v===null).length;
        if(missing){
          document.getElementById('examMsg').innerHTML=`<div class="error">باقي ${missing} سؤال بدون إجابة. فيك ترجع تجاوبهم، أو تسلّم كما هو.<div class="actions"><button class="btn btn-warning" id="submitAnyway">سلّم كما هو</button></div></div>`;
          document.getElementById('submitAnyway').onclick=finishExam;
        } else finishExam();
      });
    }

    async function finishExam(){
      clearInterval(timerId);
      const duration=Math.round((Date.now()-started)/1000);
      const details=EXAM.map((q,i)=>({
        id:q.id,
        concept:q.concept,
        question:q.q,
        selected:answers[i]===null?null:q.a[answers[i]],
        correct_answer:q.a[q.ok],
        is_correct:answers[i]===q.ok,
        explanation:q.why,
        explanation_short:q.short,
        explanation_long:q.long,
        source:q.source
      }));
      const correct=details.filter(x=>x.is_correct).length;
      const score=Math.round(correct/EXAM.length*100);
      const missed=[...new Set(details.filter(x=>!x.is_correct).map(x=>x.concept))];

      const rows=details.map((r,i)=>{
        const wrongHelp = r.is_correct ? `<div class="review-correct-note">✅ ممتاز. إجابتك صحيحة.</div>` : `
          <div class="review-explanation">
            <b>🧠 شرح الحل بثلاث خطوات:</b>
            ${stepList(r.explanation_short)}
            <button class="btn btn-warning review-more-btn" data-review-more="${i}">🔍 اشرح الحل بشكل أوسع</button>
            <div class="review-more-area" id="reviewMore${i}"></div>
          </div>`;
        return `<details class="exam-review ${r.is_correct?'review-good':'review-bad'}" ${!r.is_correct?'open':''}>
          <summary>${r.is_correct?'✅':'❌'} السؤال ${i+1}: ${math(esc(r.question))}</summary>
          <div class="review-body">
            <div>إجابتك: <b>${r.selected===null?'بدون إجابة':math(esc(r.selected))}</b></div>
            <div>الإجابة الصحيحة: <b>${math(esc(r.correct_answer))}</b></div>
            ${wrongHelp}
            <div class="source-note">${esc(r.source)}</div>
          </div>
        </details>`;
      }).join('');

      examShell('📊 نتيجة الامتحان', `أجبت صح على ${correct} من ${EXAM.length}.`, `
        <section class="panel exam-result-summary">
          <div class="exam-score">${correct}/${EXAM.length}</div>
          <div class="stats">
            <div class="stat">النسبة<b>${score}%</b></div>
            <div class="stat">صحيح<b>${correct}</b></div>
            <div class="stat">خطأ/فارغ<b>${EXAM.length-correct}</b></div>
            <div class="stat">المدة<b>${formatElapsed(duration)}</b></div>
          </div>
          <div class="section-title">🎯 يحتاج مراجعة</div>
          <div class="concept-chips">${missed.length?missed.map(c=>`<span>${esc(c)}</span>`).join(''):'<span class="all-good">كل المفاهيم ممتازة 🎉</span>'}</div>
          <div id="examSaveState" class="muted">عم نحفظ نتيجة الامتحان…</div>
          <div class="actions"><button class="btn btn-primary" id="backToStudent">رجوع لصفحتي</button></div>
        </section>
        <section class="panel">
          <div class="section-title">🔎 مراجعة كل سؤال</div>
          ${rows}
        </section>`);

      document.getElementById('backToStudent').onclick=()=>{location.hash='student';location.reload();};
      document.querySelectorAll('[data-review-more]').forEach(btn => {
        btn.addEventListener('click', () => {
          const i = Number(btn.dataset.reviewMore);
          const target = document.getElementById(`reviewMore${i}`);
          if(!target || target.dataset.open) return;
          target.dataset.open = '1';
          target.innerHTML = `<div class="review-expanded"><b>📚 شرح أوسع بست خطوات:</b>${stepList(EXAM[i].long)}</div>`;
          btn.disabled = true;
          btn.textContent = '✅ تم فتح الشرح الأوسع';
        });
      });

      try{
        const award=await familyApi('complete_quiz',{
          quiz_slug:'fractions-pages-54-57-exam',
          score,
          first_try_correct:correct,
          hints_used:0,
          delivery_mode:'exam'
        },token);
        await saveExamDetails({
          quiz_slug:'fractions-pages-54-57-exam',
          question_results:details,
          score,
          duration_seconds:duration
        },token).catch(()=>{});
        const el=document.getElementById('examSaveState');
        if(el) el.innerHTML=award.already_awarded
          ? '<div class="success">✅ النتيجة انحفظت. التكرار ما يجمع XP إضافي تلقائيًا.</div>'
          : `<div class="award-pop">🎉 النتيجة انحفظت — +${award.award.xp} XP و 🪙 +${award.award.reward_points} نقطة</div>`;
      }catch{
        const el=document.getElementById('examSaveState');
        if(el) el.innerHTML='<div class="error">النتيجة ظاهرة، لكن صار خطأ بالحفظ. خبر الأهل قبل إعادة الامتحان.</div>';
      }
    }

    renderQuestion();
  }

  async function addParentExamReport(){
    if(location.hash!=='#parents'||document.getElementById('parentExamReport')) return;
    const heading=document.querySelector('.hero h1');
    if(!heading||!heading.textContent.includes('لوحة الأهل')) return;
    const token=parentToken();
    if(!token) return;
    try{
      const d=await familyApi('parent_dashboard',{},token);
      const learnerById=Object.fromEntries((d.learners||[]).map(l=>[l.id,l]));
      const exams=(d.attempts||[]).filter(a=>a.metadata?.delivery_mode==='exam'||Array.isArray(a.metadata?.question_results));
      const section=document.createElement('section');
      section.id='parentExamReport';
      section.className='panel';
      const visible=exams.filter(a=>learnerById[a.learner_id]?.slug!=='test');
      if(!visible.length){
        section.innerHTML='<div class="section-title">📝 تقارير الامتحانات</div><div class="empty">ما في امتحانات محفوظة بعد.</div>';
      }else{
        section.innerHTML=`<div class="section-title">📝 تقارير الامتحانات</div>${visible.map(a=>{
          const l=learnerById[a.learner_id];
          const rs=Array.isArray(a.metadata?.question_results)?a.metadata.question_results:[];
          const total=a.metadata?.total_count??(rs.length||10);
          const correct=a.metadata?.correct_count??rs.filter(r=>r.is_correct).length;
          return `<details class="parent-exam"><summary>${esc(l?.display_name||'طالب')} — ${Math.round(a.percentage||0)}% — ${a.submitted_at?new Date(a.submitted_at).toLocaleDateString('ar'):'—'}</summary><div class="review-body"><div>الصحيح: <b>${correct}/${total}</b></div>${rs.map((r,i)=>`<div class="parent-exam-row">${r.is_correct?'✅':'❌'} ${i+1}. ${math(esc(r.question||''))}<br><span class="muted">إجابته: ${r.selected==null?'بدون إجابة':math(esc(r.selected))} · الصحيح: ${math(esc(r.correct_answer||''))}</span></div>`).join('')}</div></details>`;
        }).join('')}`;
      }
      const footer=document.querySelector('.footer-links');
      (footer?.parentNode||document.getElementById('app'))?.insertBefore(section,footer||null);
    }catch{}
  }

  function sync(){
    fixStudentFooterLink();
    addModeCards();
    addParentExamReport();
    arabizeUi();
    humanizeBadgeReasons();
  }

  function schedule(){
    if(syncQueued) return;
    syncQueued=true;
    queueMicrotask(()=>{syncQueued=false;sync();});
  }

  const observer=new MutationObserver(schedule);
  observer.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('hashchange',()=>setTimeout(schedule,50));
  document.addEventListener('DOMContentLoaded',schedule);
  schedule();
})();