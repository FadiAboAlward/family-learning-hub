import { isVisualPackage, assetContractErrors, conceptGuidance, MEDIA_BUCKET, MEDIA_LIMITS, UUID_PATTERN } from './assessment-visual-contract.mjs';
import { verifyRaster } from './assessment-raster.mjs';
const deny=code=>{throw new Error(code);};

/** Parent-only, narrow upload allocation. Stage remains the atomic registration boundary. */
export async function prepareAssessmentUpload(admin,w,parent,body) {
  const a=body.asset,v=body.quiz_version_id;
  if(!UUID_PATTERN.test(v||'')||assetContractErrors(a,Number(a?.position)-1,w,v).length)deny('ASSESSMENT_MEDIA_INVALID');
  const {data:allowed,error}=await admin.rpc('flh_assessment_media_parent',{p_workspace_id:w,p_parent_id:parent,p_version_id:v,p_upload:true});
  if(error||allowed!==true)deny('ASSESSMENT_FORBIDDEN');
  const {data,error:uploadError}=await admin.storage.from(MEDIA_BUCKET).createSignedUploadUrl(a.storage_path,{upsert:false});
  if(uploadError||!data?.signedUrl)deny('ASSESSMENT_MEDIA_UNAVAILABLE');
  return {ok:true,asset_id:a.asset_id,storage_path:a.storage_path,signed_upload_url:data.signedUrl};
}

/** Re-download and decode every distinct stored object before create/stage/release. */
export async function verifyAssessmentMedia(admin,w,v,candidate,hash,verify=verifyRaster) {
  if(!isVisualPackage(candidate))return {};
  const files=new Map();let total=0;
  for(const q of candidate.questions)for(const [i,a]of (q.assets||[]).entries()) {
    if(assetContractErrors(a,i,w,v).length)deny('ASSESSMENT_MEDIA_INVALID');
    if(files.has(a.asset_id))continue;
    const {data,error}=await admin.storage.from(MEDIA_BUCKET).download(a.storage_path);
    if(error||!data||data.size>MEDIA_LIMITS.bytes)deny('ASSESSMENT_MEDIA_UNAVAILABLE');
    total+=data.size;if(total>MEDIA_LIMITS.packageBytes)deny('ASSESSMENT_MEDIA_INVALID');
    const checked=await verify(new Uint8Array(await data.arrayBuffer()),a);
    files.set(a.asset_id,{asset_id:a.asset_id,...checked});
  }
  return {media_verification:{candidate_sha256:hash,verified_at:new Date().toISOString(),files:[...files.values()]}};
}

/** Authorization is re-evaluated by the read-only RPC, including on URL refresh. */
export async function assessmentMediaContext(admin,w,learner,attemptId,questionId=null) {
  if(!UUID_PATTERN.test(attemptId||'')||(questionId!==null&&!UUID_PATTERN.test(questionId||'')))deny('ASSESSMENT_MEDIA_FORBIDDEN');
  const {data,error}=await admin.rpc('flh_assessment_media_context',{p_workspace_id:w,p_learner_id:learner,p_attempt_id:attemptId,p_question_id:questionId});
  if(error||data?.error)deny('ASSESSMENT_MEDIA_FORBIDDEN');
  if(!data)return null;
  // Never copy arbitrary asset metadata, provenance or private review data to a learner.
  for(const q of data.questions) for(const a of q.assets) {
    const {data:signed,error:signError}=await admin.storage.from(MEDIA_BUCKET).createSignedUrl(a.storage_path,MEDIA_LIMITS.readTtl);
    delete a.storage_path;
    a.url=!signError&&signed?.signedUrl? signed.signedUrl:null;
    a.expires_at=a.url?new Date(Date.now()+MEDIA_LIMITS.readTtl*1000).toISOString():null;
    if(!a.url)a.error='MEDIA_UNAVAILABLE';
  }
  return data;
}

export async function hydrateAssessmentMedia(admin,w,learner,attemptId,payload) {
  const context=await assessmentMediaContext(admin,w,learner,attemptId);
  if(!context)return payload;
  const byId=new Map(context.questions.map(q=>[q.question_id,q]));
  for(const list of [payload.queue,payload.questions,payload.review])for(const row of list||[]) {
    const media=byId.get(row.question_id||row.question?.id||row.id);
    if(media)Object.assign(row.question||row,{assets:media.assets,learning_stage:media.learning_stage,assessment_profile:context.assessment_profile});
  }
  return {...payload,assessment_profile:context.assessment_profile,learning_evidence:context.learning_evidence,
    learning_guidance:context.learning_evidence?Object.fromEntries(['FOUNDATION','BRIDGE'].map(stage=>[stage,conceptGuidance(context.learning_evidence,stage)])):undefined};
}
