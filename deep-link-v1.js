(() => {
  const params = new URLSearchParams(location.search);
  const quizSlug = (params.get('quiz') || '').trim();
  const mode = (params.get('mode') || '').trim().toLowerCase();
  const learner = (params.get('learner') || '').trim().toLowerCase();
  const attemptId = (params.get('attempt') || '').trim().toLowerCase();
  const validSlug = /^[a-z0-9][a-z0-9-]{2,120}$/.test(quizSlug);
  const validMode = mode === 'learning' || mode === 'exam';
  const validAttempt = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(attemptId);
  const quizRoute = validSlug && validMode;
  const attemptRoute = validAttempt;
  if (!quizRoute && !attemptRoute) return;

  let launched = false;
  let learnerPreselected = false;
  const token = () => localStorage.getItem('learner_session') || sessionStorage.getItem('learner_session') || '';

  function cleanUrl() {
    const next = new URL(location.href);
    next.searchParams.delete('quiz');
    next.searchParams.delete('mode');
    next.searchParams.delete('learner');
    next.searchParams.delete('attempt');
    history.replaceState(null, '', `${next.pathname}${next.search}${next.hash}`);
  }

  function preselectLearner() {
    if (token() || learnerPreselected || !learner) return;
    const selectorValue = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(learner) : learner.replace(/[^a-z0-9_-]/g, '');
    const card = document.querySelector(`[data-slug="${selectorValue}"]`);
    if (!card) return;
    learnerPreselected = true;
    card.click();
    setTimeout(() => document.getElementById('studentPin')?.focus(), 0);
  }

  function tryLaunch() {
    if (launched) return;
    if (location.hash !== '#student') {
      location.hash = 'student';
      return;
    }
    if (!token()) {
      preselectLearner();
      return;
    }

    if (attemptRoute) {
      const opener = window.FLH?.openAttemptHistoryAttempt;
      if (typeof opener !== 'function') return;
      launched = true;
      Promise.resolve(opener(attemptId))
        .then(opened => {
          if (opened === false) {
            launched = false;
            return;
          }
          cleanUrl();
        })
        .catch(() => { launched = false; });
      return;
    }

    const starter = mode === 'learning' ? window.FLH?.startLearningQuiz : window.FLH?.startExamQuiz;
    if (typeof starter !== 'function') return;
    launched = true;
    cleanUrl();
    starter(quizSlug);
  }

  const observer = new MutationObserver(tryLaunch);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('hashchange', () => setTimeout(tryLaunch, 0));
  document.addEventListener('DOMContentLoaded', () => setTimeout(tryLaunch, 0));
  setTimeout(tryLaunch, 0);
})();
