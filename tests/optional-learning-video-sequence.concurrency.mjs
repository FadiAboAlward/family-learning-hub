import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const containerName = 'supabase_db_family-learning-hub';
const workspaceId = '55f9224c-8ba7-4cbc-9f88-713e6a6b41df';
const ownerId = 'a5000000-0000-4000-8000-000000000001';
const curriculumId = 'a5000000-0000-4000-8000-000000000002';
const programId = 'a5000000-0000-4000-8000-000000000003';
const quizId = 'a5000000-0000-4000-8000-000000000004';
const versionId = 'a5000000-0000-4000-8000-000000000005';
const conceptOne = 'a5000000-0000-4000-8000-000000000006';
const conceptTwo = 'a5000000-0000-4000-8000-000000000007';
const questionOne = 'a5000000-0000-4000-8000-000000000008';
const questionTwo = 'a5000000-0000-4000-8000-000000000009';
const subjectCode = 'qa-optional-video-sequence-concurrency';
const args = ['exec',containerName,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-t','-A','-c'];

async function psql(sql) {
  const { stdout } = await execFileAsync('docker',[...args,sql],{maxBuffer:1024*1024});
  return stdout.trim();
}
function spawnPsql(sql) {
  const child = spawn('docker',[...args,sql],{stdio:['ignore','pipe','pipe']});
  let stdout=''; let stderr='';
  child.stdout.on('data',chunk=>{stdout+=chunk;});
  child.stderr.on('data',chunk=>{stderr+=chunk;});
  const done = new Promise((resolve,reject)=>{
    child.on('error',reject);
    child.on('close',code=>code===0?resolve(stdout.trim()):reject(new Error(`psql exited ${code}: ${stderr}`)));
  });
  return {done};
}
const quoteJson = value => `'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;

const learnerId = await psql(`select id::text from public.learners where workspace_id='${workspaceId}'::uuid and slug='test' and is_active and coalesce((metadata->>'is_test')::boolean,false)`);
assert.match(learnerId,/^[0-9a-f-]{36}$/,'only the dedicated test learner may be used');

await psql(`
  insert into auth.users(id,email) values('${ownerId}','qa-optional-video-concurrency@example.invalid');
  insert into public.workspace_members(workspace_id,user_id,role) values('${workspaceId}','${ownerId}','owner');
  insert into public.curricula(id,code,name_ar) values('${curriculumId}','qa-optional-video-sequence-concurrency','QA optional video concurrency');
  insert into public.subjects(code,name_ar) values('${subjectCode}','QA optional video concurrency');
  insert into public.learning_programs(id,workspace_id,slug,title,status,curriculum_id,grade_level)
    values('${programId}','${workspaceId}','qa-optional-video-sequence-concurrency','QA optional video concurrency','active','${curriculumId}',7);
  insert into public.learner_program_enrollments(workspace_id,learner_id,program_id,status)
    values('${workspaceId}','${learnerId}','${programId}','active');
  insert into public.quizzes(id,workspace_id,subject_id,curriculum_id,slug,title,status)
    values('${quizId}','${workspaceId}',(select id from public.subjects where code='${subjectCode}'),'${curriculumId}','qa-optional-video-sequence-concurrency','QA optional video concurrency','active');
  insert into public.quiz_versions(id,workspace_id,quiz_id,version_no,state)
    values('${versionId}','${workspaceId}','${quizId}',1,'published');
  insert into public.program_quizzes(workspace_id,program_id,quiz_id,availability)
    values('${workspaceId}','${programId}','${quizId}','available');
  insert into public.learning_concepts(id,workspace_id,subject_id,curriculum_id,grade_level,code,title) values
    ('${conceptOne}','${workspaceId}',(select id from public.subjects where code='${subjectCode}'),'${curriculumId}',7,'qa-opt-video-concurrency-one','Concurrency concept one'),
    ('${conceptTwo}','${workspaceId}',(select id from public.subjects where code='${subjectCode}'),'${curriculumId}',7,'qa-opt-video-concurrency-two','Concurrency concept two');
  insert into public.quiz_questions(id,workspace_id,quiz_version_id,position,question_type,prompt,origin,delivery_role,prompt_language) values
    ('${questionOne}','${workspaceId}','${versionId}',1,'single_choice','Question one','generated','core','en'),
    ('${questionTwo}','${workspaceId}','${versionId}',2,'single_choice','Question two','generated','core','en');
  insert into public.quiz_question_options(workspace_id,question_id,position,content) values
    ('${workspaceId}','${questionOne}',1,'One'),('${workspaceId}','${questionTwo}',1,'Two');
  insert into public.quiz_question_concepts(workspace_id,question_id,concept_id,is_primary) values
    ('${workspaceId}','${questionOne}','${conceptOne}',true),('${workspaceId}','${questionTwo}','${conceptTwo}',true);
`);

const subjectId = Number(await psql(`select id::text from public.subjects where code='${subjectCode}'`));
assert.ok(Number.isSafeInteger(subjectId));

const base = {
  learner_id:learnerId,
  quiz_version_id:versionId,
  program_id:programId,
  curriculum_id:curriculumId,
  grade_level:7,
  subject_id:subjectId,
  title:'Sequence concurrency lesson',
  language:'en',
  rationale:'Synthetic exact target sequence concurrency',
  embeddable:true,
  made_for_kids:false,
};
function candidate(conceptId,videoRef,position) {
  const now = Date.now();
  const value = {
    ...base,
    concept_id:conceptId,
    video_ref:videoRef,
    verified_at:new Date(now).toISOString(),
    verification_expires_at:new Date(now+7*86400000).toISOString(),
  };
  if (position !== undefined) value.position=position;
  return value;
}
const call = value => `set role service_role; select public.flh_learning_video_attach('${workspaceId}'::uuid,'${ownerId}'::uuid,${quoteJson(value)})::text; reset role;`;

let children=[];
try {
  const firstSlot = JSON.parse(await psql(call(candidate(conceptOne,'qaSeqCon001',1))));
  assert.equal(firstSlot.ok,true,'position 1 fixture attaches before concurrency race');

  const lockExpression = `hashtextextended('${workspaceId}:${learnerId}:${versionId}:optional-video-sequence',0)`;
  const blocker = spawnPsql(`begin; select pg_advisory_xact_lock(${lockExpression}); select pg_advisory_xact_lock(91500101); select pg_sleep(8); commit;`);
  children.push(blocker);

  const lockDeadline=Date.now()+5000;
  let blockerReady=false;
  while(!blockerReady&&Date.now()<lockDeadline){
    blockerReady=await psql("select count(*)::text from pg_locks where locktype='advisory' and objid=91500101 and granted")==='1';
    if(!blockerReady) await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert.equal(blockerReady,true,'test blocker must own the sequence lock first');

  const explicit = spawnPsql(call(candidate(conceptTwo,'qaSeqCon002',2)));
  children.push(explicit);
  const explicitDeadline=Date.now()+4000;
  let explicitWaiting=false;
  while(!explicitWaiting&&Date.now()<explicitDeadline){
    explicitWaiting=Number(await psql("select count(*)::text from pg_stat_activity where wait_event_type='Lock' and wait_event='advisory' and query like '%qaSeqCon002%'"))===1;
    if(!explicitWaiting) await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert.equal(explicitWaiting,true,'explicit position 2 call must wait on the production sequence lock');

  const omitted = spawnPsql(call(candidate(conceptOne,'qaSeqCon003')));
  children.push(omitted);
  const omittedDeadline=Date.now()+4000;
  let omittedWaiting=false;
  while(!omittedWaiting&&Date.now()<omittedDeadline){
    omittedWaiting=Number(await psql("select count(*)::text from pg_stat_activity where wait_event_type='Lock' and wait_event='advisory' and query like '%qaSeqCon003%'"))===1;
    if(!omittedWaiting) await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert.equal(omittedWaiting,true,'omitted-position call must share the same production sequence lock');

  const [,explicitOutput,omittedOutput] = await Promise.all([blocker.done,explicit.done,omitted.done]);
  const explicitResult=JSON.parse(explicitOutput);
  const omittedResult=JSON.parse(omittedOutput);
  assert.equal(explicitResult.ok,true,'explicit position 2 commits first after serialized wait');
  assert.equal(explicitResult.position,2);
  assert.equal(omittedResult.error,'INVALID_VIDEO_INPUT','omitted position rechecks after the explicit sequence writer commits');
  assert.equal(await psql(`select video_ref from public.learning_video_assignments where workspace_id='${workspaceId}' and learner_id='${learnerId}' and quiz_version_id='${versionId}' and position=1`),'qaSeqCon001','serialized omission cannot replace slot 1');
  assert.equal(await psql(`select video_ref from public.learning_video_assignments where workspace_id='${workspaceId}' and learner_id='${learnerId}' and quiz_version_id='${versionId}' and position=2`),'qaSeqCon002','explicit slot 2 survives the race');
  assert.equal(Number(await psql(`select count(*) from public.learning_video_assignments where workspace_id='${workspaceId}' and learner_id='${learnerId}' and quiz_version_id='${versionId}'`)),2);
  console.log('Optional-video sequence concurrent explicit/omitted position serialization passed.');
} finally {
  await Promise.allSettled(children.map(child=>child.done));
  await psql(`
    delete from public.learning_video_assignments where workspace_id='${workspaceId}' and learner_id='${learnerId}' and quiz_version_id='${versionId}';
    delete from public.quiz_question_concepts where workspace_id='${workspaceId}' and question_id in ('${questionOne}','${questionTwo}');
    delete from public.quiz_question_options where workspace_id='${workspaceId}' and question_id in ('${questionOne}','${questionTwo}');
    delete from public.quiz_questions where workspace_id='${workspaceId}' and id in ('${questionOne}','${questionTwo}');
    delete from public.learning_concepts where workspace_id='${workspaceId}' and id in ('${conceptOne}','${conceptTwo}');
    delete from public.program_quizzes where workspace_id='${workspaceId}' and program_id='${programId}' and quiz_id='${quizId}';
    delete from public.learner_program_enrollments where workspace_id='${workspaceId}' and learner_id='${learnerId}' and program_id='${programId}';
    delete from public.quiz_versions where workspace_id='${workspaceId}' and id='${versionId}';
    delete from public.quizzes where workspace_id='${workspaceId}' and id='${quizId}';
    delete from public.learning_programs where workspace_id='${workspaceId}' and id='${programId}';
    delete from public.subjects where code='${subjectCode}';
    delete from public.curricula where id='${curriculumId}';
    delete from public.workspace_members where workspace_id='${workspaceId}' and user_id='${ownerId}';
    delete from auth.users where id='${ownerId}';
  `);
}
