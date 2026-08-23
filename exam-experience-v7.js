(() => {
  const TOTAL = 10;
  const EXAM_API_MARKER = '/functions/v1/exam-api';
  const RESTORE_FLAG = 'exam_restore_running_v7';

  const learnerToken = () => localStorage.getItem('learner_session') || sessionStorage.getItem('learner_session') || '';
  const hashToken = (s='') => {
    let h = 2166136261;
    for (let i=0;i<s.length;i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  };
  const stateKey = () => `exam_progress_v7_${hashToken(learnerToken())}`;

  function emptyState(){
    return { active:true, status:'active', answers:Array(TOTAL).fill(null), current:1, startedAt:Date.now(), updatedAt:Date.now() };
  }
  function loadState(){
    try {
      const raw = localStorage.getItem(stateKey());
      if(!raw) return null;
      const s = JSON.parse(raw);
      if(!s || !Array.isArray(s.answers) || s.answers.length !== TOTAL) return null;
      return s;
    } catch { return null; }
  }
  function saveState(s){ s.updatedAt = Date.now(); localStorage.setItem(stateKey(), JSON.stringify(s)); }
  function clearState(){ localStorage.removeItem(stateKey()); }

  function currentIndex(){
    const t = document.querySelector('.exam-status .topline b')?.textContent || '';
    const m = t.match(/السؤال\s+(\d+)\s+من/);
    return m ? Number(m[1]) : 0;
  }

  function currentSelected(){
    const selected = document.querySelector('#examAnswers .answer.selected');
    if(!selected) return null;
    const n = Number(selected.getAttribute('data-n'));
    return Number.isFinite(n) ? n : null;
  }

  function syncCurrentToState(){
    const s = loadState();
    const idx = currentIndex();
    if(!s || !s.active || !idx) return;
    s.current = idx;
    const selected = currentSelected();
    if(selected !== null) s.answers[idx-1] = selected;
    saveState(s);
  }

  function formatElapsed(seconds){
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s/60);
    const r = s%60;
    return `${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`;
  }

  function syncPersistentTimer(){
    const el = document.getElementById('examTimer');
    const s = loadState();
    if(!el || !s?.active || !s.startedAt) return;
    el.textContent = formatElapsed((Date.now()-Number(s.startedAt))/1000);
  }

  setInterval(syncPersistentTimer, 500);

  // Keep the saved start time in the backend details after a refresh.
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init={}) => {
    const url = typeof input === 'string' ? input : (input?.url || '');
    if(url.includes(EXAM_API_MARKER) && String(init?.method || 'GET').toUpperCase() === 'POST'){
      try {
        const body = JSON.parse(init.body || '{}');
        const s = loadState();
        if(body.action === 'save_exam_details' && s?.startedAt){
          body.duration_seconds = Math.max(0, Math.round((Date.now()-Number(s.startedAt))/1000));
          init = {...init, body:JSON.stringify(body)};
        }
      } catch {}
    }
    return nativeFetch(input, init);
  };

  function waitFor(selector, timeout=6000){
    return new Promise((resolve,reject) => {
      const start = Date.now();
      const tick = () => {
        const el = document.querySelector(selector);
        if(el) return resolve(el);
        if(Date.now()-start > timeout) return reject(new Error(`Timeout: ${selector}`));
        setTimeout(tick, 25);
      };
      tick();
    });
  }

  async function moveTo(target){
    let guard = 0;
    while(currentIndex() && currentIndex() !== target && guard++ < TOTAL+3){
      const cur = currentIndex();
      const btn = document.getElementById(target > cur ? 'examNext' : 'examPrev');
      if(!btn || btn.disabled) break;
      btn.click();
      await new Promise(r=>setTimeout(r,15));
    }
  }

  async function restoreIntoCore(s){
    if(sessionStorage.getItem(RESTORE_FLAG) === '1') return;
    sessionStorage.setItem(RESTORE_FLAG, '1');
    document.body.classList.add('exam-restoring-v7');
    try {
      await waitFor('.exam-status');
      for(let q=1;q<=TOTAL;q++){
        await moveTo(q);
        if(s.answers[q-1] !== null && s.answers[q-1] !== undefined){
          const btn = document.querySelector(`#examAnswers .answer[data-n="${s.answers[q-1]}"]`);
          if(btn && !btn.classList.contains('selected')) btn.click();
        }
      }
      await moveTo(Math.min(TOTAL, Math.max(1, Number(s.current)||1)));
      syncPersistentTimer();
      syncCurrentToState();
    } catch (e) {
      console.error('Exam restore failed', e);
    } finally {
      document.body.classList.remove('exam-restoring-v7');
      sessionStorage.removeItem(RESTORE_FLAG);
    }
  }

  async function resumeAfterRefresh(){
    const s = loadState();
    if(!s?.active || s.status !== 'active' || !learnerToken() || location.hash !== '#student') return;
    try {
      const examCard = await waitFor('#fractionExam', 8000);
      if(document.querySelector('.exam-status')) return;
      examCard.click();
      await restoreIntoCore(s);
    } catch {}
  }

  function createResultNavigator(){
    const reviews = [...document.querySelectorAll('.exam-review')];
    if(!reviews.length || document.getElementById('examResultNavigator')) return;
    const panel = reviews[0].parentElement;
    if(!panel) return;
    panel.classList.add('exam-review-panel-v7');
    const nav = document.createElement('div');
    nav.id = 'examResultNavigator';
    nav.className = 'exam-result-navigator-v7';
    nav.innerHTML = reviews.map((r,i) => {
      const good = r.classList.contains('review-good');
      return `<button type="button" class="result-nav-chip ${good?'good':'bad'}" data-result-q="${i+1}" aria-label="السؤال ${i+1} ${good?'صحيح':'خطأ'}"><span>${i+1}</span><small>${good?'✓':'✕'}</small></button>`;
    }).join('');
    panel.insertBefore(nav, reviews[0]);
    nav.querySelectorAll('[data-result-q]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.resultQ)-1;
        const target = reviews[idx];
        if(!target) return;
        target.open = true;
        target.scrollIntoView({behavior:'smooth',block:'start'});
      });
    });
  }

  function polishResultSummary(){
    const summary = document.querySelector('.exam-result-summary');
    if(!summary || summary.dataset.v7) return;
    summary.dataset.v7 = '1';
    summary.classList.add('exam-result-summary-v7');
    const stats = summary.querySelector('.stats');
    if(stats) stats.classList.add('exam-stats-grid-v7');
    const score = summary.querySelector('.exam-score');
    if(score){
      const m = score.textContent.match(/(\d+)\s*\/\s*(\d+)/);
      if(m){
        const pct = Number(m[2]) ? Math.round(Number(m[1])/Number(m[2])*100) : 0;
        score.innerHTML = `<strong>${m[1]}/${m[2]}</strong><span>${pct}%</span>`;
      }
    }
  }

  function polishResults(){
    createResultNavigator();
    polishResultSummary();
  }

  function waitForResults(){
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      if(document.querySelector('.exam-review')){
        polishResults();
        clearState();
        clearInterval(t);
      } else if(tries > 120){ clearInterval(t); }
    },100);
  }

  document.addEventListener('click', e => {
    const target = e.target instanceof Element ? e.target : null;
    if(!target) return;

    if(target.closest('#fractionExam')){
      let s = loadState();
      if(!s?.active || s.status !== 'active'){
        s = emptyState();
        saveState(s);
      }
      setTimeout(() => {
        const saved = loadState();
        if(saved && saved.answers.some(v=>v!==null)) restoreIntoCore(saved);
      },80);
      return;
    }

    if(target.closest('#examAnswers .answer')){
      setTimeout(syncCurrentToState, 0);
      return;
    }

    if(target.closest('#examNext, #examPrev, #examQuestionNavigator [data-q]')){
      setTimeout(syncCurrentToState, 25);
      return;
    }

    if(target.closest('#examQuit')){
      clearState();
      return;
    }

    if(target.closest('#examSubmit')){
      const s = loadState();
      if(s){ s.status = 'submitting'; saveState(s); }
      waitForResults();
      return;
    }
  }, true);

  document.addEventListener('DOMContentLoaded', () => {
    polishResults();
    setTimeout(resumeAfterRefresh, 150);
  });

  // Also handle scripts loaded after DOMContentLoaded.
  if(document.readyState !== 'loading') setTimeout(resumeAfterRefresh, 150);
})();
