(() => {
  const params = new URLSearchParams(location.search);
  const quizSlug = (params.get('quiz') || '').trim();
  const mode = (params.get('mode') || '').trim().toLowerCase();
  const learner = (params.get('learner') || '').trim().toLowerCase();
  const validSlug = /^[a-z0-9][a-z0-9-]{2,120}$/.test(quizSlug);
  const validMode = mode === 'learning' || mode === 'exam';
  if (!validSlug || !validMode) return;

  let launched = false;
  let learnerPreselected = false;
  const token = () => localStorage.getItem('learner_session') || sessionStorage.getItem('learner_session') || '';

  function cleanUrl() {
    const next = new URL(location.href);
    next.searchParams.delete('quiz');
    next.searchParams.delete('mode');
    next.searchParams.delete('learner');
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
