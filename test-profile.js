(() => {
  const SUPABASE_URL = 'https://gkpoylfozvuwuwqeoduc.supabase.co';
  const PUBLISHABLE_KEY = 'sb_publishable_-ysUtue-9LpsJ8gabyrQaA_IaUf4F0W';
  const FAMILY_API = `${SUPABASE_URL}/functions/v1/family-api`;

  async function api(action, payload = {}) {
    const r = await fetch(FAMILY_API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'apikey': PUBLISHABLE_KEY,
      },
      body: JSON.stringify({ action, ...payload }),
    });
    const data = await r.json().catch(() => ({ error: 'SERVER_ERROR' }));
    if (!r.ok) throw new Error(data.error || 'SERVER_ERROR');
    return data;
  }

  function renderTestPin() {
    const pinArea = document.getElementById('pinArea');
    if (!pinArea) return;
    pinArea.innerHTML = `
      <div class="field">
        <label>رمز حساب الاختبار</label>
        <input id="testStudentPin" inputmode="numeric" maxlength="8" autocomplete="one-time-code" placeholder="8 أرقام" />
      </div>
      <div class="muted">🧪 هذا الحساب مخصص للتجارب، ونتائجه منفصلة عن آية ومحمد.</div>
      <label class="muted"><input type="checkbox" id="rememberTestLearner" checked /> تذكرني على هذا الجهاز</label>
      <div class="actions"><button class="btn btn-primary" id="testLoginBtn">دخول الاختبار</button></div>
      <div id="testStudentMsg"></div>`;

    const btn = document.getElementById('testLoginBtn');
    btn.onclick = async () => {
      const pin = document.getElementById('testStudentPin')?.value || '';
      const remember = document.getElementById('rememberTestLearner')?.checked !== false;
      const msg = document.getElementById('testStudentMsg');
      btn.disabled = true;
      msg.innerHTML = '';
      try {
        const d = await api('student_login', { slug: 'test', pin });
        localStorage.removeItem('learner_session');
        sessionStorage.removeItem('learner_session');
        (remember ? localStorage : sessionStorage).setItem('learner_session', d.session);
        location.hash = 'student';
        location.reload();
      } catch {
        msg.innerHTML = '<div class="error">الرمز غير صحيح أو تعذر الدخول.</div>';
        btn.disabled = false;
      }
    };
  }

  function installTestCard() {
    const aya = document.querySelector('.profile-card[data-slug="aya"]');
    if (!aya || document.querySelector('[data-test-profile]')) return;
    const grid = aya.parentElement;
    if (!grid) return;
    const btn = document.createElement('button');
    btn.className = 'profile-card';
    btn.setAttribute('data-test-profile', 'true');
    btn.innerHTML = '<span class="big-emoji">🧪</span><div class="title">اختبار</div><div class="muted">للتجارب فقط</div>';
    btn.onclick = renderTestPin;
    grid.appendChild(btn);
  }

  const observer = new MutationObserver(() => installTestCard());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('hashchange', () => setTimeout(installTestCard, 0));
  document.addEventListener('DOMContentLoaded', installTestCard);
  installTestCard();
})();