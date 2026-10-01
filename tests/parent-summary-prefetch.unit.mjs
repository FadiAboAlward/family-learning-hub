import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('parent-center-v3.js', 'utf8');
const helperStart = source.indexOf('const SUMMARY_PREFETCH_TTL_MS=');
const helperEnd = source.indexOf("let accessData=null", helperStart);
const installStart = source.indexOf('async function installDashboard()');
const installEnd = source.indexOf('function shellPage', installStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'summary prefetch helper should be discoverable');
assert.ok(installStart >= 0 && installEnd > installStart, 'installDashboard should be discoverable');

const helperSource = source.slice(helperStart, helperEnd);
const installSource = source.slice(installStart, installEnd);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

let currentToken = 'parent-a';
let now = 1_000;
const calls = [];
const requests = [];
const report = { dataset: {}, innerHTML: '' };
const hero = { textContent: 'لوحة الأهل' };
const documentStub = {
  querySelector(selector) {
    if (selector === '.hero h1') return hero;
    if (selector === '[data-parent-center-nav]') return {};
    return null;
  },
  querySelectorAll(selector) {
    if (selector === '#app .panel') return [];
    return [];
  },
  getElementById(id) {
    return id === 'learningSessionReport' ? report : null;
  },
};

const RealDate = Date;
class FakeDate extends RealDate {
  static now() { return now; }
}

const context = vm.createContext({
  location: { hash: '#parents' },
  document: documentStub,
  Date: FakeDate,
  ACTIVITY: 'activity-api',
  token: () => currentToken,
  call: (url, action, payload) => {
    const d = deferred();
    calls.push({ url, action, payload, token: currentToken });
    requests.push(d);
    return d.promise;
  },
  bindNav: () => {},
  safe: value => String(value ?? ''),
  fmtMin: () => '0 د',
  fmtDate: () => '—',
});

vm.runInContext(
  `${helperSource}\n${installSource}\nglobalThis.__prefetch=prefetchDashboardSummary;globalThis.__clear=clearSummaryPrefetch;globalThis.__install=installDashboard;globalThis.__ttl=SUMMARY_PREFETCH_TTL_MS;`,
  context,
);

const prefetch = context.__prefetch;
const clear = context.__clear;
const install = context.__install;
const ttl = context.__ttl;

const first = prefetch();
assert.strictEqual(prefetch(), first, 'same-token callers should reuse one in-flight summary request');
assert.equal(calls.length, 1, 'same-token in-flight reuse should issue one backend call');

const installPromise = install();
assert.equal(calls.length, 1, 'dashboard installation should consume the existing prefetch instead of issuing a duplicate');
requests[0].resolve({ learners: [], summaries: [] });
await installPromise;

const afterConsume = prefetch();
assert.notStrictEqual(afterConsume, first, 'a consumed dashboard summary should not be reused on a later visit');
assert.equal(calls.length, 2, 'consuming the dashboard summary should allow a fresh request');

requests[1].resolve({ learners: [], summaries: [] });
await afterConsume;
assert.strictEqual(prefetch(), afterConsume, 'a recently settled unconsumed prefetch may be reused within the short freshness window');
now += ttl + 1;
const afterTtl = prefetch();
assert.notStrictEqual(afterTtl, afterConsume, 'an unconsumed settled prefetch should expire after the freshness window');
assert.equal(calls.length, 3, 'TTL expiry should issue a fresh request');

currentToken = 'parent-b';
const changedToken = prefetch();
assert.notStrictEqual(changedToken, afterTtl, 'changing the parent token should never reuse the previous token request');
assert.equal(calls.length, 4, 'a new parent token should issue a new request');
requests[2].resolve({ learners: [], summaries: [] });
requests[3].resolve({ learners: [], summaries: [] });
await Promise.all([afterTtl, changedToken]);

clear(changedToken);
currentToken = 'parent-c';
const rejected = prefetch();
const rejectionObserved = rejected.catch(() => 'rejected');
requests[4].reject(new Error('expected test rejection'));
assert.equal(await rejectionObserved, 'rejected');
const afterReject = prefetch();
assert.notStrictEqual(afterReject, rejected, 'a rejected prefetch should be cleared for retry');
assert.equal(calls.length, 6, 'retry after rejection should issue a fresh request');
requests[5].resolve({ learners: [], summaries: [] });
await afterReject;

console.log('Parent activity summary prefetch behavior: PASS');
