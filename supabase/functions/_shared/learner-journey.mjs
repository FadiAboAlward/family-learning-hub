// FLH-FEAT-2026-024 v1.1 / Drive revision 2: read-only, self-scoped next actions.
// This summary never starts an attempt or changes the start RPC's authorization.
export const JOURNEY_ROW_LIMIT = 1000;
export const JOURNEY_PAGE_SIZE = 100;
const timestamp = value => value == null ? null : Date.parse(value);
const newest = (rows, field) => rows.slice().sort((a, b) =>
  (timestamp(b[field]) || 0) - (timestamp(a[field]) || 0) || String(b.id).localeCompare(String(a.id)))[0] || null;
const sameScope = (row, workspaceId, learnerId) => row?.workspace_id === workspaceId && row?.learner_id === learnerId;

export function completeJourneyRows(result) {
  if (result?.error || !Array.isArray(result?.data) || !Number.isInteger(result.count)
      || result.count !== result.data.length || result.count > JOURNEY_ROW_LIMIT) {
    throw new Error('JOURNEY_UNAVAILABLE');
  }
  return result.data;
}

// Limits bound each transport call, never the legitimate catalog's total size.
export function journeyIdChunks(ids) {
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id)) throw new Error('JOURNEY_UNAVAILABLE');
  const unique = [...new Set(ids)], chunks = [];
  for (let i = 0; i < unique.length; i += JOURNEY_PAGE_SIZE) chunks.push(unique.slice(i, i + JOURNEY_PAGE_SIZE));
  return chunks;
}

export async function readJourneyRows(queryFactory, trace, name) {
  const rows = [], seen = new Set();
  let cursor = null, total = null;
  while (true) {
    const result = await trace.measure(name, { dbOperations: 1 }, () => {
      let query = queryFactory().order('id', { ascending: true }).limit(JOURNEY_PAGE_SIZE);
      if (cursor) query = query.gt('id', cursor);
      return query;
    });
    const page = result?.data;
    if (result?.error || !Array.isArray(page) || !Number.isSafeInteger(result.count) || result.count < 0
        || page.length !== Math.min(result.count, JOURNEY_PAGE_SIZE)
        || (total !== null && rows.length + result.count !== total)) throw new Error('JOURNEY_UNAVAILABLE');
    total ??= result.count;
    for (const row of page) {
      if (typeof row?.id !== 'string' || !row.id || seen.has(row.id) || (cursor && row.id <= cursor)) throw new Error('JOURNEY_UNAVAILABLE');
      cursor = row.id; seen.add(row.id); rows.push(row);
    }
    if (rows.length === total) return rows;
  }
}

export async function readJourneyRowsByIds(ids, queryFactory, trace, name) {
  const rows = [], seen = new Set();
  for (const chunk of journeyIdChunks(ids)) {
    for (const row of await readJourneyRows(() => queryFactory(chunk), trace, name)) {
      if (seen.has(row.id)) throw new Error('JOURNEY_UNAVAILABLE');
      seen.add(row.id); rows.push(row);
    }
  }
  return rows;
}

export async function readJourneyContext(admin, workspaceId, learnerId, quizIds, trace) {
  const output = { quizIds: [], versions: [], attempts: [], assignments: [], paperVersionIds: [] };
  const batches = quizIds === null ? [null] : journeyIdChunks(quizIds);
  const seenQuizzes = new Set(), seenVersions = new Set();
  for (const batch of batches) {
    let cursor = null;
    while (true) {
      const result = await trace.measure('library.journey_context', { dbOperations: 1 }, () => admin.rpc('flh_learner_journey_context', {
        p_workspace_id: workspaceId, p_learner_id: learnerId, p_quiz_ids: batch,
        p_after_quiz_id: cursor, p_page_size: JOURNEY_PAGE_SIZE,
      }));
      const data = result?.data, requested = batch && new Set(batch);
      if (result?.error || data?.error || data?.complete !== true || !Array.isArray(data.quiz_ids)
          || !Number.isInteger(data.quiz_count) || data.quiz_count !== data.quiz_ids.length || data.quiz_count > JOURNEY_PAGE_SIZE
          || new Set(data.quiz_ids).size !== data.quiz_count
          || data.quiz_ids.some((id, i) => typeof id !== 'string' || !id || (cursor && id <= cursor)
            || (i > 0 && id <= data.quiz_ids[i - 1]) || seenQuizzes.has(id) || (requested && !requested.has(id)))
          || (requested && requested.size !== data.quiz_count) || typeof data.has_more !== 'boolean'
          || (data.has_more ? (batch !== null || data.quiz_count !== JOURNEY_PAGE_SIZE || data.next_quiz_id !== data.quiz_ids.at(-1)) : data.next_quiz_id !== null)
          || !Array.isArray(data.versions) || !Number.isInteger(data.version_count) || data.version_count !== data.versions.length
          || data.version_count > data.quiz_count * 6 || new Set(data.versions.map(v => v?.id)).size !== data.version_count) {
        throw new Error('JOURNEY_UNAVAILABLE');
      }
      const pageQuizzes = new Set(data.quiz_ids), versionCounts = new Map();
      for (const v of data.versions) {
        if (!v || typeof v.id !== 'string' || !v.id || seenVersions.has(v.id) || v.workspace_id !== workspaceId || v.state !== 'published'
            || !pageQuizzes.has(v.quiz_id) || !Number.isInteger(v.version_no) || v.version_no < 1) throw new Error('JOURNEY_UNAVAILABLE');
        versionCounts.set(v.quiz_id, (versionCounts.get(v.quiz_id) || 0) + 1);
      }
      if ([...versionCounts.values()].some(n => n > 6) || (batch === null && data.quiz_ids.some(id => !versionCounts.has(id)))) throw new Error('JOURNEY_UNAVAILABLE');
      const allowed = new Set(data.versions.map(v => v.id));
      validateJourneyProgress(result, workspaceId, learnerId, allowed);
      for (const id of data.quiz_ids) { seenQuizzes.add(id); output.quizIds.push(id); }
      for (const v of data.versions) { seenVersions.add(v.id); output.versions.push(v); }
      output.attempts.push(...data.attempts); output.assignments.push(...data.assignments); output.paperVersionIds.push(...data.paper_version_ids);
      if (!data.has_more) break;
      cursor = data.next_quiz_id;
    }
  }
  return output;
}

