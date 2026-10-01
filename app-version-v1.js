(() => {
  const BUILD_META = 'app-build';
  const RELOAD_GUARD_KEY = 'flh-app-version-target';

  /** Read the build identifier from the loaded document. */
  function currentBuild(doc = globalThis.document) {
    return String(doc?.querySelector?.('meta[name="app-build"]')?.content || doc?.body?.dataset?.build || '').trim();
  }

  /** Extract a build identifier from fetched index HTML. */
  function extractBuild(html = '') {
    const source = String(html);
    const meta = source.match(/<meta\s+[^>]*name=["']app-build["'][^>]*content=["']([^"']+)["'][^>]*>/i);
    if (meta?.[1]) return meta[1].trim();
    const body = source.match(/<body[^>]*data-build=["']([^"']+)["']/i);
    return body?.[1]?.trim() || '';
  }

  /** Read session storage without letting browser storage failures escape. */
  function guardedGet(storage, key) {
    try {
      if (typeof storage?.getItem !== 'function') return { ok: false, value: '' };
      return { ok: true, value: storage.getItem(key) || '' };
    } catch {
      return { ok: false, value: '' };
    }
  }

  /** Persist and verify a session guard before any reload can occur. */
  function guardedSet(storage, key, value) {
    try {
      if (typeof storage?.setItem !== 'function' || typeof storage?.getItem !== 'function') return false;
      storage.setItem(key, value);
      return storage.getItem(key) === value;
    } catch {
      return false;
    }
  }

  /** Best-effort cleanup of a no-longer-needed session guard. */
  function guardedRemove(storage, key) {
    try { storage?.removeItem?.(key); } catch {}
  }

  /** Build a cache-busting refresh URL while preserving route and query state. */
  function refreshUrl(targetBuild, locationLike = globalThis.location) {
    const url = new URL(locationLike.href);
    url.searchParams.delete('_flh_build_check');
    url.searchParams.set('_flh_build', targetBuild);
    return url.href;
  }

  /** Fetch the deployed index without cache and return its build identifier. */
  async function remoteBuild(fetchFn = globalThis.fetch, locationLike = globalThis.location) {
    const url = new URL('index.html', locationLike.href);
    url.searchParams.set('_flh_build_check', String(Date.now()));
    const response = await fetchFn(url.href, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'cache-control': 'no-cache' }
    });
    if (!response?.ok) throw new Error('BUILD_CHECK_FAILED');
    return extractBuild(await response.text());
  }

  /** Compare local and deployed builds and perform at most one guarded refresh. */
  async function checkNow({
    fetchFn = globalThis.fetch,
    navigate = href => globalThis.location.replace(href),
    storage,
    locationLike = globalThis.location,
    documentLike = globalThis.document
  } = {}) {
    const local = currentBuild(documentLike);
    if (!local || !fetchFn || !locationLike?.href) return { status: 'unavailable', local_build: local };

    let resolvedStorage = storage;
    if (resolvedStorage === undefined) {
      try {
        resolvedStorage = globalThis.sessionStorage;
      } catch {
        return { status: 'unavailable', local_build: local };
      }
    }

    try {
      const remote = await remoteBuild(fetchFn, locationLike);
      if (!remote) return { status: 'remote-build-missing', local_build: local };

      const guard = guardedGet(resolvedStorage, RELOAD_GUARD_KEY);
      if (!guard.ok) return { status: 'unavailable', local_build: local, remote_build: remote };

      if (remote === local) {
        if (guard.value === remote) guardedRemove(resolvedStorage, RELOAD_GUARD_KEY);
        return { status: 'current', local_build: local, remote_build: remote };
      }

      if (guard.value === remote) {
        console.warn('[FLH] New build still detected after refresh attempt; suppressing reload loop.');
        return { status: 'loop-guarded', local_build: local, remote_build: remote };
      }

      if (!guardedSet(resolvedStorage, RELOAD_GUARD_KEY, remote)) {
        return { status: 'unavailable', local_build: local, remote_build: remote };
      }

      const persisted = guardedGet(resolvedStorage, RELOAD_GUARD_KEY);
      if (!persisted.ok || persisted.value !== remote) {
        return { status: 'unavailable', local_build: local, remote_build: remote };
      }

      const href = refreshUrl(remote, locationLike);
      navigate(href);
      return { status: 'refreshing', local_build: local, remote_build: remote, href };
    } catch {
      return { status: 'check-failed', local_build: local };
    }
  }

  /** Register lightweight startup, visibility, and focus checks with overlap coalescing. */
  function startWatcher({
    documentLike = globalThis.document,
    windowLike = globalThis.window,
    check = checkNow
  } = {}) {
    if (!documentLike || !windowLike) return null;

    let activeCheck = null;
    const runCheck = () => {
      if (activeCheck) return activeCheck;
      activeCheck = Promise.resolve().then(() => check()).finally(() => { activeCheck = null; });
      return activeCheck;
    };
    const checkWhenVisible = () => { if (!documentLike.hidden) void runCheck(); };

    if (documentLike.readyState === 'loading') documentLike.addEventListener('DOMContentLoaded', runCheck, { once: true });
    else queueMicrotask(runCheck);

    documentLike.addEventListener('visibilitychange', checkWhenVisible);
    windowLike.addEventListener('focus', checkWhenVisible);
    return { runCheck, checkWhenVisible };
  }

  globalThis.FLHAppVersion = { currentBuild, extractBuild, refreshUrl, remoteBuild, checkNow, startWatcher };

  if (typeof globalThis.document !== 'undefined' && typeof globalThis.window !== 'undefined') startWatcher();
})();
