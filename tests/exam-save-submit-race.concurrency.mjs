import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const containerName = 'supabase_db_family-learning-hub';
const workspaceId = '55f9224c-8ba7-4cbc-9f88-713e6a6b41df';
const paperModelCode = 'MOH-TRMATH7-K1-TAM-PAPER-20260921-B';
const signalLock = 91300601;

async function psql(sql) {
  const { stdout } = await execFileAsync('docker', [
    'exec', containerName, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-c', sql,
  ], { maxBuffer: 4 * 1024 * 1024 });
  return stdout.trim();
}

function spawnPsql(sql) {
  const child = spawn('docker', [
    'exec', containerName, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-c', sql,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => code === 0
      ? resolve(stdout.trim())
      : reject(new Error(`psql exited ${code}: ${stderr}`)));
  });
  return { done };
}

function literal(value) {
  return "'" + String(value).replaceAll("'", "''") + "'";
}

const learnerId = await psql(
  `select id::text from public.learners where workspace_id='${workspaceId}'::uuid and slug='test' and is_active=true limit 1`,
);
const versionId = await psql(
  `select id::text from public.quiz_versions where workspace_id='${workspaceId}'::uuid and state='published' and settings->'paper_exam'->>'paper_model_code'=${literal(paperModelCode)} limit 1`,
);
assert.match(learnerId, /^[0-9a-f-]{36}$/i);
assert.match(versionId, /^[0-9a-f-]{36}$/i);

const assignmentBefore = await psql(`
  select coalesce((
    select to_jsonb(qa)
    from public.quiz_assignments qa
    where qa.workspace_id='${workspaceId}'::uuid
      and qa.learner_id='${learnerId}'::uuid
      and qa.quiz_version_id='${versionId}'::uuid
    order by qa.created_at desc
    limit 1
  ),'null'::jsonb)::text
`);
const assignmentSnapshot = JSON.parse(assignmentBefore);

const masteryBefore = await psql(`
  select coalesce(jsonb_agg(to_jsonb(m) order by m.concept_id),'[]'::jsonb)::text
  from public.learner_concept_mastery m
  where m.workspace_id='${workspaceId}'::uuid
    and m.learner_id='${learnerId}'::uuid
    and m.concept_id in (
      select distinct qc.concept_id
      from public.quiz_questions q
      join public.quiz_question_concepts qc
        on qc.workspace_id=q.workspace_id and qc.question_id=q.id
      where q.workspace_id='${workspaceId}'::uuid
        and q.quiz_version_id='${versionId}'::uuid
    )
`);

let attemptId = null;
let assignmentId = null;
let targetQuestionId = null;
let targetCorrectPosition = null;

