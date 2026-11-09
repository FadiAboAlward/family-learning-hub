// FLH-FEAT-2026-044 v1.1, Drive revision 4. Legacy packages are not reinterpreted.
export const VISUAL_PROFILE = 'visual-foundation-bridge-v1';
export const MEDIA_BUCKET = 'assessment-assets';
export const MEDIA_LIMITS = Object.freeze({bytes:4*1024*1024,dimension:4096,pixels:8*1024*1024,packageBytes:24*1024*1024,readTtl:120});
export const UUID_PATTERN = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const hash = /^[a-f0-9]{64}$/;
const formats = {'image/png':'png','image/jpeg':'jpg','image/webp':'webp'};
const plain = (v,max=600) => typeof v==='string' && v.trim().length>0 && v.length<=max && !/[<>\u0000-\u001f]/u.test(v);
const object = v => v!==null && typeof v==='object' && !Array.isArray(v);
const ordered = v => Array.isArray(v)?v.map(ordered):object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v;
export const isVisualPackage = pkg => pkg?.assessment_profile===VISUAL_PROFILE;

/** Closed file/link contract: neither solutions nor URLs belong in canonical media. */
export function assetContractErrors(a,index,workspaceId,versionId) {
  const errors=[];
  if(!object(a))return ['ASSET_INVALID'];
  const allowed=['asset_id','position','purpose','label','alt_text','required','mime_type','width','height','checksum_sha256','storage_bucket','storage_path','provenance'];
  if(Object.keys(a).some(k=>!allowed.includes(k)))errors.push('ASSET_FIELD_INVALID');
  if(!UUID_PATTERN.test(a.asset_id||'') || a.position!==index+1 || a.purpose!=='prompt' || typeof a.required!=='boolean')errors.push('ASSET_IDENTITY_INVALID');
  if(!plain(a.alt_text) || (a.label!==undefined && !plain(a.label,120)))errors.push('ASSET_ACCESSIBILITY_INVALID');
  if(!formats[a.mime_type] || !hash.test(a.checksum_sha256||'') || a.storage_bucket!==MEDIA_BUCKET)errors.push('ASSET_FILE_INVALID');
  if(![a.width,a.height].every(n=>Number.isInteger(n)&&n>=16&&n<=MEDIA_LIMITS.dimension) || a.width*a.height>MEDIA_LIMITS.pixels)errors.push('ASSET_DIMENSIONS_INVALID');
  const pieces=typeof a.storage_path==='string'?a.storage_path.split('/'):[];
  if(pieces.length!==3 || !UUID_PATTERN.test(pieces[0]||'') || !UUID_PATTERN.test(pieces[1]||'')
    || pieces[2]!==a.checksum_sha256+'.'+formats[a.mime_type]
    || (workspaceId && pieces[0]!==workspaceId) || (versionId && pieces[1]!==versionId))errors.push('ASSET_SCOPE_INVALID');
  const p=a.provenance;
  if(!object(p)||Object.keys(p).some(k=>!['origin','source_ref','rights_status','rights_ref','book_code','book_part','pdf_page','source_sha256','crop'].includes(k))
    ||!plain(p.source_ref)||!['generated','book_crop'].includes(p.origin)
    ||!(p.origin==='generated'?p.rights_status==='owned':p.rights_status==='authorized'&&plain(p.rights_ref)&&plain(p.book_code)&&plain(p.book_part)&&Number.isInteger(p.pdf_page)&&p.pdf_page>0&&hash.test(p.source_sha256||'')))errors.push('ASSET_RIGHTS_INVALID');
  if(p?.crop!==undefined&&(!object(p.crop)||Object.keys(p.crop).sort().join(',')!=='height,width,x,y'||!['x','y','width','height'].every(k=>Number.isInteger(p.crop[k])&&p.crop[k]>=0)||p.crop.width===0||p.crop.height===0))errors.push('ASSET_SOURCE_CROP_INVALID');
  return errors;
}

