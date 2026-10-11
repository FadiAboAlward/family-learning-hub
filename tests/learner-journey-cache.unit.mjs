import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the actual performance wrapper at its live-origin behavior with
// controlled Responses. No external fetch or browser storage is involved.
const source = fs.readFileSync(new URL('../performance-v1.js', import.meta.url), 'utf8');
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(done => setImmediate(done));
function harness(handle) {
  const values = new Map(), calls = [], timers = [];
  const localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key), key: index => [...values.keys()][index] ?? null, get length() { return values.size; } };
  const window = { fetch: (input, init = {}) => {
    const url = String(input), body = JSON.parse(init.body || '{}'), session = new Headers(init.headers).get('authorization');
    const call = { endpoint: new URL(url).pathname.split('/').at(-1), body, session }; calls.push(call);
    return handle(call);
  } };
  vm.runInNewContext(source, { window, location: { origin: 'https://fadiaboalward.github.io', href: 'https://fadiaboalward.github.io/family-learning-hub/' },
    localStorage, URL, Request, Headers, Response, AbortController, Date, Promise,
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {} }, { filename: 'performance-v1.js' });
  const api = (endpoint, action, session = 'testing-a', payload = {}) => window.fetch(`https://gkpoylfozvuwuwqeoduc.supabase.co/functions/v1/${endpoint}`,
    { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session}` }, body: JSON.stringify({ action, ...payload }) });
  return { api, calls, values, invalidate: window.FLHPerformance.invalidateStudentCatalog };
}

{
  let revision = 1;
  const h = harness(async c => response({ revision, session: c.session, action: c.body.action }));
  await h.api('student-library-api', 'catalog'); await h.api('student-library-api', 'catalog', 'testing-b');
  await h.api('family-api', 'learner_choices');
  h.values.set('unrelated-storage', 'preserve');
  const keysBefore = [...h.values.keys()], countBefore = h.calls.length;
  const key = h.invalidate('testing-a');
  assert.ok(keysBefore.includes(`flh_perf_cache_v2|${key}`));
  assert.equal(h.values.has(`flh_perf_cache_v2|${key}`), false, 'only selected session persisted catalog is removed');
  assert.deepEqual([...h.values.keys()].sort(), keysBefore.filter(k => k !== `flh_perf_cache_v2|${key}`).sort());
  revision = 2;
  assert.equal((await (await h.api('student-library-api', 'catalog')).json()).revision, 2, 'selected session fetches current state');
  assert.equal((await (await h.api('student-library-api', 'catalog', 'testing-b')).json()).revision, 1, 'other session memory remains cached');
  await h.api('family-api', 'learner_choices');
  assert.equal(h.calls.length, countBefore + 1, 'unrelated profile/choice/catalog caches are not cleared');
}

{
  const old = deferred(), fresh = deferred(); let fetches = 0;
  const h = harness(() => (++fetches === 1 ? old.promise : fresh.promise));
  const oldRead = h.api('student-library-api', 'catalog');
  h.invalidate('testing-a');
  const newRead = h.api('student-library-api', 'catalog');
  assert.equal(fetches, 2, 'new read does not coalesce an invalidated old promise');
  old.resolve(response({ marker: 'old' })); await oldRead;
  const coalescedNewRead = h.api('student-library-api', 'catalog');
  assert.equal(fetches, 2, 'old finally cannot remove newer in-flight request ownership');
  fresh.resolve(response({ marker: 'current' }));
  assert.equal((await (await newRead).json()).marker, 'current');
  assert.equal((await (await coalescedNewRead).json()).marker, 'current');
  assert.equal((await (await h.api('student-library-api', 'catalog')).json()).marker, 'current', 'late old snapshot cannot restore memory cache');
  assert.ok([...h.values.values()].every(value => !value.includes('"marker":"old"')), 'late old snapshot cannot restore persisted cache');
}

{
  const firstSave = deferred(); let saves = 0, submitted = false;
  const h = harness(c => {
    if (c.body.action === 'save_answer') { saves++; return saves === 1 ? firstSave.promise : Promise.resolve(response({ ok: true })); }
    if (c.body.action === 'submit_exam') { submitted = true; return Promise.resolve(response({ ok: true })); }
    return Promise.resolve(response({ ok: true }));
  });
  assert.equal((await (await h.api('exam-v2-api', 'save_answer', 'testing-a', { attempt_id: 'qa-attempt', question_id: 'qa-question', option_position: 1 })).json()).queued, true);
  h.invalidate('testing-a');
  const submit = h.api('exam-v2-api', 'submit_exam', 'testing-a', { attempt_id: 'qa-attempt' });
  await tick(); assert.equal(submitted, false, 'catalog invalidation leaves pending answer-save queue intact');
  firstSave.resolve(response({ error: 'SYNTHETIC_SAVE_FAILURE' }, 503));
  assert.equal((await (await submit).json()).ok, true); assert.equal(saves, 2, 'failed queued save remains available for retry before submission');
  assert.equal(submitted, true);
}
console.log('Learner journey cache regressions passed: scoped memory/persistent invalidation, old/new in-flight ownership, and pending Exam save/retry preservation.');
