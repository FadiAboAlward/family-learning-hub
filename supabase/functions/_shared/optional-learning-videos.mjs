// FLH-FEAT-2026-012 v1.1: references and explicit FLH self-report only.
export const VIDEO_SELF_REPORTS = Object.freeze(['not_reported', 'not_watched', 'watched_part', 'watched_full']);
export const VIDEO_VALIDATION_DAYS = 7;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
function invalid() { throw new Error('INVALID_VIDEO_INPUT'); }
function uuid(value) { if (typeof value !== 'string' || !UUID.test(value)) invalid(); return value; }
function text(value, maximum) { if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) invalid(); return value.trim(); }

export function validateVideoCandidate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const allowed = new Set(['learner_id','quiz_version_id','program_id','curriculum_id','grade_level','subject_id','concept_id','position','video_ref','title','language','rationale']);
  if (Object.keys(value).some(key => !allowed.has(key))) invalid();
  const result = {};
  for (const key of ['learner_id','quiz_version_id','program_id','curriculum_id','concept_id']) result[key] = uuid(value[key]);
  const position = value.position == null ? 1 : value.position;
  if (!Number.isInteger(value.grade_level) || value.grade_level < 1 || value.grade_level > 12 || !Number.isSafeInteger(value.subject_id) || value.subject_id < 1 || !Number.isInteger(position) || position < 1 || position > 20) invalid();
  if (!VIDEO_ID.test(value.video_ref || '') || !['ar','tr','en'].includes(value.language)) invalid();
  return {...result, grade_level:value.grade_level,subject_id:value.subject_id,position,video_ref:value.video_ref,title:text(value.title,200),language:value.language,rationale:text(value.rationale,1000)};
}

export function validateVideoReport(value) {
  const allowed = new Set(['action','attempt_id','video_id','self_report','expected_revision','request_id']);
  if (!value || Object.keys(value).some(key => !allowed.has(key)) || !VIDEO_SELF_REPORTS.includes(value.self_report) || !Number.isSafeInteger(value.expected_revision) || value.expected_revision < 0) invalid();
  return {attempt_id:uuid(value.attempt_id),video_id:uuid(value.video_id),self_report:value.self_report,expected_revision:value.expected_revision,request_id:uuid(value.request_id)};
}

/** Retrieve only required provider status. Credentials/payloads never leave this boundary. */
export async function validateYouTubeStatus(videoRef, {apiKey, fetchImpl=fetch, now=Date.now()} = {}) {
  if (!VIDEO_ID.test(videoRef || '') || typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('VIDEO_PROVIDER_UNAVAILABLE');
  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('part','id,status');
    url.searchParams.set('id',videoRef);
    url.searchParams.set('fields','items(id,status(embeddable,madeForKids,privacyStatus))');
    const response = await fetchImpl(url.toString(), {headers:{'X-Goog-Api-Key':apiKey},signal:AbortSignal.timeout(5000)});
    if (!response.ok) throw new Error('VIDEO_PROVIDER_UNAVAILABLE');
    const data = await response.json();
    if (!Array.isArray(data?.items) || data.items.length !== 1 || data.items[0]?.id !== videoRef) throw new Error('VIDEO_PROVIDER_UNAVAILABLE');
    const status = data.items[0].status;
    if (status?.embeddable !== true || typeof status.madeForKids !== 'boolean' || !['public','unlisted'].includes(status.privacyStatus)) throw new Error('VIDEO_PROVIDER_UNAVAILABLE');
    return {embeddable:true,made_for_kids:status.madeForKids,verified_at:new Date(now).toISOString(),verification_expires_at:new Date(now+VIDEO_VALIDATION_DAYS*86400000).toISOString()};
  } catch { throw new Error('VIDEO_PROVIDER_UNAVAILABLE'); }
}

export async function saveOptionalVideoReport(admin, workspaceId, learnerId, body, trace) {
  const report = validateVideoReport(body);
  const {data,error} = await trace.measure('video.report.rpc',{dbOperations:1},()=>admin.rpc('flh_learning_video_report',{p_workspace_id:workspaceId,p_learner_id:learnerId,p_attempt_id:report.attempt_id,p_video_id:report.video_id,p_self_report:report.self_report,p_expected_revision:report.expected_revision,p_request_id:report.request_id}));
  if (error) throw new Error('VIDEO_REPORT_UNAVAILABLE');
  if (data?.error) { const failure = new Error(data.error); failure.data = data; throw failure; }
  return data;
}

export async function attachOptionalVideo(admin, workspaceId, parentId, body, trace, providerOptions) {
  const candidate = validateVideoCandidate(body.video);
  const status = await validateYouTubeStatus(candidate.video_ref,providerOptions);
  const {data,error} = await trace.measure('video.attach.rpc',{dbOperations:1},()=>admin.rpc('flh_learning_video_attach',{p_workspace_id:workspaceId,p_parent_id:parentId,p_candidate:{...candidate,...status}}));
  if (error) throw new Error('VIDEO_ATTACHMENT_UNAVAILABLE');
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function maintainOptionalVideos(admin, workspaceId, body, trace, providerOptions) {
  if (body.action === 'prune_optional_video_status') {
    const {data,error} = await trace.measure('video.prune.rpc',{dbOperations:1},()=>admin.rpc('flh_learning_video_prune_status',{p_workspace_id:workspaceId}));
    if (error) throw new Error('VIDEO_MAINTENANCE_UNAVAILABLE');
    return data;
  }
  const assignmentId = uuid(body.assignment_id);
  const {data:assignment,error:lookupError} = await trace.measure('video.refresh.lookup',{dbOperations:1},()=>admin.from('learning_video_assignments').select('id,video_revision,status_revision,video_ref').eq('workspace_id',workspaceId).eq('id',assignmentId).maybeSingle());
  if (lookupError || !assignment) throw new Error('VIDEO_NOT_AVAILABLE');
  let status = null;
  try { status = await validateYouTubeStatus(assignment.video_ref,providerOptions); } catch { /* Fail closed, with an opaque provider error. */ }
  const {data,error} = await trace.measure('video.refresh.rpc',{dbOperations:1},()=>admin.rpc('flh_learning_video_refresh',{p_workspace_id:workspaceId,p_assignment_id:assignmentId,p_video_revision:assignment.video_revision,p_status_revision:assignment.status_revision,p_status:status}));
  if (error) throw new Error('VIDEO_MAINTENANCE_UNAVAILABLE');
  if (data?.error) throw new Error(data.error);
  return data;
}
