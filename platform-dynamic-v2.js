(() => {
  const SUPABASE_URL = 'https://gkpoylfozvuwuwqeoduc.supabase.co';
  const PUBLISHABLE_KEY = 'sb_publishable_-ysUtue-9LpsJ8gabyrQaA_IaUf4F0W';
  const LEARNING_API = `${SUPABASE_URL}/functions/v1/learning-api`;
  const originalStudentLogin = typeof renderStudentLogin === 'function' ? renderStudentLogin : null;
  const originalStudentHome = typeof renderStudentHome === 'function' ? renderStudentHome : null;

  const learnerToken = () => localStorage.getItem('learner_session') || sessionStorage.getItem('learner_session') || '';
  const safe = (s = '') => typeof esc === 'function' ? esc(s) : String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const renderMath = (s = '') => typeof math === 'function' ? math(safe(s)) : safe(s);

  async function learningApi(action, payload = {}) {
    const token = learnerToken();
    if (!token) throw new Error('AUTH_REQUIRED');
    const r = await fetch(LEARNING_API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'apikey': PUBLISHABLE_KEY,
        'authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ action, ...payload }),
    });
    const data = await r.json().catch(() => ({ error: 'SERVER_ERROR' }));
    if (!r.ok) throw Object.assign(new Error(data.error || 'SERVER_ERROR'), { status: r.status, data });
    return data;
  }

  function genericLandingCopy() {
    document.querySelectorAll('.role-card .muted').forEach(el => {
      if ((el.textContent || '').includes('متابعة آية ومحمد')) {
        el.textContent = 'متابعة المتعلمين والنتائج والمكافآت.';
      }
    });
  }

  async function renderDynamicStudentLogin() {
    if (typeof shell !== 'function' || typeof api !== 'function') return originalStudentLogin?.();
    shell('🧑‍🎓 دخول الطالب', 'اختَر اسمك، ثم اكتب رمزك.', `
      <section class="panel">
        <div class="choice-grid" id="dynamicLearnerGrid"><div class="loading-card">جارِ تحميل الحسابات…</div></div>
        <div id="pinArea"></div>
        <div class="actions"><button class="btn btn-soft" id="backHome">رجوع</button></div>
      </section>`);
    document.getElementById('backHome')?.addEventListener('click', () => { location.hash = ''; });
    try {
      const d = await api('learner_choices');
      const learners = d.learners || [];
      const grid = document.getElementById('dynamicLearnerGrid');
      if (!grid) return;
      grid.innerHTML = learners.length ? learners.map(l => `
        <button class="profile-card" data-dynamic-learner="${safe(l.slug)}">
          <span class="big-emoji">${safe(l.avatar_emoji || '🧑‍🎓')}</span>
          <div class="title">${safe(l.display_name)}</div>
          ${l.is_test ? '<div class="muted">للتجارب فقط</div>' : ''}
        </button>`).join('') : '<div class="empty">لا توجد حسابات طالب مفعلة.</div>';
      grid.querySelectorAll('[data-dynamic-learner]').forEach(btn => {
        btn.addEventListener('click', () => {
          const slug = btn.getAttribute('data-dynamic-learner') || '';
          const name = btn.querySelector('.title')?.textContent || slug;
          if (typeof showPin === 'function') showPin(slug, name);
        });
      });
    } catch {
      const grid = document.getElementById('dynamicLearnerGrid');
      if (grid) grid.innerHTML = '<div class="error">تعذر تحميل الحسابات. جرّب تحديث الصفحة.</div>';
    }
  }

  function testBanner(profile) {
    document.querySelector('[data-dynamic-test-banner]')?.remove();
    if (!profile?.learner?.is_test) return;
    const hero = document.querySelector('.hero');
    if (!hero) return;
    const banner = document.createElement('section');
    banner.className = 'panel';
    banner.dataset.dynamicTestBanner = '1';
    banner.innerHTML = '<b>🧪 وضع الاختبار</b><div class="muted">هذا حساب معاينة. نشاطه منفصل عن سجلات المتعلمين الحقيقية وتقارير الأهل.</div>';
    hero.insertAdjacentElement('afterend', banner);
  }

  function programCard(program) {
    const quizzes = program.quizzes || [];
    const quizHtml = quizzes.length ? quizzes.map(q => `
      <button class="quiz-card dynamic-program-quiz" data-quiz-slug="${safe(q.slug)}">
        <b>${safe(q.title)}</b>
        <div class="muted">${safe(q.description || (q.quiz_kind === 'unit' ? 'تدريب شامل على الوحدة' : 'تدريب تعليمي'))}</div>
        <span class="mode-tag">وضع التعلّم</span>
      </button>`).join('') : '<div class="empty">لا يوجد محتوى متاح في هذا البرنامج حاليًا.</div>';
    const context = [program.grade_level ? `الصف ${program.grade_level}` : '', program.school_year || ''].filter(Boolean).join(' · ');
    return `<section class="panel dynamic-program" data-program="${safe(program.slug)}">
      <div class="topline"><b>📚 ${safe(program.title)}</b>${program.is_primary ? '<span class="mode-tag">البرنامج الأساسي</span>' : ''}</div>
      ${context ? `<div class="muted">${safe(context)}</div>` : ''}
      <div class="dynamic-program-quizzes">${quizHtml}</div>
    </section>`;
  }

  async function installProgramCatalog(profile) {
    document.querySelectorAll('.dynamic-program').forEach(el => el.remove());
    document.querySelector('[data-program-error]')?.remove();
    testBanner(profile);
    try {
      const d = await learningApi('catalog');
      const programs = d.programs || [];
      const oldLearningCard = document.getElementById('fractionQuiz');
      if (oldLearningCard) oldLearningCard.style.display = 'none';
      const anchor = oldLearningCard?.closest('.panel') || document.querySelector('#app .panel:last-of-type');
      if (!anchor) return;
      const wrap = document.createElement('div');
      wrap.dataset.dynamicPrograms = '1';
      wrap.innerHTML = programs.length
        ? programs.map(programCard).join('')
        : '<section class="panel dynamic-program"><div class="empty">ما في برنامج تعليمي مربوط بهذا الحساب بعد.</div></section>';
      anchor.insertAdjacentElement('beforebegin', wrap);
      wrap.querySelectorAll('[data-quiz-slug]').forEach(btn => {
        btn.addEventListener('click', () => startDatabaseQuiz(btn.getAttribute('data-quiz-slug') || ''));
      });
    } catch (e) {
      const oldLearningCard = document.getElementById('fractionQuiz');
      const anchor = oldLearningCard?.closest('.panel');
      if (anchor) {
        const msg = document.createElement('div');
        msg.dataset.programError = '1';
        msg.className = 'error';
        msg.textContent = 'تعذر تحميل البرامج من قاعدة البيانات. التدريب القديم ما زال متاحًا مؤقتًا.';
        anchor.insertAdjacentElement('beforebegin', msg);
      }
    }
  }

  function refreshProfileSoon() {
    if (typeof api !== 'function' || typeof state === 'undefined') return;
    api('student_profile', {}, learnerToken()).then(p => { state.learnerProfile = p; }).catch(() => {});
  }

  async function startDatabaseQuiz(slug) {
    if (!slug) return;
    let session;
    try {
      session = await learningApi('start_quiz', { quiz_slug: slug });
    } catch (e) {
      if (typeof shell === 'function') shell('تعذر بدء التدريب', 'هذا التدريب غير متاح لهذا الحساب أو صار خطأ أثناء فتحه.', '<section class="panel"><div class="actions"><button class="btn btn-primary" id="returnStudentHome">رجوع</button></div></section>');
      document.getElementById('returnStudentHome')?.addEventListener('click', () => originalStudentHome?.(state.learnerProfile));
      return;
    }

    const queue = (session.queue || []).map(row => ({ ...row }));
    const startedAt = Date.now();
    let currentIndex = Math.max(0, queue.findIndex(row => !['completed', 'skipped'].includes(row.status)));
    if (currentIndex < 0) currentIndex = queue.length;

    const findNext = () => queue.findIndex((row, i) => i > currentIndex && !['completed', 'skipped'].includes(row.status));
    const remaining = () => queue.some(row => !['completed', 'skipped'].includes(row.status));

    function quizShell(content) {
      shell(`🧠 ${safe(session.quiz.title)}`, 'وضع التعلّم — التصحيح والتلميحات تأتي من محرك التعلّم على السيرفر.', content);
    }

    async function finish() {
      quizShell('<section class="panel"><div class="loading-card">عم نحسب النتيجة من إجاباتك المحفوظة…</div></section>');
      try {
        const d = await learningApi('finish_quiz', {
          attempt_id: session.attempt_id,
          duration_seconds: Math.max(1, Math.round((Date.now() - startedAt) / 1000)),
        });
        refreshProfileSoon();
        const review = (d.review || []).map((r, i) => `
          <details class="exam-review">
            <summary>${r.is_correct ? '✅' : '❌'} السؤال ${i + 1}</summary>
            <div>${renderMath(r.prompt || '')}</div>
            ${r.explanation ? `<div class="muted">${renderMath(r.explanation)}</div>` : ''}
          </details>`).join('');
        const award = d.award?.already_awarded
          ? '<div class="muted">XP لهذا التدريب كان محسوبًا من إكمال سابق.</div>'
          : `<div class="award-pop">🎉 +${Number(d.award?.xp || 0)} XP &nbsp; 🪙 +${Number(d.award?.reward_points || 0)} نقطة</div>`;
        quizShell(`<section class="panel">
          <div class="stats"><div class="stat">الدرجة<b>${Number(d.percentage || 0)}%</b></div><div class="stat">من أول مرة<b>${Number(d.first_try_correct || 0)}</b></div><div class="stat">التلميحات<b>${Number(d.hints_used || 0)}</b></div><div class="stat">الحالة<b>محفوظة ✓</b></div></div>
          ${award}
          <div class="section-title">مراجعة الإجابات</div>${review || '<div class="empty">لا توجد مراجعة.</div>'}
          <div class="actions"><button class="btn btn-primary" id="dbQuizHome">رجوع لصفحتي</button></div>
        </section>`);
        document.getElementById('dbQuizHome')?.addEventListener('click', async () => {
          try { state.learnerProfile = await api('student_profile', {}, learnerToken()); } catch {}
          renderStudentHome(state.learnerProfile);
        });
      } catch {
        quizShell('<section class="panel"><div class="error">تعذر إنهاء التدريب. إجاباتك المحفوظة لم تضِع.</div><div class="actions"><button class="btn btn-primary" id="dbQuizRetryFinish">إعادة المحاولة</button></div></section>');
        document.getElementById('dbQuizRetryFinish')?.addEventListener('click', finish);
      }
    }

    function renderCurrent() {
      if (!remaining() || currentIndex >= queue.length) return finish();
      const row = queue[currentIndex];
      const q = row?.question;
      if (!q) return finish();
      const options = (q.options || []).map(o => `<button class="answer db-answer" data-option-position="${Number(o.position)}"><span class="answer-number">${Number(o.position)}</span><span>${renderMath(o.content)}</span></button>`).join('');
      const source = q.source_page_start ? `PDF ${q.source_page_start}${q.source_page_end && q.source_page_end !== q.source_page_start ? `–${q.source_page_end}` : ''}` : '';
      quizShell(`<section class="panel">
        <div class="topline"><b>السؤال ${currentIndex + 1}</b><span class="mode-tag">${row.source_role === 'remediation' ? 'تدريب مساعد' : 'أساسي'}</span></div>
        ${source ? `<div class="muted">${safe(source)}</div>` : ''}
        <div class="question"><b>${renderMath(q.prompt)}</b></div>
        <div id="dbQuizAnswers" class="answer-grid">${options}</div>
        <div id="dbQuizFeedback"></div>
        <div class="actions"><button class="btn btn-soft" id="dbQuizExit">رجوع لصفحتي</button></div>
      </section>`);
      document.getElementById('dbQuizExit')?.addEventListener('click', () => renderStudentHome(state.learnerProfile));
      document.querySelectorAll('.db-answer').forEach(btn => btn.addEventListener('click', () => submitAnswer(btn)));
    }

    async function submitAnswer(btn) {
      const row = queue[currentIndex];
      const feedback = document.getElementById('dbQuizFeedback');
      const buttons = [...document.querySelectorAll('.db-answer')];
      buttons.forEach(b => b.disabled = true);
      if (feedback) feedback.innerHTML = '<div class="muted">عم نتحقق من إجابتك…</div>';
      try {
        const d = await learningApi('answer', {
          attempt_id: session.attempt_id,
          question_id: row.question_id,
          option_position: Number(btn.getAttribute('data-option-position')),
        });
        if (!d.finalized) {
          buttons.forEach(b => b.disabled = false);
          if (feedback) feedback.innerHTML = `<div class="error">مو هي الإجابة بعد.</div>${d.hint?.content ? `<div class="panel"><b>💡 تلميح ${Number(d.hint.hint_level || d.attempt_no)}</b><div>${renderMath(d.hint.content)}</div></div>` : ''}`;
          return;
        }
        row.status = 'completed';
        if (d.remediation_added?.question) queue.push(d.remediation_added);
        const correct = d.is_correct ? '<div class="award-pop">✅ ممتاز!</div>' : '<div class="error">خلصت المحاولات لهذا السؤال.</div>';
        const explanation = d.explanation ? `<div class="panel"><b>الشرح</b><div>${renderMath(d.explanation)}</div></div>` : '';
        if (feedback) feedback.innerHTML = `${correct}${explanation}<div class="actions"><button class="btn btn-primary" id="dbQuizNext">${remaining() ? 'السؤال التالي' : 'إنهاء التدريب'}</button></div>`;
        document.getElementById('dbQuizNext')?.addEventListener('click', () => {
          const next = findNext();
          if (next >= 0) { currentIndex = next; renderCurrent(); }
          else finish();
        });
      } catch {
        buttons.forEach(b => b.disabled = false);
        if (feedback) feedback.innerHTML = '<div class="error">صار خطأ بالحفظ. جرّب نفس الإجابة مرة ثانية.</div>';
      }
    }

    renderCurrent();
  }

  if (originalStudentLogin) {
    renderStudentLogin = renderDynamicStudentLogin;
  }
  if (originalStudentHome) {
    renderStudentHome = function(profile) {
      originalStudentHome(profile);
      installProgramCatalog(profile);
    };
  }

  const observer = new MutationObserver(() => genericLandingCopy());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  genericLandingCopy();

  // app.js routes before this enhancement script executes, so upgrade the already-rendered route once.
  if (location.hash === '#student') {
    if (learnerToken() && typeof state !== 'undefined' && state.learnerProfile) {
      renderStudentHome(state.learnerProfile);
    } else if (!learnerToken()) {
      renderDynamicStudentLogin();
    }
  }
})();
