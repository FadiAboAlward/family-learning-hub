(() => {
  const SUPABASE_URL='https://gkpoylfozvuwuwqeoduc.supabase.co';
  const PUBLISHABLE_KEY='sb_publishable_-ysUtue-9LpsJ8gabyrQaA_IaUf4F0W';
  const API=`${SUPABASE_URL}/functions/v1/student-library-api`;
  const safe=(s='')=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const token=()=>localStorage.getItem('learner_session')||sessionStorage.getItem('learner_session')||'';
  let cache=null,cacheSession='',activeSession='',requestSerial=0,loadingRequest=0,installQueued=false,lastRoot=null;

  async function load(session){if(!session)throw new Error('AUTH_REQUIRED');const r=await fetch(API,{method:'POST',headers:{'content-type':'application/json','apikey':PUBLISHABLE_KEY,'authorization':`Bearer ${session}`},body:JSON.stringify({action:'catalog'})});const d=await r.json().catch(()=>({error:'SERVER_ERROR'}));if(!r.ok)throw new Error(d.error||'SERVER_ERROR');return d;}
  function hideLegacy(){document.querySelectorAll('[data-dynamic-programs]').forEach(el=>{el.style.display='none';el.setAttribute('aria-hidden','true');});const old=document.getElementById('fractionQuiz');if(old)old.style.display='none';document.querySelectorAll('.section-title').forEach(el=>{if((el.textContent||'').includes('كويزاتك'))el.style.display='none';});}
  function contextBook(b){return [b.subject?.name_ar||'',b.grade_level?`الصف ${b.grade_level}`:'',b.school_year||''].filter(Boolean).join(' · ')}
  function isSupportBook(b){return b?.source_metadata?.support_source===true}
  function sourceBadge(b){if(!isSupportBook(b))return '';const official=b?.source_metadata?.publisher==='MEB'||b?.source_metadata?.official===true;return official?'مصدر داعم رسمي · MEB':'مصدر داعم'}
  function crumb(items){return `<div class="flh-breadcrumb">${items.map((x,i)=>i===items.length-1?`<span>${safe(x.label)}</span>`:`<button data-nav="${safe(x.nav)}">${safe(x.label)}</button><b>‹</b>`).join('')}</div>`}
  const journeyStates=new Set(['NEW','CONTINUE_LEARNING','START_EXAM','COMPLETE']);
  const resultIdOk=id=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id||''));
  function orderedQuizzes(rows){return rows.map((q,index)=>({q,index})).sort((a,b)=>{const rank=q=>q.journey?(q.journey.primary_action&&q.journey.state!=='COMPLETE'?0:q.journey.state==='COMPLETE'?1:2):0;return rank(a.q)-rank(b.q)||a.index-b.index;}).map(x=>x.q);}
  function journeyButton(q,action,label,primary=false,id=null){const attr=action==='results'?`data-result-attempt="${safe(id)}"`:`data-${action==='learning'?'learn':'exam'}="${safe(q.slug)}"`;return`<button class="btn ${primary?'btn-primary flh-journey-primary':'btn-soft'}" ${attr} ${primary?'data-journey-primary="1"':''}>${action==='learning'?'🧠':action==='exam'?'📝':'📘'} ${safe(label)}</button>`;}
  function modeButtons(q){
    const learning=q.delivery_config?.learning?.enabled!==false,exam=q.delivery_config?.exam?.enabled!==false,j=q.journey;
    // During an independent backend rollout, old catalog data retains its existing
    // mode choices. It is never labelled NEW without authoritative attempt data.
    if(!j)return `<div class="flh-mode-grid">${learning?`<button class="flh-mode learn" data-learn="${safe(q.slug)}"><span>🧠</span><b>${q.delivery_config?.support_session?'حلّ التمرين':'وضع التعلّم'}</b><small>${q.delivery_config?.support_session?'من الكتاب الداعم الرسمي · مع تلميحات وحفظ التقدم':'تلميحات وشرح أثناء الحل'}</small></button>`:''}${exam?`<button class="flh-mode exam" data-exam="${safe(q.slug)}"><span>📝</span><b>وضع الامتحان</b><small>بدون تلميحات، النتيجة بعد التسليم</small></button>`:''}</div>`;
    const canLearn=learning&&j.learning?.available===true,canExam=exam&&j.exam?.available===true;
    const action=journeyStates.has(j.state)&&((j.primary_action==='learning'&&canLearn)||(j.primary_action==='exam'&&canExam)||(j.primary_action==='results'&&resultIdOk(j.result_attempt_id)))?j.primary_action:null;
    const label=action==='learning'?(j.state==='CONTINUE_LEARNING'?'تابع التعلّم':q.delivery_config?.support_session?'ابدأ حلّ التمرين':'ابدأ التعلّم'):action==='exam'?(j.exam.resumed?'تابع الامتحان':'ابدأ الامتحان'):'عرض النتائج ومراجعة الأخطاء';
    const status={NEW:'جاهز للبدء',CONTINUE_LEARNING:'التعلّم قيد المتابعة',START_EXAM:j.exam?.resumed?'الامتحان قيد المتابعة':'جاهز للامتحان',COMPLETE:'مكتمل'};
    const alternatives=[];
    if(canLearn&&action!=='learning')alternatives.push(journeyButton(q,'learning',j.learning.resumed?'تابع التعلّم':'وضع التعلّم'));
    if(canExam&&action!=='exam')alternatives.push(journeyButton(q,'exam',j.exam.resumed?'تابع الامتحان':'وضع الامتحان'));
    if(resultIdOk(j.latest_result_attempt_id)&&j.latest_result_attempt_id!==j.result_attempt_id)alternatives.push(journeyButton(q,'results','مراجعة آخر نتيجة سابقة',false,j.latest_result_attempt_id));
    return`<div class="flh-journey" data-journey-state="${safe(action?j.state:'UNAVAILABLE')}"><div class="flh-journey-status">${safe(action?status[j.state]:'البدء غير متاح حاليًا')}</div>${action?journeyButton(q,action,label,true,j.result_attempt_id):'<p class="muted">لا يمكن بدء هذا النشاط الآن. اطلب من ولي الأمر مراجعة إتاحته.</p>'}${alternatives.length?`<details class="flh-journey-alternatives"><summary>خيارات الدراسة والمراجعة</summary><div class="flh-journey-options">${alternatives.join('')}</div></details>`:''}<p class="flh-journey-error muted" role="alert" hidden></p></div>`;
  }
  function invalidateCatalog(root,session=activeSession||token()){globalThis.FLHPerformance?.invalidateStudentCatalog?.(session);cache=null;cacheSession='';requestSerial++;loadingRequest=0;if(root)delete root.dataset.libraryReady;}
  function bindModes(root){
    window.FLH?.warmExamApi?.();const session=activeSession;
    const current=()=>root.isConnected&&token()===session&&activeSession===session;
    for(const [selector,method,attr]of [['[data-learn]','startLearningQuiz','data-learn'],['[data-exam]','startExamQuiz','data-exam']])root.querySelectorAll(selector).forEach(b=>b.addEventListener('click',()=>{if(!current()){reset();return;}const starter=window.FLH?.[method];if(typeof starter!=='function')return;invalidateCatalog(root);starter(b.getAttribute(attr)||'');}));
    root.querySelectorAll('[data-result-attempt]').forEach(b=>b.addEventListener('click',async()=>{if(!current()){reset();return;}const opener=window.FLH?.openAttemptHistoryAttempt;if(typeof opener!=='function')return;const box=b.closest('.flh-journey')?.querySelector('.flh-journey-error');b.disabled=true;if(box)box.hidden=true;try{if(await opener(b.getAttribute('data-result-attempt'))===false)throw Error('RESULT_UNAVAILABLE');}catch{if(current()&&box){box.textContent='تعذر فتح النتيجة الآن. جرّب مرة أخرى.';box.hidden=false;}}finally{if(current())b.disabled=false;}}));
  }
  function bindNav(root,handlers){root.querySelectorAll('[data-nav]').forEach(b=>b.addEventListener('click',()=>handlers[b.getAttribute('data-nav')]?.()));}

  function renderHome(root,d){
    const programs=d.programs||[],standalone=d.standalone_books||[],assessments=orderedQuizzes(d.standalone_assessments||[]);
    root.innerHTML=`<div class="flh-library-head"><div><b>📚 مكتبتي</b><div class="muted">اختَر المنهاج أو الكتاب، وبعدها الوحدة والنشاط التالي.</div></div><button class="btn btn-soft" id="flhLibraryRefresh">تحديث الأنشطة</button></div>
      ${programs.length?`<div class="flh-library-title">🎓 مناهجي وكورساتي</div><div class="flh-card-grid">${programs.map((p,i)=>`<button class="flh-library-card" data-open-program="${i}"><span class="flh-card-icon">${p.program_type==='curriculum'?'🏫':'🎯'}</span><b>${safe(p.title)}</b><small>${[p.grade_level?`الصف ${p.grade_level}`:'',p.school_year||'',`${(p.books||[]).length} كتاب`].filter(Boolean).join(' · ')}</small>${p.is_primary?'<em>البرنامج الأساسي</em>':''}</button>`).join('')}</div>`:''}
      ${standalone.length?`<div class="flh-library-title">📖 كتبي المستقلة</div><div class="flh-card-grid">${standalone.map((b,i)=>`<button class="flh-library-card" data-open-standalone="${i}"><span class="flh-card-icon">📘</span><b>${safe(b.title)}</b><small>${safe(contextBook(b)||'كتاب مستقل')}</small></button>`).join('')}</div>`:''}
      ${assessments.length?`<div class="flh-library-title">🎯 أنشطتي المخصصة</div>${assessments.map(q=>`<div class="flh-activity-card"><b>${safe(q.title)}</b>${q.description?`<div class="muted">${safe(q.description)}</div>`:''}${modeButtons(q)}</div>`).join('')}`:''}
      ${!programs.length&&!standalone.length&&!assessments.length?'<div class="empty">ما في محتوى مربوط بحسابك بعد. اطلب من ولي الأمر يضيف لك منهاجًا أو كتابًا.</div>':''}`;
    root.querySelector('#flhLibraryRefresh')?.addEventListener('click',()=>{invalidateCatalog(root);install();});
    root.querySelectorAll('[data-open-program]').forEach(b=>b.addEventListener('click',()=>renderProgram(root,programs[Number(b.getAttribute('data-open-program'))],d)));
    root.querySelectorAll('[data-open-standalone]').forEach(b=>b.addEventListener('click',()=>renderBook(root,standalone[Number(b.getAttribute('data-open-standalone'))],d,null)));
    bindModes(root);
  }

  function renderProgram(root,p,d){
    const books=p.books||[],core=books.filter(b=>!isSupportBook(b)),support=books.filter(isSupportBook);
    const cards=(rows,kind)=>rows.length?`<div class="flh-card-grid">${rows.map(b=>{const i=books.findIndex(v=>String(v.id)===String(b.id));return `<button class="flh-library-card book ${kind==='support'?'support':''}" data-book="${i}" data-book-id="${safe(b.id)}"><span class="flh-card-icon">${kind==='support'?'🧩':'📘'}</span><b>${safe(b.title)}</b><small>${safe(contextBook(b))}</small>${kind==='support'?`<em>${safe(sourceBadge(b))}</em>`:`<em>${(b.units||[]).length} وحدة</em>`}</button>`}).join('')}</div>`:'';
    root.innerHTML=`${crumb([{label:'مكتبتي',nav:'home'},{label:p.title,nav:'current'}])}<div class="flh-page-title"><span>${p.program_type==='curriculum'?'🏫':'🎯'}</span><div><b>${safe(p.title)}</b><small>${[p.grade_level?`الصف ${p.grade_level}`:'',p.school_year||''].filter(Boolean).join(' · ')}</small></div></div>${core.length?`<div class="flh-library-title">📘 الكتب الأساسية</div>${cards(core,'core')}`:''}${support.length?`<div class="flh-library-title">🧩 كتب داعمة رسمية</div><div class="muted flh-support-note">هذه مصادر تدريب إضافية ولا تستبدل الكتاب الأساسي أو ترتيب المنهج.</div>${cards(support,'support')}`:''}${!books.length?'<div class="empty">ما في كتب مضافة لهذا البرنامج بعد.</div>':''}`;
    bindNav(root,{home:()=>renderHome(root,d)});
    root.querySelectorAll('[data-book-id]').forEach(x=>x.addEventListener('click',()=>{const b=books.find(v=>String(v.id)===x.getAttribute('data-book-id'));if(b)renderBook(root,b,d,p);}));
  }

  function renderBook(root,b,d,p){const units=b.units||[],extras=orderedQuizzes(b.extras||[]);root.innerHTML=`${crumb([{label:'مكتبتي',nav:'home'},...(p?[{label:p.title,nav:'program'}]:[]),{label:b.title,nav:'current'}])}<div class="flh-page-title"><span>${isSupportBook(b)?'🧩':'📘'}</span><div><b>${safe(b.title)}</b><small>${safe(contextBook(b))}</small>${isSupportBook(b)?`<em class="mode-tag">${safe(sourceBadge(b))}</em>`:''}</div></div><div class="flh-library-title">اختَر الوحدة</div>${units.length?`<div class="flh-unit-list">${units.map((u,i)=>`<button class="flh-unit-card" data-unit="${i}"><span class="flh-unit-no">${i+1}</span><div><b>${safe(u.title)}</b><small>${(u.quizzes||[]).length?`${u.quizzes.length} نشاط متاح`:'المحتوى قيد الإعداد'}</small></div><span>‹</span></button>`).join('')}</div>`:'<div class="empty">ما في وحدات مضافة لهذا الكتاب بعد.</div>'}${extras.length?`<div class="flh-library-title">✨ تدريبات إضافية</div>${extras.map(q=>`<div class="flh-activity-card"><b>${safe(q.title)}</b><div class="muted">${safe(q.description||'تدريب إضافي')}</div>${modeButtons(q)}</div>`).join('')}`:''}`;bindNav(root,{home:()=>renderHome(root,d),program:()=>renderProgram(root,p,d)});root.querySelectorAll('[data-unit]').forEach(x=>x.addEventListener('click',()=>renderUnit(root,b,units[Number(x.getAttribute('data-unit'))],d,p)));bindModes(root);}

  function renderUnit(root,b,u,d,p){const qs=orderedQuizzes(u.quizzes||[]);root.innerHTML=`${crumb([{label:'مكتبتي',nav:'home'},...(p?[{label:p.title,nav:'program'}]:[]),{label:b.title,nav:'book'},{label:u.title,nav:'current'}])}<div class="flh-page-title"><span>📗</span><div><b>${safe(u.title)}</b><small>${safe(b.title)}</small></div></div>${qs.length?qs.map(q=>`<div class="flh-activity-card"><b>${safe(q.title)}</b>${q.description?`<div class="muted">${safe(q.description)}</div>`:''}${modeButtons(q)}</div>`).join(''):'<div class="empty">ما في تدريب منشور لهذه الوحدة بعد.</div>'}`;bindNav(root,{home:()=>renderHome(root,d),program:()=>renderProgram(root,p,d),book:()=>renderBook(root,b,d,p)});bindModes(root);}

  function syncSession(root,session){
    if(activeSession===session)return;
    activeSession=session;
    invalidateCatalog(root,session);
  }
  async function install(){
    // A Learning/Exam/deep-link shell replaces the library. Returning Home must
    // reload progress even when the learner session and URL hash did not change.
    if(lastRoot&&!lastRoot.isConnected){invalidateCatalog();lastRoot=null;}
    if(location.hash!=='#student')return;
    const session=token();
    let root=document.querySelector('[data-student-library]');
    if(!session){syncSession(root,'');if(root)root.replaceChildren();return;}
    const hero=document.querySelector('.hero h1');
    if(!hero||(hero.textContent||'').trim().indexOf('أهلًا')!==0)return;
    hideLegacy();
    if(!root){root=document.createElement('section');root.className='panel flh-student-library';root.dataset.studentLibrary='1';const progress=document.querySelector('#app .hero + .panel');if(progress)progress.insertAdjacentElement('afterend',root);else document.querySelector('#app .panel')?.insertAdjacentElement('beforebegin',root);}
    if(!root)return;
    lastRoot=root;
    syncSession(root,session);
    if(root.dataset.libraryReady==='1'&&cache&&cacheSession===session)return;
    if(cache&&cacheSession===session){renderHome(root,cache);root.dataset.libraryReady='1';return;}
    if(loadingRequest)return;
    const requestId=++requestSerial;
    loadingRequest=requestId;
    root.innerHTML='<div class="loading-card">جارٍ ترتيب مكتبتك…</div>';
    try{
      const data=await load(session);
      if(requestId!==requestSerial||activeSession!==session||token()!==session||!root.isConnected)return;
      cache=data;
      cacheSession=session;
      renderHome(root,cache);
      root.dataset.libraryReady='1';
    }
    catch{
      if(requestId===requestSerial&&activeSession===session&&token()===session&&root.isConnected){root.innerHTML='<div class="error" role="alert">تعذر تحميل مكتبتك وتقدّم أنشطتك الآن.</div><button class="btn btn-soft" id="flhLibraryRetry">إعادة المحاولة</button>';root.querySelector('#flhLibraryRetry')?.addEventListener('click',()=>{invalidateCatalog(root);install();});}
    }
    finally{if(loadingRequest===requestId)loadingRequest=0;}
  }
  function scheduleInstall(){if(installQueued)return;installQueued=true;requestAnimationFrame(()=>{installQueued=false;install();});}
  function reset(){const root=document.querySelector('[data-student-library]');invalidateCatalog(root);activeSession='';if(root)root.replaceChildren();setTimeout(install,30)}
  const appRoot=document.getElementById('app');
  if(appRoot){const observer=new MutationObserver(records=>{if(records.some(r=>!r.target.closest?.('[data-student-library]')))scheduleInstall();});observer.observe(appRoot,{childList:true,subtree:true});}
  window.addEventListener('hashchange',reset);window.addEventListener('storage',e=>{if(e.key==='learner_session')reset();});document.addEventListener('DOMContentLoaded',install,{once:true});install();
})();
