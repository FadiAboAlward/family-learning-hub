import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { completeJourneyRows, deriveLearnerJourney, eligibleJourneyAssignments, JOURNEY_ROW_LIMIT, JOURNEY_PAGE_SIZE,
  readJourneyProgress, readJourneyContext, readJourneyRows, readJourneyRowsByIds } from '../supabase/functions/_shared/learner-journey.mjs';

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
  assert.equal(derive({ versions: settings, paperVersionIds: ['v2'], attempts: [attempt('new-digital-result', 'exam', 'submitted')] }).learning.available, false,
    'compact latest digital result must not erase older own paper evidence');
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
test('compact progress RPC carries only verified scope/version arguments and rejects incomplete evidence', async () => {
  const calls = [];
  const complete = { complete: true, version_count: 2, attempts: [], assignments: [], paper_version_ids: [] };
  let response = { data: complete, error: null };
  const admin = { rpc: async (name, args) => { calls.push({ name, args }); return response; } };
  const traces = [], trace = { measure: async (name, options, run) => { traces.push([name, options]); return run(); } };
  assert.deepEqual(await readJourneyProgress(admin, workspaceId, learnerId, ['v1', 'v2'], trace), { attempts: [], assignments: [], paperVersionIds: [] });
  assert.deepEqual(calls, [{ name: 'flh_learner_journey_progress', args: { p_workspace_id: workspaceId, p_learner_id: learnerId, p_version_ids: ['v1', 'v2'] } }]);
  assert.equal(traces.length, 1); assert.ok(traces.every(x => x[1].dbOperations === 1));
  await readJourneyProgress(admin, workspaceId, learnerId, [], trace);
  assert.equal(calls.length, 1, 'empty visible catalog needs no progress read');
  for (const data of [{ ...complete, complete: false }, { error: 'JOURNEY_UNAVAILABLE' }, { ...complete, version_count: 1001 },
    { ...complete, version_count: 1 },
    { ...complete, attempts: [attempt('foreign', 'exam', 'submitted', 'v1', { learner_id: 'sibling' })] },
    { ...complete, assignments: [assignment('foreign', 'v1', { workspace_id: 'foreign' })] },
    { ...complete, paper_version_ids: ['unrequested'] }, { ...complete, attempts: Array(9).fill(attempt('too-many', 'exam', 'submitted')) }]) {
    response = { data, error: null };
    await assert.rejects(readJourneyProgress(admin, workspaceId, learnerId, ['v1', 'v2'], trace), /^Error: JOURNEY_UNAVAILABLE$/);
  }
  response = { data: complete, error: { message: 'PRIVATE_DATABASE_FAILURE' } };
  await assert.rejects(readJourneyProgress(admin, workspaceId, learnerId, ['v1'], trace), /^Error: JOURNEY_UNAVAILABLE$/);
  const before = calls.length;
  await assert.rejects(readJourneyProgress(admin, workspaceId, learnerId, Array(1001).fill('v1'), trace), /^Error: JOURNEY_UNAVAILABLE$/);
  assert.equal(calls.length, before, 'oversized version request fails before RPC');
});

