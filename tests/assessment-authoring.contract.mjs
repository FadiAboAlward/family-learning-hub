import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { assessmentStagePayload } from '../supabase/functions/_shared/assessment-publication.mjs';
import { validateAuthoringCandidate } from '../supabase/functions/_shared/assessment-authoring.mjs';

// Existing disposable Core QA DB only. No hosted URL/key, learner attempt or provider call.
const w='55f9224c-8ba7-4cbc-9f88-713e6a6b41df';
const ids=Object.fromEntries(['parent','teacher','curriculum','program','quiz','version','request','other'].map((k,i)=>[k,`03310000-0000-4000-8000-${String(i+1).padStart(12,'0')}`]));
const json=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
function query(source) {
 const p=spawn('docker',['exec','-i','supabase_db_family-learning-hub','psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-t','-A'],{stdio:['pipe','pipe','pipe']});
 let out='',err='';p.stdout.on('data',c=>out+=c);p.stderr.on('data',c=>err+=c);
 const done=new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',code=>code===0?resolve(out.trim()):reject(new Error('Isolated authoring contract: '+err)));});p.stdin.end(source);return done;
}
const learner=await query(`select id from public.learners where workspace_id='${w}' and slug='test' and is_active and metadata->>'is_test'='true';`);
assert.match(learner,/^[a-f0-9-]{36}$/);
const priorFlag=JSON.parse(await query(`select value from public.workspace_settings where workspace_id='${w}' and key='optional_learning_videos';`));
const candidate=JSON.parse(fs.readFileSync('tests/fixtures/assessment-publication/valid-package.json','utf8'));
const report=await validateAuthoringCandidate(candidate);assert.equal(report.ok,true);
const hash=report.candidate_sha256,target={quiz_id:ids.quiz,quiz_version_id:ids.version,learner_id:learner,program_id:ids.program};
const semantic_review={...target,workspace_id:w,result:'PASS',candidate_sha256:hash,reviewed_at:new Date().toISOString(),reviewer_ref:'synthetic:review',source_review_ref:'synthetic:source',learner_scope_review_ref:'synthetic:Testing',authority_ref:'synthetic:owner',warning_dispositions:report.validation.warnings.map(d=>({...d,result:'ACCEPTED',reason:'Synthetic technical fixture only.'}))};
const staged=await assessmentStagePayload(w,ids.parent,{target,candidate,semantic_review});
const subject=Number(await query('select coalesce(max(id),0)+1 from public.subjects;'));
const quiz={slug:'qa-assessment-authoring',title:'Synthetic direct authoring',subject_id:subject,curriculum_id:ids.curriculum};
const payload={...staged,request_id:ids.request,quiz};
const author=(action,p={request_id:ids.request},parent=ids.parent,workspace=w)=>`public.flh_assessment_authoring_command('${workspace}','${parent}','${action}',${json(p)})`;
const publication=(action,p={quiz_version_id:ids.version,candidate_sha256:hash})=>`public.flh_assessment_command('${w}','${ids.parent}','${action}',${json(p)})`;
const setup=`
 insert into auth.users(id,email) values('${ids.parent}','qa-authoring-owner@example.invalid'),('${ids.teacher}','qa-authoring-teacher@example.invalid');
 insert into public.workspace_members(workspace_id,user_id,role) values('${w}','${ids.parent}','owner'),('${w}','${ids.teacher}','teacher');
 insert into public.curricula(id,code,name_ar) values('${ids.curriculum}','qa-assessment-authoring','Testing curriculum');
 insert into public.subjects(id,code,name_ar) overriding system value values(${subject},'qa-assessment-authoring','Testing subject');
 insert into public.learning_programs(id,workspace_id,slug,title,status,curriculum_id,grade_level) values('${ids.program}','${w}','qa-assessment-authoring','Testing authoring','active','${ids.curriculum}',7);
 insert into public.learner_program_enrollments(workspace_id,learner_id,program_id,status) values('${w}','${learner}','${ids.program}','active');
 ${[...new Set(candidate.questions.map(q=>q.concept_code))].map(code=>`insert into public.learning_concepts(workspace_id,subject_id,curriculum_id,grade_level,code,title) values('${w}',${subject},'${ids.curriculum}',7,'${code}','Synthetic concept');`).join('\n')}`;
