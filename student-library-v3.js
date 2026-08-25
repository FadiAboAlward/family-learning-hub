(() => {
  const SUPABASE_URL='https://gkpoylfozvuwuwqeoduc.supabase.co';
  const PUBLISHABLE_KEY='sb_publishable_-ysUtue-9LpsJ8gabyrQaA_IaUf4F0W';
  const API=`${SUPABASE_URL}/functions/v1/student-library-api`;
  const safe=(s='')=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const token=()=>localStorage.getItem('learner_session')||sessionStorage.getItem('learner_session')||'';
  let loading=false,cache=null;

  async function load(){const t=token();if(!t)throw new Error('AUTH_REQUIRED');const r=await fetch(API,{method:'POST',headers:{'content-type':'application/json','apikey':PUBLISHABLE_KEY,'authorization':`Bearer ${t}`},body:JSON.stringify({action:'catalog'})});const d=await r.json().catch(()=>({error:'SERVER_ERROR'}));if(!r.ok)throw new Error(d.error||'SERVER_ERROR');return d;}
  function hideLegacy(){document.querySelectorAll('[data-dynamic-programs]').forEach(el=>{el.style.display='none';el.setAttribute('aria-hidden','true');});const old=document.getElementById('fractionQuiz');if(old)old.style.display='none';document.querySelectorAll('.section-title').forEach(el=>{if((el.textContent||'').includes('كويزاتك'))el.style.display='none';});}
  function contextBook(b){return [b.subject?.name_ar||'',b.grade_level?`الصف ${b.grade_level}`:'',b.school_year||''].filter(Boolean).join(' · ')}
  function crumb(items){return `<div class="flh-breadcrumb">${items.map((x,i)=>i===items.length-1?`<span>${safe(x.label)}</span>`:`<button data-nav="${safe(x.nav)}">${safe(x.label)}</button><b>‹</b>`).join('')}</div>`}
  function modeButtons(q){return `<div class="flh-mode-grid"><button class="flh-mode learn" data-learn="${safe(q.slug)}"><span>🧠</span><b>وضع التعلّم</b><small>تلميحات وشرح أثناء الحل</small></button><button class="flh-mode exam" data-exam="${safe(q.slug)}"><span>📝</span><b>وضع الامتحان</b><small>بدون تلميحات، النتيجة بعد التسليم</small></button></div>`}
  function bindModes(root){window.FLH?.warmExamApi?.();root.querySelectorAll('[data-learn]').forEach(b=>b.addEventListener('click',()=>window.FLH?.startLearningQuiz?.(b.getAttribute('data-learn')||'')));root.querySelectorAll('[data-exam]').forEach(b=>b.addEventListener('click',()=>window.FLH?.startExamQuiz?.(b.getAttribute('data-exam')||'')));}
  function bindNav(root,handlers){root.querySelectorAll('[data-nav]').forEach(b=>b.addEventListener('click',()=>handlers[b.getAttribute('data-nav')]?.()));}

  function renderHome(root,d){const programs=d.programs||[],standalone=d.standalone_books||[];root.innerHTML=`<div class="flh-library-head"><div><b>📚 مكتبتي</b><div class="muted">اختَر المنهاج أو الكتاب، وبعدها الوحدة وطريقة الدراسة.</div></div></div>${programs.length?`<div class="flh-library-title">🎓 مناهجي وكورساتي</div><div class="flh-card-grid">${programs.map((p,i)=>`<button class="flh-library-card" data-open-program="${i}"><span class="flh-card-icon">${p.program_type==='curriculum'?'🏫':'🎯'}</span><b>${safe(p.title)}</b><small>${[p.grade_level?`الصف ${p.grade_level}`:'',p.school_year||'',`${(p.books||[]).length} كتاب`].filter(Boolean).join(' · ')}</small>${p.is_primary?'<em>البرنامج الأساسي</em>':''}</button>`).join('')}</div>`:''}${standalone.length?`<div class="flh-library-title">📖 كتبي المستقلة</div><div class="flh-card-grid">${standalone.map((b,i)=>`<button class="flh-library-card" data-open-standalone="${i}"><span class="flh-card-icon">📘</span><b>${safe(b.title)}</b><small>${safe(contextBook(b)||'كتاب مستقل')}</small></button>`).join('')}</div>`:''}${!programs.length&&!standalone.length?'<div class="empty">ما في محتوى مربوط بحسابك بعد. اطلب من ولي الأمر يضيف لك منهاجًا أو كتابًا.</div>':''}`;root.querySelectorAll('[data-open-program]').forEach(b=>b.addEventListener('click',()=>renderProgram(root,programs[Number(b.getAttribute('data-open-program'))],d)));root.querySelectorAll('[data-open-standalone]').forEach(b=>b.addEventListener('click',()=>renderBook(root,standalone[Number(b.getAttribute('data-open-standalone'))],d,null)));}

  function renderProgram(root,p,d){root.innerHTML=`${crumb([{label:'مكتبتي',nav:'home'},{label:p.title,nav:'current'}])}<div class="flh-page-title"><span>${p.program_type==='curriculum'?'🏫':'🎯'}</span><div><b>${safe(p.title)}</b><small>${[p.grade_level?`الصف ${p.grade_level}`:'',p.school_year||''].filter(Boolean).join(' · ')}</small></div></div><div class="flh-library-title">اختَر الكتاب</div>${(p.books||[]).length?`<div class="flh-card-grid">${p.books.map((b,i)=>`<button class="flh-library-card book" data-book="${i}"><span class="flh-card-icon">📘</span><b>${safe(b.title)}</b><small>${safe(contextBook(b))}</small><em>${(b.units||[]).length} وحدة</em></button>`).join('')}</div>`:'<div class="empty">ما في كتب مضافة لهذا البرنامج بعد.</div>'}`;bindNav(root,{home:()=>renderHome(root,d)});root.querySelectorAll('[data-book]').forEach(b=>b.addEventListener('click',()=>renderBook(root,p.books[Number(b.getAttribute('data-book'))],d,p)));}

  function renderBook(root,b,d,p){const units=b.units||[],extras=b.extras||[];root.innerHTML=`${crumb([{label:'مكتبتي',nav:'home'},...(p?[{label:p.title,nav:'program'}]:[]),{label:b.title,nav:'current'}])}<div class="flh-page-title"><span>📘</span><div><b>${safe(b.title)}</b><small>${safe(contextBook(b))}</small></div></div><div class="flh-library-title">اختَر الوحدة</div>${units.length?`<div class="flh-unit-list">${units.map((u,i)=>`<button class="flh-unit-card" data-unit="${i}"><span class="flh-unit-no">${i+1}</span><div><b>${safe(u.title)}</b><small>${(u.quizzes||[]).length?`${u.quizzes.length} نشاط متاح`:'المحتوى قيد الإعداد'}</small></div><span>‹</span></button>`).join('')}</div>`:'<div class="empty">ما في وحدات مضافة لهذا الكتاب بعد.</div>'}${extras.length?`<div class="flh-library-title">✨ تدريبات إضافية</div>${extras.map(q=>`<div class="flh-activity-card"><b>${safe(q.title)}</b><div class="muted">${safe(q.description||'تدريب إضافي')}</div>${modeButtons(q)}</div>`).join('')}`:''}`;bindNav(root,{home:()=>renderHome(root,d),program:()=>renderProgram(root,p,d)});root.querySelectorAll('[data-unit]').forEach(x=>x.addEventListener('click',()=>renderUnit(root,b,units[Number(x.getAttribute('data-unit'))],d,p)));bindModes(root);}

  function renderUnit(root,b,u,d,p){const qs=u.quizzes||[];root.innerHTML=`${crumb([{label:'مكتبتي',nav:'home'},...(p?[{label:p.title,nav:'program'}]:[]),{label:b.title,nav:'book'},{label:u.title,nav:'current'}])}<div class="flh-page-title"><span>📗</span><div><b>${safe(u.title)}</b><small>${safe(b.title)}</small></div></div>${qs.length?qs.map(q=>`<div class="flh-activity-card"><b>${safe(q.title)}</b>${q.description?`<div class="muted">${safe(q.description)}</div>`:''}<div class="flh-mode-question">كيف بدك تشتغل على هالوحدة؟</div>${modeButtons(q)}</div>`).join(''):'<div class="empty">ما في تدريب منشور لهذه الوحدة بعد.</div>'}`;bindNav(root,{home:()=>renderHome(root,d),program:()=>renderProgram(root,p,d),book:()=>renderBook(root,b,d,p)});bindModes(root);}

  async function install(){
    if(location.hash!=='#student'||!token())return;
    const hero=document.querySelector('.hero h1');
    if(!hero||(hero.textContent||'').trim().indexOf('أهلًا')!==0)return;
    hideLegacy();
    let root=document.querySelector('[data-student-library]');
    if(root?.dataset.libraryReady==='1')return;
    if(!root){root=document.createElement('section');root.className='panel flh-student-library';root.dataset.studentLibrary='1';const progress=document.querySelector('#app .hero + .panel');if(progress)progress.insertAdjacentElement('afterend',root);else document.querySelector('#app .panel')?.insertAdjacentElement('beforebegin',root);}
    if(!root||loading)return;
    if(cache){renderHome(root,cache);root.dataset.libraryReady='1';return;}
    loading=true;root.innerHTML='<div class="loading-card">جارِ ترتيب مكتبتك…</div>';
    try{cache=await load();renderHome(root,cache);root.dataset.libraryReady='1';}
    catch{root.innerHTML='<div class="error">تعذر تحميل مكتبتك. جرّب تحديث الصفحة.</div>';}
    finally{loading=false;}
  }
  function reset(){cache=null;setTimeout(install,30)}
  const observer=new MutationObserver(()=>{hideLegacy();install();});observer.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('hashchange',reset);document.addEventListener('DOMContentLoaded',install);install();
})();
