(() => {
  const originalStudentLogin=typeof renderStudentLogin==='function'?renderStudentLogin:null;
  const originalStudentHome=typeof renderStudentHome==='function'?renderStudentHome:null;
  const token=()=>localStorage.getItem('learner_session')||sessionStorage.getItem('learner_session')||'';
  const safe=(s='')=>typeof esc==='function'?esc(s):String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function genericCopy(){document.querySelectorAll('.role-card .muted').forEach(el=>{if((el.textContent||'').includes('متابعة آية ومحمد')||(el.textContent||'').includes('متابعة المتعلمين'))el.textContent='متابعة الأبناء والنتائج والمكافآت.';});}
  async function renderDynamicLogin(){
    if(typeof shell!=='function'||typeof api!=='function')return originalStudentLogin?.();
    shell('🧑‍🎓 دخول الطالب','اختَر اسمك، ثم اكتب رمزك.',`<section class="panel"><div class="choice-grid" id="dynamicLearnerGrid"><div class="loading-card">جارٍ تحميل الحسابات…</div></div><div id="pinArea"></div><div class="actions"><button class="btn btn-soft" id="backHome">رجوع</button></div></section>`);
    document.getElementById('backHome')?.addEventListener('click',()=>{location.hash='';});
    try{const d=await api('learner_choices'),learners=d.learners||[],grid=document.getElementById('dynamicLearnerGrid');if(!grid)return;grid.innerHTML=learners.length?learners.map(l=>`<button class="profile-card" data-dynamic-learner="${safe(l.slug)}"><span class="big-emoji">${safe(l.avatar_emoji||'🧑‍🎓')}</span><div class="title">${safe(l.display_name)}</div>${l.is_test?'<div class="muted">للتجارب فقط</div>':''}</button>`).join(''):'<div class="empty">لا توجد حسابات طالب مفعّلة.</div>';grid.querySelectorAll('[data-dynamic-learner]').forEach(btn=>btn.addEventListener('click',()=>{const slug=btn.getAttribute('data-dynamic-learner')||'',name=btn.querySelector('.title')?.textContent||slug;if(typeof showPin==='function')showPin(slug,name);}));}
    catch{const grid=document.getElementById('dynamicLearnerGrid');if(grid)grid.innerHTML='<div class="error">تعذر تحميل الحسابات. جرّب تحديث الصفحة.</div>';}
  }
  function testBanner(profile){document.querySelector('[data-dynamic-test-banner]')?.remove();if(!profile?.learner?.is_test)return;const hero=document.querySelector('.hero');if(!hero)return;const b=document.createElement('section');b.className='panel';b.dataset.dynamicTestBanner='1';b.innerHTML='<b>🧪 وضع الاختبار</b><div class="muted">هذا حساب معاينة. نشاطه منفصل عن سجلات المتعلمين الحقيقية وتقارير الأهل.</div>';hero.insertAdjacentElement('afterend',b);}

  if(originalStudentLogin)renderStudentLogin=renderDynamicLogin;
  if(originalStudentHome)renderStudentHome=function(profile){originalStudentHome(profile);testBanner(profile);};
  const observer=new MutationObserver(genericCopy);observer.observe(document.documentElement,{childList:true,subtree:true});genericCopy();
  if(location.hash==='#student'){if(token()&&typeof state!=='undefined'&&state.learnerProfile)renderStudentHome(state.learnerProfile);else if(!token())renderDynamicLogin();}
})();
