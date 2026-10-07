import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const containerName = 'supabase_db_family-learning-hub';
const workspaceId = '55f9224c-8ba7-4cbc-9f88-713e6a6b41df';
const slug = 'tr-g5-meb-support-s3-models';
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

const learnerId = await psql(`select id::text from public.learners where workspace_id='${workspaceId}'::uuid and slug='test' and is_active and coalesce((metadata->>'is_test')::boolean,false)`);
assert.match(learnerId,/^[0-9a-f-]{36}$/,'only the dedicated Testing learner may be used');

const versionId = await psql(`
  select qv.id::text
  from public.quizzes q
  join public.quiz_versions qv on qv.workspace_id=q.workspace_id and qv.quiz_id=q.id and qv.state='published'
  where q.workspace_id='${workspaceId}'::uuid and q.slug='${slug}'
    and coalesce((q.delivery_config->>'support_session')::boolean,false)
    and coalesce((qv.settings->>'support_source')::boolean,false)
  order by qv.version_no desc limit 1
`);
assert.match(versionId,/^[0-9a-f-]{36}$/);

const modelCode = await psql(`select settings->'paper_exam'->>'paper_model_code' from public.quiz_versions where id='${versionId}'::uuid`);
assert.ok(modelCode.length>0);

const activeBefore = Number(await psql(`select count(*) from public.quiz_attempts where workspace_id='${workspaceId}' and learner_id='${learnerId}' and quiz_version_id='${versionId}' and status in ('in_progress','submitted')`));
assert.equal(activeBefore,0,'concurrency fixture requires no active/submitted attempt');

const sharedLock = `hashtextextended('${workspaceId}:${learnerId}:${versionId}:support-delivery',0)`;
const children=[];
try {
  const blocker = spawnPsql(`begin; select pg_advisory_xact_lock(${sharedLock}); select pg_advisory_xact_lock(91602011); select pg_sleep(8); commit;`);
  children.push(blocker);

  const deadline=Date.now()+5000;
  let ready=false;
  while(!ready&&Date.now()<deadline){
    ready=await psql("select count(*)::text from pg_locks where locktype='advisory' and classid=0 and objid=91602011 and objsubid=1 and granted")==='1';
    if(!ready) await new Promise(r=>setTimeout(r,25));
  }
  assert.equal(ready,true,'shared support-delivery blocker must acquire the lock first');

  const learningSql=`set role service_role; select public.flh_learning_start('${workspaceId}'::uuid,'${learnerId}'::uuid,'${slug}')::text; reset role;`;
  const paperSql=`set role service_role; select public.flh_paper_exam_start('${workspaceId}'::uuid,'${learnerId}'::uuid,'${versionId}'::uuid,'${modelCode.replaceAll("'","''")}','qa_mutual_exclusion_concurrency')::text; reset role;`;
  const learning=spawnPsql(learningSql);
  const paper=spawnPsql(paperSql);
  children.push(learning,paper);

  let waiters=0;
  const waiterDeadline=Date.now()+5000;
  while(waiters<2&&Date.now()<waiterDeadline){
    waiters=Number(await psql(`
      select count(*)::text
      from pg_stat_activity
      where wait_event_type='Lock' and wait_event='advisory'
        and query like '%${learnerId}%'
        and (query like '%flh_learning_start%' or query like '%flh_paper_exam_start%')
    `));
    if(waiters<2) await new Promise(r=>setTimeout(r,25));
  }
  assert.equal(waiters,2,'paper and Learning starts must wait on the same learner/version advisory lock');

  const [,learningOut,paperOut] = await Promise.all([blocker.done,learning.done,paper.done]);
  const learningResult=JSON.parse(learningOut);
  const paperResult=JSON.parse(paperOut);

  const learningWon = !learningResult.error && typeof learningResult.attempt_id==='string';
  const paperWon = paperResult.ok===true;
  assert.notEqual(learningWon,paperWon,'exactly one delivery surface may create/resume an active attempt');
  if(learningWon) assert.equal(paperResult.error,'SESSION_IN_PROGRESS');
  if(paperWon) assert.equal(learningResult.error,'QUIZ_NOT_AVAILABLE');

  const activeRows=JSON.parse(await psql(`
    select coalesce(json_agg(json_build_object('id',id,'delivery_mode',delivery_mode,'status',status)),'[]'::json)::text
    from public.quiz_attempts
    where workspace_id='${workspaceId}' and learner_id='${learnerId}' and quiz_version_id='${versionId}' and status='in_progress'
  `));
  assert.equal(activeRows.length,1,'concurrent starts must leave exactly one active attempt');
  assert.equal(activeRows[0].delivery_mode,learningWon?'learning':'exam');

  console.log('Support paper/digital Learning shared-lock concurrency test passed.');
} finally {
  await Promise.allSettled(children.map(child=>child.done));
  await psql(`
    delete from public.quiz_attempts
    where workspace_id='${workspaceId}' and learner_id='${learnerId}' and quiz_version_id='${versionId}'
      and status in ('in_progress','abandoned')
      and (delivery_mode='learning' or metadata->>'paper_source'='qa_mutual_exclusion_concurrency');
    delete from public.quiz_assignments
    where workspace_id='${workspaceId}' and learner_id='${learnerId}' and quiz_version_id='${versionId}'
      and metadata->>'source'='support_workbook_paper';
  `);
}
