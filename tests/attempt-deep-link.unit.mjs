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
  { startExamQuiz: () => {} },
);
assert.deepEqual(exam.calls, [['exam', 'qa-automation-core']], 'existing quiz deep links must keep working');
assert.equal(exam.replaced, '/#student', 'quiz route parameters should still be cleaned');

assert.match(historySource, /openAttemptHistoryAttempt=openAttempt/, 'attempt history must expose the deep-link opener');
assert.match(historySource, /attemptIdOk/, 'attempt history must validate attempt IDs before opening');
assert.match(indexSource, /deep-link-v1\.js\?v=20260910-attempt1/, 'deep-link asset must be cache-busted');
assert.match(indexSource, /attempt-history-v1\.js\?v=20260910-attempt1/, 'attempt-history asset must be cache-busted');

console.log('Attempt deep-link unit tests passed.');