/** Extends the official gate; never replaces its difficulty, hints or uniqueness checks. */
export function validateVisualContract(pkg,errors,warnings) {
  const issue=(code,path,message)=>errors.push({code,path,message});
  if(!isVisualPackage(pkg)) {
    if(pkg?.assessment_profile!==undefined || (Array.isArray(pkg?.questions)&&pkg.questions.some(q=>q?.learning_stage!==undefined || (Array.isArray(q?.assets)&&q.assets.length))))issue('VISUAL_PROFILE_REQUIRED','assessment_profile','New visual/staged content requires the explicit opt-in profile.');
    return;
  }
  const questions=Array.isArray(pkg.questions)?pkg.questions:[];
  const blueprints=Array.isArray(pkg.blueprint)?pkg.blueprint:[];
  const learning=questions.filter(q=>q?.delivery_surface==='learning'),exam=questions.filter(q=>q?.delivery_surface==='exam');
  const paperOnly=questions.length===20&&questions.every(q=>q?.delivery_surface==='paper');
  if(!paperOnly&&(questions.length!==40 || learning.length!==20 || exam.length!==20))issue('VISUAL_10_10_20_REQUIRED','questions','Interactive packages require 10 Foundation + 10 Bridge + 20 independent Exam items; the separate optional Paper has 20 NEW items.');
  if(/\/storage\/v1\/object\/(?:sign|upload\/sign)\/|[?&](?:token|sig|signature|expires|x-amz-[^=\s"&]+|x-goog-[^=\s"&]+)=/i.test(JSON.stringify(pkg)))issue('ASSET_TRANSIENT_URL_FORBIDDEN','$','Temporary media credentials/URLs cannot enter the immutable candidate or its hash.');
  const files=new Map();
  for(const [i,q] of questions.entries()) {
    if(!object(q)){issue('VISUAL_QUESTION_INVALID','questions['+i+']','Question must be an object.');continue;}
    const path='questions['+i+']',stage=learning.indexOf(q)<10?'FOUNDATION':'BRIDGE';
    const blueprint=blueprints.find(b=>b?.question_code===q.question_code);
    if(q.delivery_surface==='learning' ? q.learning_stage!==stage||blueprint?.learning_stage!==stage : q.learning_stage!==undefined||blueprint?.learning_stage!==undefined)issue('LEARNING_STAGE_INVALID',path+'.learning_stage','Explicit stage must match authored Learning order and blueprint; Exam has no stage.');
    if(q.delivery_role==='remediation_pool')issue('VISUAL_REMEDIATION_FORBIDDEN',path,'No extra remediation pool for this profile.');
    const assets=q.assets===undefined?[]:q.assets;
    if(!Array.isArray(assets)){issue('ASSET_ARRAY_REQUIRED',path+'.assets','Assets must be an ordered array.');continue;}
    const ids=new Set();
    for(const [j,a]of assets.entries()) {
      for(const code of assetContractErrors(a,j))issue(code,path+'.assets['+j+']','Invalid immutable prompt asset contract.');
      if(!object(a))continue;
      if(ids.has(a?.asset_id))issue('ASSET_DUPLICATE',path+'.assets['+j+']','A question may not link the same asset twice.');
      ids.add(a?.asset_id);
      const file=a&&Object.fromEntries(Object.entries(a).filter(([k])=>!['position','label','alt_text','required','purpose'].includes(k)));
      const identity=JSON.stringify(ordered(file));
      if(files.has(a?.asset_id)&&files.get(a.asset_id)!==identity)issue('ASSET_IDENTITY_CONFLICT',path+'.assets['+j+']','One UUID must identify the same immutable file and provenance.');
      files.set(a?.asset_id,identity);
    }
  }
  // FLH-FEAT-2026-046 v1.0: prospective policy. Historical v1.1 visual candidates
  // without the new visual_plan remain readable and valid; the current academic SOP
  // requires the plan for new authored packages. Never infer academic relevance from a count.
  if(!paperOnly){
    const plan=pkg.academic_context?.visual_plan;
    if(plan!==undefined){
      const subject=String(pkg.academic_context?.subject||'').trim().toLowerCase();
      const math=/^(?:mathematics|math|matematik|رياضيات|الرياضيات)$/u.test(subject);
      const science=/^(?:science|fen bilimleri|fen|علوم|العلوم)$/u.test(subject);
      const focus=plan&&typeof plan==='object'&&!Array.isArray(plan)?plan.focus:null;
      const visual=questions.filter(q=>Array.isArray(q?.assets)&&q.assets.length>0);
      const learningVisual=visual.filter(q=>q.delivery_surface==='learning').length;
      const examVisual=visual.filter(q=>q.delivery_surface==='exam').length;
      if(!plan||typeof plan!=='object'||Array.isArray(plan)||plan.policy!=='subject-aware-v1'
        ||!['general','geometry','diagram-intensive','subject-appropriate'].includes(focus)
        ||!Number.isInteger(plan.target_questions)||plan.target_questions<0||plan.target_questions>40
        ||!Number.isInteger(plan.actual_questions)||plan.actual_questions!==visual.length){
        issue('VISUAL_PLAN_INVALID','academic_context.visual_plan','Declare the exact subject-aware-v1 visual mix and actual distinct image-question count for this new candidate.');
      }else{
        if(math&&(visual.length<10||plan.target_questions<10))issue('VISUAL_MATH_QUOTA','questions','Mathematics needs at least 10 meaningful visual questions out of 40; do not add decorative images merely to meet a quota.');
        if(math&&learningVisual===0||math&&examVisual===0)issue('VISUAL_MODE_COVERAGE','questions','Mathematics visuals must appear in both Learning and Exam, not one mode only.');
        if(math&&['geometry','diagram-intensive'].includes(focus)&&visual.length<20)issue('VISUAL_GEOMETRY_QUOTA','questions','Geometry and diagram-heavy math aims for at least 20 relevant visual questions out of 40.');
        if(science&&(visual.length<8||visual.length>16))warnings.push({code:'VISUAL_SCIENCE_MIX_REVIEW',path:'academic_context.visual_plan',message:'Science generally targets 8–16 meaningful visual questions; reconcile this exact scope and record a reason for a different ratio.'});
        if(math&&['geometry','diagram-intensive'].includes(focus)&&visual.length>28)warnings.push({code:'VISUAL_GEOMETRY_DENSITY_REVIEW',path:'academic_context.visual_plan',message:'Over 28 visual questions may be valid, but independently check necessity and readability rather than decorative density.'});
      }
    }else{
      warnings.push({code:'VISUAL_PLAN_MISSING_NEW_AUTHORING',path:'academic_context.visual_plan',message:'The v1.25 SOP requires a subject-aware visual plan for new exercises; missing plans are accepted only for frozen pre-FLH-046 candidates, not as new authoring approval.'});
    }
  }
  if(questions.some(q=>q?.assets?.length))warnings.push({code:'VISUAL_SEMANTIC_REVIEW_REQUIRED',path:'questions',message:'Independently verify exact raster/source geometry, all labels, option mapping, solution-neutral alt text and rights against this candidate hash.'});
}

/** Read-only guidance from completed authoritative answers; never claims mastery. */
export function conceptGuidance(rows,stage) {
  const groups=new Map();
  for(const row of rows.filter(r=>r.learning_stage===stage)) {
    const key=row.concept_id;
    const group=groups.get(key)||{concept_id:key,...(row.concept_label?{concept_label:row.concept_label}:{}),question_codes:[],recommend_review:false,assessed:false};
    if(row.status==='completed' && typeof row.is_correct==='boolean') {
      group.assessed=true;group.question_codes.push(row.question_code);
      group.recommend_review ||= !row.is_correct || Number(row.attempts_used)>1 || Number(row.hints_used)>0;
    }
    groups.set(key,group);
  }
  return [...groups.values()].map(g=>({...g,status:!g.assessed?'NOT_YET_ASSESSED':g.recommend_review?'OPTIONAL_REVIEW':'ASSESSED'}));
}
