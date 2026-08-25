(() => {
  const SUPABASE_URL='https://gkpoylfozvuwuwqeoduc.supabase.co';
  const PUBLISHABLE_KEY='sb_publishable_-ysUtue-9LpsJ8gabyrQaA_IaUf4F0W';
  const API=`${SUPABASE_URL}/functions/v1/student-library-api`;
  const safe=(s='')=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
  const token=()=>localStorage.getItem('learner_session')||sessionStorage.getItem('learner_session')||'';
  let loading=false,cache=null;

  async function load(){
    const t=token();
    if(!t)throw new Error('AUTH_REQUIRED');
    const r=await fetch(API,{method:'POST',headers:{'content-type':'application/json','apikey':PUBLISHABLE_KEY,'authorization':`Bearer ${t}`},body:JSON.stringify({action:'catalog'})});
    const d=await r.json().catch(()=>({error:'SERVER_ERROR'}));
    if(!r.ok)throw new Error(d.error||'SERVER_ERROR');
    return d;
  }

  function onStudentHome(){
    if(location.hash!=='#student')return false;
    const hero=document.querySelector('.hero h1');
    return !!hero&&(hero.textContent||'').trim().startsWith('أهلًا');
  }

  function profile(){
    try{return typeof state!=='undefined'?state.learnerProfile:null}catch{return null}
  }

  function learnerKey(){
    const slug=profile()?.learner?.slug||'learner';
    return `flh_last_activity_${slug}`;
  }

  function setChildChrome(){
    document.body.classList.toggle('flh-child-mode',location.hash==='#student');
    if(!onStudentHome())return;
    const hero=document.querySelector('.hero');
    const p=hero?.querySelector('p');
    const copy='جاهز نكمّل؟ اختر نشاطك وابدأ.';
    if(p&&p.textContent!==copy)p.textContent=copy;
    document.querySelectorAll('#app > .panel:not(.flh-student-library)').forEach(panel=>{
      if(panel.querySelector('.stats,.badge-row,.reward-card')||[...panel.querySelectorAll('.section-title')].some(x=>/(أوسمتك|المكافآت|كويزاتك)/.test(x.textContent||''))){
        panel.classList.add('flh-legacy-student-panel');
        panel.setAttribute('aria-hidden','true');
      }
    });
  }

  function hideLegacy(){
    setChildChrome();
    if(!onStudentHome())return;
    document.querySelectorAll('[data-dynamic-programs]').forEach(el=>{el.style.display='none';el.setAttribute('aria-hidden','true');});
    const old=document.getElementById('fractionQuiz');
    if(old)old.style.display='none';
  }

  function contextBook(b){return [b.subject?.name_ar||'',b.grade_level?`الصف ${b.grade_level}`:''].filter(Boolean).join(' · ')}
  function subjectName(b){return b.subject?.name_ar||b.title||'مادة'}
  function subjectIcon(b){
    const s=subjectName(b);
    if(/رياض/.test(s))return'🧮';
    if(/عرب|لغتي/.test(s))return'📚';
    if(/علوم/.test(s))return'🔬';
    if(/إنج|English/i.test(s))return'🔤';
    if(/ترك|Türk/i.test(s))return'🗣️';
    if(/شطرنج/.test(s))return'♟️';
    return'📘';
  }

  function allQuizzes(d){
    const list=[];
    const addBook=b=>{
      (b.units||[]).forEach(u=>(u.quizzes||[]).forEach(q=>list.push({q,b,u})));
      (b.extras||[]).forEach(q=>list.push({q,b,u:null}));
    };
    (d.programs||[]).forEach(p=>(p.books||[]).forEach(addBook));
    (d.standalone_books||[]).forEach(addBook);
    return list;
  }

  function getLast(d){
    try{
      const saved=JSON.parse(localStorage.getItem(learnerKey())||'null');
      if(!saved?.slug)return null;
      const found=allQuizzes(d).find(x=>x.q.slug===saved.slug);
      return found?{...saved,...found}:null;
    }catch{return null}
  }

  function remember(q,mode,b,u){
    try{localStorage.setItem(learnerKey(),JSON.stringify({slug:q.slug,title:q.title||'نشاط',mode,bookTitle:subjectName(b),unitTitle:u?.title||'',ts:Date.now()}));}catch{}
  }

  function startQuiz(q,mode,b,u){
    if(!q?.slug)return;
    remember(q,mode,b,u);
    if(mode==='exam')window.FLH?.startExamQuiz?.(q.slug);
    else window.FLH?.startLearningQuiz?.(q.slug);
  }

  function backBar(label='مكتبتي'){return `<div class="flh-child-topbar"><button class="flh-back-btn" data-nav="back">→ ${safe(label)}</button></div>`}

  function modeButtons(q,b,u){
    return `<div class="flh-mode-grid"><button class="flh-mode learn" data-learn="${safe(q.slug)}"><span>🧠</span><b>ابدأ التعلّم</b><small>شرح ومساعدة أثناء الحل</small></button><button class="flh-mode exam" data-exam="${safe(q.slug)}"><span>📝</span><b>اختبار</b><small>حلّ وحدك ثم شوف النتيجة</small></button></div>`;
  }

  function bindModes(root,quizLookup){
    root.querySelectorAll('[data-learn]').forEach(btn=>btn.addEventListener('click',()=>{
      const item=quizLookup.get(btn.getAttribute('data-learn'));
      if(item)startQuiz(item.q,'learn',item.b,item.u);
    }));
    root.querySelectorAll('[data-exam]').forEach(btn=>btn.addEventListener('click',()=>{
      const item=quizLookup.get(btn.getAttribute('data-exam'));
      if(item)startQuiz(item.q,'exam',item.b,item.u);
    }));
  }

  function miniProgress(){
    const p=profile(),g=p?.gamification||{};
    return `<div class="flh-mini-progress"><div class="flh-mini-name"><span>${safe(p?.learner?.avatar_emoji||'🌟')}</span><b>رحلتي</b></div><div class="flh-mini-score"><span title="النقاط">⭐ ${Number(g.xp||0)}</span>${Number(g.current_streak||0)>0?`<span title="السلسلة">🔥 ${Number(g.current_streak)}</span>`:''}</div><button class="flh-achievement-link" data-achievements>🏆 إنجازاتي</button></div>`;
  }

  function renderAchievements(root,d){
    const p=profile(),g=p?.gamification||{},badges=g.badges||[],rewards=g.rewards||[];
    root.innerHTML=`${backBar('مكتبتي')}<div class="flh-child-page-title"><span>🏆</span><div><b>إنجازاتي</b><small>كل خطوة تتعلّمها محسوبة.</small></div></div><div class="flh-achievement-section"><h3>أوسمتي</h3>${badges.length?`<div class="flh-achievement-grid">${badges.map(x=>`<div class="flh-achievement-card"><span>${safe(x.badge?.icon||'🏅')}</span><b>${safe(x.badge?.title||'وسام')}</b><small>${safe(x.award_reason||'')}</small></div>`).join('')}</div>`:'<div class="empty">أول وسام لسه بالطريق 🏅</div>'}</div><div class="flh-achievement-section"><h3>مكافآتي</h3>${rewards.length?`<div class="flh-reward-list">${rewards.map(r=>`<div class="flh-reward-row"><span>🎁</span><div><b>${safe(r.title)}</b><small>${r.required_reward_points?`${Number(r.required_reward_points)} نقطة`:''}</small></div></div>`).join('')}</div>`:'<div class="empty">لا توجد مكافآت مضافة حاليًا.</div>'}</div>`;
    root.querySelector('[data-nav="back"]')?.addEventListener('click',()=>renderHome(root,d));
  }

  function renderHome(root,d){
    hideLegacy();
    const programs=d.programs||[],standalone=d.standalone_books||[];
    const primary=programs.find(p=>p.is_primary)||null;
    const otherPrograms=programs.filter(p=>p!==primary);
    const directBooks=primary?.books||[];
    const last=getLast(d);

    root.innerHTML=`${miniProgress()}${last?`<button class="flh-continue-card" data-continue><span class="flh-continue-icon">▶</span><div><small>نكمل من آخر مرة؟</small><b>${safe(last.title||last.q.title)}</b><span>${safe([last.bookTitle||subjectName(last.b),last.unitTitle||last.u?.title].filter(Boolean).join(' · '))}</span></div><strong>كمّل</strong></button>`:`<div class="flh-start-prompt"><span>✨</span><div><b>شو حابب تتعلّم اليوم؟</b><small>اختر مادة من تحت.</small></div></div>`}
      ${directBooks.length?`<div class="flh-library-title">موادي</div><div class="flh-subject-grid">${directBooks.map((b,i)=>`<button class="flh-subject-card" data-primary-book="${i}"><span class="flh-subject-icon">${subjectIcon(b)}</span><b>${safe(subjectName(b))}</b><small>${(b.units||[]).filter(u=>(u.quizzes||[]).length).length} وحدات جاهزة</small></button>`).join('')}</div>`:''}
      ${!directBooks.length&&programs.length?`<div class="flh-library-title">مساراتي</div><div class="flh-card-grid">${programs.map((p,i)=>`<button class="flh-library-card" data-open-program="${i}"><span class="flh-card-icon">${p.program_type==='curriculum'?'🏫':'🎯'}</span><b>${safe(p.title)}</b><small>${(p.books||[]).length} مواد</small></button>`).join('')}</div>`:''}
      ${otherPrograms.length&&directBooks.length?`<div class="flh-library-title small">مسارات أخرى</div><div class="flh-secondary-list">${otherPrograms.map((p,i)=>`<button data-open-other-program="${i}"><span>${p.program_type==='curriculum'?'🏫':'🎯'}</span><b>${safe(p.title)}</b><span>‹</span></button>`).join('')}</div>`:''}
      ${standalone.length?`<div class="flh-library-title small">أنشطة أخرى</div><div class="flh-subject-grid secondary">${standalone.map((b,i)=>`<button class="flh-subject-card" data-open-standalone="${i}"><span class="flh-subject-icon">${subjectIcon(b)}</span><b>${safe(subjectName(b))}</b><small>${safe(contextBook(b)||'نشاط مستقل')}</small></button>`).join('')}</div>`:''}
      ${!programs.length&&!standalone.length?'<div class="empty">ما في محتوى مربوط بحسابك بعد. اطلب من ولي الأمر يضيف لك منهاجًا أو كتابًا.</div>':''}`;

    root.querySelector('[data-achievements]')?.addEventListener('click',()=>renderAchievements(root,d));
    root.querySelector('[data-continue]')?.addEventListener('click',()=>startQuiz(last.q,last.mode==='exam'?'exam':'learn',last.b,last.u));
    root.querySelectorAll('[data-primary-book]').forEach(btn=>btn.addEventListener('click',()=>renderBook(root,directBooks[Number(btn.getAttribute('data-primary-book'))],d,primary)));
    root.querySelectorAll('[data-open-program]').forEach(btn=>btn.addEventListener('click',()=>renderProgram(root,programs[Number(btn.getAttribute('data-open-program'))],d)));
    root.querySelectorAll('[data-open-other-program]').forEach(btn=>btn.addEventListener('click',()=>renderProgram(root,otherPrograms[Number(btn.getAttribute('data-open-other-program'))],d)));
    root.querySelectorAll('[data-open-standalone]').forEach(btn=>btn.addEventListener('click',()=>renderBook(root,standalone[Number(btn.getAttribute('data-open-standalone'))],d,null)));
  }

  function renderProgram(root,p,d){
    root.innerHTML=`${backBar('مكتبتي')}<div class="flh-child-page-title"><span>${p.program_type==='curriculum'?'🏫':'🎯'}</span><div><b>${safe(p.title)}</b><small>${p.grade_level?`الصف ${safe(p.grade_level)}`:''}</small></div></div><div class="flh-library-title">اختر مادة</div>${(p.books||[]).length?`<div class="flh-subject-grid">${p.books.map((b,i)=>`<button class="flh-subject-card" data-book="${i}"><span class="flh-subject-icon">${subjectIcon(b)}</span><b>${safe(subjectName(b))}</b><small>${(b.units||[]).length} وحدات</small></button>`).join('')}</div>`:'<div class="empty">ما في كتب مضافة لهذا المسار بعد.</div>'}`;
    root.querySelector('[data-nav="back"]')?.addEventListener('click',()=>renderHome(root,d));
    root.querySelectorAll('[data-book]').forEach(btn=>btn.addEventListener('click',()=>renderBook(root,p.books[Number(btn.getAttribute('data-book'))],d,p)));
  }

  function renderBook(root,b,d,p){
    const units=b.units||[],extras=b.extras||[];
    const lookup=new Map();
    units.forEach(u=>(u.quizzes||[]).forEach(q=>lookup.set(q.slug,{q,b,u})));
    extras.forEach(q=>lookup.set(q.slug,{q,b,u:null}));

    root.innerHTML=`${backBar(p?.is_primary?'مكتبتي':(p?.title||'مكتبتي'))}<div class="flh-child-page-title subject"><span>${subjectIcon(b)}</span><div><b>${safe(subjectName(b))}</b><small>${safe(b.title)}</small></div></div><div class="flh-library-title">اختر الوحدة</div>${units.length?`<div class="flh-unit-list">${units.map((u,i)=>{const qs=u.quizzes||[],ready=qs.length>0;return `<div class="flh-unit-row ${ready?'ready':'pending'}"><button class="flh-unit-main" data-unit="${i}" ${ready?'':'disabled'}><span class="flh-unit-no">${i+1}</span><div><b>${safe(u.title)}</b><small>${ready?(qs.length===1?'جاهزة للتعلّم':`${qs.length} أنشطة`):'قريبًا'}</small></div><span class="flh-unit-go">${ready?'ابدأ':'—'}</span></button>${ready&&qs.length===1?`<button class="flh-unit-exam" data-unit-exam="${i}">📝 اختبار</button>`:''}</div>`}).join('')}</div>`:'<div class="empty">ما في وحدات مضافة لهذا الكتاب بعد.</div>'}${extras.length?`<div class="flh-library-title small">تدريبات إضافية</div>${extras.map(q=>`<div class="flh-activity-card"><b>${safe(q.title)}</b>${modeButtons(q,b,null)}</div>`).join('')}`:''}`;

    root.querySelector('[data-nav="back"]')?.addEventListener('click',()=>p&&!p.is_primary?renderProgram(root,p,d):renderHome(root,d));
    root.querySelectorAll('[data-unit]').forEach(btn=>btn.addEventListener('click',()=>{
      const u=units[Number(btn.getAttribute('data-unit'))],qs=u?.quizzes||[];
      if(qs.length===1)startQuiz(qs[0],'learn',b,u);
      else if(qs.length>1)renderUnit(root,b,u,d,p);
    }));
    root.querySelectorAll('[data-unit-exam]').forEach(btn=>btn.addEventListener('click',()=>{
      const u=units[Number(btn.getAttribute('data-unit-exam'))],q=u?.quizzes?.[0];
      if(q)startQuiz(q,'exam',b,u);
    }));
    bindModes(root,lookup);
  }

  function renderUnit(root,b,u,d,p){
    const qs=u.quizzes||[],lookup=new Map(qs.map(q=>[q.slug,{q,b,u}]));
    root.innerHTML=`${backBar(subjectName(b))}<div class="flh-child-page-title"><span>📗</span><div><b>${safe(u.title)}</b><small>${safe(subjectName(b))}</small></div></div>${qs.length?qs.map(q=>`<div class="flh-activity-card"><b>${safe(q.title)}</b>${q.description?`<div class="muted">${safe(q.description)}</div>`:''}${modeButtons(q,b,u)}</div>`).join(''):'<div class="empty">ما في تدريب منشور لهذه الوحدة بعد.</div>'}`;
    root.querySelector('[data-nav="back"]')?.addEventListener('click',()=>renderBook(root,b,d,p));
    bindModes(root,lookup);
  }

  async function install(){
    setChildChrome();
    if(location.hash!=='#student'||!token())return;
    if(!onStudentHome())return;
    hideLegacy();
    let root=document.querySelector('[data-student-library]');
    if(root?.dataset.libraryReady==='1')return;
    if(!root){
      root=document.createElement('section');
      root.className='panel flh-student-library';
      root.dataset.studentLibrary='1';
      const legacyPanels=[...document.querySelectorAll('#app > .panel')];
      const firstLegacy=legacyPanels.find(x=>x.classList.contains('flh-legacy-student-panel'));
      if(firstLegacy)firstLegacy.insertAdjacentElement('afterend',root);
      else document.querySelector('#app .hero')?.insertAdjacentElement('afterend',root);
    }
    if(!root||loading)return;
    if(cache){renderHome(root,cache);root.dataset.libraryReady='1';return;}
    loading=true;
    root.innerHTML='<div class="loading-card">جارِ ترتيب أنشطتك…</div>';
    try{cache=await load();renderHome(root,cache);root.dataset.libraryReady='1';}
    catch{root.innerHTML='<div class="error">تعذر تحميل أنشطتك. جرّب تحديث الصفحة.</div>';}
    finally{loading=false;}
  }

  function reset(){
    cache=null;
    document.body.classList.toggle('flh-child-mode',location.hash==='#student');
    setTimeout(install,30);
  }

  const observer=new MutationObserver(()=>{setChildChrome();hideLegacy();install();});
  observer.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('hashchange',reset);
  document.addEventListener('DOMContentLoaded',install);
  install();
})();