async function cleanup() {
  await psql('drop trigger if exists aaa_qa_exam_submit_race_pause on public.quiz_attempt_answers; drop function if exists public.qa_exam_submit_race_pause();');

  if (attemptId) {
    await psql(`delete from public.quiz_attempts where workspace_id='${workspaceId}'::uuid and id='${attemptId}'::uuid`);
  }

  await psql(`
    delete from public.learner_concept_mastery m
    where m.workspace_id='${workspaceId}'::uuid
      and m.learner_id='${learnerId}'::uuid
      and m.concept_id in (
        select distinct qc.concept_id
        from public.quiz_questions q
        join public.quiz_question_concepts qc
          on qc.workspace_id=q.workspace_id and qc.question_id=q.id
        where q.workspace_id='${workspaceId}'::uuid
          and q.quiz_version_id='${versionId}'::uuid
      );
    insert into public.learner_concept_mastery(
      id,workspace_id,learner_id,concept_id,mastery_score,evidence_count,
      first_try_correct_count,total_question_count,total_hint_count,last_difficulty,
      last_assessed_at,metadata,created_at,updated_at
    )
    select
      x.id,x.workspace_id,x.learner_id,x.concept_id,x.mastery_score,x.evidence_count,
      x.first_try_correct_count,x.total_question_count,x.total_hint_count,x.last_difficulty,
      x.last_assessed_at,x.metadata,x.created_at,x.updated_at
    from jsonb_to_recordset(${literal(masteryBefore)}::jsonb) as x(
      id uuid, workspace_id uuid, learner_id uuid, concept_id uuid,
      mastery_score numeric, evidence_count integer, first_try_correct_count integer,
      total_question_count integer, total_hint_count integer, last_difficulty smallint,
      last_assessed_at timestamptz, metadata jsonb, created_at timestamptz, updated_at timestamptz
    );
  `);

  if (assignmentSnapshot) {
    await psql(`
      update public.quiz_assignments
      set status=${literal(assignmentSnapshot.status)},
          available_at=${assignmentSnapshot.available_at ? literal(assignmentSnapshot.available_at) + '::timestamptz' : 'null'},
          due_at=${assignmentSnapshot.due_at ? literal(assignmentSnapshot.due_at) + '::timestamptz' : 'null'},
          max_attempts=${assignmentSnapshot.max_attempts ?? 'null'},
          assigned_by=${assignmentSnapshot.assigned_by ? literal(assignmentSnapshot.assigned_by) + '::uuid' : 'null'},
          learner_program_enrollment_id=${assignmentSnapshot.learner_program_enrollment_id ? literal(assignmentSnapshot.learner_program_enrollment_id) + '::uuid' : 'null'},
          metadata=${literal(JSON.stringify(assignmentSnapshot.metadata ?? {}))}::jsonb
      where id=${literal(assignmentSnapshot.id)}::uuid;
    `);
  } else if (assignmentId) {
    await psql(`delete from public.quiz_assignments where id='${assignmentId}'::uuid`);
  }
}

