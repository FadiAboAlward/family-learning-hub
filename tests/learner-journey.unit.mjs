import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { completeJourneyRows, deriveLearnerJourney, eligibleJourneyAssignments, JOURNEY_ROW_LIMIT, readJourneyProgress } from '../supabase/functions/_shared/learner-journey.mjs';

// Synthetic fixtures only. No learner data, backend requests or attempt writes.
const workspaceId = 'qa-workspace', learnerId = 'qa-testing';
const now = Date.parse('2026-10-08T12:00:00Z');
const quiz = { id: 'qa-quiz', delivery_config: {} };
const version = (id, version_no, extra = {}) => ({ id, version_no, quiz_id: quiz.id, workspace_id: workspaceId, state: 'published', ...extra });
const versions = [version('v1', 1), version('v2', 2)];
const attempt = (id, delivery_mode, status, quiz_version_id = 'v2', extra = {}) => ({ id, delivery_mode, status, quiz_version_id,
  workspace_id: workspaceId, learner_id: learnerId, started_at: '2026-10-08T10:00:00Z', submitted_at: status === 'submitted' ? '2026-10-08T11:00:00Z' : null, ...extra });
const assignment = (id, quiz_version_id = 'v1', extra = {}) => ({ id, quiz_version_id, workspace_id: workspaceId, learner_id: learnerId,
  status: 'assigned', available_at: null, due_at: null, created_at: '2026-10-08T09:00:00Z', ...extra });
const derive = overrides => deriveLearnerJourney({ quiz, versions, workspaceId, learnerId, now, programAccess: true, ...overrides });
const checks = [];
const test = (name, run) => checks.push({ name, run });

