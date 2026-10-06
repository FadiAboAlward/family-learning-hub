import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync=promisify(execFile);
const containerName='supabase_db_family-learning-hub';
const workspaceId='55f9224c-8ba7-4cbc-9f88-713e6a6b41df';
const quizId='97000000-0000-4000-8000-000000000001';
const versionId='97000000-0000-4000-8000-000000000002';
const questionId='97000000-0000-4000-8000-000000000003';
const attemptA='97000000-0000-4000-8000-000000000011';
const attemptB='97000000-0000-4000-8000-000000000012';
const slug='qa-exam-reward-concurrency-v12';

async function psql(sql){
  const{stdout}=await execFileAsync('docker',[
    'exec',containerName,'psql','-X','-q','-v','ON_ERROR_STOP=1',
    '-U','postgres','-d','postgres','-t','-A','-c',sql
  ],{maxBuffer:4*1024*1024});
  return stdout.trim();
}

function spawnPsql(sql){
  const child=spawn('docker',[
    'exec',containerName,'psql','-X','-q','-v','ON_ERROR_STOP=1',
    '-U','postgres','-d','postgres','-t','-A','-c',sql
  ],{stdio:['ignore','pipe','pipe']});
  let stdout='';let stderr='';
  child.stdout.on('data',chunk=>{stdout+=chunk;});
  child.stderr.on('data',chunk=>{stderr+=chunk;});
  const done=new Promise((resolve,reject)=>{
    child.on('error',reject);
    child.on('close',code=>code===0?resolve(stdout.trim()):reject(new Error(`psql exited ${code}: ${stderr}`)));
  });
  return{done};
}

const learnerId=await psql(
  `select id::text from public.learners where workspace_id='${workspaceId}'::uuid and slug='test' and is_active=true and coalesce((metadata->>'is_test')::boolean,false) limit 1`
);
assert.match(learnerId,/^[0-9a-f-]{36}$/i);

const stateBefore=await psql(`
  select coalesce((select to_jsonb(s) from public.learner_gamification_state s
    where s.workspace_id='${workspaceId}'::uuid and s.learner_id='${learnerId}'::uuid),'null'::jsonb)::text
`);
const stateSnapshot=JSON.parse(stateBefore);

let subjectId=null;

async function cleanup(){
  await psql(`
    delete from public.gamification_events
    where workspace_id='${workspaceId}'::uuid and learner_id='${learnerId}'::uuid
      and source_type='exam' and source_id='${quizId}';
    delete from public.quiz_attempts
    where workspace_id='${workspaceId}'::uuid and id in ('${attemptA}'::uuid,'${attemptB}'::uuid);
    delete from public.quizzes where workspace_id='${workspaceId}'::uuid and id='${quizId}'::uuid;
    ${subjectId?`delete from public.subjects where id=${subjectId};`:''}
  `);
  if(stateSnapshot){
    await psql(`
      insert into public.learner_gamification_state(
        id,workspace_id,learner_id,xp,reward_points,current_level,current_streak,longest_streak,last_learning_date,metadata,created_at,updated_at
      ) values(
        '${stateSnapshot.id}'::uuid,'${stateSnapshot.workspace_id}'::uuid,'${stateSnapshot.learner_id}'::uuid,
        ${stateSnapshot.xp},${stateSnapshot.reward_points},${stateSnapshot.current_level},
        ${stateSnapshot.current_streak},${stateSnapshot.longest_streak},
        ${stateSnapshot.last_learning_date?`'${stateSnapshot.last_learning_date}'::date`:'null'},
        '${JSON.stringify(stateSnapshot.metadata??{}).replaceAll("'","''")}'::jsonb,
        '${stateSnapshot.created_at}'::timestamptz,'${stateSnapshot.updated_at}'::timestamptz
      )
      on conflict(learner_id) do update set
        xp=excluded.xp,reward_points=excluded.reward_points,current_level=excluded.current_level,
        current_streak=excluded.current_streak,longest_streak=excluded.longest_streak,
        last_learning_date=excluded.last_learning_date,metadata=excluded.metadata,
        created_at=excluded.created_at,updated_at=excluded.updated_at;
    `);
  }else{
    await psql(`delete from public.learner_gamification_state where workspace_id='${workspaceId}'::uuid and learner_id='${learnerId}'::uuid`);
  }
}

