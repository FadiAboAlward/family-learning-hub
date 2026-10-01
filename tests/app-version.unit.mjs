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

console.log('App version tests passed: same-build no-op, one-shot stale refresh, route preservation, loop guard, and failure safety are intact.');
