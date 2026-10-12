import { validateAcademicPackage } from './academic-content-quality.mjs';
import { ASSESSMENT_DELIVERY_ACTIONS,assessmentDeliveryCommand } from './assessment-delivery.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const deny = code => { throw new Error(code); };
export const ASSESSMENT_ACTIONS = Object.freeze(['stage_assessment','publish_assessment','release_assessment','read_assessment',...Object.keys(ASSESSMENT_DELIVERY_ACTIONS)]);

/** Preserve every candidate field and array order while normalizing object keys. */
export function canonicalAssessment(value) {
  if (Array.isArray(value)) return value.map(canonicalAssessment);
  if (!object(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key,canonicalAssessment(value[key])]));
}

/** The same full-candidate SHA-256 identity used by the operator preflight. */
export async function academicCandidateHash(candidate) {
  const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonicalAssessment(candidate))));
  return Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
}

/** Validate exact content and explicit semantic/source approval before any RPC write. */
export async function assessmentStagePayload(workspaceId,parentId,body) {
  const target = body.target;
  const keys = ['quiz_id','quiz_version_id','learner_id','program_id'];
  if (!object(target) || Object.keys(target).some(k=>!keys.includes(k)) || keys.some(k=>!UUID.test(target[k]||''))) deny('ASSESSMENT_TARGET_INVALID');
  const candidate = body.candidate;
  let report;
  try { report = validateAcademicPackage(candidate); } catch { deny('ASSESSMENT_ACADEMIC_REJECTED'); }
  if (!report.ok || candidate.questions.length !== 40
      || candidate.questions.filter(q=>q.delivery_surface==='learning').length !== 20
      || candidate.questions.filter(q=>q.delivery_surface==='exam').length !== 20
      || candidate.questions.some(q=>q.question_type!=='single_choice' || !/^Q-[0-9]{6,}$/.test(q.question_code))) deny('ASSESSMENT_ACADEMIC_REJECTED');
  const hash = await academicCandidateHash(candidate);
  const review = body.semantic_review;
  if (!object(review) || review.result!=='PASS' || review.candidate_sha256!==hash
      || review.workspace_id!==workspaceId || keys.some(k=>review[k]!==target[k])
      || ['reviewer_ref','source_review_ref','learner_scope_review_ref','authority_ref'].some(k=>!text(review[k]))
      || !Number.isFinite(Date.parse(review.reviewed_at)) || Date.parse(review.reviewed_at)>Date.now()+60000
      || !Array.isArray(review.warning_dispositions)
      || report.warnings.some(w=>!review.warning_dispositions.some(d=>object(d) && d.code===w.code && d.path===w.path && d.result==='ACCEPTED' && text(d.reason)))) deny('ASSESSMENT_SEMANTIC_REVIEW_REQUIRED');
  return {target,candidate,candidate_sha256:hash,validation:report,semantic_review:{...review,reviewed_by:parentId}};
}

/** Parent identity is supplied exclusively by the existing authenticated API boundary. */
export async function assessmentCommand(admin,workspaceId,parentId,body,trace) {
  if (!ASSESSMENT_ACTIONS.includes(body.action)) deny('ASSESSMENT_ACTION_INVALID');
  if(Object.hasOwn(ASSESSMENT_DELIVERY_ACTIONS,body.action))return assessmentDeliveryCommand(admin,workspaceId,parentId,body,trace);
  const action = body.action.replace('_assessment','');
  let payload;
  if (action==='stage') payload=await assessmentStagePayload(workspaceId,parentId,body);
  else {
    if (!UUID.test(body.quiz_version_id||'') || !/^[a-f0-9]{64}$/.test(body.candidate_sha256||'')) deny('ASSESSMENT_TARGET_INVALID');
    payload={quiz_version_id:body.quiz_version_id,candidate_sha256:body.candidate_sha256};
  }
  const {data,error}=await trace.measure('assessment.'+action+'.rpc',{dbOperations:1},()=>admin.rpc('flh_assessment_command',{
    p_workspace_id:workspaceId,p_parent_id:parentId,p_action:action,p_payload:payload
  }));
  if (error) deny(/^ASSESSMENT_[A-Z_]+$/.test(error.message||'')?error.message:'ASSESSMENT_UNAVAILABLE');
  if (data?.error) deny(data.error);
  if (data?.ok!==true) deny('ASSESSMENT_UNAVAILABLE');
  return data;
}