try {
  const startOutput = await psql(`
    set role service_role;
    select public.flh_paper_exam_start(
      '${workspaceId}'::uuid,
      '${learnerId}'::uuid,
      '${versionId}'::uuid,
      ${literal(paperModelCode)},
      'qa_save_submit_race'
    )::text;
    reset role;
  `);
  const started = JSON.parse(startOutput);
  assert.equal(started.ok, true, 'paper race fixture must start successfully');
  attemptId = started.attempt_id;

  assignmentId = await psql(
    `select assignment_id::text from public.quiz_attempts where workspace_id='${workspaceId}'::uuid and id='${attemptId}'::uuid`,
  );

  // Fill every queued question with its correct selected option so generic submit is complete.
  await psql(`
    do $setup$
    declare
      r record;
      v_saved jsonb;
    begin
      for r in
        select qq.question_id,(k.correct_answer->>'option_position')::integer as correct_position
        from public.quiz_attempt_question_queue qq
        join public.quiz_question_answer_keys k
          on k.workspace_id=qq.workspace_id and k.question_id=qq.question_id
        where qq.workspace_id='${workspaceId}'::uuid
          and qq.quiz_attempt_id='${attemptId}'::uuid
        order by qq.sequence_no
      loop
        v_saved := public.flh_exam_save_answer(
          '${workspaceId}'::uuid,
          '${learnerId}'::uuid,
          '${attemptId}'::uuid,
          r.question_id,
          r.correct_position
        );
        if coalesce((v_saved->>'ok')::boolean,false) is not true then
          raise exception 'RACE_SETUP_SAVE_FAILED';
        end if;
      end loop;
    end;
    $setup$;
  `);

  const target = JSON.parse(await psql(`
    select jsonb_build_object(
      'question_id',qq.question_id,
      'correct_position',(k.correct_answer->>'option_position')::integer
    )::text
    from public.quiz_attempt_question_queue qq
    join public.quiz_question_answer_keys k
      on k.workspace_id=qq.workspace_id and k.question_id=qq.question_id
    where qq.workspace_id='${workspaceId}'::uuid
      and qq.quiz_attempt_id='${attemptId}'::uuid
      and qq.sequence_no=1
  `));
  targetQuestionId = target.question_id;
  targetCorrectPosition = target.correct_position;

  // Test-only pause: while submit owns both the attempt lock and the target answer
  // row being graded, expose an advisory-lock signal and hold the transaction open.
  await psql(`
    create or replace function public.qa_exam_submit_race_pause()
    returns trigger
    language plpgsql
    set search_path to 'public'
    as $fn$
    begin
      if new.attempt_id='${attemptId}'::uuid
         and new.question_id='${targetQuestionId}'::uuid
         and old.evaluation='ungraded'
         and new.evaluation in ('correct','incorrect') then
        perform pg_advisory_xact_lock(${signalLock});
        perform pg_sleep(8);
      end if;
      return new;
    end;
    $fn$;

    create trigger aaa_qa_exam_submit_race_pause
    before update of evaluation,is_correct,points_awarded on public.quiz_attempt_answers
    for each row execute function public.qa_exam_submit_race_pause();
  `);

  const submit = spawnPsql(`
    set role service_role;
    select public.flh_exam_submit(
      '${workspaceId}'::uuid,
      '${learnerId}'::uuid,
      '${attemptId}'::uuid
    )::text;
    reset role;
  `);

  const signalDeadline = Date.now() + 6000;
  let submitInGrading = false;
  while (!submitInGrading && Date.now() < signalDeadline) {
    submitInGrading = await psql(
      `select count(*)::text from pg_locks where locktype='advisory' and objid=${signalLock} and granted`,
    ) === '1';
    if (submitInGrading) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(submitInGrading, true, 'submit must reach the target grading update before the racing save starts');

  const save = spawnPsql(`
    set role service_role;
    select public.flh_exam_save_answer(
      '${workspaceId}'::uuid,
      '${learnerId}'::uuid,
      '${attemptId}'::uuid,
      '${targetQuestionId}'::uuid,
      ${targetCorrectPosition}
    )::text;
    reset role;
  `);

  const waiterDeadline = Date.now() + 5000;
  let saveWaiters = 0;
  while (saveWaiters < 1 && Date.now() < waiterDeadline) {
    saveWaiters = Number(await psql(`
      select count(*)::text
      from pg_stat_activity
      where wait_event_type='Lock'
        and query like '%flh_exam_save_answer%'
        and query like '%${attemptId}%'
    `));
    if (saveWaiters >= 1) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(saveWaiters, 1, 'the racing save must wait behind submit on the serialized attempt row');

  const [submitOutput, saveOutput] = await Promise.all([submit.done, save.done]);
  const submitted = JSON.parse(submitOutput);
  const saved = JSON.parse(saveOutput);

  assert.equal(submitted.ok, true, 'submit must complete successfully');
  assert.equal(saved.error, 'ATTEMPT_OR_QUESTION_NOT_ACTIVE', 'save must re-check status after submit commits');

  const finalState = JSON.parse(await psql(`
    select jsonb_build_object(
      'attempt_status',a.status,
      'score_points',a.score_points,
      'max_points',a.max_points,
      'evaluation',aa.evaluation,
      'is_correct',aa.is_correct,
      'response',aa.response,
      'attempts_used',aa.attempts_used
    )::text
    from public.quiz_attempts a
    join public.quiz_attempt_answers aa
      on aa.workspace_id=a.workspace_id
     and aa.attempt_id=a.id
     and aa.question_id='${targetQuestionId}'::uuid
    where a.workspace_id='${workspaceId}'::uuid
      and a.id='${attemptId}'::uuid
  `));

  assert.equal(finalState.attempt_status, 'submitted');
  assert.equal(Number(finalState.score_points), 20);
  assert.equal(Number(finalState.max_points), 20);
  assert.equal(finalState.evaluation, 'correct');
  assert.equal(finalState.is_correct, true);
  assert.deepEqual(finalState.response, { option_position: targetCorrectPosition });
  assert.equal(finalState.attempts_used, 1);

  console.log('Exam answer save/submit race regression passed: post-submit save cannot reset graded state.');
} finally {
  await cleanup();
}
