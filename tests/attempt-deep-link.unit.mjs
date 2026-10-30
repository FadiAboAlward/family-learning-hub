import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../deep-link-v1.js', import.meta.url), 'utf8');
const historySource = fs.readFileSync(new URL('../attempt-history-v1.js', import.meta.url), 'utf8');
const indexSource = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

async function runDeepLink(rawUrl, flh = {}) {
  const url = new URL(rawUrl);
  const calls = [];
  let replaced = null;
  const location = {
    search: url.search,
    hash: url.hash,
    href: url.href,
  };
  const context = {
    URL,
    URLSearchParams,
    location,
    window: { FLH: flh, addEventListener: () => {} },
    history: { replaceState: (_a, _b, next) => { replaced = next; } },
    localStorage: { getItem: key => key === 'learner_session' ? 'payload.signature' : null },
    sessionStorage: { getItem: () => null },
    document: {
      querySelector: () => null,
      getElementById: () => null,
      addEventListener: () => {},
      documentElement: {},
    },
    MutationObserver: class { observe() {} },
    setTimeout: fn => { fn(); return 1; },
    CSS: { escape: value => value },
    console,
  };
  if (flh.openAttemptHistoryAttempt) {
    const original = flh.openAttemptHistoryAttempt;
    flh.openAttemptHistoryAttempt = async id => { calls.push(['attempt', id]); return original(id); };
  }
  if (flh.startExamQuiz) {
    const original = flh.startExamQuiz;
    flh.startExamQuiz = slug => { calls.push(['exam', slug]); return original(slug); };
  }
  if (flh.startLearningQuiz) {
    const original = flh.startLearningQuiz;
    flh.startLearningQuiz = slug => { calls.push(['learning', slug]); return original(slug); };
  }
  vm.runInNewContext(source, context, { filename: 'deep-link-v1.js' });
  await new Promise(resolve => setImmediate(resolve));
  return { calls, replaced };
}

const attemptId = '41e1c1bd-c8d4-4294-9ca6-f581950602ae';
const attempt = await runDeepLink(
  `https://example.test/?attempt=${attemptId}&learner=mohammad#student`,
  { openAttemptHistoryAttempt: async () => true },
);
assert.deepEqual(attempt.calls, [['attempt', attemptId]], 'valid attempt link should open the exact attempt');
assert.equal(attempt.replaced, '/#student', 'attempt and learner parameters should be removed after launch');

const invalid = await runDeepLink(
  'https://example.test/?attempt=not-a-uuid&learner=mohammad#student',
  { openAttemptHistoryAttempt: async () => true },
);
assert.equal(invalid.calls.length, 0, 'invalid attempt IDs must not launch history');

const exam = await runDeepLink(
  'https://example.test/?quiz=qa-automation-core&mode=exam&learner=test#student',
  { startExamQuiz: () => true },
);
assert.deepEqual(exam.calls, [['exam', 'qa-automation-core']], 'existing quiz deep links must keep working');
assert.equal(exam.replaced, '/#student', 'quiz route parameters should still be cleaned');

assert.match(historySource, /openAttemptHistoryAttempt=openAttempt/, 'attempt history must expose the deep-link opener');
assert.match(historySource, /attemptIdOk/, 'attempt history must validate attempt IDs before opening');
const build=indexSource.match(/<body[^>]*data-build="([^"]+)"/)?.[1];
assert.ok(build,'index must declare the unified data-build cache key');
assert.ok(indexSource.includes(`deep-link-v1.js?v=${build}`),'deep-link asset must use the unified cache-bust key');
assert.ok(indexSource.includes(`attempt-history-v1.js?v=${build}`),'attempt-history asset must use the unified cache-bust key');


async function simulateQuizLink({ initialToken = 'valid.session', profile = { learner: { slug: 'mohammad' } }, starts = [true] } = {}) {
  const url = new URL('https://example.test/index.html?quiz=moh-english-review&mode=learning&learner=mohammad#student');
  let storedToken = initialToken, currentProfile = profile, observer = null, cleaned = null, selected = 0, calls = 0;
  const buttons = {
    '[data-dynamic-learner="mohammad"], [data-slug="mohammad"]': { click: () => { selected++; } },
  };
  const context = {
    URL, URLSearchParams,
    location: { href: url.href, hash: url.hash, search: url.search },
    history: { replaceState: (_a,_b,next) => { cleaned = next; } },
    state: { get learnerProfile() { return currentProfile; } },
    localStorage: { getItem: key => key === 'learner_session' ? storedToken : null },
    sessionStorage: { getItem: () => null },
    window: { FLH: { startLearningQuiz: () => { const value = starts[Math.min(calls, starts.length-1)]; calls++; return Promise.resolve(value); } }, addEventListener: () => {} },
    document: { documentElement: {}, querySelector: selector => buttons[selector] || null, getElementById: () => null, addEventListener: () => {} },
    MutationObserver: class { constructor(fn) { observer = fn; } observe() {} },
    setTimeout: fn => { fn(); return 1; },
    CSS: { escape: x => x },
  };
  vm.runInNewContext(source, context, { filename: 'deep-link-v1.js' });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await settle();
  return {
    get calls() { return calls; },
    get cleaned() { return cleaned; },
    get selected() { return selected; },
    trigger: async () => { observer?.(); await settle(); },
    login: async () => { storedToken = 'new.valid.session'; currentProfile = { learner: { slug: 'mohammad' } }; observer?.(); await settle(); },
    switchSession: async () => { storedToken = 'another.valid.session'; observer?.(); await settle(); },
  };
}

const fresh = await simulateQuizLink({ initialToken: '', profile: null });
assert.equal(fresh.selected, 1, 'active dynamic learner card must be preselected');
assert.equal(fresh.calls, 0, 'must not launch before login');
assert.equal(fresh.cleaned, null, 'must preserve exact link while logged out');
await fresh.login();
assert.equal(fresh.calls, 1, 'launch exact quiz after login');
assert.equal(fresh.cleaned, '/index.html#student', 'clean parameters only after successful start');

const loading = await simulateQuizLink({ profile: null });
assert.equal(loading.calls, 0, 'wait for validated learner profile, even with cached session token');
await loading.login();
assert.equal(loading.calls, 1, 'launch after validation completes');

const declined = await simulateQuizLink({ starts: [false, true] });
assert.equal(declined.calls, 1, 'start attempted only once');
assert.equal(declined.cleaned, null, 'denied start must not consume link');
await declined.trigger();
assert.equal(declined.calls, 1, 'DOM mutation must not cause repeated denied-start attempts');
await declined.switchSession();
assert.equal(declined.calls, 2, 'fresh authenticated session may retry');
assert.equal(declined.cleaned, '/index.html#student', 'successful retry cleans link');


console.log('Attempt deep-link unit tests passed.');