function validateJourneyProgress(result, workspaceId, learnerId, allowed) {
  const data = result?.data;
  if (result?.error || data?.error || data?.complete !== true || !Number.isInteger(data.version_count)
      || data.version_count < 0 || data.version_count > JOURNEY_ROW_LIMIT
      || (allowed && data.version_count !== allowed.size)
      || !Array.isArray(data.attempts) || data.attempts.length > data.version_count * 4
      || !Array.isArray(data.assignments) || data.assignments.length > data.version_count * 2
      || !Array.isArray(data.paper_version_ids) || data.paper_version_ids.length > data.version_count
      || data.attempts.some(row => !sameScope(row, workspaceId, learnerId) || typeof row.id !== 'string' || !row.id
        || !['learning', 'exam'].includes(row.delivery_mode) || !['in_progress', 'submitted'].includes(row.status)
        || (allowed && !allowed.has(row.quiz_version_id)))
      || data.assignments.some(row => !sameScope(row, workspaceId, learnerId) || typeof row.id !== 'string' || !row.id
        || !['assigned', 'in_progress', 'completed'].includes(row.status) || (allowed && !allowed.has(row.quiz_version_id)))
      || data.paper_version_ids.some(id => typeof id !== 'string' || (allowed && !allowed.has(id)))
      || new Set(data.attempts.map(row => `${row.quiz_version_id}/${row.delivery_mode}/${row.status}`)).size !== data.attempts.length
      || new Set(data.assignments.map(row => `${row.quiz_version_id}/${row.status === 'completed'}`)).size !== data.assignments.length
      || new Set(data.paper_version_ids).size !== data.paper_version_ids.length
      || (!allowed && (data.attempts.length || data.paper_version_ids.length))) throw new Error('JOURNEY_UNAVAILABLE');
}

export async function readJourneyProgress(admin, workspaceId, learnerId, versionIds, trace) {
  if (versionIds && !versionIds.length) return { attempts: [], assignments: [], paperVersionIds: [] };
  if (versionIds && versionIds.length > JOURNEY_ROW_LIMIT) throw new Error('JOURNEY_UNAVAILABLE');
  const result = await trace.measure('library.journey_progress', { dbOperations: 1 }, () => admin.rpc('flh_learner_journey_progress', {
    p_workspace_id: workspaceId, p_learner_id: learnerId, p_version_ids: versionIds,
  }));
  const data = result?.data;
  validateJourneyProgress(result, workspaceId, learnerId, versionIds && new Set(versionIds));
  return { attempts: data.attempts, assignments: data.assignments, paperVersionIds: data.paper_version_ids };
}

export function eligibleJourneyAssignments(rows, { workspaceId, learnerId, now = Date.now(), versionIds = null }) {
  return rows.filter(a => sameScope(a, workspaceId, learnerId) && (!versionIds || versionIds.has(a.quiz_version_id))
    && ['assigned', 'in_progress'].includes(a.status)
    && (a.available_at == null || (Number.isFinite(timestamp(a.available_at)) && timestamp(a.available_at) <= now))
    && (a.due_at == null || (Number.isFinite(timestamp(a.due_at)) && timestamp(a.due_at) >= now)));
}

export function deriveLearnerJourney({ quiz, versions = [], attempts = [], assignments = [], paperVersionIds = [],
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
      && (paperVersionIds.includes(version.id) || scoped.some(a => a.quiz_version_id === version.id && a.delivery_mode === 'exam' && String(a.paper_model_code || '').trim()));
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
