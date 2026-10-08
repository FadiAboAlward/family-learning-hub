// FLH-FEAT-2026-024 v1.0: read-only, self-scoped next actions.
// This summary never starts an attempt or changes the start RPC's authorization.
export const JOURNEY_ROW_LIMIT = 1000;
const timestamp = value => value == null ? null : Date.parse(value);
const newest = (rows, field) => rows.slice().sort((a, b) =>
  (timestamp(b[field]) || 0) - (timestamp(a[field]) || 0) || String(b.id).localeCompare(String(a.id)))[0] || null;
const sameScope = (row, workspaceId, learnerId) => row.workspace_id === workspaceId && row.learner_id === learnerId;

export function completeJourneyRows(result) {
  if (result?.error || !Array.isArray(result?.data) || !Number.isInteger(result.count)
      || result.count !== result.data.length || result.count > JOURNEY_ROW_LIMIT) {
    throw new Error('JOURNEY_UNAVAILABLE');
  }
  return result.data;
}

export async function readJourneyProgress(admin, workspaceId, learnerId, versionIds, trace, knownAssignments = null) {
  if (!versionIds.length) return { attempts: [], assignments: [] };
  const measure = (name, query) => trace.measure(name, { dbOperations: 1 }, () => query);
  const [attempts, assignments] = await Promise.all([
    measure('library.journey_attempts', admin.from('quiz_attempts')
      .select('id,workspace_id,learner_id,quiz_version_id,status,delivery_mode,started_at,submitted_at,paper_model_code:metadata->>paper_model_code', { count: 'exact' })
      .eq('workspace_id', workspaceId).eq('learner_id', learnerId).in('quiz_version_id', versionIds)
      .in('status', ['in_progress', 'submitted']).in('delivery_mode', ['learning', 'exam'])
      .limit(JOURNEY_ROW_LIMIT)),
    knownAssignments == null ? measure('library.journey_assignments', admin.from('quiz_assignments')
      .select('id,workspace_id,learner_id,quiz_version_id,status,available_at,due_at,created_at', { count: 'exact' })
      .eq('workspace_id', workspaceId).eq('learner_id', learnerId).in('quiz_version_id', versionIds)
      .in('status', ['assigned', 'in_progress']).limit(JOURNEY_ROW_LIMIT)) : Promise.resolve({ data: knownAssignments, count: knownAssignments.length }),
  ]);
  return { attempts: completeJourneyRows(attempts), assignments: completeJourneyRows(assignments) };
}

export function eligibleJourneyAssignments(rows, { workspaceId, learnerId, now = Date.now(), versionIds = null }) {
  return rows.filter(a => sameScope(a, workspaceId, learnerId) && (!versionIds || versionIds.has(a.quiz_version_id))
    && ['assigned', 'in_progress'].includes(a.status)
    && (a.available_at == null || (Number.isFinite(timestamp(a.available_at)) && timestamp(a.available_at) <= now))
    && (a.due_at == null || (Number.isFinite(timestamp(a.due_at)) && timestamp(a.due_at) >= now)));
}

export function deriveLearnerJourney({ quiz, versions = [], attempts = [], assignments = [],
  workspaceId, learnerId, programAccess = false, now = Date.now() }) {
  const published = versions.filter(v => v.workspace_id === workspaceId && v.quiz_id === quiz.id && v.state === 'published');
  const byVersion = new Map(published.map(v => [v.id, v]));
  const scoped = attempts.filter(a => sameScope(a, workspaceId, learnerId) && byVersion.has(a.quiz_version_id)
    && ['learning', 'exam'].includes(a.delivery_mode) && ['in_progress', 'submitted'].includes(a.status));
  const eligible = eligibleJourneyAssignments(assignments, { workspaceId, learnerId, now, versionIds: new Set(byVersion.keys()) });
  const assigned = newest(eligible, 'created_at');
  const latest = published.slice().sort((a, b) => Number(b.version_no) - Number(a.version_no))[0] || null;
  const submitted = scoped.filter(a => a.status === 'submitted');
  const latestResult = newest(submitted, 'submitted_at');

  function mode(modeName) {
    const active = newest(scoped.filter(a => a.delivery_mode === modeName && a.status === 'in_progress'), 'started_at');
    // Match each existing RPC: original active version, eligible explicit assignment, latest publication.
    const version = byVersion.get(active?.quiz_version_id || assigned?.quiz_version_id) || latest;
    const access = Boolean(version && (programAccess || eligible.some(a => a.quiz_version_id === version.id)));
    const supportPaper = modeName === 'learning' && [true, 'true'].includes(version?.support_source)
      && scoped.some(a => a.quiz_version_id === version.id && a.delivery_mode === 'exam' && String(a.paper_model_code || '').trim());
    const available = access && quiz.delivery_config?.[modeName]?.enabled !== false && !supportPaper;
    const result = newest(submitted.filter(a => a.delivery_mode === modeName && a.quiz_version_id === version?.id), 'submitted_at');
    return { available, version, active, result };
  }
  const learning = mode('learning'), exam = mode('exam');
  let state = null, action = null, version = learning.available ? learning.version : exam.available ? exam.version : latest;
  let active = null, result = null;
  if (learning.available && learning.active) {
    state = 'CONTINUE_LEARNING'; action = 'learning'; version = learning.version; active = learning.active;
  } else if (exam.available && exam.active) {
    state = 'START_EXAM'; action = 'exam'; version = exam.version; active = exam.active;
  } else {
    const examResult = newest(submitted.filter(a => a.delivery_mode === 'exam' && a.quiz_version_id === version?.id), 'submitted_at');
    const learningResult = newest(submitted.filter(a => a.delivery_mode === 'learning' && a.quiz_version_id === version?.id), 'submitted_at');
    if (examResult) {
      state = 'COMPLETE'; action = 'results'; result = examResult;
    } else if (learningResult && exam.available && exam.version?.id === version?.id) {
      state = 'START_EXAM'; action = 'exam'; version = exam.version;
    } else if (learningResult) {
      // Learning-only support exercises complete with their own result; never force an Exam.
      state = 'COMPLETE'; action = 'results'; result = learningResult;
    } else if (learning.available || exam.available) {
      state = 'NEW'; action = learning.available ? 'learning' : 'exam';
    } else if (latestResult) {
      state = 'COMPLETE'; action = 'results'; result = latestResult; version = byVersion.get(result.quiz_version_id);
    }
  }
  const summary = value => ({ available: value.available, resumed: Boolean(value.available && value.active), quiz_version_id: value.version?.id || null });
  return {
    state, primary_action: action, quiz_version_id: version?.id || null,
    attempt_id: active?.id || null, result_attempt_id: result?.id || null,
    latest_result_attempt_id: latestResult?.id || null,
    learning: summary(learning), exam: summary(exam),
  };
}