try{
  subjectId=Number(await psql(`
    insert into public.subjects(code,name_ar,name_en)
    values('QA-EXAM-REWARD-CONCURRENCY-V12','تزامن مكافآت الامتحان','Exam reward concurrency QA')
    returning id
  `));

  await psql(`
    insert into public.quizzes(id,workspace_id,subject_id,slug,title,status)
    values('${quizId}'::uuid,'${workspaceId}'::uuid,${subjectId},'${slug}','Exam reward concurrency QA','active');

    insert into public.quiz_versions(id,workspace_id,quiz_id,version_no,state)
    values('${versionId}'::uuid,'${workspaceId}'::uuid,'${quizId}'::uuid,1,'published');

    insert into public.quiz_questions(
      id,workspace_id,quiz_version_id,position,question_type,prompt,points,
      difficulty_level,max_attempts,remediation_after_attempt,delivery_role,question_code,prompt_language
    ) values(
      '${questionId}'::uuid,'${workspaceId}'::uuid,'${versionId}'::uuid,1,'single_choice','concurrent reward',100,
      2,1,1,'core','Q-97000001','en'
    );

    insert into public.quiz_question_options(workspace_id,question_id,position,content) values
      ('${workspaceId}'::uuid,'${questionId}'::uuid,1,'correct'),
      ('${workspaceId}'::uuid,'${questionId}'::uuid,2,'wrong');

    insert into public.quiz_question_answer_keys(
      question_id,workspace_id,correct_answer,explanation,correct_explanation,final_incorrect_explanation,grading_config
    ) values(
      '${questionId}'::uuid,'${workspaceId}'::uuid,'{"option_position":1}'::jsonb,'base','correct','incorrect','{}'::jsonb
    );

    insert into public.quiz_attempts(
      id,workspace_id,learner_id,quiz_version_id,status,delivery_mode,started_at,metadata
    ) values
      ('${attemptA}'::uuid,'${workspaceId}'::uuid,'${learnerId}'::uuid,'${versionId}'::uuid,'in_progress','exam',clock_timestamp()-interval '1 minute','{"qa":"exam-reward-concurrency-a"}'),
      ('${attemptB}'::uuid,'${workspaceId}'::uuid,'${learnerId}'::uuid,'${versionId}'::uuid,'in_progress','exam',clock_timestamp()-interval '1 minute','{"qa":"exam-reward-concurrency-b"}');

    insert into public.quiz_attempt_question_queue(
      workspace_id,quiz_attempt_id,sequence_no,question_id,difficulty_level,status,source_role
    ) values
      ('${workspaceId}'::uuid,'${attemptA}'::uuid,1,'${questionId}'::uuid,2,'active','core'),
      ('${workspaceId}'::uuid,'${attemptB}'::uuid,1,'${questionId}'::uuid,2,'active','core');

    insert into public.quiz_attempt_answers(
      workspace_id,attempt_id,question_id,response,evaluation,is_correct,points_awarded,
      attempts_used,hints_used,first_try_correct,mastery_result,quiz_version_id
    ) values
      ('${workspaceId}'::uuid,'${attemptA}'::uuid,'${questionId}'::uuid,'{"option_position":1}'::jsonb,'ungraded',null,null,1,0,null,null,'${versionId}'::uuid),
      ('${workspaceId}'::uuid,'${attemptB}'::uuid,'${questionId}'::uuid,'{"option_position":1}'::jsonb,'ungraded',null,null,1,0,null,null,'${versionId}'::uuid);
  `);

  const baseline=JSON.parse(await psql(`
    select jsonb_build_object('xp',coalesce(s.xp,0),'reward_points',coalesce(s.reward_points,0))::text
    from public.learners l
    left join public.learner_gamification_state s
      on s.workspace_id=l.workspace_id and s.learner_id=l.id
    where l.workspace_id='${workspaceId}'::uuid and l.id='${learnerId}'::uuid
  `));

  const submitSql=attempt=>`
    set role service_role;
    select public.flh_exam_submit('${workspaceId}'::uuid,'${learnerId}'::uuid,'${attempt}'::uuid)::text;
    reset role;
  `;
  const a=spawnPsql(submitSql(attemptA));
  const b=spawnPsql(submitSql(attemptB));
  const [rawA,rawB]=await Promise.all([a.done,b.done]);
  const resultA=JSON.parse(rawA);
  const resultB=JSON.parse(rawB);
  assert.equal(resultA.ok,true);
  assert.equal(resultB.ok,true);
  assert.equal(Number(resultA.percentage),100);
  assert.equal(Number(resultB.percentage),100);

  const awarded=[
    [Number(resultA.award.xp),Number(resultA.award.reward_points)],
    [Number(resultB.award.xp),Number(resultB.award.reward_points)]
  ];
  awarded.sort((x,y)=>y[0]-x[0]);
  assert.deepEqual(awarded,[[75,15],[0,0]],'concurrent 100% attempts must award the quiz cap exactly once');

  const ledger=JSON.parse(await psql(`
    select jsonb_build_object(
      'count',count(*),
      'xp',coalesce(sum(xp_delta),0),
      'reward_points',coalesce(sum(reward_points_delta),0)
    )::text
    from public.gamification_events
    where workspace_id='${workspaceId}'::uuid and learner_id='${learnerId}'::uuid
      and event_type='quiz_completed' and source_type='exam' and source_id='${quizId}'
  `));
  assert.equal(Number(ledger.count),1);
  assert.equal(Number(ledger.xp),75);
  assert.equal(Number(ledger.reward_points),15);

  const state=JSON.parse(await psql(`
    select jsonb_build_object('xp',xp,'reward_points',reward_points)::text
    from public.learner_gamification_state
    where workspace_id='${workspaceId}'::uuid and learner_id='${learnerId}'::uuid
  `));
  assert.equal(Number(state.xp),Number(baseline.xp)+75);
  assert.equal(Number(state.reward_points),Number(baseline.reward_points)+15);

  console.log('Exam mastery reward concurrency passed: learner lock prevents double-award across simultaneous retakes.');
}finally{
  await cleanup();
}
