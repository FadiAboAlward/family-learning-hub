(() => {
  const BUILD_META = 'app-build';
  const RELOAD_GUARD_KEY = 'flh-app-version-target';

  function currentBuild(doc = document) {
    return String(doc?.querySelector?.('meta[name="app-build"]')?.content || doc?.body?.dataset?.build || '').trim();
  }

  function extractBuild(html = '') {
    const source = String(html);
    const meta = source.match(/<meta\s+[^>]*name=["']app-build["'][^>]*content=["']([^"']+)["'][^>]*>/i);
    if (meta?.[1]) return meta[1].trim();
    const body = source.match(/<body[^>]*data-build=["']([^"']+)["']/i);
    return body?.[1]?.trim() || '';
  }

  function guardedGet(storage, key) {
    try { return storage?.getItem?.(key) || ''; } catch { return ''; }
  }

  function guardedSet(storage, key, value) {
    try { storage?.setItem?.(key, value); } catch {}
  }

  function guardedRemove(storage, key) {
    try { storage?.removeItem?.(key); } catch {}
  }

  function refreshUrl(targetBuild, locationLike = location) {
    const url = new URL(locationLike.href);
    url.searchParams.delete('_flh_build_check');
    url.searchParams.set('_flh_build', targetBuild);
    return url.href;
  }

  async function remoteBuild(fetchFn = fetch, locationLike = location) {
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

  async function checkNow({
    fetchFn = globalThis.fetch,
    navigate = href => globalThis.location.replace(href),
    storage = globalThis.sessionStorage,
    locationLike = globalThis.location,
    documentLike = globalThis.document
  } = {}) {
    const local = currentBuild(documentLike);
    if (!local || !fetchFn || !locationLike?.href) return { status: 'unavailable', local_build: local };

    try {
      const remote = await remoteBuild(fetchFn, locationLike);
      if (!remote) return { status: 'remote-build-missing', local_build: local };

      if (remote === local) {
        if (guardedGet(storage, RELOAD_GUARD_KEY) === remote) guardedRemove(storage, RELOAD_GUARD_KEY);
        return { status: 'current', local_build: local, remote_build: remote };
      }

      if (guardedGet(storage, RELOAD_GUARD_KEY) === remote) {
        console.warn('[FLH] New build still detected after refresh attempt; suppressing reload loop.');
        return { status: 'loop-guarded', local_build: local, remote_build: remote };
      }

      guardedSet(storage, RELOAD_GUARD_KEY, remote);
      const href = refreshUrl(remote, locationLike);
      navigate(href);
      return { status: 'refreshing', local_build: local, remote_build: remote, href };
    } catch {
      return { status: 'check-failed', local_build: local };
    }
  }

  globalThis.FLHAppVersion = { currentBuild, extractBuild, refreshUrl, remoteBuild, checkNow };

  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  let activeCheck = null;
  const runCheck = () => {
    if (activeCheck) return activeCheck;
    activeCheck = checkNow().finally(() => { activeCheck = null; });
    return activeCheck;
  };
  const checkWhenVisible = () => { if (!document.hidden) void runCheck(); };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', runCheck, { once: true });
  else queueMicrotask(runCheck);

  document.addEventListener('visibilitychange', checkWhenVisible);
  window.addEventListener('focus', checkWhenVisible);
})();
