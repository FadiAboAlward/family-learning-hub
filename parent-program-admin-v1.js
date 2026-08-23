(() => {
  const SUPABASE_URL = 'https://gkpoylfozvuwuwqeoduc.supabase.co';
  const PUBLISHABLE_KEY = 'sb_publishable_-ysUtue-9LpsJ8gabyrQaA_IaUf4F0W';
  const API = `${SUPABASE_URL}/functions/v1/parent-program-api`;

  const safe = (s='') => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function parentToken(){
    try {
      if (typeof state !== 'undefined' && state.parentSession?.access_token) return state.parentSession.access_token;
      return JSON.parse(localStorage.getItem('parent_session') || 'null')?.access_token || '';
    } catch { return ''; }
  }
  async function call(action, payload={}){
    const token = parentToken();
    if(!token) throw new Error('AUTH_REQUIRED');
    const r = await fetch(API,{method:'POST',headers:{'content-type':'application/json','apikey':PUBLISHABLE_KEY,'authorization':`Bearer ${token}`},body:JSON.stringify({action,...payload})});
    const d = await r.json().catch(()=>({error:'SERVER_ERROR'}));
    if(!r.ok) throw new Error(d.error || 'SERVER_ERROR');
    return d;
  }

  function gradeOptions(current){
    return `<option value="">غير محدد</option>${Array.from({length:12},(_,i)=>i+1).map(n=>`<option value="${n}" ${Number(current)===n?'selected':''}>الصف ${n}</option>`).join('')}`;
  }

  function programRow(learner, program, enrollment, hasAnyActive){
    const enrolled = !!enrollment;
    const primary = !!enrollment?.is_primary;
    const mismatch = learner.grade_level && program.grade_level && Number(learner.grade_level)!==Number(program.grade_level);
    const context = [program.program_type==='curriculum'?'منهاج':'كورس', program.grade_level?`الصف ${program.grade_level}`:'', program.school_year||''].filter(Boolean).join(' · ');
    return `<div class="reward-card parent-program-row" data-program-id="${safe(program.id)}">
      <div class="topline"><b>${safe(program.title)}</b>${primary?'<span class="mode-tag">البرنامج الأساسي</span>':enrolled?'<span class="mode-tag">مرتبط</span>':''}</div>
      <div class="muted">${safe(context)}</div>
      ${mismatch?`<div class="error">تنبيه: هذا البرنامج للصف ${safe(program.grade_level)} بينما الطالب مسجل حاليًا بالصف ${safe(learner.grade_level)}.</div>`:''}
      <div class="actions">
        ${!enrolled?`<button class="btn btn-primary" data-program-action="enroll" data-primary="${hasAnyActive?'0':'1'}">ربط بالطالب</button>`:''}
        ${enrolled&&!primary?'<button class="btn btn-soft" data-program-action="primary">جعله البرنامج الأساسي</button>':''}
        ${enrolled?'<button class="btn btn-soft" data-program-action="remove">إزالة البرنامج</button>':''}
      </div>
    </div>`;
  }

  async function render(root){
    root.innerHTML = '<div class="loading-card">جارِ تحميل إعدادات الطلاب والبرامج…</div>';
    try {
      const d = await call('catalog');
      const enrollments = d.enrollments || [];
      const programs = d.programs || [];
      root.innerHTML = `<div class="topline"><b>🎓 إدارة صفوف وبرامج الطلاب</b><span class="muted">التحكم بما يظهر لكل طالب</span></div>
        <div class="muted">اربط كل طالب بالمنهاج أو الكورس المناسب. أي محتوى غير مربوط ببرنامج الطالب لن يظهر له.</div>
        <div id="parentProgramLearners"></div>`;
      const host = root.querySelector('#parentProgramLearners');
      if(!host) return;
      host.innerHTML = (d.learners||[]).map(learner => {
        const active = enrollments.filter(e=>e.learner_id===learner.id && ['active','paused'].includes(e.status));
        return `<div class="card parent-program-learner" data-learner-id="${safe(learner.id)}">
          <div class="topline"><b>${safe(learner.display_name)}</b><span>${learner.grade_level?`الصف ${safe(learner.grade_level)}`:'الصف غير محدد'}</span></div>
          <div class="field"><label>الصف الدراسي</label><select class="parent-grade-select">${gradeOptions(learner.grade_level)}</select></div>
          <div class="actions"><button class="btn btn-soft" data-save-grade>حفظ الصف</button></div>
          <div class="section-title">البرامج والكورسات</div>
          ${programs.length?programs.map(p=>programRow(learner,p,active.find(e=>e.program_id===p.id),active.length>0)).join(''):'<div class="empty">لا توجد برامج مضافة للمنصة بعد.</div>'}
        </div>`;
      }).join('') || '<div class="empty">لا يوجد طلاب حقيقيون مفعّلون.</div>';

      host.querySelectorAll('.parent-program-learner').forEach(card => {
        const learnerId = card.getAttribute('data-learner-id') || '';
        card.querySelector('[data-save-grade]')?.addEventListener('click', async e => {
          const btn=e.currentTarget; btn.disabled=true;
          const value=card.querySelector('.parent-grade-select')?.value || '';
          try{ await call('set_grade',{learner_id:learnerId,grade_level:value||null}); await render(root); }
          catch{ btn.disabled=false; alert('تعذر حفظ الصف الدراسي.'); }
        });
        card.querySelectorAll('[data-program-action]').forEach(btn => btn.addEventListener('click', async () => {
          const row=btn.closest('[data-program-id]'); const programId=row?.getAttribute('data-program-id')||'';
          const action=btn.getAttribute('data-program-action'); btn.disabled=true;
          try{
            if(action==='remove') await call('set_program',{learner_id:learnerId,program_id:programId,mode:'remove'});
            else await call('set_program',{learner_id:learnerId,program_id:programId,mode:'enroll',is_primary:action==='primary'||btn.getAttribute('data-primary')==='1'});
            await render(root);
          }catch{ btn.disabled=false; alert('تعذر تعديل البرنامج لهذا الطالب.'); }
        }));
      });
    } catch {
      root.innerHTML = '<div class="error">تعذر تحميل إدارة البرامج. جرّب تحديث الصفحة أو تسجيل الدخول من جديد.</div>';
    }
  }

  function install(){
    if(location.hash !== '#parents' || !parentToken()) return;
    const logout = document.getElementById('parentLogout');
    if(!logout || document.querySelector('[data-parent-program-admin]')) return;
    const root=document.createElement('section');
    root.className='panel'; root.dataset.parentProgramAdmin='1';
    const panel=logout.closest('.panel') || document.querySelector('#app .panel:last-of-type');
    if(panel) panel.insertAdjacentElement('beforebegin',root); else document.getElementById('app')?.appendChild(root);
    render(root);
  }

  const observer=new MutationObserver(()=>install());
  observer.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('hashchange',()=>setTimeout(install,0));
  document.addEventListener('DOMContentLoaded',install);
  install();
})();
