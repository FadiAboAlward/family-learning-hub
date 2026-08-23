(() => {
  const SUPABASE_URL = 'https://gkpoylfozvuwuwqeoduc.supabase.co';
  const PUBLISHABLE_KEY = 'sb_publishable_-ysUtue-9LpsJ8gabyrQaA_IaUf4F0W';
  const FAMILY_API = `${SUPABASE_URL}/functions/v1/family-api`;
  const ACTIVITY_API = `${SUPABASE_URL}/functions/v1/activity-api`;
  const SOUND_KEY = 'learning_sound_enabled';

  let soundEnabled = localStorage.getItem(SOUND_KEY) !== 'false';
  let lastInteractionAt = Date.now();
  let lastPingAt = 0;
  let parentReportLoading = false;
  let uiSyncScheduled = false;

  function learnerToken(){
    return localStorage.getItem('learner_session') || sessionStorage.getItem('learner_session') || '';
  }

  function parentToken(){
    try { return JSON.parse(localStorage.getItem('parent_session') || 'null')?.access_token || ''; }
    catch { return ''; }
  }

  async function activityApi(action, payload = {}, token = '', keepalive = false){
    if(!token) throw new Error('NO_TOKEN');
    const r = await fetch(ACTIVITY_API, {
      method: 'POST',
      keepalive,
      headers: {
        'content-type': 'application/json',
        'apikey': PUBLISHABLE_KEY,
        'authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ action, ...payload }),
    });
    const d = await r.json().catch(() => ({ error: 'SERVER_ERROR' }));
    if(!r.ok) throw new Error(d.error || 'SERVER_ERROR');
    return d;
  }

  // Mark a real manual learner login without changing the app's login flow.
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const reqUrl = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    let loginRequest = false;
    try {
      const init = args[1] || {};
      if(reqUrl.includes('/functions/v1/family-api') && typeof init.body === 'string'){
        const body = JSON.parse(init.body);
        loginRequest = body?.action === 'student_login';
      }
    } catch {}

    const response = await originalFetch(...args);
    if(loginRequest && response.ok){
      try {
        const copy = response.clone();
        const d = await copy.json();
        if(d?.session){
          setTimeout(() => activityApi('learner_activity', { entry_type: 'login' }, d.session).catch(() => {}), 0);
        }
      } catch {}
    }
    return response;
  };

  async function ping(entryType = 'resume_after_inactivity'){
    const token = learnerToken();
    if(!token || document.visibilityState !== 'visible') return;
    lastPingAt = Date.now();
    try { await activityApi('learner_activity', { entry_type: entryType }, token); }
    catch {}
  }

  function markActivity(){
    lastInteractionAt = Date.now();
    if(Date.now() - lastPingAt > 45000) ping();
  }

  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => {
    document.addEventListener(ev, markActivity, { passive: true, capture: true });
  });

  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'visible'){
      lastInteractionAt = Date.now();
      ping();
    }
  });

  setInterval(() => {
    if(Date.now() - lastInteractionAt <= 120000) ping();
  }, 60000);

  setTimeout(() => { if(learnerToken()) ping(); }, 900);

  document.addEventListener('click', e => {
    const btn = e.target.closest?.('#studentLogout');
    if(!btn) return;
    const token = learnerToken();
    if(token) activityApi('learner_logout', {}, token, true).catch(() => {});
  }, true);

  function renderSoundButton(btn){
    const icon = soundEnabled ? '🔊' : '🔇';
    const title = soundEnabled ? 'كتم أصوات النجاح' : 'تشغيل أصوات النجاح';
    if(btn.textContent !== icon) btn.textContent = icon;
    if(btn.title !== title) btn.title = title;
  }

  function ensureSoundToggle(){
    const studentMode = location.hash === '#student' && !!learnerToken();
    let btn = document.getElementById('soundToggle');

    if(!studentMode){
      if(btn) btn.remove();
      return;
    }

    if(!btn){
      btn = document.createElement('button');
      btn.id = 'soundToggle';
      btn.className = 'sound-toggle';
      btn.type = 'button';
      btn.setAttribute('aria-label', 'تشغيل أو كتم أصوات النجاح');
      renderSoundButton(btn);
      btn.onclick = () => {
        soundEnabled = !soundEnabled;
        localStorage.setItem(SOUND_KEY, String(soundEnabled));
        renderSoundButton(btn);
        if(soundEnabled) playChime('small');
      };
      document.body.appendChild(btn);
    } else {
      renderSoundButton(btn);
    }
  }

  function playChime(level = 'small'){
    if(!soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if(!AudioCtx) return;
      const ctx = new AudioCtx();
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(level === 'big' ? 0.10 : 0.055, ctx.currentTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.42);
      const notes = level === 'big' ? [523.25, 659.25, 783.99] : [659.25, 783.99];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.connect(gain);
        const t = ctx.currentTime + i * 0.065;
        osc.start(t);
        osc.stop(t + 0.28);
      });
      setTimeout(() => ctx.close().catch(() => {}), 700);
    } catch {}
  }

  function celebrate(level = 'small'){
    playChime(level);
    if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const layer = document.createElement('div');
    layer.className = `celebration-layer ${level}`;
    const icons = level === 'big' ? ['🎉','✨','⭐','💫','🏆','🌟'] : ['✨','⭐','💫'];
    const count = level === 'big' ? 28 : 12;

    for(let i = 0; i < count; i++){
      const piece = document.createElement('span');
      piece.className = 'celebration-piece';
      piece.textContent = icons[i % icons.length];
      piece.style.setProperty('--x', `${Math.round(Math.random() * 96)}vw`);
      piece.style.setProperty('--delay', `${Math.random() * 0.25}s`);
      piece.style.setProperty('--drift', `${Math.round((Math.random() - 0.5) * 120)}px`);
      piece.style.setProperty('--spin', `${Math.round(Math.random() * 540 - 270)}deg`);
      layer.appendChild(piece);
    }

    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 1900);
  }

  function filterTestFromParentUi(){
    if(location.hash !== '#parents') return;
    document.querySelectorAll('.card').forEach(card => {
      const name = card.querySelector('.topline b')?.textContent?.trim();
      if(name === 'اختبار') card.remove();
    });
    document.querySelectorAll('.parent-table tbody tr').forEach(tr => {
      if(tr.cells?.[0]?.textContent?.trim() === 'اختبار') tr.remove();
    });
  }

  function fmtMinutes(sec){
    const m = Math.round((Number(sec) || 0) / 60);
    return m < 1 ? 'أقل من دقيقة' : `${m} د`;
  }
  function fmtTime(v){
    return v ? new Date(v).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' }) : '—';
  }
  function fmtDate(v){
    return v ? new Date(v).toLocaleDateString('ar', { weekday: 'short', day: 'numeric', month: 'numeric' }) : '—';
  }

  async function injectParentSessionReport(){
    if(location.hash !== '#parents' || parentReportLoading || document.getElementById('learningSessionReport')) return;
    const heading = document.querySelector('.hero h1');
    if(!heading || !heading.textContent.includes('لوحة الأهل')) return;
    const token = parentToken();
    if(!token) return;

    parentReportLoading = true;
    try {
      const d = await activityApi('parent_sessions', {}, token);
      const weekStart = Date.now() - 7 * 86400000;
      const byLearner = Object.fromEntries((d.learners || []).map(l => [l.id, l]));
      const weekly = (d.sessions || []).filter(s => new Date(s.started_at).getTime() >= weekStart);

      const summaries = (d.learners || []).map(l => {
        const ss = weekly.filter(s => s.learner_id === l.id);
        const visits = ss.length;
        const logins = ss.filter(s => s.entry_type === 'login').length;
        const seconds = ss.reduce((a, s) => a + Number(s.duration_seconds || 0), 0);
        const avg = visits ? seconds / visits : 0;
        return `<div class="session-summary"><b>${l.display_name}</b><div class="session-mini-grid"><span>📅 جلسات هذا الأسبوع<strong>${visits}</strong></span><span>🔐 تسجيلات دخول<strong>${logins}</strong></span><span>⏱️ وقت التعلّم<strong>${fmtMinutes(seconds)}</strong></span><span>📏 متوسط الجلسة<strong>${fmtMinutes(avg)}</strong></span></div></div>`;
      }).join('');

      const rows = (d.sessions || []).slice(0, 60).map(s => {
        const learner = byLearner[s.learner_id];
        if(!learner) return '';
        const end = s.ended_at || s.last_activity_at;
        return `<tr><td>${learner.display_name}</td><td>${fmtDate(s.started_at)}</td><td>${fmtTime(s.started_at)}</td><td>${fmtTime(end)}</td><td>${fmtMinutes(s.duration_seconds)}</td><td>${s.entry_type === 'login' ? 'دخول' : 'رجوع بعد توقف'}</td></tr>`;
      }).join('') || '<tr><td colspan="6">ما في جلسات مسجلة بعد.</td></tr>';

      const section = document.createElement('section');
      section.className = 'panel';
      section.id = 'learningSessionReport';
      section.innerHTML = `<div class="section-title">⏱️ نشاط التعلّم والجلسات</div><div class="muted">الجلسة تنتهي تلقائيًا بعد ${d.inactivity_minutes || 10} دقائق بدون نشاط، حتى ما ينحسب وقت الجهاز المفتوح كدراسة.</div><div class="session-summaries">${summaries}</div><details class="session-details"><summary>عرض تفاصيل كل جلسة</summary><div style="overflow:auto"><table class="parent-table"><thead><tr><th>الطالب</th><th>اليوم</th><th>من</th><th>إلى</th><th>المدة</th><th>النوع</th></tr></thead><tbody>${rows}</tbody></table></div></details><div class="muted tracking-note">ℹ️ التتبع بدأ من تاريخ تفعيل هذه الميزة، لذلك ما في بيانات رجعية دقيقة لما قبلها.</div>`;

      const footer = document.querySelector('.footer-links');
      const parent = footer?.parentNode || document.getElementById('app');
      if(parent) parent.insertBefore(section, footer || null);
      filterTestFromParentUi();
    } catch {}
    finally { parentReportLoading = false; }
  }

  function scheduleUiSync(){
    if(uiSyncScheduled) return;
    uiSyncScheduled = true;
    queueMicrotask(() => {
      uiSyncScheduled = false;
      ensureSoundToggle();
      filterTestFromParentUi();
      injectParentSessionReport();
    });
  }

  const observer = new MutationObserver(mutations => {
    for(const mutation of mutations){
      for(const node of mutation.addedNodes){
        if(!(node instanceof Element)) continue;

        const goodEls = [
          ...(node.matches?.('.feedback.good') ? [node] : []),
          ...(node.querySelectorAll?.('.feedback.good') || []),
        ];
        goodEls.forEach(el => {
          if(el.dataset.celebrated) return;
          el.dataset.celebrated = '1';
          celebrate('small');
        });

        const awardEls = [
          ...(node.matches?.('.award-pop') ? [node] : []),
          ...(node.querySelectorAll?.('.award-pop') || []),
        ];
        awardEls.forEach(el => {
          if(el.dataset.celebrated) return;
          const text = el.textContent || '';
          if(/XP|أوسمة|نقطة|🏅|🎉/.test(text)){
            el.dataset.celebrated = '1';
            celebrate('big');
          }
        });
      }
    }
    scheduleUiSync();
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('hashchange', () => setTimeout(scheduleUiSync, 50));
  document.addEventListener('DOMContentLoaded', () => {
    scheduleUiSync();
    setTimeout(injectParentSessionReport, 600);
  });
})();