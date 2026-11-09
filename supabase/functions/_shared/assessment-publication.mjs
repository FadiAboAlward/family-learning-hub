import { validateAcademicPackage } from './academic-content-quality.mjs';
import { ASSESSMENT_DELIVERY_ACTIONS,assessmentDeliveryCommand } from './assessment-delivery.mjs';
import { verifyAssessmentMedia } from './assessment-media.mjs';
import { isVisualPackage } from './assessment-visual-contract.mjs';

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
  if (action==='stage') {
    if(isVisualPackage(body.candidate)&&body.candidate?.academic_context?.visual_plan?.policy!=='subject-aware-v1'){
      // New direct learning-api stages must have a visual plan. Permit only
      // owner-bound immutable pre-policy retries: a published/staged receipt OR
      // an authenticated authoring draft receipt tied to this request UUID.
      const version=body.target?.quiz_version_id,hash=await academicCandidateHash(body.candidate);
      const targetKeys=['quiz_id','quiz_version_id','learner_id','program_id'];
      const matchesTarget=(stored)=>targetKeys.every(k=>UUID.test(stored?.[k]||'')&&UUID.test(body.target?.[k]||'')
        &&stored[k].toLowerCase()===body.target[k].toLowerCase());
      if(!UUID.test(version||''))deny('ASSESSMENT_ACADEMIC_REJECTED');
      const prior=await admin.rpc('flh_assessment_command',{p_workspace_id:workspaceId,p_parent_id:parentId,
        p_action:'read',p_payload:{quiz_version_id:version,candidate_sha256:hash}});
      if(prior.data?.ok===true&&object(prior.data.publication)){
        const stored=prior.data.publication;
        if(stored.candidate_sha256!==hash||!matchesTarget(stored))
          deny('ASSESSMENT_RETRY_CONFLICT');
      }else{
        // A known missing publication is normal for a never-staged draft.
        // Other publication errors (e.g. drift/permissions) must not fall back.
        if(prior.error?.message!=='ASSESSMENT_TARGET_INVALID'
          ||!UUID.test(body.request_id||''))deny('ASSESSMENT_ACADEMIC_REJECTED');
        const receipt=await admin.rpc('flh_assessment_authoring_command',{
          p_workspace_id:workspaceId,p_parent_id:parentId,p_action:'read',
          p_payload:{request_id:body.request_id}
        });
        if(receipt.error||receipt.data?.ok!==true)deny('ASSESSMENT_ACADEMIC_REJECTED');
        if(receipt.data.candidate_sha256!==hash||!matchesTarget(receipt.data.target))
          deny('ASSESSMENT_RETRY_CONFLICT');
        if(receipt.data.state!=='draft')deny('ASSESSMENT_ACADEMIC_REJECTED');
        // The receipt itself is not proof that the draft predates this policy:
        // service-role create can still produce a new planless draft. Only the
        // one-time DB migration can mark genuine pre-policy requests eligible.
        const eligible=await admin.rpc('flh_assessment_legacy_draft_eligible',{
          p_workspace_id:workspaceId,p_parent_id:parentId,
          p_request_id:body.request_id,p_version_id:version,p_candidate_sha256:hash
        });
        if(eligible.error||eligible.data!==true)deny('ASSESSMENT_ACADEMIC_REJECTED');
      }
    }
    payload=await assessmentStagePayload(workspaceId,parentId,body);
    Object.assign(payload,await verifyAssessmentMedia(admin,workspaceId,payload.target.quiz_version_id,payload.candidate,payload.candidate_sha256));
  }
  else {
    if (!UUID.test(body.quiz_version_id||'') || !/^[a-f0-9]{64}$/.test(body.candidate_sha256||'')) deny('ASSESSMENT_TARGET_INVALID');
    payload={quiz_version_id:body.quiz_version_id,candidate_sha256:body.candidate_sha256};
    if(action==='release') {
      const {data:read,error}=await admin.rpc('flh_assessment_command',{p_workspace_id:workspaceId,p_parent_id:parentId,p_action:'read',p_payload:payload});
      if(error||read?.ok!==true)deny('ASSESSMENT_UNAVAILABLE');
      if(isVisualPackage(read.publication?.candidate))Object.assign(payload,await verifyAssessmentMedia(admin,workspaceId,body.quiz_version_id,read.publication.candidate,body.candidate_sha256));
    }
  }
  const {data,error}=await trace.measure('assessment.'+action+'.rpc',{dbOperations:1},()=>admin.rpc('flh_assessment_command',{
    p_workspace_id:workspaceId,p_parent_id:parentId,p_action:action,p_payload:payload
  }));
  if (error) deny(/^ASSESSMENT_[A-Z_]+$/.test(error.message||'')?error.message:'ASSESSMENT_UNAVAILABLE');
  if (data?.error) deny(data.error);
  if (data?.ok!==true) deny('ASSESSMENT_UNAVAILABLE');
  return data;
}
