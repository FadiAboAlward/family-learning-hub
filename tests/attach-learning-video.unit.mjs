import assert from 'node:assert/strict';
import fs from 'node:fs';
import {prepareVideoAttachment,attachReviewedVideo} from '../scripts/attach-learning-video.mjs';

const pkg=JSON.parse(fs.readFileSync(new URL('./fixtures/academic-content-quality/valid-package.json',import.meta.url),'utf8'));
const id='11111111-1111-4111-8111-111111111111';
const reference={academic_context:{student_ref:'testing-learner',grade:'7',curriculum:'Türkiye MEB',subject:'Mathematics'},concept_code:'integer-direction',video:{learner_id:id,quiz_version_id:id,program_id:id,curriculum_id:id,grade_level:7,subject_id:1,concept_id:id,video_ref:'qaVideo0001',title:'Testing integer direction',language:'tr',rationale:'Reviewed exact curriculum and primary skill.'}};
const payload=prepareVideoAttachment(pkg,reference);
assert.equal(payload.action,'attach_optional_video');
assert.throws(()=>prepareVideoAttachment({},reference),/ACADEMIC_PACKAGE_INVALID/);
for (const key of ['student_ref','grade','curriculum','subject']) {
  const mismatch=structuredClone(reference);mismatch.academic_context[key]='different';
  assert.throws(()=>prepareVideoAttachment(pkg,mismatch),/VIDEO_ACADEMIC_CONTEXT_MISMATCH/);
}
assert.throws(()=>prepareVideoAttachment(pkg,{...reference,concept_code:'integer-addition'}),/VIDEO_PRIMARY_TARGET_MISMATCH/);
assert.throws(()=>prepareVideoAttachment(pkg,{...reference,video:{...reference.video,grade_level:8}}),/VIDEO_ACADEMIC_CONTEXT_MISMATCH/);
assert.throws(()=>prepareVideoAttachment(pkg,{...reference,video:{...reference.video,watch_seconds:42}}),/INVALID_VIDEO_INPUT/);
let calls=0;
const fetchImpl=async(url,options)=>{calls++;assert.equal(url,'https://testing.example/learning-api');assert.equal(JSON.parse(options.body).video.video_ref,'qaVideo0001');assert.equal(options.headers.Authorization,'Bearer synthetic-parent-token');return {ok:true,json:async()=>({ok:true})};};
await assert.rejects(()=>attachReviewedVideo(payload,{url:'https://testing.example/learning-api',fetchImpl}),/PARENT_API_CREDENTIALS_REQUIRED/);
assert.equal(calls,0);
assert.deepEqual(await attachReviewedVideo(payload,{url:'https://testing.example/learning-api',accessToken:'synthetic-parent-token',publishableKey:'synthetic-public-key',fetchImpl}),{ok:true});
assert.equal(calls,1);
await assert.rejects(()=>attachReviewedVideo(payload,{url:'https://testing.example/learning-api',accessToken:'synthetic-parent-token',publishableKey:'synthetic-public-key',fetchImpl:async()=>{throw new Error('sensitive backend detail');}}),/^Error: VIDEO_ATTACHMENT_FAILED$/);
console.log('PASS: academic publication gate, exact context/primary target, minimal reference and sanitized attachment failure');