test('untouched published package starts Learning; library read never creates attempts', () => {
  const d = derive({});
  assert.equal(d.state, 'NEW'); assert.equal(d.primary_action, 'learning'); assert.equal(d.quiz_version_id, 'v2');
  assert.equal(d.attempt_id, null); assert.equal(d.result_attempt_id, null);
});
test('original active Learning version wins over eligible newer assignment and publication', () => {
  const d = derive({ attempts: [attempt('old-learning', 'learning', 'in_progress', 'v1')], assignments: [assignment('new-assignment', 'v2')] });
  assert.equal(d.state, 'CONTINUE_LEARNING'); assert.equal(d.quiz_version_id, 'v1'); assert.equal(d.attempt_id, 'old-learning');
  assert.equal(d.learning.resumed, true); assert.equal(d.exam.quiz_version_id, 'v2');
});
test('newest active original Exam resumes before fresh Learning and keeps its version', () => {
  const d = derive({ attempts: [attempt('older-exam', 'exam', 'in_progress', 'v2', { started_at: '2026-10-08T08:00:00Z' }), attempt('active-exam', 'exam', 'in_progress', 'v1')] });
  assert.equal(d.state, 'START_EXAM'); assert.equal(d.primary_action, 'exam'); assert.equal(d.quiz_version_id, 'v1');
  assert.equal(d.attempt_id, 'active-exam'); assert.equal(d.exam.resumed, true);
  assert.equal(d.learning.quiz_version_id, 'v2'); assert.equal(d.learning.available, true, 'pending fresh v2 Learning does not retarget active v1 Exam');
});
test('active Learning stays primary when both independent modes are active', () => {
  const d = derive({ attempts: [attempt('la', 'learning', 'in_progress', 'v1'), attempt('ea', 'exam', 'in_progress', 'v2')] });
  assert.equal(d.state, 'CONTINUE_LEARNING'); assert.equal(d.learning.quiz_version_id, 'v1'); assert.equal(d.exam.quiz_version_id, 'v2');
});
test('Learning completion on served version leads to Exam without imposing a prerequisite gate', () => {
  const d = derive({ attempts: [attempt('learning-result', 'learning', 'submitted')] });
  assert.equal(d.state, 'START_EXAM'); assert.equal(d.primary_action, 'exam'); assert.equal(d.exam.available, true);
  assert.equal(derive({}).exam.available, true, 'untouched package still offers independent Exam as an alternative');
});
test('Exam completion displays exact submitted result even without Learning completion', () => {
  const d = derive({ attempts: [attempt('exam-result', 'exam', 'submitted')] });
  assert.equal(d.state, 'COMPLETE'); assert.equal(d.primary_action, 'results'); assert.equal(d.result_attempt_id, 'exam-result');
});
test('Learning-only support exercises complete with Learning review and no forced Exam', () => {
  const d = derive({ quiz: { ...quiz, delivery_config: { support_session: true, exam: { enabled: false } } }, attempts: [attempt('support-result', 'learning', 'submitted')] });
  assert.equal(d.state, 'COMPLETE'); assert.equal(d.result_attempt_id, 'support-result'); assert.equal(d.exam.available, false);
});
test('historical completion never marks a newer untouched published version complete', () => {
  const d = derive({ attempts: [attempt('old-exam-result', 'exam', 'submitted', 'v1'), attempt('old-learning-result', 'learning', 'submitted', 'v1')] });
  assert.equal(d.state, 'NEW'); assert.equal(d.quiz_version_id, 'v2'); assert.equal(d.result_attempt_id, null);
  assert.ok(['old-exam-result', 'old-learning-result'].includes(d.latest_result_attempt_id));
});
test('eligible explicit version assignment wins latest without inventing program access', () => {
  const d = derive({ programAccess: false, assignments: [assignment('valid-old')] });
  assert.equal(d.state, 'NEW'); assert.equal(d.quiz_version_id, 'v1'); assert.equal(d.learning.available, true);
  assert.equal(d.exam.quiz_version_id, 'v1'); assert.equal(d.exam.available, true);
});
test('latest eligible assignment is selected after date/status/workspace/learner filters', () => {
  const rows = [assignment('valid-old'), assignment('eligible-new', 'v2', { created_at: '2026-10-08T10:00:00Z' }),
    assignment('future', 'v1', { available_at: '2026-10-09T00:00:00Z', created_at: '2026-10-08T11:00:00Z' }),
    assignment('expired', 'v1', { due_at: '2026-10-07T00:00:00Z' }), assignment('completed', 'v1', { status: 'completed' }),
    assignment('sibling', 'v1', { learner_id: 'qa-sibling' }), assignment('tenant', 'v1', { workspace_id: 'qa-other-workspace' }),
    assignment('malformed', 'v1', { due_at: 'not-a-date' })];
  assert.equal(derive({ programAccess: false, assignments: rows }).quiz_version_id, 'v2');
  assert.equal(derive({ programAccess: false, assignments: rows.slice(2) }).state, null);
});
test('an old active attempt alone does not grant revoked access or retarget to an assignment', () => {
  const d = derive({ programAccess: false, attempts: [attempt('la', 'learning', 'in_progress', 'v1')], assignments: [assignment('assigned-new', 'v2')] });
  assert.equal(d.learning.available, false); assert.equal(d.learning.quiz_version_id, 'v1');
  assert.equal(d.primary_action, 'exam'); assert.equal(d.quiz_version_id, 'v2');
});
test('catalog-only direct assignment does not become RPC start permission', () => {
  const d = derive({ programAccess: false });
  assert.equal(d.state, null); assert.equal(d.primary_action, null);
  assert.equal(d.learning.available, false); assert.equal(d.exam.available, false);
});
test('revoked start access keeps existing self-scoped submitted results reviewable', () => {
  const d = derive({ programAccess: false, attempts: [attempt('own-result', 'exam', 'submitted', 'v1')] });
  assert.equal(d.state, 'COMPLETE'); assert.equal(d.quiz_version_id, 'v1'); assert.equal(d.result_attempt_id, 'own-result');
});
test('sibling, foreign-workspace, other-quiz and retired-version attempts do not affect state', () => {
  const d = derive({ versions: [...versions, version('retired', 3, { state: 'retired' }), version('unrelated', 4, { quiz_id: 'other-quiz' }), version('tenant-version', 5, { workspace_id: 'other-workspace' })],
    attempts: [attempt('sibling', 'learning', 'in_progress', 'v2', { learner_id: 'qa-sibling' }), attempt('foreign', 'exam', 'submitted', 'v2', { workspace_id: 'other-workspace' }),
      attempt('retired-attempt', 'learning', 'in_progress', 'retired'), attempt('other-quiz', 'exam', 'submitted', 'unrelated'), attempt('foreign-version', 'exam', 'submitted', 'tenant-version')] });
  assert.equal(d.state, 'NEW'); assert.equal(d.quiz_version_id, 'v2'); assert.equal(d.latest_result_attempt_id, null);
});
test('session switch derives only the new learner and never reuses prior learner state', () => {
  const shared = [attempt('test-learning', 'learning', 'in_progress'), attempt('other-result', 'exam', 'submitted', 'v2', { learner_id: 'qa-testing-second' })];
  assert.equal(derive({ attempts: shared }).state, 'CONTINUE_LEARNING');
  assert.equal(derive({ attempts: shared, learnerId: 'qa-testing-second' }).result_attempt_id, 'other-result');
});
test('official support paper evidence prevents parallel Learning and exposes submitted paper result', () => {
  const settings = [version('v2', 2, { support_source: 'true' })];
  const d = derive({ quiz: { ...quiz, delivery_config: { exam: { enabled: false } } }, versions: settings,
    attempts: [attempt('paper-result', 'exam', 'submitted', 'v2', { paper_model_code: 'QA-PAPER' })] });
  assert.equal(d.learning.available, false); assert.equal(d.state, 'COMPLETE'); assert.equal(d.result_attempt_id, 'paper-result');
  assert.equal(derive({ versions: settings, attempts: [attempt('paper-active', 'exam', 'in_progress', 'v2', { paper_model_code: 'QA-PAPER' })] }).learning.available, false);
});
test('disabled Learning does not hide supported independent Exam', () => {
  const d = derive({ quiz: { ...quiz, delivery_config: { learning: { enabled: false } } } });
  assert.equal(d.state, 'NEW'); assert.equal(d.primary_action, 'exam'); assert.equal(d.learning.available, false);
});
test('summary allowlist never exposes answer content, private metadata or scoring keys', () => {
  const d = derive({ attempts: [attempt('result', 'exam', 'submitted', 'v2', { response: 'PRIVATE_RESPONSE_SENTINEL', metadata: { secret: 'PRIVATE_METADATA_SENTINEL' }, correct_answer: 'PRIVATE_KEY_SENTINEL' })] });
  const serialized = JSON.stringify(d);
  assert.doesNotMatch(serialized, /PRIVATE_|response|correct_answer|metadata|percentage|reward/);
  assert.deepEqual(Object.keys(d).sort(), ['state', 'primary_action', 'quiz_version_id', 'attempt_id', 'result_attempt_id', 'latest_result_attempt_id', 'learning', 'exam'].sort());
});
test('failed or truncated bounded reads fail closed rather than guessing NEW', () => {
  for (const value of [{ error: { message: 'private raw error' }, data: [], count: 0 }, { data: [], count: 1 }, { data: [], count: null }, { data: [], count: JOURNEY_ROW_LIMIT + 1 }]) {
    assert.throws(() => completeJourneyRows(value), /^Error: JOURNEY_UNAVAILABLE$/);
  }
  assert.deepEqual(completeJourneyRows({ data: [], count: 0, error: null }), []);
});
test('progress queries are bounded read-only self/workspace/version/status projections', async () => {
  const calls = [];
  const admin = { from(table) {
    const entry = { table, filters: [] }; calls.push(entry);
    const query = {
      select(columns, options) { entry.columns = columns; entry.options = options; return query; },
      eq(key, value) { entry.filters.push(['eq', key, value]); return query; },
      in(key, values) { entry.filters.push(['in', key, values]); return query; },
      limit(value) { entry.limit = value; return query; },
      then(resolve, reject) { return Promise.resolve({ data: [], count: 0, error: null }).then(resolve, reject); },
    }; return query;
  } };
  const traces = [], trace = { measure: async (name, options, run) => { traces.push([name, options]); return run(); } };
  assert.deepEqual(await readJourneyProgress(admin, workspaceId, learnerId, ['v1', 'v2'], trace), { attempts: [], assignments: [] });
  assert.deepEqual(calls.map(c => c.table), ['quiz_attempts', 'quiz_assignments']);
  for (const call of calls) {
    assert.deepEqual(call.options, { count: 'exact' }); assert.equal(call.limit, JOURNEY_ROW_LIMIT);
    assert.ok(call.filters.some(x => x[0] === 'eq' && x[1] === 'workspace_id' && x[2] === workspaceId));
    assert.ok(call.filters.some(x => x[0] === 'eq' && x[1] === 'learner_id' && x[2] === learnerId));
    assert.ok(call.filters.some(x => x[0] === 'in' && x[1] === 'quiz_version_id' && x[2].join() === 'v1,v2'));
    assert.doesNotMatch(call.columns, /response|correct_answer|grading|metadata(?:,|$)|\*/);
  }
  assert.equal(traces.length, 2); assert.ok(traces.every(x => x[1].dbOperations === 1));
  await readJourneyProgress(admin, workspaceId, learnerId, [], trace);
  assert.equal(calls.length, 2, 'empty visible catalog needs no progress read');
});