const fail=(sql,code)=>`begin perform ${sql};raise exception 'EXPECTED_FAILURE_MISSING';exception when raise_exception then if sqlerrm<>'${code}' then raise;end if;end;`;
const malformed=structuredClone(staged);delete malformed.candidate.questions[25].options;
const video=`jsonb_build_object('learner_id','${learner}','quiz_version_id','${ids.version}','program_id','${ids.program}','curriculum_id','${ids.curriculum}','grade_level',7,'subject_id',${subject},'concept_id',(select id from public.learning_concepts where workspace_id='${w}' and code='${candidate.questions[0].concept_code}'),'position',1,'video_ref','qaVideo0001','title','Synthetic provider receipt','language','tr','rationale','Isolated contract provider fixture only','embeddable',true,'made_for_kids',true,'verified_at',now(),'verification_expires_at',now()+interval '1 hour')`;
await query(`begin; ${setup}
 create function pg_temp.authoring_check(ok boolean) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'AUTHORING_ASSERTION_FAILED';end if;end$$;
 do $test$ declare r jsonb; begin
  perform pg_temp.authoring_check(not has_function_privilege('authenticated','public.flh_assessment_authoring_command(uuid,uuid,text,jsonb)','EXECUTE'));
  perform pg_temp.authoring_check(not has_table_privilege('authenticated','private.assessment_authoring_requests','SELECT'));
  ${fail(author('create',payload,ids.teacher),'ASSESSMENT_FORBIDDEN')}
  ${fail(author('create',payload,ids.parent,ids.other),'ASSESSMENT_FORBIDDEN')}
  ${fail(author('read'),'ASSESSMENT_TARGET_INVALID')}
  ${fail(author('create',{...payload,quiz:{...quiz,curriculum_id:ids.other}}),'ASSESSMENT_CONTEXT_MISMATCH')}
  ${fail(author('create',{...payload,semantic_review:{...staged.semantic_review,result:'FAIL'}}),'ASSESSMENT_AUTHORING_INPUT_INVALID')}
  perform pg_temp.authoring_check(not exists(select 1 from public.quizzes where id='${ids.quiz}'));
  r:=${author('create',payload)};perform pg_temp.authoring_check(r->>'state'='draft' and r->>'question_count'='0' and r->>'duplicate'='false');
  r:=${author('create',payload)};perform pg_temp.authoring_check(r->>'duplicate'='true');
  ${fail(author('create',{...payload,quiz:{...quiz,title:'Changed retry'}}),'ASSESSMENT_RETRY_CONFLICT')}
  ${fail(publication('stage',malformed),'ASSESSMENT_ACADEMIC_REJECTED')}
  ${fail(publication('stage',{...staged,candidate_sha256:'0'.repeat(64),semantic_review:{...staged.semantic_review,candidate_sha256:'0'.repeat(64)}}),'ASSESSMENT_RETRY_CONFLICT')}
  perform pg_temp.authoring_check(not exists(select 1 from public.quiz_questions where quiz_version_id='${ids.version}'));
  r:=${author('read')};perform pg_temp.authoring_check(r->>'state'='draft');
  r:=${publication('stage',staged)};perform pg_temp.authoring_check(r->>'state'='staged');
  r:=${author('read')};perform pg_temp.authoring_check(r->>'state'='staged' and r->>'question_count'='40' and not r ? 'candidate' and not r ? 'expected_graph');
  r:=${publication('publish')};perform pg_temp.authoring_check(r->>'state'='held');
  ${fail(publication('release'),'ASSESSMENT_VIDEO_GATE_FAILED')}
  r:=${author('read')};perform pg_temp.authoring_check(r->>'state'='held' and r->>'quiz_status'='draft' and r->>'learning_path' is null);
  r:=public.flh_learning_video_attach('${w}','${ids.parent}',${video});perform pg_temp.authoring_check(r->>'ok'='true');
  update public.workspace_settings set value='{"enabled":true,"test_only":true}' where workspace_id='${w}' and key='optional_learning_videos';
  r:=${publication('release')};perform pg_temp.authoring_check(r->>'state'='released');
  r:=${author('read')};perform pg_temp.authoring_check(r->>'state'='released' and r->>'quiz_status'='active' and r->>'version_state'='published' and r->>'video_count'='1' and r->>'learning_path' like '%learner=test');
  perform pg_temp.authoring_check((select count(*)=1 from public.quiz_assignments where quiz_version_id='${ids.version}') and not exists(select 1 from public.quiz_attempts where quiz_version_id='${ids.version}'));
 end $test$; rollback;`);
