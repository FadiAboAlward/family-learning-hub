import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { assessmentStagePayload, academicCandidateHash } from '../supabase/functions/_shared/assessment-publication.mjs';
import { validateAcademicPackage } from '../scripts/academic-content-quality.mjs';

// Disposable local container only. No URL/key/backend transport and no real attempts.
const container='supabase_db_family-learning-hub';
const w='55f9224c-8ba7-4cbc-9f88-713e6a6b41df';
const ids=Object.fromEntries(['parent','quiz','version','program','curriculum','other','teacher'].map((k,i)=>[k,`02710000-0000-4000-8000-${String(i+1).padStart(12,'0')}`]));
const json=value=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";
function query(sql) {
  const child=spawn('docker',['exec','-i',container,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-t','-A'],{stdio:['pipe','pipe','pipe']});
  let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);
  const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve(out.trim()):reject(new Error('Local assessment contract: '+err)));});
  child.stdin.end(sql);return done;
}
const learner=await query(`select id from public.learners where workspace_id='${w}' and slug='test' and is_active and metadata->>'is_test'='true';`);
assert.match(learner,/^[a-f0-9-]{36}$/,'dedicated Testing learner required');
const priorVideoFlag=JSON.parse(await query(`select value from public.workspace_settings where workspace_id='${w}' and key='optional_learning_videos';`));
const candidate=JSON.parse(fs.readFileSync(new URL('./fixtures/assessment-publication/valid-package.json',import.meta.url),'utf8'));
// Preserve authored post-answer feedback exactly; never insert unvalidated fallback copy.
Object.assign(candidate.questions[0],{explanation:'Test için doğrulanmış özgün geri bildirim metni.',correct_explanation:'Doğrulanmış doğru yanıt geri bildirimi.',final_incorrect_explanation:'Doğrulanmış son yanlış yanıt geri bildirimi.'});
// A valid manifest may interleave modes. Native positions must match the existing
// preflight projection without changing manifest identity or within-mode order.
candidate.questions=Array.from({length:20},(_,i)=>[candidate.questions[i],candidate.questions[i+20]]).flat();
const hash=await academicCandidateHash(candidate);
const report=validateAcademicPackage(candidate);assert.equal(report.ok,true);
const target={quiz_id:ids.quiz,quiz_version_id:ids.version,learner_id:learner,program_id:ids.program};
const review={...target,workspace_id:w,candidate_sha256:hash,result:'PASS',reviewed_at:new Date().toISOString(),reviewer_ref:'synthetic:academic-reviewer',authority_ref:'Synthetic isolated parent',source_review_ref:'Synthetic source fixture',learner_scope_review_ref:'Testing scope fixture',warning_dispositions:report.warnings.map(d=>({...d,result:'ACCEPTED',reason:'Synthetic gate test; no real approval.'}))};
const payload=await assessmentStagePayload(w,ids.parent,{target,candidate,semantic_review:review});
const malformedPayloads=[
 p=>delete p.candidate.questions[0].question_code,
 p=>delete p.candidate.questions[0].hints,
 p=>p.candidate.questions[0].options={},
 p=>p.candidate.questions[0].hints={},
 p=>p.candidate.questions=null,
 p=>p.validation.warnings={},
 p=>p.semantic_review.warning_dispositions=null,
 p=>delete p.semantic_review.reviewer_ref,
 p=>p.semantic_review.warning_dispositions.forEach(d=>{d.disposition=d.result;delete d.result;})
].map(mutate=>{const p=structuredClone(payload);mutate(p);return p;});
const pointer={quiz_version_id:ids.version,candidate_sha256:hash};
const cmd=(action,p=pointer,parent=ids.parent)=>`public.flh_assessment_command('${w}','${parent}','${action}',${json(p)})`;
const delivery=(action,p=pointer,parent=ids.parent)=>`public.flh_assessment_delivery_command('${w}','${parent}','${action}',${json(p)})`;
const root='http://localhost:4187/';
const prepareDelivery={...pointer,recipient:'qa-assessment@example.invalid',app_url:root,recipient_review_ref:'Synthetic Testing recipient review only',link_review:{result:'PASS',learning_url:root+'index.html?quiz=qa-assessment-publication&mode=learning&learner=test',exam_url:root+'index.html?quiz=qa-assessment-publication&mode=exam&learner=test',source_ref:'Synthetic isolated released-link contract'}};
const concepts=[...new Set(candidate.questions.map(q=>q.concept_code))];
const setup=`
 insert into auth.users(id,email) values('${ids.parent}','qa-assessment-owner@example.invalid'),('${ids.teacher}','qa-assessment-teacher@example.invalid');
 insert into public.workspace_members(workspace_id,user_id,role) values('${w}','${ids.parent}','owner'),('${w}','${ids.teacher}','teacher');
 insert into public.curricula(id,code,name_ar) values('${ids.curriculum}','qa-assessment-publication','Testing curriculum');
 insert into public.subjects(code,name_ar) values('qa-assessment-publication','Testing subject');
 insert into public.learning_programs(id,workspace_id,slug,title,status,curriculum_id,grade_level)
 values('${ids.program}','${w}','qa-assessment-publication','Testing publication','active','${ids.curriculum}',7);
 insert into public.learner_program_enrollments(workspace_id,learner_id,program_id,status) values('${w}','${learner}','${ids.program}','active');
 insert into public.quizzes(id,workspace_id,subject_id,curriculum_id,slug,title,status,delivery_config)
 values('${ids.quiz}','${w}',(select id from public.subjects where code='qa-assessment-publication'),'${ids.curriculum}','qa-assessment-publication','Testing held assessment','draft','{"exam":{"question_count":20}}');
 insert into public.quiz_versions(id,workspace_id,quiz_id,version_no,state) values('${ids.version}','${w}','${ids.quiz}',1,'draft');
 insert into public.program_quizzes(workspace_id,program_id,quiz_id,availability) values('${w}','${ids.program}','${ids.quiz}','available');
 ${concepts.map(code=>`insert into public.learning_concepts(workspace_id,subject_id,curriculum_id,grade_level,code,title) values('${w}',(select id from public.subjects where code='qa-assessment-publication'),'${ids.curriculum}',7,'${code}','Testing concept');`).join('\n')}
`;
const assertions=`
 create function pg_temp.check_assessment(ok boolean,message text) returns void language plpgsql as $assert$begin if ok is distinct from true then raise exception 'Assessment assertion: %',message; end if; end$assert$;
 do $test$ declare result jsonb; video jsonb; prior_graph jsonb; envelope_hash text; receipt jsonb; begin
  perform pg_temp.check_assessment(not has_table_privilege('anon','public.assessment_publications','SELECT') and not has_table_privilege('authenticated','public.assessment_publications','SELECT'),'private evidence denied to browser roles');
  perform pg_temp.check_assessment(not has_function_privilege('authenticated','public.flh_assessment_command(uuid,uuid,text,jsonb)','EXECUTE') and not has_function_privilege('anon','public.flh_assessment_command(uuid,uuid,text,jsonb)','EXECUTE'),'authoring RPC service only');
  perform pg_temp.check_assessment((select relrowsecurity from pg_class where oid='public.assessment_publications'::regclass),'RLS enabled');
  perform pg_temp.check_assessment(not exists(select 1 from unnest(array['quizzes','quiz_versions','quiz_questions','quiz_question_options','quiz_question_answer_keys','quiz_question_hints','quiz_question_concepts','quiz_assignments','quiz_attempts','learning_video_assignments']) table_name where has_table_privilege('anon','public.'||table_name,'SELECT')),'learner HMAC cannot bypass APIs through anonymous content reads');
  begin perform ${cmd('stage',payload,ids.teacher)}; raise exception 'teacher stage succeeded'; exception when raise_exception then if sqlerrm<>'ASSESSMENT_FORBIDDEN' then raise; end if; end;
  ${malformedPayloads.map(p=>`begin perform ${cmd('stage',p)};raise exception 'malformed stage succeeded';exception when raise_exception then if sqlerrm<>'ASSESSMENT_ACADEMIC_REJECTED' then raise;end if;end;`).join('\n')}
  perform pg_temp.check_assessment((select count(*)=0 from public.quiz_questions where quiz_version_id='${ids.version}'),'malformed RPC inputs leave zero questions');
  perform pg_temp.check_assessment((select count(*)=0 from public.assessment_publications where quiz_version_id='${ids.version}'),'malformed RPC inputs leave zero receipts');
  insert into public.quizzes(id,workspace_id,subject_id,curriculum_id,slug,title,status) select '${ids.other}',workspace_id,subject_id,curriculum_id,'qa-assessment-unrelated','Unrelated sentinel','draft' from public.quizzes where id='${ids.quiz}';
  insert into public.quiz_versions(id,workspace_id,quiz_id,version_no,state) values('02710000-0000-4000-8000-000000000008','${w}','${ids.other}',1,'draft');
  insert into public.quiz_questions(workspace_id,quiz_version_id,position,question_code,question_type,prompt,prompt_language) values('${w}','02710000-0000-4000-8000-000000000008',1,'${candidate.questions.at(-1).question_code}','single_choice','Unrelated sentinel prompt','tr');
  begin perform ${cmd('stage',payload)};raise exception 'global code collision imported';exception when raise_exception then if sqlerrm<>'ASSESSMENT_RETRY_CONFLICT' then raise;end if;end;
  perform pg_temp.check_assessment((select count(*)=0 from public.quiz_questions where quiz_version_id='${ids.version}') and (select count(*)=0 from public.assessment_publications where quiz_version_id='${ids.version}'),'late code collision rolls back entire import');
  perform pg_temp.check_assessment((select prompt='Unrelated sentinel prompt' from public.quiz_questions where quiz_version_id='02710000-0000-4000-8000-000000000008'),'code collision never updates unrelated quiz');
  delete from public.quizzes where id='${ids.other}' and workspace_id='${w}';
  begin perform ${cmd('stage',{...payload,candidate:{...candidate,academic_context:{...candidate.academic_context,grade:'7. sınıf'}}})}; raise exception 'nonnumeric grade stage succeeded'; exception when raise_exception then if sqlerrm<>'ASSESSMENT_CONTEXT_MISMATCH' then raise; end if; end;
  -- A failure after earlier questions were inserted must roll back the entire graph.
  delete from public.learning_concepts where workspace_id='${w}' and code='${concepts.at(-1)}';
  begin perform ${cmd('stage',payload)}; raise exception 'partial stage succeeded'; exception when raise_exception then if sqlerrm<>'ASSESSMENT_CONTEXT_MISMATCH' then raise; end if; end;
  perform pg_temp.check_assessment((select count(*)=0 from public.quiz_questions where quiz_version_id='${ids.version}'),'failed import leaves zero questions');
  perform pg_temp.check_assessment((select count(*)=0 from public.assessment_publications where quiz_version_id='${ids.version}'),'failed import leaves zero receipts');
  insert into public.learning_concepts(workspace_id,subject_id,curriculum_id,grade_level,code,title) values('${w}',(select id from public.subjects where code='qa-assessment-publication'),'${ids.curriculum}',7,'${concepts.at(-1)}','Testing restored concept');
  result:=${cmd('stage',payload)};perform pg_temp.check_assessment(result->>'state'='staged','stage succeeds');
  perform pg_temp.check_assessment((select k.explanation='${candidate.questions[0].explanation}' and k.correct_explanation='${candidate.questions[0].correct_explanation}' and k.final_incorrect_explanation='${candidate.questions[0].final_incorrect_explanation}' from public.quiz_question_answer_keys k join public.quiz_questions q on q.id=k.question_id where q.quiz_version_id='${ids.version}' and q.position=1),'authored feedback preserved exactly');
  begin update public.quiz_versions set state='published' where id='${ids.version}';raise exception 'raw publish succeeded';exception when raise_exception then if sqlerrm<>'ASSESSMENT_HELD_OR_IMMUTABLE' then raise;end if;end;
  result:=${cmd('stage',payload)};perform pg_temp.check_assessment(result->>'duplicate'='true','stage retry converges');
  perform pg_temp.check_assessment((select count(*)=40 from public.quiz_questions where quiz_version_id='${ids.version}'),'40 exact questions');
  perform pg_temp.check_assessment((select jsonb_agg(question_code order by position) from public.quiz_questions where quiz_version_id='${ids.version}')=${json(['learning','exam'].flatMap(mode=>candidate.questions.filter(q=>q.delivery_surface===mode).map(q=>q.question_code)))},'mixed manifest retains exact canonical mode order');
  perform pg_temp.check_assessment((select count(*)=160 from public.quiz_question_options o join public.quiz_questions q on q.id=o.question_id where q.quiz_version_id='${ids.version}'),'160 options without duplicates');
  perform pg_temp.check_assessment((select count(*)=80 from public.quiz_question_hints h join public.quiz_questions q on q.id=h.question_id where q.quiz_version_id='${ids.version}'),'80 authored hints without duplicates');
  begin perform ${cmd('stage',{...payload,candidate_sha256:'0'.repeat(64)})};raise exception 'changed retry succeeded';exception when raise_exception then if sqlerrm<>'ASSESSMENT_RETRY_CONFLICT' then raise;end if;end;
  begin perform ${cmd('stage',{...payload,target:{...target,quiz_id:ids.other}})};raise exception 'cross quiz succeeded';exception when raise_exception then if sqlerrm<>'ASSESSMENT_TARGET_INVALID' then raise;end if;end;
  result:=${cmd('publish')};perform pg_temp.check_assessment(result->>'state'='held','complete version held');
  result:=${cmd('publish')};perform pg_temp.check_assessment(result->>'duplicate'='true','publish retry converges');
  begin perform ${delivery('prepare',prepareDelivery)};raise exception 'held delivery prepared';exception when raise_exception then if sqlerrm<>'ASSESSMENT_DELIVERY_STATE_CONFLICT' then raise;end if;end;
  perform pg_temp.check_assessment((select state='published' from public.quiz_versions where id='${ids.version}') and (select status='draft' from public.quizzes where id='${ids.quiz}'),'published version stays draft quiz');
  result:=public.flh_learning_start('${w}','${learner}','qa-assessment-publication');perform pg_temp.check_assessment(result->>'error'='QUIZ_NOT_FOUND','Learning start hidden');
  result:=public.flh_exam_start('${w}','${learner}','qa-assessment-publication');perform pg_temp.check_assessment(result->>'error'='QUIZ_NOT_FOUND','Exam start hidden');
  result:=public.flh_learning_video_preview('${w}','${learner}','qa-assessment-publication');perform pg_temp.check_assessment(result->>'error'='QUIZ_NOT_FOUND','preview hidden');
  result:=public.flh_learner_journey_context('${w}','${learner}',array['${ids.quiz}'::uuid]);perform pg_temp.check_assessment(result->>'error'='JOURNEY_UNAVAILABLE','journey explicit quiz hidden');
  result:=public.flh_learner_journey_progress('${w}','${learner}',array['${ids.version}'::uuid]);perform pg_temp.check_assessment(result->>'error'='JOURNEY_UNAVAILABLE','journey explicit version hidden');
  perform pg_temp.check_assessment((select count(*)=0 from public.quiz_attempts where quiz_version_id='${ids.version}') and (select count(*)=0 from public.quiz_assignments where quiz_version_id='${ids.version}'),'no premature attempts or assignments');
  begin insert into public.quiz_assignments(workspace_id,learner_id,quiz_version_id) values('${w}','${learner}','${ids.version}');raise exception 'raw held assignment inserted';exception when raise_exception then if sqlerrm<>'ASSESSMENT_HELD_OR_IMMUTABLE' then raise;end if;end;
  begin insert into public.quiz_attempts(workspace_id,learner_id,quiz_version_id) values('${w}','${learner}','${ids.version}');raise exception 'raw held attempt inserted';exception when raise_exception then if sqlerrm<>'ASSESSMENT_HELD_OR_IMMUTABLE' then raise;end if;end;
  begin update public.quizzes set status='active' where id='${ids.quiz}';raise exception 'bypass activated';exception when raise_exception then if sqlerrm<>'ASSESSMENT_HELD_OR_IMMUTABLE' then raise;end if;end;
  begin update public.quiz_questions set prompt='tampered' where quiz_version_id='${ids.version}';raise exception 'immutable question changed';exception when raise_exception then if sqlerrm<>'ASSESSMENT_HELD_OR_IMMUTABLE' then raise;end if;end;
  begin perform ${cmd('release')};raise exception 'released without video';exception when raise_exception then if sqlerrm<>'ASSESSMENT_VIDEO_GATE_FAILED' then raise;end if;end;
  perform pg_temp.check_assessment((select status='draft' from public.quizzes where id='${ids.quiz}'),'release failure stays hidden');
  video:=jsonb_build_object('learner_id','${learner}','quiz_version_id','${ids.version}','program_id','${ids.program}','curriculum_id','${ids.curriculum}','grade_level',7,'subject_id',(select id from public.subjects where code='qa-assessment-publication'),'concept_id',(select id from public.learning_concepts where workspace_id='${w}' and code='${candidate.questions[0].concept_code}'),'position',1,'video_ref','qaVideo0001','title','Testing reviewed video','language','tr','rationale','Synthetic official provider status fixture','embeddable',true,'made_for_kids',true,'verified_at',now(),'verification_expires_at',now()+interval '1 hour');
  result:=public.flh_learning_video_attach('${w}','${ids.teacher}',video);perform pg_temp.check_assessment(result->>'error'='VIDEO_ATTACHMENT_FORBIDDEN','teacher cannot attach');
  result:=public.flh_learning_video_attach('${w}','${ids.parent}',video||'{"authoring":true}');perform pg_temp.check_assessment(result->>'error'='INVALID_VIDEO_INPUT','flag cannot grant authoring');
  result:=public.flh_learning_video_attach('${w}','${ids.parent}',video||'{"grade_level":6}');perform pg_temp.check_assessment(result->>'error'='VIDEO_CONTEXT_MISMATCH','grade mismatch hidden attachment rejected');
  update public.learning_programs set grade_level=6 where id='${ids.program}';update public.learning_concepts set grade_level=6 where workspace_id='${w}' and subject_id=(select id from public.subjects where code='qa-assessment-publication');
  result:=public.flh_learning_video_attach('${w}','${ids.parent}',video||'{"grade_level":6}');perform pg_temp.check_assessment(result->>'error'='VIDEO_CONTEXT_MISMATCH','changed live grade cannot retarget reviewed candidate');
  update public.learning_programs set grade_level=7 where id='${ids.program}';update public.learning_concepts set grade_level=7 where workspace_id='${w}' and subject_id=(select id from public.subjects where code='qa-assessment-publication');
  result:=public.flh_learning_video_attach('${w}','${ids.parent}',video);perform pg_temp.check_assessment(result->>'ok'='true','authorized exact held attachment: '||coalesce(result->>'error','UNKNOWN'));
  result:=public.flh_learning_video_preview('${w}','${learner}','qa-assessment-publication');perform pg_temp.check_assessment(result->>'error'='QUIZ_NOT_FOUND','attached held version still hidden');
  result:=public.flh_learner_journey_progress('${w}','${learner}',null);
  perform pg_temp.check_assessment(result->>'error' is null and position('${ids.version}' in result::text)=0,'default assignment discovery excludes attached held versions without blocking unrelated progress');
  update public.workspace_settings set value='{"enabled":false,"test_only":true}' where workspace_id='${w}' and key='optional_learning_videos';
  begin perform ${cmd('release')};raise exception 'disabled video rollout released';exception when raise_exception then if sqlerrm<>'ASSESSMENT_VIDEO_GATE_FAILED' then raise;end if;end;
  perform pg_temp.check_assessment((select status='draft' from public.quizzes where id='${ids.quiz}'),'disabled preview keeps hold');
  update public.workspace_settings set value='{"enabled":true,"test_only":true}' where workspace_id='${w}' and key='optional_learning_videos';
  result:=${cmd('release')};perform pg_temp.check_assessment(result->>'state'='released','complete release succeeds');
  result:=${cmd('release')};perform pg_temp.check_assessment(result->>'duplicate'='true','release retry converges');
  perform pg_temp.check_assessment((select count(*)=1 from public.quiz_assignments where quiz_version_id='${ids.version}' and learner_id='${learner}'),'one intended assignment');
  result:=public.flh_learner_journey_progress('${w}','${learner}',null);
  perform pg_temp.check_assessment(result->>'error' is null and position('${ids.version}' in result::text)>0,'default assignment discovery includes released versions');
  result:=public.flh_learning_start('${w}','${learner}','qa-assessment-publication');perform pg_temp.check_assessment(result->>'error' is null,'released Learning accessible');
  result:=public.flh_learning_video_preview('${w}','${learner}','qa-assessment-publication');perform pg_temp.check_assessment(result->>'error' is null,'released verified video preview accessible');
  result:=public.flh_exam_start('${w}','${learner}','qa-assessment-publication');perform pg_temp.check_assessment(result->>'error' is null,'released independent Exam accessible');
  result:=public.flh_learning_video_preview('${w}','${learner}','qa-assessment-publication');perform pg_temp.check_assessment(result->>'error'='VIDEO_NOT_AVAILABLE','active Exam blocks video preview');
  begin delete from public.quiz_question_hints where question_id in(select id from public.quiz_questions where quiz_version_id='${ids.version}');raise exception 'published hints deleted';exception when raise_exception then if sqlerrm<>'ASSESSMENT_HELD_OR_IMMUTABLE' then raise;end if;end;
  perform pg_temp.check_assessment((select video_receipt is not null and delivery_state='pending' from public.assessment_publications where quiz_version_id='${ids.version}'),'durable release evidence; no mail sent');
  perform pg_temp.check_assessment(not has_function_privilege('authenticated','public.flh_assessment_delivery_command(uuid,uuid,text,jsonb)','EXECUTE'),'delivery RPC service only');
  begin perform ${delivery('prepare',prepareDelivery,ids.teacher)};raise exception 'teacher delivery prepared';exception when raise_exception then if sqlerrm<>'ASSESSMENT_FORBIDDEN' then raise;end if;end;
  result:=${delivery('prepare',prepareDelivery)};envelope_hash:=result->>'envelope_sha256';
  perform pg_temp.check_assessment(result->>'state'='pending' and result->>'automatic_send'='false','private Gmail outbox pending without sender');
  result:=${delivery('prepare',prepareDelivery)};perform pg_temp.check_assessment(result->>'duplicate'='true','outbox prepare exact retry converges');
  begin perform ${delivery('prepare',{...prepareDelivery,recipient:'other@example.invalid'})};raise exception 'recipient retry changed';exception when raise_exception then if sqlerrm<>'ASSESSMENT_DELIVERY_CONFLICT' then raise;end if;end;
  result:=public.flh_assessment_delivery_command('${w}','${ids.parent}','claim',${json(pointer)}||jsonb_build_object('envelope_sha256',envelope_hash));perform pg_temp.check_assessment(result->>'new_handoff'='true','first handoff claimed once');
  result:=public.flh_assessment_delivery_command('${w}','${ids.parent}','claim',${json(pointer)}||jsonb_build_object('envelope_sha256',envelope_hash));perform pg_temp.check_assessment(result->>'new_handoff'='false','retry never creates another handoff');
  result:=public.flh_assessment_delivery_command('${w}','${ids.parent}','uncertain',${json(pointer)}||jsonb_build_object('envelope_sha256',envelope_hash));perform pg_temp.check_assessment(result->>'state'='uncertain','unknown send recorded');
  result:=public.flh_assessment_delivery_command('${w}','${ids.parent}','claim',${json(pointer)}||jsonb_build_object('envelope_sha256',envelope_hash));perform pg_temp.check_assessment(result->>'new_handoff'='false' and result->>'state'='uncertain','uncertain send never automatically retries');
  receipt:=jsonb_build_object('provider','gmail','gmail_message_id','abc0123456789def','sent',true,'recipient','qa-assessment@example.invalid','reviewed_by','${ids.parent}','verification_method','parent-reviewed-connector-readback','source_ref','gmail:read_email:abc0123456789def','observed_at',now(),
   'content_sha256',(select encode(extensions.digest(convert_to(delivery_envelope->>'body','UTF8'),'sha256'),'hex') from public.assessment_publications where quiz_version_id='${ids.version}'));
  begin perform public.flh_assessment_delivery_command('${w}','${ids.parent}','reconcile',${json(pointer)}||jsonb_build_object('envelope_sha256',envelope_hash,'receipt',receipt||'{"sent":false}'));raise exception 'unsent receipt accepted';exception when raise_exception then if sqlerrm<>'ASSESSMENT_DELIVERY_EVIDENCE_INVALID' then raise;end if;end;
  result:=public.flh_assessment_delivery_command('${w}','${ids.parent}','reconcile',${json(pointer)}||jsonb_build_object('envelope_sha256',envelope_hash,'receipt',receipt));perform pg_temp.check_assessment(result->>'state'='confirmed','synthetic SENT witness reconciliation');
  result:=public.flh_assessment_delivery_command('${w}','${ids.parent}','reconcile',${json(pointer)}||jsonb_build_object('envelope_sha256',envelope_hash,'receipt',receipt));perform pg_temp.check_assessment(result->>'duplicate'='true','SENT witness retry preserves receipt');
 end; $test$;
`;
await query(`begin; ${setup} ${assertions} rollback;`);
assert.equal(await query(`select count(*) from public.quizzes where id='${ids.quiz}';`),'0','transaction fixture cleanup');
// Real separate connections contend on the same exact target. Owned committed fixtures
// are removed in finally, including failed runs; no generic/reset/Production transport.
let owned=false;
try {
 await query(`begin; ${setup} commit;`);owned=true;
 const staged=await Promise.all(Array.from({length:3},()=>query(`set role service_role; select ${cmd('stage',payload)};`)));
 assert.ok(staged.every(s=>JSON.parse(s).ok===true));
 assert.equal(staged.filter(s=>JSON.parse(s).duplicate===true).length,2);
 await assert.rejects(()=>query(`set role service_role; select ${cmd('stage',{...payload,candidate_sha256:'0'.repeat(64)})};`),/ASSESSMENT_RETRY_CONFLICT/);
 const published=await Promise.all(Array.from({length:3},()=>query(`set role service_role; select ${cmd('publish')};`)));
 assert.ok(published.every(s=>JSON.parse(s).ok===true));
 const videoSql=`jsonb_build_object('learner_id','${learner}','quiz_version_id','${ids.version}','program_id','${ids.program}','curriculum_id','${ids.curriculum}','grade_level',7,'subject_id',(select id from public.subjects where code='qa-assessment-publication'),'concept_id',(select id from public.learning_concepts where workspace_id='${w}' and code='${candidate.questions[0].concept_code}'),'position',1,'video_ref','qaVideo0001','title','Testing concurrent video','language','tr','rationale','Synthetic provider status contract only','embeddable',true,'made_for_kids',true,'verified_at',now(),'verification_expires_at',now()+interval '1 hour')`;
 assert.equal(JSON.parse(await query(`set role service_role; select public.flh_learning_video_attach('${w}','${ids.parent}',${videoSql});`)).ok,true);
 await query(`update public.workspace_settings set value='{"enabled":true,"test_only":true}' where workspace_id='${w}' and key='optional_learning_videos';`);
 const released=await Promise.all(Array.from({length:3},()=>query(`set role service_role; select ${cmd('release')};`)));
 assert.ok(released.every(s=>JSON.parse(s).ok===true));
 assert.equal(released.filter(s=>JSON.parse(s).duplicate===true).length,2);
 assert.equal(await query(`select count(*) from public.quiz_assignments where quiz_version_id='${ids.version}';`),'1');
 assert.equal(await query(`select count(*) from public.quiz_questions where quiz_version_id='${ids.version}';`),'40');
 const outbox=JSON.parse(await query(`set role service_role; select ${delivery('prepare',prepareDelivery)};`));
 const deliveryPointer={...pointer,envelope_sha256:outbox.envelope_sha256};
 const claims=await Promise.all(Array.from({length:3},()=>query(`set role service_role; select ${delivery('claim',deliveryPointer)};`)));
 assert.equal(claims.filter(s=>JSON.parse(s).new_handoff===true).length,1,'one concurrent Gmail handoff; no sender invoked');
 await query(`set role service_role; select ${delivery('uncertain',deliveryPointer)};`);
 assert.equal(JSON.parse(await query(`set role service_role; select ${delivery('claim',deliveryPointer)};`)).new_handoff,false,'uncertain concurrent handoff cannot resend');
} finally {
 if(owned) await query(`begin;
  do $owned$ begin
   if not exists(select 1 from auth.users where id='${ids.parent}' and email='qa-assessment-owner@example.invalid') or not exists(select 1 from public.quizzes where id='${ids.quiz}' and workspace_id='${w}' and slug='qa-assessment-publication') then raise exception 'ASSESSMENT_QA_CLEANUP_OWNER_MISMATCH';end if;
  end; $owned$;
  update public.workspace_settings set value=${json(priorVideoFlag)} where workspace_id='${w}' and key='optional_learning_videos';
  delete from public.assessment_publications where workspace_id='${w}' and quiz_version_id='${ids.version}' and created_by='${ids.parent}';
  delete from public.learning_video_assignments where workspace_id='${w}' and quiz_version_id='${ids.version}';
  delete from public.quiz_assignments where workspace_id='${w}' and quiz_version_id='${ids.version}';
  delete from public.quizzes where workspace_id='${w}' and id='${ids.quiz}';
  delete from public.learner_program_enrollments where workspace_id='${w}' and program_id='${ids.program}' and learner_id='${learner}';
  delete from public.learning_programs where workspace_id='${w}' and id='${ids.program}';
  delete from public.learning_concepts where workspace_id='${w}' and subject_id=(select id from public.subjects where code='qa-assessment-publication');
  delete from public.subjects where code='qa-assessment-publication';
  delete from public.curricula where id='${ids.curriculum}' and code='qa-assessment-publication';
  delete from public.workspace_members where workspace_id='${w}' and user_id in('${ids.parent}','${ids.teacher}');
  delete from auth.users where id in('${ids.parent}','${ids.teacher}') and email in('qa-assessment-owner@example.invalid','qa-assessment-teacher@example.invalid');
  commit;`);
}
assert.equal(await query(`select count(*) from public.quizzes where id='${ids.quiz}';`),'0','committed owned-fixture cleanup');
assert.deepEqual(JSON.parse(await query(`select value from public.workspace_settings where workspace_id='${w}' and key='optional_learning_videos';`)),priorVideoFlag,'video rollout flag restored after owned QA');
console.log('Assessment DB transaction/rollback, concurrent exact retries, authorization/RLS, held visibility, immutable authored content, provider-context, atomic release and cleanup: PASS');
