import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { visualCandidate,diagram,workspace,version } from './fixtures/assessment-visual/candidate.mjs';
import { validateAcademicPackage } from '../scripts/academic-content-quality.mjs';
import { academicCandidateHash,assessmentCommand } from '../supabase/functions/_shared/assessment-publication.mjs';
import { assetContractErrors,conceptGuidance,validateVisualContract } from '../supabase/functions/_shared/assessment-visual-contract.mjs';
import { verifyRaster } from '../supabase/functions/_shared/assessment-raster.mjs';
import { verifyAssessmentMedia,assessmentMediaContext,hydrateAssessmentMedia,requireAssessmentMediaForAnswer,prepareAssessmentUpload,INLINE_ASSESSMENT_IMAGE_MAX_BYTES } from '../supabase/functions/_shared/assessment-media.mjs';
const pkg=visualCandidate(),original=structuredClone(pkg);
assert.deepEqual(fs.readFileSync(new URL('../supabase/functions/_shared/vendor/webp_dec.wasm',import.meta.url)),fs.readFileSync(new URL('../supabase/functions/_shared/node_modules/@jsquash/webp/codec/dec/webp_dec.wasm',import.meta.url)),'Vendored WebP decoder must match the locked upstream package exactly');
const report=validateAcademicPackage(pkg);assert.equal(report.ok,true,JSON.stringify(report.errors));assert.deepEqual(pkg,original);
let stageReads=0,stageWrites=0;
await assert.rejects(()=>assessmentCommand({rpc:async(name,args)=>{
 assert.equal(name,'flh_assessment_command');
 if(args.p_action==='read'){stageReads++;return {error:{message:'ASSESSMENT_TARGET_INVALID'}};}
 stageWrites++;return {data:{ok:true}};
}},workspace,'04410000-0000-4000-8000-000000000020',{
 action:'stage_assessment',target:{quiz_id:'04410000-0000-4000-8000-000000000021',quiz_version_id:version,learner_id:'04410000-0000-4000-8000-000000000022',program_id:'04410000-0000-4000-8000-000000000023'},
 candidate:pkg
},{measure:(_name,_options,operation)=>operation()}),/ASSESSMENT_ACADEMIC_REJECTED/);
assert.equal(stageReads,1,'planless direct stage must check immutable existing publication first');
assert.equal(stageWrites,0,'new planless direct stage must never persist');