// Execute the actual catalog body with in-memory PostgREST query results. Its
// production authentication/serve wrapper is deliberately never initialized.
function catalogHarness(tables, failedTable = null) {
  const calls = [];
  const admin = { from(table) {
    const entry = { table, filters: [] }; calls.push(entry);
    const query = {
      select(columns, options) { entry.columns = columns; entry.counted = options?.count === 'exact'; return query; },
      eq(key, value) { entry.filters.push(['eq', key, value]); return query; },
      in(key, values) { entry.filters.push(['in', key, values]); return query; },
      order() { return query; }, limit(value) { entry.limit = value; return query; },
      then(resolve, reject) {
        const rows = (tables[table] || []).filter(row => entry.filters.every(([kind, key, value]) => kind === 'eq' ? row[key] === value : value.includes(row[key])));
        return Promise.resolve(table === failedTable ? { data: null, count: null, error: { message: 'PRIVATE_DATABASE_FAILURE' } }
          : { data: structuredClone(rows.slice(0, entry.limit ?? rows.length)), count: entry.counted ? rows.length : null, error: null }).then(resolve, reject);
      },
    }; return query;
  } };
  const source = readFileSync(new URL('../supabase/functions/student-library-api/index.ts', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('function cleanQuiz'), source.indexOf('Deno.serve'));
  class FixedDate extends Date { static now() { return now; } }
  const catalog = vm.runInNewContext(stripTypeScriptTypes(body) + '\ncatalog;', { admin, WORKSPACE_ID: workspaceId, Date: FixedDate,
    completeJourneyRows, deriveLearnerJourney, eligibleJourneyAssignments, JOURNEY_ROW_LIMIT, readJourneyProgress });
  const trace = { measure: async (_name, _options, run) => run() };
  return { run: () => catalog(learnerId, trace), calls };
}
const catalogQuiz = (extra = {}) => ({ ...quiz, workspace_id: workspaceId, slug: 'qa-assigned', title: 'Synthetic assigned activity', status: 'active', book_id: null, unit_id: null, ...extra });
test('actual catalog displays authorized bookless explicit assignment with old immutable version', async () => {
  const harness = catalogHarness({ quizzes: [catalogQuiz(), catalogQuiz({ id: 'unassigned', title: 'PRIVATE_UNASSIGNED_TITLE' })], quiz_versions: versions,
    quiz_assignments: [assignment('own-assignment'), assignment('sibling', 'v2', { learner_id: 'other-learner' }), assignment('future', 'v2', { available_at: '2026-10-09T00:00:00Z' })] });
  const d = await harness.run();
  assert.equal(d.standalone_assessments.length, 1); assert.equal(d.standalone_assessments[0].journey.quiz_version_id, 'v1');
  assert.equal(d.standalone_assessments[0].journey.state, 'NEW'); assert.equal(d.standalone_books.length, 0);
  assert.doesNotMatch(JSON.stringify(d), /PRIVATE_|other-learner|sibling/);
  assert.equal(harness.calls.filter(c => c.table === 'quiz_assignments').length, 1, 'one initial read also supplies routing context');
  assert.ok(harness.calls.every(c => !/answer|key|reward|gamification/.test(c.table)), 'catalog reads no answer or award tables');
});
test('actual catalog displays authorized bookless program quiz without a book or assignment', async () => {
  const tables = { learner_program_enrollments: [{ workspace_id: workspaceId, learner_id: learnerId, status: 'active', program: { id: 'p', status: 'active', title: 'Testing program' } }],
    program_quizzes: [{ workspace_id: workspaceId, program_id: 'p', quiz_id: quiz.id, availability: 'available' }, { workspace_id: workspaceId, program_id: 'p', quiz_id: 'blocked-quiz', availability: 'locked' }],
    quizzes: [catalogQuiz(), catalogQuiz({ id: 'blocked-quiz', title: 'PRIVATE_UNAVAILABLE_TITLE' })], quiz_versions: versions };
  const d = await catalogHarness(tables).run();
  assert.equal(d.standalone_assessments.length, 1); assert.equal(d.standalone_assessments[0].journey.state, 'NEW');
  assert.equal(d.standalone_assessments[0].journey.quiz_version_id, 'v2'); assert.equal(d.programs[0].books.length, 0);
  assert.doesNotMatch(JSON.stringify(d), /PRIVATE_/);
  const inactive = { ...tables, learner_program_enrollments: [{ ...tables.learner_program_enrollments[0], status: 'removed' }] };
  assert.equal((await catalogHarness(inactive).run()).standalone_assessments.length, 0, 'inactive enrollment is not access');
});
test('completed bookless assignment appears only with its own actual submitted result', async () => {
  const tables = { quizzes: [catalogQuiz()], quiz_versions: versions, quiz_assignments: [assignment('done', 'v1', { status: 'completed' })], quiz_attempts: [attempt('own-result', 'exam', 'submitted', 'v1')] };
  const d = await catalogHarness(tables).run();
  assert.equal(d.standalone_assessments[0].journey.state, 'COMPLETE'); assert.equal(d.standalone_assessments[0].journey.result_attempt_id, 'own-result');
  assert.equal(d.standalone_assessments[0].journey.learning.available, false);
  assert.equal((await catalogHarness({ ...tables, quiz_attempts: [] }).run()).standalone_assessments.length, 0, 'an assignment label alone cannot fabricate completion');
  assert.equal((await catalogHarness({ ...tables, quiz_attempts: [attempt('sibling-result', 'exam', 'submitted', 'v1', { learner_id: 'other-learner' })] }).run()).standalone_assessments.length, 0);
});
test('assigned activities already visible in a program are not duplicated', async () => {
  const tables = { learner_program_enrollments: [{ workspace_id: workspaceId, learner_id: learnerId, status: 'active', program: { id: 'p', status: 'active', title: 'Testing program' } }],
    program_books: [{ workspace_id: workspaceId, program_id: 'p', book_id: 'b', sort_order: 1 }], program_quizzes: [{ workspace_id: workspaceId, program_id: 'p', quiz_id: quiz.id, availability: 'available' }],
    books: [{ id: 'b', title: 'Testing book' }], units: [{ id: 'u', book_id: 'b', sort_order: 1, title: 'Testing unit' }],
    quizzes: [catalogQuiz({ book_id: 'b', unit_id: 'u' })], quiz_versions: versions, quiz_assignments: [assignment('assigned')] };
  const d = await catalogHarness(tables).run();
  assert.equal(d.programs[0].books[0].units[0].quizzes[0].journey.quiz_version_id, 'v1'); assert.equal(d.standalone_assessments.length, 0);
});
test('actual direct-book catalog remains visible but cannot invent start permission', async () => {
  const d = await catalogHarness({ learner_content_assignments: [{ workspace_id: workspaceId, learner_id: learnerId, status: 'active', resource_type: 'book', resource_id: 'b' }],
    books: [{ id: 'b', title: 'Testing direct book' }], quizzes: [catalogQuiz({ book_id: 'b' })], quiz_versions: versions }).run();
  const j = d.standalone_books[0].extras[0].journey;
  assert.equal(j.state, null); assert.equal(j.learning.available, false); assert.equal(j.exam.available, false);
});
test('actual catalog rejects failed journey data rather than returning an inaccurate action', async () => {
  const harness = catalogHarness({ quizzes: [catalogQuiz()], quiz_versions: versions, quiz_assignments: [assignment('own')] }, 'quiz_attempts');
  await assert.rejects(harness.run(), /^Error: JOURNEY_UNAVAILABLE$/);
});

for (const { name, run } of checks) { await run(); console.log(`PASS ${name}`); }
console.log(`Learner journey: ${checks.length} synthetic state, immutable routing, authorization and read-only query regressions passed.`);
