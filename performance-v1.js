(() => {
  const nativeFetch = window.fetch.bind(window);
  const SUPABASE_ORIGIN = 'https://gkpoylfozvuwuwqeoduc.supabase.co';
  const LIVE_ORIGIN = 'https://fadiaboalward.github.io';
  const STORAGE_PREFIX = 'flh_perf_cache_v2|';
  const responseCache = new Map();
  const inflight = new Map();
  const deferredDrafts = new Map();

  const isLiveApp = () => location.origin === LIVE_ORIGIN;

  function normalizedUrl(input) {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input?.url;
    if (!raw) return null;
    try { return new URL(raw, location.href).toString(); }
    catch { return raw; }
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

  function fingerprintToken(value = '') {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function tokenFingerprint(headers) {
    return fingerprintToken(headers.get('authorization') || '');
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

  function configFor(slug, action) {
    if (slug === 'family-api' && action === 'student_profile') return { memoryTtl: 30_000, maxStale: 6 * 60 * 60_000 };
    if (slug === 'student-library-api' && action === 'catalog') return { memoryTtl: 60_000, maxStale: 24 * 60 * 60_000 };
    if (slug === 'family-api' && action === 'learner_choices') return { memoryTtl: 5 * 60_000, maxStale: 7 * 24 * 60 * 60_000 };
    return null;
  }

  function storageKey(key) { return `${STORAGE_PREFIX}${key}`; }

  function savePersistent(key, snapshot) {
    try {
      localStorage.setItem(storageKey(key), JSON.stringify({ savedAt: Date.now(), snapshot }));
    } catch {}
  }

  function loadPersistent(key, maxStale) {
    try {
      const raw = localStorage.getItem(storageKey(key));
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data?.snapshot || !data.savedAt || Date.now() - Number(data.savedAt) > maxStale) {
        localStorage.removeItem(storageKey(key));
        return null;
      }
      return data.snapshot;
    } catch { return null; }
  }

  function storeSnapshot(key, snapshot, cfg) {
    if (!snapshot?.ok) return;
    responseCache.set(key, { snapshot, expiresAt: Date.now() + cfg.memoryTtl });
    savePersistent(key, snapshot);
  }

  function refreshCache(key, input, init, cfg) {
    if (inflight.has(key)) return inflight.get(key);
    const p = fetchSnapshot(input, init)
      .then(snapshot => {
        storeSnapshot(key, snapshot, cfg);
        return snapshot;
      })
      .catch(() => null)
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  function learnerHeadersFrom(headers, session) {
    const h = new Headers(headers);
    h.set('authorization', `Bearer ${session}`);
    h.set('content-type', 'application/json');
    return h;
  }

  function prefetchCatalog(headers) {
    const url = `${SUPABASE_ORIGIN}/functions/v1/student-library-api`;
    const key = `student-library-api|catalog|${tokenFingerprint(headers)}`;
    const cfg = configFor('student-library-api', 'catalog');
    const memory = responseCache.get(key);
    if (memory && memory.expiresAt > Date.now()) return;
    if (loadPersistent(key, cfg.maxStale)) {
      refreshCache(key, url, { method: 'POST', headers, body: JSON.stringify({ action: 'catalog' }) }, cfg);
      return;
    }
    refreshCache(key, url, { method: 'POST', headers, body: JSON.stringify({ action: 'catalog' }) }, cfg);
  }

  function prefetchProfile(headers) {
    const url = `${SUPABASE_ORIGIN}/functions/v1/family-api`;
    const key = `family-api|student_profile|${tokenFingerprint(headers)}`;
    const cfg = configFor('family-api', 'student_profile');
    refreshCache(key, url, { method: 'POST', headers, body: JSON.stringify({ action: 'student_profile' }) }, cfg);
  }

  function primeProfile(session, profile, requestHeaders) {
    if (!session || !profile) return;
    const h = learnerHeadersFrom(requestHeaders, session);
    const key = `family-api|student_profile|${tokenFingerprint(h)}`;
    const cfg = configFor('family-api', 'student_profile');
    const snapshot = {
      ok: true,
      status: 200,
      statusText: 'OK',
      contentType: 'application/json; charset=utf-8',
      text: JSON.stringify(profile)
    };
    storeSnapshot(key, snapshot, cfg);
    prefetchCatalog(h);
  }

  window.fetch = async function optimizedFetch(input, init = {}) {
    const url = normalizedUrl(input);
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

    if (isLiveApp() && slug === 'learning-api' && action === 'save_draft' && body?.attempt_id && body?.question_id) {
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

    if (slug === 'family-api' && action === 'student_login') {
      const snapshot = await fetchSnapshot(nextInput, init);
      if (snapshot.ok) {
        try {
          const d = JSON.parse(snapshot.text);
          primeProfile(d.session, d.profile, headers);
        } catch {}
      }
      return responseFrom(snapshot);
    }

    const cfg = configFor(slug, action);
    if (cfg) {
      const key = cacheKey(url || '', action, headers);
      const memory = responseCache.get(key);
      if (memory && memory.expiresAt > Date.now()) return responseFrom(memory.snapshot);

      const persisted = loadPersistent(key, cfg.maxStale);
      if (persisted) {
        responseCache.set(key, { snapshot: persisted, expiresAt: Date.now() + cfg.memoryTtl });
        refreshCache(key, nextInput, init, cfg);
        if (slug === 'family-api' && action === 'student_profile') prefetchCatalog(headers);
        return responseFrom(persisted);
      }

      const pending = refreshCache(key, nextInput, init, cfg);
      const snapshot = await pending;
      if (!snapshot) return nativeFetch(nextInput, init);
      if (slug === 'family-api' && action === 'student_profile') prefetchCatalog(headers);
      return responseFrom(snapshot);
    }

    const response = await nativeFetch(nextInput, init);
    if (response.ok && (action === 'finish_quiz' || action === 'submit_exam')) {
      setTimeout(() => prefetchProfile(headers), 0);
    }
    return response;
  };

  window.FLHPerformance = {
    clear() {
      responseCache.clear();
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k?.startsWith(STORAGE_PREFIX)) localStorage.removeItem(k);
        }
      } catch {}
    }
  };
})();