for(const malformed of [{...pkg,questions:{}},{...pkg,blueprint:{}},{...pkg,questions:[null]},{...pkg,questions:[{...pkg.questions[0],assets:[null,null]}]}])assert.equal(validateAcademicPackage(malformed).ok,false,'Malformed containers must return a validation report instead of throwing');
const reordered=structuredClone(pkg);reordered.questions[10].assets[0]=Object.fromEntries(Object.entries(reordered.questions[10].assets[0]).reverse());assert.equal(validateAcademicPackage(reordered).ok,true,'Object key order must not invent conflicting file identities');
const transient=structuredClone(pkg);transient.questions[0].assets[0].provenance.source_ref='https://example.invalid/storage/v1/object/sign/file?token=private';assert.ok(validateAcademicPackage(transient).errors.some(e=>e.code==='ASSET_TRANSIENT_URL_FORBIDDEN'));
const paperErrors=[];validateVisualContract({assessment_profile:pkg.assessment_profile,questions:Array.from({length:20},(_,i)=>({question_code:'P-'+i,delivery_surface:'paper',assets:[]}))},paperErrors,[]);assert.deepEqual(paperErrors,[],'The separate Paper contract is 20 items, never a 60-item interactive candidate; full academic/source QA remains separate');
assert.equal(pkg.questions.filter(q=>q.learning_stage==='FOUNDATION').length,10);assert.equal(pkg.questions.filter(q=>q.learning_stage==='BRIDGE').length,10);
for(const mutate of [p=>p.questions[0].learning_stage='BRIDGE',p=>delete p.blueprint[0].learning_stage,p=>p.questions[20].learning_stage='FOUNDATION',p=>p.questions.pop(),p=>p.questions[0].assets[0].position=2,p=>p.questions[10].assets.reverse(),p=>p.questions[0].assets[0].purpose='solution',p=>p.questions[0].assets[0].provenance.rights_status='unknown',p=>p.questions[0].assets[0].url='https://hotlink.invalid/image']){
 const bad=structuredClone(pkg);mutate(bad);assert.equal(validateAcademicPackage(bad).ok,false,'Invalid visual candidate must fail the official gate');
}
// FLH-046: native MCP-compatible inline base64 reuses the private signed-upload
// path and exact raster verification. No real service-role or student data.
{
 const valid=fs.readFileSync(new URL('./fixtures/assessment-visual/rectangle.png',import.meta.url));
 const asset=diagram('rectangle'), ops=[];
 let saved=null;
 const localAdmin={
  rpc:async name=>{
   ops.push('rpc:'+name);
   if(name==='flh_assessment_media_parent')return {data:true,error:null};
   if(name==='flh_assessment_upload_maintenance')return {data:{paths:[]},error:null};
   throw Error('unexpected RPC '+name);
  },
  storage:{from:bucket=>{
   assert.equal(bucket,'assessment-assets');
   return {
    createSignedUploadUrl:async path=>{ops.push('sign:'+path);return {data:{signedUrl:'https://synthetic.invalid/signed',token:'synthetic-upload-grant'},error:null};},
    uploadToSignedUrl:async (path,token,blob,options)=>{
     assert.equal(path,asset.storage_path);assert.equal(token,'synthetic-upload-grant');assert.equal(options.upsert,false);
     assert.equal(options.contentType,'image/png');
     saved=new Uint8Array(await blob.arrayBuffer());ops.push('uploaded');return {data:{path},error:null};
    },
    download:async path=>{assert.equal(path,asset.storage_path);ops.push('downloaded');return {data:new Blob([saved]),error:null};},
    remove:async()=>({error:null})
   };
  }}
 };
 const result=await prepareAssessmentUpload(localAdmin,workspace,'04410000-0000-4000-8000-000000000020',{quiz_version_id:version,asset,image_base64:valid.toString('base64')});
 assert.equal(result.verified,true);assert.equal(result.uploaded_bytes,valid.length);
 assert.equal(result.signed_upload_url,undefined);
 assert.deepEqual(saved,new Uint8Array(valid));assert.ok(ops.some(x=>x==='uploaded')&&ops.some(x=>x==='downloaded'));
 const previous=ops.length;
 for(const invalid of ['bad=', '', Buffer.from('not-real-png').toString('base64'), 'A'.repeat(4*Math.ceil(INLINE_ASSESSMENT_IMAGE_MAX_BYTES/3)+4)]){
  await assert.rejects(()=>prepareAssessmentUpload(localAdmin,workspace,'04410000-0000-4000-8000-000000000020',{quiz_version_id:version,asset,image_base64:invalid}),/ASSESSMENT_MEDIA_INVALID/);
 }
 assert.equal(ops.length,previous,'invalid bytes must never reach the authorization, signer or Storage');
}
const a=diagram('rectangle');
for(const change of [{storage_path:'../x'},{storage_path:a.storage_path.replace(workspace,version)},{width:5000},{width:4096,height:4096},{checksum_sha256:'0'},{asset_id:'bad'},{mime_type:'image/svg+xml'},{alt_text:'<script>'}])assert.ok(assetContractErrors({...a,...change},0,workspace,version).length);
for(const [file,mime]of [['rectangle.png','image/png'],['rectangle.jpg','image/jpeg'],['rectangle.webp','image/webp']]){
 const bytes=fs.readFileSync(new URL('./fixtures/assessment-visual/'+file,import.meta.url));
 const descriptor={...a,mime_type:mime,checksum_sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
 assert.equal((await verifyRaster(bytes,descriptor)).checksum_sha256,descriptor.checksum_sha256,'Full real codec must decode '+mime);
 await assert.rejects(()=>verifyRaster(bytes,{...descriptor,checksum_sha256:'0'.repeat(64)}),/MEDIA_INVALID/);
 await assert.rejects(()=>verifyRaster(bytes,{...descriptor,width:601}),/MEDIA_INVALID/);
 await assert.rejects(()=>verifyRaster(bytes.subarray(0,40),descriptor),/MEDIA_INVALID/);
}
const bytes=fs.readFileSync(new URL('./fixtures/assessment-visual/rectangle.png',import.meta.url)),corrupt=Buffer.from(bytes);corrupt[50]^=255;
await assert.rejects(()=>verifyRaster(corrupt,{...a,checksum_sha256:crypto.createHash('sha256').update(corrupt).digest('hex')}),/MEDIA_INVALID/,'Corrupt compressed/CRC bytes must fail, even with matching supplied checksum');
const hash=await academicCandidateHash(pkg),downloads=[];
const storage={from:bucket=>{assert.equal(bucket,'assessment-assets');return {download:async path=>{downloads.push(path);const name=['rectangle','triangle','composite'].find(n=>diagram(n).storage_path===path);return {data:new Blob([fs.readFileSync(new URL('./fixtures/assessment-visual/'+name+'.png',import.meta.url))])};}};}};
const proof=await verifyAssessmentMedia({storage},workspace,version,pkg,hash);assert.equal(proof.media_verification.files.length,3);assert.equal(downloads.length,3,'Same immutable file may be reused with question-specific order');
assert.deepEqual(await verifyAssessmentMedia({},workspace,version,{}),{},'Legacy authoring has zero media side effects');
let gradeCalls=0;
const missingRuntime={rpc:async name=>{assert.equal(name,'flh_assessment_media_context');return {data:{questions:[{assets:[{...diagram('rectangle'),required:true}]}]}};},storage:{from:()=>({download:async()=>({error:{message:'storage outage'}})})}};
await assert.rejects(async()=>{await requireAssessmentMediaForAnswer(missingRuntime,workspace,'learner','attempt','question');gradeCalls++;},/MEDIA_UNAVAILABLE/);assert.equal(gradeCalls,0,'Missing required stored data must fail before grading or answer persistence');
await requireAssessmentMediaForAnswer({rpc:async()=>({data:null})},workspace,'learner','attempt','question');
const source=JSON.parse(fs.readFileSync(new URL('./fixtures/assessment-visual/geometry-source.json',import.meta.url)));
assert.equal(source.rectangle.side_cm.reduce((a,b)=>a+b)*2,20);assert.equal(source.rectangle.side_cm.reduce((a,b)=>a*b)+source.triangle.base_cm*source.triangle.height_cm/2,36);
assert.equal(pkg.questions[0].options.find(o=>o.is_correct).content,source.rectangle.side_cm.reduce((a,b)=>a+b)*2+' cm','Perimeter answer key follows measured geometry');
assert.equal(pkg.questions[10].options.find(o=>o.is_correct).content,source.rectangle.side_cm.reduce((a,b)=>a*b)+source.triangle.base_cm*source.triangle.height_cm/2+' cm²','Combined-area key follows measured geometry');
const orthogonal=Object.entries(source.composite.panels).filter(([,p])=>(p[1][0]-p[0][0])*(p[2][0]-p[0][0])+(p[1][1]-p[0][1])*(p[2][1]-p[0][1])===0).map(([label])=>label);
assert.deepEqual(orthogonal,['A']);assert.equal(pkg.questions[20].options.find(o=>o.is_correct).content,orthogonal[0]+' paneli','Independent vector truth must map to the actual keyed option');
const rows=[{concept_id:'ok',question_code:'Q1',learning_stage:'FOUNDATION',status:'completed',is_correct:true,attempts_used:1,hints_used:0},{concept_id:'wrong',question_code:'Q2',learning_stage:'FOUNDATION',status:'completed',is_correct:false,attempts_used:1,hints_used:0},{concept_id:'hint',question_code:'Q3',learning_stage:'FOUNDATION',status:'completed',is_correct:true,attempts_used:1,hints_used:1},{concept_id:'retry',question_code:'Q4',learning_stage:'FOUNDATION',status:'completed',is_correct:true,attempts_used:2,hints_used:0},{concept_id:'unknown',learning_stage:'FOUNDATION',status:'pending'}];
assert.deepEqual(conceptGuidance(rows,'FOUNDATION').map(g=>g.status),['ASSESSED','OPTIONAL_REVIEW','OPTIONAL_REVIEW','OPTIONAL_REVIEW','NOT_YET_ASSESSED']);
let actions=[];const qid='04410000-0000-4000-8000-000000000011',attempt='04410000-0000-4000-8000-000000000012',learner='04410000-0000-4000-8000-000000000013';
const runtime={rpc:async(name,args)=>{actions.push(name);assert.equal(args.p_learner_id,learner);return {data:{assessment_profile:pkg.assessment_profile,learning_evidence:rows,questions:[{question_id:qid,assets:[structuredClone(a)]}]}};},storage:{from:()=>({createSignedUrls:async(paths,ttl)=>{assert.deepEqual(paths,[a.storage_path]);assert.equal(ttl,120);return {data:[{path:a.storage_path,signedUrl:'https://synthetic.invalid/signed'}]};}})}};
const context=await assessmentMediaContext(runtime,workspace,learner,attempt,qid);assert.equal(context.questions[0].assets[0].url,'https://synthetic.invalid/signed');assert.equal(context.questions[0].assets[0].storage_path,undefined);
assert.deepEqual(actions,['flh_assessment_media_context'],'URL refresh must call only the read RPC');
await assert.rejects(()=>assessmentMediaContext({rpc:async()=>({error:{message:'private body'}})},workspace,learner,attempt,qid),/MEDIA_FORBIDDEN/);
const old={queue:[]};assert.equal(await hydrateAssessmentMedia({rpc:async()=>({data:null})},workspace,learner,attempt,old),old,'Legacy payload object/fields remain identical');
const unavailable={rpc:async()=>({error:{message:'private failure'}})};
const committed={ok:true,percentage:100,review:[{question_id:qid}]};
assert.deepEqual(await hydrateAssessmentMedia(unavailable,workspace,learner,attempt,committed,{committed:true}),{...committed,media_unavailable:true},'Committed grading/result survives hydration failure');
await assert.rejects(()=>hydrateAssessmentMedia(unavailable,workspace,learner,attempt,committed),/MEDIA_FORBIDDEN/,'Uncommitted media reads still fail closed');
const browserContext={localStorage:{getItem:()=> 'synthetic-session'},sessionStorage:{getItem:()=>null}};
vm.runInNewContext(fs.readFileSync(new URL('../assessment-assets-v1.js',import.meta.url),'utf8'),browserContext);
const render=browserContext.FLHAssessmentAssets;
assert.equal(render.ready({assessment_profile:pkg.assessment_profile,id:qid,assets:[]}),true);
assert.equal(render.ready({assessment_profile:pkg.assessment_profile,id:qid,assets:[{...diagram('rectangle'),required:false}]}),true,'An independently answerable optional-image failure cannot lock the learner');
assert.equal(render.ready({assessment_profile:pkg.assessment_profile,id:qid,assets:[diagram('rectangle')]}),false,'Required content is unavailable until actually loaded');
console.log('Visual exact candidate, 0/1/2 assets, three actual raster codecs, integrity/rights/path negatives, deterministic geometry and read-only guidance/refresh: PASS (synthetic; independent academic pilot still required)');
