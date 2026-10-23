import { assessmentStagePayload, assessmentCommand, academicCandidateHash } from './assessment-publication.mjs';
import { validateAcademicPackage } from './academic-content-quality.mjs';
import { attachOptionalVideo } from './optional-learning-videos.mjs';

export const AUTHORING_ACTIONS = Object.freeze(['create_assessment_draft','read_assessment_authoring']);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const deny = code => { throw new Error(code); };
const targetKeys=['quiz_id','quiz_version_id','learner_id','program_id'];
// PostgreSQL returns canonical lowercase UUIDs. Preserve closed-key/type validation
// and the exact candidate/hash while normalizing only known identity fields.
const uuidFields=(value,keys)=>object(value)?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,keys.includes(k)&&uuid(v)?v.toLowerCase():v])):value;
const authoringInput=body=>({...uuidFields(body,['request_id']),target:uuidFields(body.target,targetKeys),
  semantic_review:uuidFields(body.semantic_review,['workspace_id',...targetKeys]),quiz:uuidFields(body.quiz,['curriculum_id'])});

/** This is the existing academic gate, not an automated semantic reviewer. */
export async function validateAuthoringCandidate(candidate) {
  let validation;
  try { validation = validateAcademicPackage(candidate); } catch { deny('ASSESSMENT_ACADEMIC_REJECTED'); }
  const publication_supported = validation.ok && candidate.questions.length === 40
    && candidate.questions.filter(q=>q.delivery_surface==='learning').length === 20
    && candidate.questions.filter(q=>q.delivery_surface==='exam').length === 20
    && candidate.questions.every(q=>q.question_type==='single_choice' && /^Q-[0-9]{6,}$/.test(q.question_code));
  return {ok:validation.ok && publication_supported,validation,publication_supported,candidate_sha256:await academicCandidateHash(candidate),semantic_review:'REQUIRED'};
}

/** Fail before creating a draft when any authored skill is absent or out of scope.
 * No concepts are created here; registration remains an authorized content action.
 */
export async function verifyAssessmentConceptRegistry(admin,workspaceId,candidate,quiz) {
  const codes=[...new Set(candidate.questions.map(q=>q.concept_code))];
  if(!codes.length || codes.some(code=>typeof code!=='string'||!code.trim())) deny('ASSESSMENT_ACADEMIC_REJECTED');
  const grade=Number(candidate.academic_context.grade);
  if(!Number.isInteger(grade)||grade<1||grade>12) deny('ASSESSMENT_CONTEXT_MISMATCH');
  const {data,error}=await admin.from('learning_concepts').select('code')
    .eq('workspace_id',workspaceId).eq('curriculum_id',quiz.curriculum_id)
    .eq('subject_id',quiz.subject_id).eq('grade_level',grade).in('code',codes);
  if(error || !Array.isArray(data)) deny('ASSESSMENT_UNAVAILABLE');
  const found=new Set(data.map(row=>row.code));
  if(codes.some(code=>!found.has(code))) deny('ASSESSMENT_CONCEPTS_MISSING');
}

/** Session identity is supplied by the parent-authenticated application boundary. */
export async function assessmentAuthoringCommand(admin,workspaceId,parentId,body,trace) {
  body=authoringInput(body);
  if (!AUTHORING_ACTIONS.includes(body.action) || !uuid(body.request_id)) deny('ASSESSMENT_AUTHORING_INPUT_INVALID');
  let payload={request_id:body.request_id};
  if (body.action==='create_assessment_draft') {
    const m=body.quiz;
    if (!object(m) || Object.keys(m).some(k=>!['slug','title','subject_id','curriculum_id'].includes(k))
        || typeof m.slug!=='string' || m.slug.length>160 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(m.slug)
        || typeof m.title!=='string' || !m.title.trim() || m.title.length>300
        || !Number.isSafeInteger(m.subject_id) || m.subject_id<1 || !uuid(m.curriculum_id)) deny('ASSESSMENT_AUTHORING_INPUT_INVALID');
    const staged=await assessmentStagePayload(workspaceId,parentId,body);
    await verifyAssessmentConceptRegistry(admin,workspaceId,body.candidate,m);
    payload={...staged,request_id:body.request_id,quiz:m};
  }
  const {data,error}=await trace.measure('assessment.authoring.rpc',{dbOperations:1},()=>admin.rpc('flh_assessment_authoring_command',{
    p_workspace_id:workspaceId,p_parent_id:parentId,p_action:body.action==='create_assessment_draft'?'create':'read',p_payload:payload
  }));
  if (error) deny(/^ASSESSMENT_[A-Z_]+$/.test(error.message||'')?error.message:'ASSESSMENT_UNAVAILABLE');
  if (data?.ok!==true) deny('ASSESSMENT_UNAVAILABLE');
  return data;
}

/** MCP may only advance fresh requests created by this integration and this parent. */
export async function assessmentAuthoringTool(admin,workspaceId,parentId,name,args,trace,providerOptions={}) {
  args=authoringInput(args);
  if(name==='validate_assessment_candidate') return validateAuthoringCandidate(args.candidate);
  if(AUTHORING_ACTIONS.includes(name)) return assessmentAuthoringCommand(admin,workspaceId,parentId,{...args,action:name},trace);
  if(!['stage_assessment','publish_assessment','attach_optional_video','release_assessment'].includes(name)) deny('ASSESSMENT_ACTION_INVALID');
  const before=await assessmentAuthoringCommand(admin,workspaceId,parentId,{action:'read_assessment_authoring',request_id:args.request_id},trace);
  if(before.candidate_sha256!==args.candidate_sha256) deny('ASSESSMENT_RETRY_CONFLICT');
  let operation;
  if(name==='stage_assessment') {
    if(!object(args.target) || Object.keys(before.target).some(k=>args.target[k]!==before.target[k]) || Object.keys(args.target).length!==4) deny('ASSESSMENT_TARGET_INVALID');
    if(await academicCandidateHash(args.candidate)!==before.candidate_sha256) deny('ASSESSMENT_RETRY_CONFLICT');
    operation=await assessmentCommand(admin,workspaceId,parentId,{...args,action:name},trace);
  } else if(name==='attach_optional_video') {
    const video=uuidFields(args.candidate,['learner_id','quiz_version_id','program_id','curriculum_id','concept_id']);
    if(!object(video) || video.quiz_version_id!==before.target.quiz_version_id || video.learner_id!==before.target.learner_id || video.program_id!==before.target.program_id) deny('ASSESSMENT_TARGET_INVALID');
    operation=await attachOptionalVideo(admin,workspaceId,parentId,{video},trace,providerOptions);
  } else {
    operation=await assessmentCommand(admin,workspaceId,parentId,{action:name,quiz_version_id:before.target.quiz_version_id,candidate_sha256:before.candidate_sha256},trace);
  }
  const status=await assessmentAuthoringCommand(admin,workspaceId,parentId,{action:'read_assessment_authoring',request_id:args.request_id},trace);
  return {ok:true,operation,status};
}
