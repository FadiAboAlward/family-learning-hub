(() => {
  const nativeFetch = window.fetch.bind(window);
  const SUPABASE_ORIGIN = 'https://gkpoylfozvuwuwqeoduc.supabase.co';
  const DB_REGION = 'ap-southeast-1';
  const responseCache = new Map();
  const inflight = new Map();
  const deferredDrafts = new Map();

  function regionalUrl(input) {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input?.url;
    if (!raw) return null;
    try {
      const u = new URL(raw, location.href);
      if (u.origin === SUPABASE_ORIGIN && u.pathname.startsWith('/functions/v1/')) {
        u.searchParams.set('forceFunctionRegion', DB_REGION);
      }
      return u.toString();
    } catch {
      return raw;
    }
  }

  function buildInput(input, url) {
    if (!url) return input;
    if (input instanceof Request) return new Request(url, input);
    if (input instanceof URL) return new URL(url);
    return url;
  }

  function headersFor(input, init) {
    const h = new Headers(input instanceof Request ? input.headers : undefined);
    if (init?.headers) new Headers(init.headers).forEach((v, k) => h.set(k, v));
    return h;
  }

  function bodyJson(init) {
    if (typeof init?.body !== 'string') return null;
    try { return JSON.parse(init.body); } catch { return null; }
  }

  function tokenFingerprint(headers) {
    const value = headers.get('authorization') || '';
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function apiSlug(url) {
    try {
      const p = new URL(url).pathname.split('/');
      return p[p.length - 1] || '';
    } catch { return ''; }
  }

  function cacheKey(url, action, headers) {
    return `${apiSlug(url)}|${action}|${tokenFingerprint(headers)}`;
  }

  function responseFrom(snapshot) {
    return new Response(snapshot.text, {
      status: snapshot.status,
      statusText: snapshot.statusText,
      headers: { 'content-type': snapshot.contentType || 'application/json; charset=utf-8' }
    });
  }

  async function fetchSnapshot(input, init) {
    const r = await nativeFetch(input, init);
    return {
      ok: r.ok,
      status: r.status,
      statusText: r.statusText,
      contentType: r.headers.get('content-type') || 'application/json; charset=utf-8',
      text: await r.text()
    };
  }

  function invalidateProfile(headers) {
    const fp = tokenFingerprint(headers);
    for (const key of responseCache.keys()) {
      if (key.includes('|student_profile|') && key.endsWith(`|${fp}`)) responseCache.delete(key);
    }
  }

  function prefetchCatalog(headers) {
    const key = `student-library-api|catalog|${tokenFingerprint(headers)}`;
    const cached = responseCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return;
    if (inflight.has(key)) return;
    const url = `${SUPABASE_ORIGIN}/functions/v1/student-library-api?forceFunctionRegion=${DB_REGION}`;
    const h = new Headers(headers);
    h.set('content-type', 'application/json');
    const p = fetchSnapshot(url, { method: 'POST', headers: h, body: JSON.stringify({ action: 'catalog' }) })
      .then(snapshot => {
        if (snapshot.ok) responseCache.set(key, { snapshot, expiresAt: Date.now() + 60_000 });
        return snapshot;
      })
      .catch(() => null)
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
  }

  window.fetch = async function optimizedFetch(input, init = {}) {
    const url = regionalUrl(input);
    const nextInput = buildInput(input, url);
    const headers = headersFor(input, init);
    const body = bodyJson(init);
    const action = body?.action || '';
    const slug = apiSlug(url || '');

    if (action === 'answer' && body?.attempt_id && body?.question_id) {
      const draftKey = `${body.attempt_id}|${body.question_id}`;
      const pending = deferredDrafts.get(draftKey);
      if (pending) {
        clearTimeout(pending.timer);
        pending.controller.abort();
        deferredDrafts.delete(draftKey);
      }
    }

    if (slug === 'learning-api' && action === 'save_draft' && body?.attempt_id && body?.question_id) {
      const draftKey = `${body.attempt_id}|${body.question_id}`;
      const old = deferredDrafts.get(draftKey);
      if (old) {
        clearTimeout(old.timer);
        old.controller.abort();
      }
      const controller = new AbortController();
      const timer = setTimeout(() => {
        nativeFetch(nextInput, { ...init, signal: controller.signal })
          .catch(() => {})
          .finally(() => deferredDrafts.delete(draftKey));
      }, 600);
      deferredDrafts.set(draftKey, { timer, controller });
      return new Response(JSON.stringify({ ok: true, deferred: true }), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      });
    }

    if (action === 'finish_quiz' || action === 'submit_exam') invalidateProfile(headers);

    const ttl = slug === 'family-api' && action === 'student_profile' ? 30_000
      : slug === 'student-library-api' && action === 'catalog' ? 60_000
      : 0;

    if (ttl > 0) {
      const key = cacheKey(url || '', action, headers);
      const cached = responseCache.get(key);
      if (cached && cached.expiresAt > Date.now()) return responseFrom(cached.snapshot);
      if (cached) responseCache.delete(key);

      if (inflight.has(key)) {
        const snapshot = await inflight.get(key);
        if (snapshot) return responseFrom(snapshot);
      }

      const p = fetchSnapshot(nextInput, init)
        .then(snapshot => {
          if (snapshot.ok) responseCache.set(key, { snapshot, expiresAt: Date.now() + ttl });
          return snapshot;
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, p);

      if (slug === 'family-api' && action === 'student_profile') prefetchCatalog(headers);

      const snapshot = await p;
      return responseFrom(snapshot);
    }

    return nativeFetch(nextInput, init);
  };
})();
