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

  async function familyApi(action, payload={}, token='') {
    const headers = {'content-type':'application/json','apikey':PUBLISHABLE_KEY};
    if(token) headers.authorization = `Bearer ${token}`;
    const r = await fetch(FAMILY_API, {method:'POST', headers, body:JSON.stringify({action,...payload})});
    const d = await r.json().catch(()=>({error:'SERVER_ERROR'}));
    if(!r.ok) throw new Error(d.error || 'SERVER_ERROR');
    return d;
  }
  async function examApi(payload, token) {
    const r = await fetch(EXAM_API, {method:'POST', headers:{'content-type':'application/json','apikey':PUBLISHABLE_KEY,'authorization':`Bearer ${token}`}, body:JSON.stringify({action:'save_exam_details',...payload})});
    const d = await r.json().catch(()=>({error:'SERVER_ERROR'}));
    if(!r.ok) throw new Error(d.error || 'SERVER_ERROR');
    return d;
  }

  // ---------------------------
  // Navigation UX fix
  // ---------------------------
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

  // ---------------------------
  // Exam question bank
  // ---------------------------
  const EXAM = [
    {id:'e1',concept:'الكسور المتكافئة',source:'مكيّف من الكتاب — PDF 55',q:'أي كسر يكافئ 3/8؟',a:['6/16','3/16','6/8','8/16','9/16'],ok:0,why:'3/8 = 6/16 لأننا ضربنا البسط والمقام بالعدد نفسه.'},
    {id:'e2',concept:'مقارنة الكسور',source:'مكيّف من الكتاب — PDF 55',q:'أي علاقة صحيحة بين 2/3 و1/2؟',a:['2/3 > 1/2','2/3 < 1/2','2/3 = 1/2','لا يمكن المقارنة','المقام الأكبر يعني الكسر أكبر'],ok:0,why:'عند توحيد المقام إلى 6 نحصل على 4/6 و3/6، لذلك 2/3 أكبر.'},
    {id:'e3',concept:'مقارنة الكسور',source:'مكيّف من الكتاب — PDF 56',q:'أي علاقة صحيحة بين 2/5 و1/3؟',a:['2/5 > 1/3','2/5 < 1/3','2/5 = 1/3','لا يمكن المقارنة','1/3 أكبر لأن مقامه أصغر دائمًا'],ok:0,why:'2/5 = 6/15 و1/3 = 5/15، لذلك 2/5 أكبر.'},
    {id:'e4',concept:'ترتيب الكسور',source:'مكيّف من الكتاب — PDF 56',q:'أي ترتيب تصاعدي صحيح للكسور 3/4 ، 1/3 ، 5/6 ، 7/12؟',a:['1/3 < 7/12 < 3/4 < 5/6','7/12 < 1/3 < 3/4 < 5/6','1/3 < 3/4 < 7/12 < 5/6','5/6 < 3/4 < 7/12 < 1/3','3/4 < 7/12 < 1/3 < 5/6'],ok:0,why:'بالمقام 12 تصبح البسوط 4، 7، 9، 10؛ لذلك هذا هو الترتيب التصاعدي.'},
    {id:'e5',concept:'تطبيق مقارنة الكسور',source:'مكيّف من الكتاب — PDF 57',q:'يبعد منزل بسّام 5/7 كم عن المدرسة، ومنزل رهام 3/5 كم. أيهما أقرب؟',a:['منزل بسّام','منزل رهام','المسافتان متساويتان','لا يمكن المقارنة','كلاهما أبعد من 1 كم'],ok:1,why:'3/5 = 21/35 وهي أصغر من 5/7 = 25/35، لذلك منزل رهام أقرب.'},
    {id:'e6',concept:'تطبيق مقارنة الكسور',source:'مكيّف من الكتاب — PDF 57',q:'أي الكسرين أكبر: 13/20 أم 16/25؟',a:['13/20','16/25','متساويان','لا يمكن المقارنة','يعتمد على المقام فقط'],ok:0,why:'13/20 = 65/100 بينما 16/25 = 64/100، لذلك 13/20 أكبر.'},
    {id:'e7',concept:'تطبيق مقارنة الكسور',source:'مكيّف من الكتاب — PDF 57',q:'استهلكت مركبة أولى 13/40 من الوقود، والثانية 23/60 للمسافة نفسها. أيهما أكثر اقتصادية؟',a:['المركبة الأولى','المركبة الثانية','متساويتان','لا يمكن المقارنة','الأكثر استهلاكًا هو الأكثر اقتصادية'],ok:0,why:'13/40 = 39/120 و23/60 = 46/120؛ الأولى استهلكت نسبة أقل، فهي أكثر اقتصادية.'},
    {id:'e8',concept:'مقارنة الكسور',source:'سؤال جديد مولّد على نمط الدرس',q:'أي علاقة صحيحة بين 3/5 و2/3؟',a:['3/5 < 2/3','3/5 > 2/3','3/5 = 2/3','لا يمكن المقارنة','المقام 5 يجعل الأول أكبر'],ok:0,why:'3/5 = 9/15 و2/3 = 10/15، لذلك 3/5 أصغر.'},
    {id:'e9',concept:'ترتيب الكسور',source:'سؤال جديد مولّد على نمط الدرس',q:'أي ترتيب تصاعدي صحيح؟',a:['1/2 < 2/3 < 3/4 < 5/6','2/3 < 1/2 < 3/4 < 5/6','1/2 < 3/4 < 2/3 < 5/6','5/6 < 3/4 < 2/3 < 1/2','3/4 < 1/2 < 2/3 < 5/6'],ok:0,why:'بالمقام 12 تصبح 6/12، 8/12، 9/12، 10/12؛ وهذا ترتيبها التصاعدي.'},
    {id:'e10',concept:'الكسور المتكافئة',source:'سؤال جديد مولّد على نمط الدرس',q:'أي كسر يكافئ 4/10؟',a:['2/5','4/5','2/10','8/10','5/2'],ok:0,why:'بقسمة البسط والمقام على 2 نحصل على 2/5.'},
  ];

  function addModeCards(){
    if(location.hash !== '#student' || !learnerToken()) return;
    const learningCard = document.getElementById('fractionQuiz');
    if(!learningCard) return;

    if(!learningCard.dataset.modeStyled){
      learningCard.dataset.modeStyled = '1';
      learningCard.classList.add('mode-card','learning-mode-card');
      learningCard.innerHTML = '<div class="mode-icon">🧠</div><b>الكسور (1) — وضع التعلّم</b><div class="muted">تصحيح مباشر، محاولات، Hints، وشرح خطوة بخطوة.</div><span class="mode-tag">Learning Mode</span>';
    }

    if(document.getElementById('fractionExam')) return;
    const exam = document.createElement('button');
    exam.id = 'fractionExam';
    exam.className = 'quiz-card mode-card exam-mode-card';
    exam.innerHTML = '<div class="mode-icon">📝</div><b>الكسور (1) — وضع الامتحان</b><div class="muted">10 أسئلة وراء بعض، بدون Hints أو تصحيح أثناء الحل. النتيجة والتحليل بالنهاية.</div><span class="mode-tag">Exam Mode</span>';
    exam.onclick = startExam;
    learningCard.insertAdjacentElement('afterend', exam);
  }

  function examShell(title, subtitle, content){
    const app = document.getElementById('app');
    if(!app) return;
    app.innerHTML = `<section class="hero exam-hero"><h1>${title}</h1><p>${subtitle}</p></section>${content}<div class="footer-links"><a href="#student" id="examBackHome">صفحة الطالب</a><a href="#parents">دخول الأهل</a></div>`;
    document.getElementById('examBackHome')?.addEventListener('click', e => { e.preventDefault(); location.hash='student'; location.reload(); });
  }

  function startExam(){
    const token = learnerToken();
    if(!token) { location.hash='student'; return; }
    const answers = Array(EXAM.length).fill(null);
    let index = 0;
    const started = Date.now();

    function renderQuestion(){
      const q = EXAM[index];
      const selected = answers[index];
      const pct = Math.round((index / EXAM.length) * 100);
      examShell('📝 Exam Mode — الكسور', 'ما في Hints ولا تصحيح الآن. جاوب بهدوء، والنتيجة الكاملة بتطلع بعد التسليم.', `
        <section class="panel exam-status">
          <div class="topline"><b>السؤال ${index+1} من ${EXAM.length}</b><span>${answers.filter(v=>v!==null).length}/${EXAM.length} مجاب</span></div>
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
      document.querySelectorAll('#examAnswers .answer').forEach(b => b.onclick = () => {
        answers[index] = Number(b.dataset.n);
        document.querySelectorAll('#examAnswers .answer').forEach(x=>x.classList.remove('selected'));
        b.classList.add('selected');
      });
      document.getElementById('examPrev')?.addEventListener('click',()=>{ if(index>0){index--;renderQuestion();} });
      document.getElementById('examNext')?.addEventListener('click',()=>{ index++;renderQuestion(); });
      document.getElementById('examQuit')?.addEventListener('click',()=>{ location.hash='student';location.reload(); });
      document.getElementById('examSubmit')?.addEventListener('click',()=>{
        const missing = answers.filter(v=>v===null).length;
        if(missing){
          document.getElementById('examMsg').innerHTML = `<div class="error">باقي ${missing} سؤال بدون إجابة. فيك ترجع تجاوبهم، أو تسلّم كما هو.<div class="actions"><button class="btn btn-warning" id="submitAnyway">سلّم كما هو</button></div></div>`;
          document.getElementById('submitAnyway').onclick = finishExam;
        } else finishExam();
      });
    }

    async function finishExam(){
      const details = EXAM.map((q,i) => ({
        id:q.id, concept:q.concept, question:q.q,
        selected: answers[i]===null ? null : q.a[answers[i]],
        correct_answer:q.a[q.ok],
        is_correct: answers[i]===q.ok,
        explanation:q.why,
        source:q.source,
      }));
      const correct = details.filter(x=>x.is_correct).length;
      const score = Math.round(correct / EXAM.length * 100);
      const missedConcepts = [...new Set(details.filter(x=>!x.is_correct).map(x=>x.concept))];
      const duration = Math.round((Date.now()-started)/1000);
      const rows = details.map((r,i)=>`<details class="exam-review ${r.is_correct?'review-good':'review-bad'}"><summary>${r.is_correct?'✅':'❌'} السؤال ${i+1}: ${math(esc(r.question))}</summary><div class="review-body"><div>إجابتك: <b>${r.selected===null?'بدون إجابة':math(esc(r.selected))}</b></div><div>الإجابة الصحيحة: <b>${math(esc(r.correct_answer))}</b></div><div class="muted">${math(esc(r.explanation))}</div><div class="source-note">${esc(r.source)}</div></div></details>`).join('');

      examShell('📊 نتيجة الامتحان', `أجبت صح على ${correct} من ${EXAM.length}.`, `
        <section class="panel exam-result-summary">
          <div class="exam-score">${correct}/${EXAM.length}</div>
          <div class="stats"><div class="stat">النسبة<b>${score}%</b></div><div class="stat">صحيح<b>${correct}</b></div><div class="stat">خطأ/فارغ<b>${EXAM.length-correct}</b></div><div class="stat">المدة<b>${Math.max(1,Math.round(duration/60))} د</b></div></div>
          <div class="section-title">🎯 يحتاج مراجعة</div>
          <div class="concept-chips">${missedConcepts.length?missedConcepts.map(c=>`<span>${esc(c)}</span>`).join(''):'<span class="all-good">كل المفاهيم ممتازة 🎉</span>'}</div>
          <div id="examSaveState" class="muted">عم نحفظ نتيجة الامتحان…</div>
          <div class="actions"><button class="btn btn-primary" id="backToStudent">رجوع لصفحتي</button></div>
        </section>
        <section class="panel"><div class="section-title">🔎 مراجعة كل سؤال</div>${rows}</section>`);
      document.getElementById('backToStudent').onclick = ()=>{location.hash='student';location.reload();};

      try {
        const award = await familyApi('complete_quiz',{quiz_slug:'fractions-pages-54-57-exam',score,first_try_correct:correct,hints_used:0,delivery_mode:'exam'},token);
        await examApi({quiz_slug:'fractions-pages-54-57-exam',question_results:details},token).catch(()=>{});
        const el = document.getElementById('examSaveState');
        if(el) el.innerHTML = award.already_awarded ? '<div class="success">✅ النتيجة انحفظت.</div>' : `<div class="award-pop">🎉 النتيجة انحفظت — +${award.award.xp} XP و 🪙 +${award.award.reward_points} نقطة</div>`;
      } catch {
        const el = document.getElementById('examSaveState');
        if(el) el.innerHTML = '<div class="error">النتيجة ظاهرة، لكن صار خطأ بالحفظ. لا تعيد الامتحان الآن؛ خبر الأهل.</div>';
      }
    }

    renderQuestion();
  }

  // Detailed exam attempts in parent dashboard.
  async function addParentExamReport(){
    if(location.hash !== '#parents' || document.getElementById('parentExamReport')) return;
    const heading = document.querySelector('.hero h1');
    if(!heading || !heading.textContent.includes('لوحة الأهل')) return;
    const token = parentToken(); if(!token) return;
    try {
      const d = await familyApi('parent_dashboard',{},token);
      const learnerById = Object.fromEntries((d.learners||[]).map(l=>[l.id,l]));
      const exams = (d.attempts||[]).filter(a=>a.metadata?.delivery_mode==='exam' || Array.isArray(a.metadata?.question_results));
      const section = document.createElement('section');
      section.id='parentExamReport'; section.className='panel';
      if(!exams.length){ section.innerHTML='<div class="section-title">📝 تقارير الامتحانات</div><div class="empty">ما في امتحانات محفوظة بعد.</div>'; }
      else {
        section.innerHTML = `<div class="section-title">📝 تقارير الامتحانات</div>${exams.map(a=>{
          const l=learnerById[a.learner_id]; const rs=a.metadata?.question_results||[];
          return `<details class="parent-exam"><summary>${esc(l?.display_name||'طالب')} — ${Math.round(a.percentage||0)}% — ${a.submitted_at?new Date(a.submitted_at).toLocaleDateString('ar'):'—'}</summary><div class="review-body"><div>الصحيح: <b>${a.metadata?.correct_count??rs.filter(r=>r.is_correct).length}/${a.metadata?.total_count??rs.length||10}</b></div>${rs.map((r,i)=>`<div class="parent-exam-row">${r.is_correct?'✅':'❌'} ${i+1}. ${math(esc(r.question||''))}<br><span class="muted">إجابته: ${r.selected==null?'بدون إجابة':math(esc(r.selected))} · الصحيح: ${math(esc(r.correct_answer||''))}</span></div>`).join('')}</div></details>`;
        }).join('')}`;
      }
      const footer=document.querySelector('.footer-links'); (footer?.parentNode||document.getElementById('app'))?.insertBefore(section,footer||null);
    } catch {}
  }

  function sync(){
    fixStudentFooterLink();
    addModeCards();
    addParentExamReport();
  }
  function schedule(){
    if(syncQueued) return; syncQueued=true;
    queueMicrotask(()=>{syncQueued=false;sync();});
  }
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('hashchange',()=>setTimeout(schedule,50));
  document.addEventListener('DOMContentLoaded',schedule);
  schedule();
})();