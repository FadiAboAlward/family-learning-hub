import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const containerName = 'supabase_db_family-learning-hub';
const workspaceId = '55f9224c-8ba7-4cbc-9f88-713e6a6b41df';
const attemptId = '74000000-0000-4000-8000-000000000001';
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

const row = JSON.parse(await psql(`
  select json_build_object(
    'version_id',qv.id::text,
    'question_id',qq.id::text,
    'concept_id',qc.concept_id::text,
    'difficulty',qq.difficulty_level,
    'correct_value',k.correct_answer->>'value'
  )::text
  from public.quizzes quiz
  join public.quiz_versions qv on qv.workspace_id=quiz.workspace_id and qv.quiz_id=quiz.id and qv.state='published'
  join public.quiz_questions qq on qq.workspace_id=qv.workspace_id and qq.quiz_version_id=qv.id and qq.question_type='numeric'
  join public.quiz_question_concepts qc on qc.workspace_id=qq.workspace_id and qc.question_id=qq.id and qc.is_primary
  join public.quiz_question_answer_keys k on k.workspace_id=qq.workspace_id and k.question_id=qq.id
  where quiz.workspace_id='${workspaceId}'::uuid
    and quiz.slug='tr-g5-meb-support-s2-decimals'
  order by qq.position
  limit 1
`));

await psql(`
  delete from public.quiz_attempts where id='${attemptId}'::uuid;
  delete from public.learner_concept_mastery
    where workspace_id='${workspaceId}'::uuid
      and learner_id='${learnerId}'::uuid
      and concept_id='${row.concept_id}'::uuid
      and metadata->>'engine'='learning-api-v2';
  insert into public.quiz_attempts(id,workspace_id,learner_id,quiz_version_id,status,delivery_mode,metadata)
    values('${attemptId}','${workspaceId}','${learnerId}','${row.version_id}','in_progress','learning','{"qa_scope":"support_typed_concurrency"}'::jsonb);
  insert into public.quiz_attempt_question_queue(
    workspace_id,quiz_attempt_id,sequence_no,question_id,concept_id,difficulty_level,status
  ) values (
    '${workspaceId}','${attemptId}',1,'${row.question_id}','${row.concept_id}',${Number(row.difficulty)},'active'
  );
`);

const answerSql = `set role service_role; select public.flh_learning_answer_response('${workspaceId}'::uuid,'${learnerId}'::uuid,'${attemptId}'::uuid,'${row.question_id}'::uuid,${quoteJson({value:row.correct_value})})::text; reset role;`;
const draftSql = `set role service_role; select public.flh_learning_save_response_draft('${workspaceId}'::uuid,'${learnerId}'::uuid,'${attemptId}'::uuid,'${row.question_id}'::uuid,${quoteJson({value:'999999'})})::text; reset role;`;

let children=[];
try {
  const blocker = spawnPsql(`begin; select id from public.quiz_attempts where id='${attemptId}'::uuid for update; select pg_advisory_xact_lock(91700101); select pg_sleep(8); commit;`);
  children.push(blocker);

  const deadline=Date.now()+4000;
  let ready=false;
  while(!ready&&Date.now()<deadline){
    ready=await psql("select count(*)::text from pg_locks where locktype='advisory' and objid=91700101 and granted")==='1';
    if(!ready) await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert.equal(ready,true,'blocker must own the attempt row first');

  const answer=spawnPsql(answerSql);
  children.push(answer);
  const answerDeadline=Date.now()+4000;
  let answerWaiting=false;
  while(!answerWaiting&&Date.now()<answerDeadline){
    answerWaiting=Number(await psql(`select count(*)::text from pg_stat_activity where wait_event_type='Lock' and query like '%flh_learning_answer_response%' and query like '%${attemptId}%'`))>=1;
    if(!answerWaiting) await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert.equal(answerWaiting,true,'answer must be waiting on the production attempt-row lock');

  const draft=spawnPsql(draftSql);
  children.push(draft);
  const [blockerOutput,answerOutput,draftOutput]=await Promise.all([blocker.done,answer.done,draft.done]);
  assert.match(blockerOutput,new RegExp(attemptId));

  const answerResult=JSON.parse(answerOutput);
  const draftResult=JSON.parse(draftOutput);
  assert.equal(answerResult.finalized,true,'correct typed answer finalizes while racing the draft');
  assert.equal(answerResult.is_correct,true);
  assert.equal(draftResult.error,'QUESTION_NOT_ACTIVE','late draft is rejected after grading completes');

  const metadata=JSON.parse(await psql(`select interaction_metadata::text from public.quiz_attempt_question_queue where quiz_attempt_id='${attemptId}'::uuid and question_id='${row.question_id}'::uuid`));
  assert.equal(metadata.draft_response,undefined,'late draft cannot be restored after grading');
  assert.deepEqual(metadata.learning_response_last_response,{value:row.correct_value},'idempotency response survives the race');
  assert.deepEqual(metadata.learning_response_last_result,answerResult,'idempotency result survives the race');

  const retry=JSON.parse(await psql(answerSql));
  assert.deepEqual(retry,answerResult,'exact answer retry returns the cached result after the race');
  assert.equal(Number(await psql(`select count(*) from public.quiz_answer_attempts where quiz_attempt_id='${attemptId}'::uuid and question_id='${row.question_id}'::uuid`)),1,'race creates one grading attempt');
  assert.equal(Number(await psql(`select evidence_count from public.learner_concept_mastery where learner_id='${learnerId}'::uuid and concept_id='${row.concept_id}'::uuid`)),1,'race creates one mastery evidence event');

  console.log('Typed draft/answer concurrency and idempotency regression passed.');
} finally {
  await Promise.allSettled(children.map(child=>child.done));
  await psql(`
    delete from public.quiz_attempts where id='${attemptId}'::uuid;
    delete from public.learner_concept_mastery
      where workspace_id='${workspaceId}'::uuid
        and learner_id='${learnerId}'::uuid
        and concept_id='${row.concept_id}'::uuid
        and metadata->>'engine'='learning-api-v2';
  `);
}