// Execute the actual catalog body with in-memory PostgREST query results. Its
// production authentication/serve wrapper is deliberately never initialized.
function catalogHarness(tables, failedTable = null) {
  const calls = [];
  const admin = { async rpc(name, args) {
    calls.push({ rpc: name, args });
    if (failedTable === 'quiz_attempts' || failedTable === 'quiz_assignments') return { data: null, error: { message: 'PRIVATE_DATABASE_FAILURE' } };
    const scope = row => row.workspace_id === args.p_workspace_id && row.learner_id === args.p_learner_id;
    const ownAttempts = (tables.quiz_attempts || []).filter(row => scope(row) && ['in_progress', 'submitted'].includes(row.status) && ['learning', 'exam'].includes(row.delivery_mode));
    const published = (tables.quiz_versions || []).filter(row => row.workspace_id === args.p_workspace_id && row.state === 'published');
    const versionMap = new Map(published.map(v => [v.id, v]));
    const relevant = (tables.quiz_assignments || []).filter(row => scope(row) && versionMap.has(row.quiz_version_id)
      && (eligibleJourneyAssignments([row], { workspaceId, learnerId, now }).length || (row.status === 'completed' && ownAttempts.some(t => t.quiz_version_id === row.quiz_version_id && t.status === 'submitted'))));
    const assignedQuizSet = new Set(relevant.map(a => versionMap.get(a.quiz_version_id).quiz_id));
    const latest = (rows, field) => rows.slice().sort((a, b) => (Date.parse(b[field]) || 0) - (Date.parse(a[field]) || 0) || String(b.id).localeCompare(String(a.id)))[0];
    assert.equal(name, 'flh_learner_journey_context');
    const discovery = args.p_quiz_ids === null;
    const candidates = (tables.quizzes || []).filter(q => q.workspace_id === workspaceId && q.status === 'active'
      && (discovery ? assignedQuizSet.has(q.id) : args.p_quiz_ids.includes(q.id)))
      .map(q => q.id).sort();
    const eligibleIds = candidates.filter(id => !args.p_after_quiz_id || id > args.p_after_quiz_id);
    const hasMore = discovery && eligibleIds.length > args.p_page_size;
    const quizIds = discovery ? eligibleIds.slice(0, args.p_page_size) : candidates;
    const chosen = quizIds.flatMap(id => {
      const ownVersions = published.filter(v => v.quiz_id === id), versionSet = new Set(ownVersions.map(v => v.id));
      const activity = ownAttempts.filter(t => versionSet.has(t.quiz_version_id)), assigned = relevant.filter(a => versionSet.has(a.quiz_version_id));
      return [ownVersions.slice().sort((a, b) => b.version_no - a.version_no)[0]?.id,
        ...['learning', 'exam'].map(mode => latest(activity.filter(t => t.delivery_mode === mode && t.status === 'in_progress'), 'started_at')?.quiz_version_id),
        latest(assigned.filter(a => a.status !== 'completed'), 'created_at')?.quiz_version_id,
        latest(activity.filter(t => t.status === 'submitted'), 'submitted_at')?.quiz_version_id,
        latest(assigned.filter(a => a.status === 'completed'), 'created_at')?.quiz_version_id].filter(Boolean);
    });
    const versionIds = [...new Set(chosen)];
    calls.at(-1).contextVersionCount = versionIds.length;
    const assignments = versionIds.flatMap(id => [false, true].map(completed => latest(relevant.filter(row => row.quiz_version_id === id && (row.status === 'completed') === completed), 'created_at')).filter(Boolean));
    const attempts = versionIds.flatMap(id => ['learning', 'exam'].flatMap(mode => ['in_progress', 'submitted'].map(status => latest(ownAttempts.filter(t => t.quiz_version_id === id && t.delivery_mode === mode && t.status === status), status === 'in_progress' ? 'started_at' : 'submitted_at')).filter(Boolean)));
    const paper = versionIds.filter(id => ownAttempts.some(t => t.quiz_version_id === id && t.delivery_mode === 'exam' && String(t.paper_model_code || '').trim()));
    return { data: { complete: true, quiz_ids: quizIds, quiz_count: quizIds.length, has_more: hasMore,
      next_quiz_id: hasMore ? quizIds.at(-1) : null, versions: published.filter(v => versionIds.includes(v.id)),
      version_count: versionIds.length, attempts, assignments, paper_version_ids: paper }, error: null };
  }, from(table) {
    const entry = { table, filters: [] }; calls.push(entry);
    const query = {
      select(columns, options) { entry.columns = columns; entry.counted = options?.count === 'exact'; return query; },
      eq(key, value) { entry.filters.push(['eq', key, value]); return query; },
      in(key, values) { entry.filters.push(['in', key, values]); return query; },
      gt(key, value) { entry.filters.push(['gt', key, value]); return query; },
      order(key) { entry.order = key; return query; }, limit(value) { entry.limit = value; return query; },
      then(resolve, reject) {
        const rows = (tables[table] || []).map((row, i) => ({ id: `${table}-${String(i).padStart(6, '0')}`, ...row }))
          .filter(row => entry.filters.every(([kind, key, value]) => kind === 'eq' ? row[key] === value : kind === 'gt' ? row[key] > value : value.includes(row[key])))
          .sort((a, b) => a[entry.order] < b[entry.order] ? -1 : a[entry.order] > b[entry.order] ? 1 : 0);
        return Promise.resolve(table === failedTable ? { data: null, count: null, error: { message: 'PRIVATE_DATABASE_FAILURE' } }
          : { data: structuredClone(rows.slice(0, entry.limit ?? rows.length)), count: entry.counted ? rows.length : null, error: null }).then(resolve, reject);
      },
    }; return query;
  } };
  const source = readFileSync(new URL('../supabase/functions/student-library-api/index.ts', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('function cleanQuiz'), source.indexOf('Deno.serve'));
  class FixedDate extends Date { static now() { return now; } }
  const catalog = vm.runInNewContext(stripTypeScriptTypes(body) + '\ncatalog;', { admin, WORKSPACE_ID: workspaceId, Date: FixedDate,
    deriveLearnerJourney, eligibleJourneyAssignments, readJourneyContext, readJourneyRows, readJourneyRowsByIds });
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
  assert.equal(harness.calls.filter(c => c.table === 'quiz_assignments').length, 0, 'assignment history is compacted behind the service RPC');
  assert.equal(harness.calls.filter(c => c.rpc === 'flh_learner_journey_context').length, 2, 'paged assignment discovery then compact visible quiz context');
  assert.ok(harness.calls.every(c => !/answer|key|reward|gamification/.test(c.table || c.rpc)), 'catalog reads no answer or award tables');
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
test('actual catalog remains correct with more than 1000 historical retakes and completed assignments', async () => {
  const history = Array.from({ length: 1001 }, (_, i) => attempt(`history-${i}`, 'learning', 'submitted', 'v1', { submitted_at: new Date(now - (1001 - i) * 1000).toISOString() }));
  const assignmentHistory = Array.from({ length: 1001 }, (_, i) => assignment(`done-${i}`, 'v1', { status: 'completed' }));
  const base = { quizzes: [catalogQuiz()], quiz_versions: versions, quiz_assignments: [...assignmentHistory, assignment('eligible-old')], quiz_attempts: history };
  const d = await catalogHarness(base).run();
  assert.equal(d.standalone_assessments[0].journey.state, 'START_EXAM');
  assert.equal(d.standalone_assessments[0].journey.quiz_version_id, 'v1', 'eligible old immutable version remains selected');
  assert.equal(d.standalone_assessments[0].journey.latest_result_attempt_id, 'history-1000');
  const resumed = await catalogHarness({ ...base, quiz_attempts: [...history, attempt('original-active', 'learning', 'in_progress', 'v1')] }).run();
  assert.equal(resumed.standalone_assessments[0].journey.state, 'CONTINUE_LEARNING');
  assert.equal(resumed.standalone_assessments[0].journey.attempt_id, 'original-active');
});

test('1001 publications compact to all six relevant contexts and preserve old original active versions', async () => {
  const publications = Array.from({ length: 1001 }, (_, i) => version(`publication-${String(i + 1).padStart(4, '0')}`, i + 1));
  const ids = publications.map(v => v.id);
  const harness = catalogHarness({ quizzes: [catalogQuiz()], quiz_versions: publications,
    learner_program_enrollments: [{ workspace_id: workspaceId, learner_id: learnerId, status: 'active', program: { id: 'p', status: 'active' } }],
    program_quizzes: [{ workspace_id: workspaceId, program_id: 'p', quiz_id: quiz.id, availability: 'available' }],
    quiz_attempts: [attempt('original-learning', 'learning', 'in_progress', ids[0]), attempt('original-exam', 'exam', 'in_progress', ids[1]),
      attempt('latest-result', 'exam', 'submitted', ids[3]), attempt('completed-assignment-result', 'learning', 'submitted', ids[4], { submitted_at: '2026-10-08T09:00:00Z' })],
    quiz_assignments: [assignment('eligible-third', ids[2]), assignment('completed-fifth', ids[4], { status: 'completed' })] });
  const result = await harness.run(), journey = result.standalone_assessments[0].journey;
  assert.equal(journey.state, 'CONTINUE_LEARNING'); assert.equal(journey.quiz_version_id, ids[0]);
  assert.equal(journey.exam.quiz_version_id, ids[1]); assert.equal(journey.latest_result_attempt_id, 'latest-result');
  assert.ok(harness.calls.filter(c => c.rpc).every(c => c.contextVersionCount === 6), 'six independently required versions survive; other 995 publications never leave the RPC');
  assert.equal(harness.calls.filter(c => c.table === 'quiz_versions').length, 0, 'never collect full publication metadata');
  const untouched = await catalogHarness({ quizzes: [catalogQuiz()], quiz_versions: publications,
    learner_program_enrollments: [{ workspace_id: workspaceId, learner_id: learnerId, status: 'active', program: { id: 'p', status: 'active' } }],
    program_quizzes: [{ workspace_id: workspaceId, program_id: 'p', quiz_id: quiz.id, availability: 'available' }] }).run();
  assert.equal(untouched.standalone_assessments[0].journey.state, 'NEW');
  assert.equal(untouched.standalone_assessments[0].journey.quiz_version_id, ids.at(-1), 'untouched current publication stays current');
});

test('completed assigned version survives when latest own result belongs to another unassigned version', async () => {
  const d = await catalogHarness({ quizzes: [catalogQuiz()], quiz_versions: versions,
    quiz_assignments: [assignment('completed-old', 'v1', { status: 'completed' })],
    quiz_attempts: [attempt('older-assigned-result', 'learning', 'submitted', 'v1', { submitted_at: '2026-10-08T08:00:00Z' }), attempt('newer-own-result', 'exam', 'submitted', 'v2')] }).run();
  assert.equal(d.standalone_assessments.length, 1); assert.equal(d.standalone_assessments[0].journey.state, 'COMPLETE');
  assert.equal(d.standalone_assessments[0].journey.result_attempt_id, 'newer-own-result');
});

test('1001 legitimate assigned activities page completely without a global catalog cap', async () => {
  const activities = Array.from({ length: 1001 }, (_, i) => catalogQuiz({ id: `activity-${String(i).padStart(4, '0')}` }));
  const publications = activities.map(q => version(`version-${q.id}`, 1, { quiz_id: q.id }));
  const harness = catalogHarness({ quizzes: activities, quiz_versions: publications,
    quiz_assignments: publications.map(v => assignment(`assignment-${v.id}`, v.id)) });
  const result = await harness.run();
  assert.equal(result.standalone_assessments.length, 1001);
  assert.ok(result.standalone_assessments.every(q => q.journey.state === 'NEW' && q.journey.learning.available));
  assert.equal(new Set(result.standalone_assessments.map(q => q.id)).size, 1001);
  const rpc = harness.calls.filter(c => c.rpc);
  assert.equal(rpc.filter(c => c.args.p_quiz_ids === null).length, 11, 'all discovery pages read through final cursor');
  assert.equal(rpc.filter(c => c.args.p_quiz_ids !== null).length, 11, 'visible quiz contexts use <=100 quiz batches');
  assert.ok(rpc.every(c => c.contextVersionCount <= 600));
  assert.ok(harness.calls.flatMap(c => c.filters || []).filter(([kind]) => kind === 'in').every(([, , ids]) => ids.length <= JOURNEY_PAGE_SIZE));
});

test('1001 available program quizzes remain visible outside any book, with latest and original resume truth', async () => {
  const activities = Array.from({ length: 1001 }, (_, i) => catalogQuiz({ id: `program-activity-${String(i).padStart(4, '0')}` }));
  const publications = activities.flatMap(q => [version(`old-${q.id}`, 1, { quiz_id: q.id }), version(`latest-${q.id}`, 2, { quiz_id: q.id })]);
  const harness = catalogHarness({ quizzes: activities, quiz_versions: publications,
    learner_program_enrollments: [{ workspace_id: workspaceId, learner_id: learnerId, status: 'active', program: { id: 'p', status: 'active' } }],
    program_quizzes: activities.map(q => ({ workspace_id: workspaceId, program_id: 'p', quiz_id: q.id, availability: 'available' })),
    quiz_attempts: [attempt('program-original-active', 'exam', 'in_progress', `old-${activities.at(-1).id}`)] });
  const result = await harness.run();
  assert.equal(result.standalone_assessments.length, 1001); assert.equal(result.programs[0].books.length, 0);
  assert.equal(result.standalone_assessments[0].journey.quiz_version_id, `latest-${activities[0].id}`);
  const resumed = result.standalone_assessments.find(q => q.id === activities.at(-1).id).journey;
  assert.equal(resumed.state, 'START_EXAM'); assert.equal(resumed.quiz_version_id, `old-${activities.at(-1).id}`);
  assert.equal(resumed.attempt_id, 'program-original-active');
  assert.equal(harness.calls.filter(c => c.table === 'program_quizzes').length, 11, 'program access rows also paginate rather than silently hit PostgREST row limit');
});

test('metadata pagination rejects truncation, count changes, repeats and failed later pages', async () => {
  const page = Array.from({ length: 100 }, (_, i) => ({ id: `row-${String(i).padStart(4, '0')}` }));
  const trace = { measure: async (_name, _options, run) => run() };
  for (const broken of [{ data: [], count: 1 }, { data: [page.at(-1)], count: 1 }, { data: [{ id: 'row-0100' }], count: 2 },
    { data: [{ id: 'row-0100' }], count: null }, { data: null, count: null, error: { message: 'PRIVATE_SQL_FAILURE' } }]) {
    let calls = 0;
    const factory = () => ({ order() { return this; }, limit(n) { assert.equal(n, 100); return this; }, gt(field, value) { assert.equal(field, 'id'); assert.equal(value, page.at(-1).id); return this; },
      then(resolve) { return Promise.resolve(calls++ ? broken : { data: page, count: 101 }).then(resolve); } });
    await assert.rejects(readJourneyRows(factory, trace, 'synthetic.metadata'), /^Error: JOURNEY_UNAVAILABLE$/);
    assert.equal(calls, 2, 'failure is bounded and no partial catalog is returned');
  }
});

test('context carriers reject missing counts, foreign scope, repeated cursors and oversized per-quiz metadata', async () => {
  const carrier = { complete: true, quiz_ids: [quiz.id], quiz_count: 1, versions: [versions[0]], version_count: 1,
    has_more: false, next_quiz_id: null, attempts: [], assignments: [], paper_version_ids: [] };
  const trace = { measure: async (_name, _options, run) => run() };
  for (const bad of [{ ...carrier, complete: false }, { ...carrier, quiz_count: 2 }, { ...carrier, quiz_ids: [] },
    { ...carrier, versions: [] }, { ...carrier, versions: [version('foreign', 1, { workspace_id: 'foreign' })] },
    { ...carrier, versions: [null] }, { ...carrier, attempts: [null] }, { ...carrier, assignments: [null] },
    { ...carrier, attempts: [attempt('sibling', 'exam', 'submitted', 'v1', { learner_id: 'sibling' })] },
    { ...carrier, attempts: [attempt('first', 'exam', 'submitted', 'v1'), attempt('second', 'exam', 'submitted', 'v1')] },
    { ...carrier, assignments: [assignment('first'), assignment('second')] },
    { ...carrier, paper_version_ids: ['v1', 'v1'] },
    { ...carrier, has_more: true, next_quiz_id: quiz.id }, { ...carrier, next_quiz_id: quiz.id },
    { ...carrier, versions: Array.from({ length: 7 }, (_, i) => version(`v${i}`, i + 1)), version_count: 7 }]) {
    await assert.rejects(readJourneyContext({ rpc: async () => ({ data: bad }) }, workspaceId, learnerId, [quiz.id], trace), /^Error: JOURNEY_UNAVAILABLE$/);
  }
  const ids = Array.from({ length: 100 }, (_, i) => `quiz-${String(i).padStart(4, '0')}`);
  const repeated = { ...carrier, quiz_ids: ids, quiz_count: 100, versions: ids.map(id => version(`v-${id}`, 1, { quiz_id: id })), version_count: 100, has_more: true, next_quiz_id: ids.at(-1) };
  let calls = 0;
  await assert.rejects(readJourneyContext({ rpc: async () => { calls++; return { data: repeated }; } }, workspaceId, learnerId, null, trace), /^Error: JOURNEY_UNAVAILABLE$/);
  assert.equal(calls, 2, 'same discovery cursor is rejected before any retry loop');
  let emptyCalls = 0;
  await readJourneyContext({ rpc: async () => { emptyCalls++; } }, workspaceId, learnerId, [], trace);
  assert.equal(emptyCalls, 0);
});

test('failed final context chunk rejects the whole 1001-activity read rather than returning partial success', async () => {
  const ids = Array.from({ length: 1001 }, (_, i) => `quiz-${String(i).padStart(4, '0')}`), calls = [];
  const admin = { rpc: async (_name, args) => {
    calls.push(args);
    if (calls.length === 11) return { error: { message: 'PRIVATE_FINAL_CHUNK_FAILURE' }, data: null };
    return { data: { complete: true, quiz_ids: args.p_quiz_ids, quiz_count: args.p_quiz_ids.length,
      versions: args.p_quiz_ids.map(id => version(`v-${id}`, 1, { quiz_id: id })), version_count: args.p_quiz_ids.length,
      has_more: false, next_quiz_id: null, attempts: [], assignments: [], paper_version_ids: [] } };
  } };
  await assert.rejects(readJourneyContext(admin, workspaceId, learnerId, ids, { measure: async (_name, _opts, run) => run() }), /^Error: JOURNEY_UNAVAILABLE$/);
  assert.equal(calls.length, 11); assert.ok(calls.every(c => c.p_quiz_ids.length <= 100 && c.p_workspace_id === workspaceId && c.p_learner_id === learnerId));
});

for (const { name, run } of checks) { await run(); console.log(`PASS ${name}`); }
console.log(`Learner journey: ${checks.length} synthetic state, immutable routing, authorization and read-only query regressions passed.`);