assert.equal(await query(`select count(*) from private.assessment_authoring_requests where workspace_id='${w}' and request_id='${ids.request}';`),'0');
let owned=false;
try {
 await query(`begin; ${setup} commit;`);owned=true;
 const results=await Promise.all(Array.from({length:3},()=>query(`set role service_role;select ${author('create',payload)};`)));
 assert.equal(results.filter(x=>JSON.parse(x).duplicate===true).length,2);
 assert.equal(await query(`select count(*) from public.quiz_versions where quiz_id='${ids.quiz}';`),'1');
 await assert.rejects(()=>query(`set role service_role;select ${author('create',{...payload,request_id:ids.other})};`),/ASSESSMENT_RETRY_CONFLICT/);
 await query(`set role service_role;select ${publication('stage',staged)};`);
 assert.equal(JSON.parse(await query(`set role service_role;select ${author('read')};`)).question_count,40);
} finally {
 if(owned) await query(`begin;
 do $$ begin if not exists(select 1 from auth.users where id='${ids.parent}' and email='qa-authoring-owner@example.invalid') then raise exception 'AUTHORING_CLEANUP_OWNER_MISMATCH';end if;end$$;
 delete from private.assessment_authoring_requests where workspace_id='${w}' and request_id='${ids.request}' and created_by='${ids.parent}';
 delete from public.assessment_publications where workspace_id='${w}' and quiz_version_id='${ids.version}' and created_by='${ids.parent}';
 delete from public.quizzes where workspace_id='${w}' and id='${ids.quiz}' and slug='qa-assessment-authoring';
 delete from public.learner_program_enrollments where workspace_id='${w}' and learner_id='${learner}' and program_id='${ids.program}';
 delete from public.learning_programs where workspace_id='${w}' and id='${ids.program}';
 delete from public.learning_concepts where workspace_id='${w}' and subject_id=${subject};
 delete from public.subjects where id=${subject} and code='qa-assessment-authoring';
 delete from public.curricula where id='${ids.curriculum}' and code='qa-assessment-authoring';
 delete from public.workspace_members where workspace_id='${w}' and user_id in('${ids.parent}','${ids.teacher}');
 delete from auth.users where id in('${ids.parent}','${ids.teacher}') and email in('qa-authoring-owner@example.invalid','qa-authoring-teacher@example.invalid'); commit;`);
}
assert.equal(await query(`select count(*) from public.quizzes where id='${ids.quiz}';`),'0','owned committed cleanup');
assert.deepEqual(JSON.parse(await query(`select value from public.workspace_settings where workspace_id='${w}' and key='optional_learning_videos';`)),priorFlag);
console.log('Assessment authoring DB grants/tenant/review/input/duplicate/partial rollback/full release/concurrency/owned cleanup: PASS (isolated synthetic provider receipt)');
