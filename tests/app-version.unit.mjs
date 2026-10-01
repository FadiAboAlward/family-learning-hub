import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../app-version-v1.js', import.meta.url), 'utf8');
const warnings = [];
const context = { globalThis: {}, URL, console: { warn: message => warnings.push(String(message)) } };
context.globalThis = context;
vm.runInNewContext(source, context, { filename: 'app-version-v1.js' });

const api = context.FLHAppVersion;
const doc = build => ({
  querySelector: selector => selector === 'meta[name="app-build"]' ? { content: build } : null,
  body: { dataset: { build } }
});
const makeStorage = () => {
  const values = new Map();
  return {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
};
const response = html => Promise.resolve({ ok: true, text: async () => html });
const locationLike = { href: 'https://example.test/family-learning-hub/?qa=1#student' };
const tick = () => new Promise(resolve => setImmediate(resolve));

/** Minimal browser-like event target for deterministic watcher tests. */
function eventTarget(initial = {}) {
  const listeners = new Map();
  return Object.assign(initial, {
    addEventListener(name, fn, options = {}) {
      const rows = listeners.get(name) || [];
      rows.push({ fn, once: Boolean(options?.once) });
      listeners.set(name, rows);
    },
    emit(name) {
      const rows = [...(listeners.get(name) || [])];
      listeners.set(name, rows.filter(row => !row.once));
      return rows.map(row => row.fn());
    },
    async dispatch(name) {
      await Promise.all(this.emit(name));
    },
    listenerCount(name) {
      return (listeners.get(name) || []).length;
    }
  });
}

/** Evaluate the production watcher with controlled browser globals. */
function loadBrowserRuntime({ readyState = 'loading', hidden = false, fetchFn, storage = makeStorage() } = {}) {
  const document = eventTarget({
    readyState,
    hidden,
    querySelector: selector => selector === 'meta[name="app-build"]' ? { content: 'build-1' } : null,
    body: { dataset: { build: 'build-1' } }
  });
  const window = eventTarget();
  const navigations = [];
  const runtime = {
    URL,
    Date,
    Promise,
    queueMicrotask,
    document,
    window,
    fetch: fetchFn,
    sessionStorage: storage,
    location: {
      href: locationLike.href,
      replace: href => navigations.push(href)
    },
    console: { warn: message => warnings.push(String(message)) }
  };
  runtime.globalThis = runtime;
  vm.runInNewContext(source, runtime, { filename: 'app-version-v1.js' });
  return { runtime, document, window, navigations };
}

assert.equal(api.extractBuild('<meta name="app-build" content="build-2">'), 'build-2');
assert.equal(api.extractBuild('<body data-build="build-3">'), 'build-3');

{
  const navigations = [];
  const result = await api.checkNow({
    fetchFn: () => response('<meta name="app-build" content="build-1">'),
    navigate: href => navigations.push(href),
    storage: makeStorage(),
    locationLike,
    documentLike: doc('build-1')
  });
  assert.equal(result.status, 'current');
  assert.deepEqual(navigations, []);
}

{
  const navigations = [];
  const store = makeStorage();
  const first = await api.checkNow({
    fetchFn: () => response('<meta name="app-build" content="build-2">'),
    navigate: href => navigations.push(href),
    storage: store,
    locationLike,
    documentLike: doc('build-1')
  });
  assert.equal(first.status, 'refreshing');
  assert.equal(navigations.length, 1);
  const target = new URL(navigations[0]);
  assert.equal(target.pathname, '/family-learning-hub/');
  assert.equal(target.searchParams.get('qa'), '1');
  assert.equal(target.searchParams.get('_flh_build'), 'build-2');
  assert.equal(target.hash, '#student');

  const second = await api.checkNow({
    fetchFn: () => response('<meta name="app-build" content="build-2">'),
    navigate: href => navigations.push(href),
    storage: store,
    locationLike,
    documentLike: doc('build-1')
  });
  assert.equal(second.status, 'loop-guarded');
  assert.equal(navigations.length, 1);
  assert.ok(warnings.some(message => message.includes('suppressing reload loop')));
}

{
  const navigations = [];
  const brokenStorage = {
    getItem: () => null,
    setItem: () => { throw new Error('quota'); },
    removeItem: () => {}
  };
  for (let i = 0; i < 2; i++) {
    const result = await api.checkNow({
      fetchFn: () => response('<meta name="app-build" content="build-2">'),
      navigate: href => navigations.push(href),
      storage: brokenStorage,
      locationLike,
      documentLike: doc('build-1')
    });
    assert.equal(result.status, 'unavailable');
  }
  assert.deepEqual(navigations, []);
}

{
  const navigations = [];
  Object.defineProperty(context, 'sessionStorage', {
    configurable: true,
    get() { throw new Error('storage denied'); }
  });
  const result = await api.checkNow({
    fetchFn: () => response('<meta name="app-build" content="build-2">'),
    navigate: href => navigations.push(href),
    locationLike,
    documentLike: doc('build-1')
  });
  assert.equal(result.status, 'unavailable');
  assert.deepEqual(navigations, []);
  delete context.sessionStorage;
}

{
  const navigations = [];
  const result = await api.checkNow({
    fetchFn: async () => { throw new Error('offline'); },
    navigate: href => navigations.push(href),
    storage: makeStorage(),
    locationLike,
    documentLike: doc('build-1')
  });
  assert.equal(result.status, 'check-failed');
  assert.deepEqual(navigations, []);
}

{
  const navigations = [];
  const result = await api.checkNow({
    fetchFn: () => response('<html><body>No build marker</body></html>'),
    navigate: href => navigations.push(href),
    storage: makeStorage(),
    locationLike,
    documentLike: doc('build-1')
  });
  assert.equal(result.status, 'remote-build-missing');
  assert.deepEqual(navigations, []);
}

{
  let fetchCount = 0;
  const browser = loadBrowserRuntime({
    readyState: 'loading',
    hidden: false,
    fetchFn: () => {
      fetchCount++;
      return response('<meta name="app-build" content="build-1">');
    }
  });
  assert.equal(browser.document.listenerCount('DOMContentLoaded'), 1);
  assert.equal(browser.document.listenerCount('visibilitychange'), 1);
  assert.equal(browser.window.listenerCount('focus'), 1);

  await browser.document.dispatch('DOMContentLoaded');
  assert.equal(fetchCount, 1);

  browser.document.hidden = true;
  await browser.document.dispatch('visibilitychange');
  assert.equal(fetchCount, 1);

  browser.document.hidden = false;
  await browser.document.dispatch('visibilitychange');
  assert.equal(fetchCount, 2);

  await browser.window.dispatch('focus');
  assert.equal(fetchCount, 3);
  assert.deepEqual(browser.navigations, []);
}

{
  let fetchCount = 0;
  loadBrowserRuntime({
    readyState: 'complete',
    hidden: false,
    fetchFn: () => {
      fetchCount++;
      return response('<meta name="app-build" content="build-1">');
    }
  });
  await tick();
  assert.equal(fetchCount, 1);
}

{
  let fetchCount = 0;
  let resolveFirst;
  const browser = loadBrowserRuntime({
    readyState: 'loading',
    hidden: false,
    fetchFn: () => {
      fetchCount++;
      if (fetchCount === 1) return new Promise(resolve => { resolveFirst = resolve; });
      return response('<meta name="app-build" content="build-1">');
    }
  });

  browser.document.emit('DOMContentLoaded');
  browser.window.emit('focus');
  await tick();
  assert.equal(fetchCount, 1);

  resolveFirst(await response('<meta name="app-build" content="build-1">'));
  await tick();

  await browser.window.dispatch('focus');
  assert.equal(fetchCount, 2);
}

console.log('App version tests passed: stale-refresh persistence, storage failure safety, automatic readiness/visibility/focus checks, overlap coalescing, route preservation, loop guard, and failure safety are intact.');
