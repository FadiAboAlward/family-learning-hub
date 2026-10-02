-- FLH-FEAT-2026-012 / SPEC_VERSION 1.1 / DRIVE_REVISION_ID 2.
-- Forward-only references, provider validation and explicit FLH self-report.
-- Disabled by default; no academic content, history, XP or reward changes.
grant usage on schema private to service_role;

create table public.learning_video_assignments (
  id uuid primary key default gen_random_uuid(),
  video_revision uuid not null default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  learner_id uuid not null,
  quiz_version_id uuid not null,
  program_id uuid not null,
  curriculum_id uuid not null references public.curricula(id) on delete restrict,
  grade_level smallint not null check (grade_level between 1 and 12),
  subject_id bigint not null references public.subjects(id) on delete restrict,
  concept_id uuid not null,
  provider text not null default 'youtube' check (provider = 'youtube'),
  video_ref text not null check (video_ref ~ '^[A-Za-z0-9_-]{11}$'),
  title text not null check (length(btrim(title)) between 1 and 200),
  language text not null check (language in ('ar','tr','en')),
  rationale text not null check (length(btrim(rationale)) between 1 and 1000),
  verification_state text not null check (verification_state in ('verified','unavailable','expired')),
  embeddable boolean,
  made_for_kids boolean,
  verified_at timestamptz,
  verification_expires_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id,workspace_id),
  unique (workspace_id,learner_id,quiz_version_id),
  foreign key (learner_id,workspace_id) references public.learners(id,workspace_id) on delete cascade,
  foreign key (quiz_version_id,workspace_id) references public.quiz_versions(id,workspace_id) on delete cascade,
  foreign key (program_id,workspace_id) references public.learning_programs(id,workspace_id) on delete cascade,
  foreign key (concept_id,workspace_id) references public.learning_concepts(id,workspace_id) on delete restrict,
  check (verification_state <> 'verified' or (embeddable is true and made_for_kids is not null and verified_at is not null and verification_expires_at > verified_at and verification_expires_at <= verified_at + interval '7 days'))
);
create index learning_video_assignments_program_idx on public.learning_video_assignments(program_id,workspace_id);
create index learning_video_assignments_concept_idx on public.learning_video_assignments(concept_id,workspace_id);
create index learning_video_assignments_curriculum_idx on public.learning_video_assignments(curriculum_id);
create index learning_video_assignments_subject_idx on public.learning_video_assignments(subject_id);
create index learning_video_assignments_reviewer_idx on public.learning_video_assignments(reviewed_by);

-- A Learning attempt pins its own reference, including after an attachment changes.
create table public.learning_video_attempts (
  attempt_id uuid primary key,
  video_id uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  learner_id uuid not null,
  quiz_version_id uuid not null,
  program_id uuid,
  curriculum_id uuid not null references public.curricula(id) on delete restrict,
  grade_level smallint not null check (grade_level between 1 and 12),
  subject_id bigint not null references public.subjects(id) on delete restrict,
  concept_id uuid,
  video_ref text not null check (video_ref ~ '^[A-Za-z0-9_-]{11}$'),
  title text not null check (length(btrim(title)) between 1 and 200),
  language text not null check (language in ('ar','tr','en')),
  verification_state text not null check (verification_state in ('verified','unavailable','expired')),
  embeddable boolean,
  made_for_kids boolean,
  verified_at timestamptz,
  verification_expires_at timestamptz,
  self_report text not null default 'not_reported' check (self_report in ('not_reported','not_watched','watched_part','watched_full')),
  report_revision integer not null default 0 check (report_revision >= 0),
  reported_at timestamptz,
  unique (attempt_id,workspace_id),
  foreign key (attempt_id,workspace_id) references public.quiz_attempts(id,workspace_id) on delete cascade,
  foreign key (learner_id,workspace_id) references public.learners(id,workspace_id) on delete cascade,
  foreign key (quiz_version_id,workspace_id) references public.quiz_versions(id,workspace_id) on delete restrict,
  foreign key (program_id,workspace_id) references public.learning_programs(id,workspace_id) on delete set null (program_id),
  foreign key (concept_id,workspace_id) references public.learning_concepts(id,workspace_id) on delete set null (concept_id)
);
create index learning_video_attempts_learner_idx on public.learning_video_attempts(learner_id,workspace_id);
create index learning_video_attempts_version_idx on public.learning_video_attempts(quiz_version_id,workspace_id);
create index learning_video_attempts_program_idx on public.learning_video_attempts(program_id,workspace_id);
create index learning_video_attempts_concept_idx on public.learning_video_attempts(concept_id,workspace_id);
create index learning_video_attempts_curriculum_idx on public.learning_video_attempts(curriculum_id);
create index learning_video_attempts_subject_idx on public.learning_video_attempts(subject_id);

-- Receipts contain only allowlisted FLH report values/revisions, never provider events.
create table public.learning_video_report_requests (
  workspace_id uuid not null,
  attempt_id uuid not null,
  request_id uuid not null,
  video_id uuid not null,
  self_report text not null check (self_report in ('not_reported','not_watched','watched_part','watched_full')),
  expected_revision integer not null check (expected_revision >= 0),
  result_revision integer not null check (result_revision > 0),
  created_at timestamptz not null default now(),
  primary key (attempt_id,request_id),
  foreign key (attempt_id,workspace_id) references public.learning_video_attempts(attempt_id,workspace_id) on delete cascade
);
do $security$
declare t text;
begin
  foreach t in array array['learning_video_assignments','learning_video_attempts','learning_video_report_requests'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end
$security$;

-- Match exact serving program and quiz concept; catalog names alone are insufficient.
create function private.flh_learning_video_context_matches(
 p_workspace_id uuid,p_learner_id uuid,p_version_id uuid,p_program_id uuid,
 p_curriculum_id uuid,p_grade smallint,p_subject_id bigint,p_concept_id uuid
) returns boolean language sql stable security invoker set search_path = '' as $$
 select exists (
  select 1 from public.learners l
  join public.learner_program_enrollments e on e.workspace_id=l.workspace_id and e.learner_id=l.id and e.status='active'
  join public.learning_programs p on p.id=e.program_id and p.workspace_id=e.workspace_id and p.status='active'
  join public.program_quizzes pq on pq.program_id=p.id and pq.workspace_id=p.workspace_id and pq.availability='available'
  join public.quizzes q on q.id=pq.quiz_id and q.workspace_id=pq.workspace_id and q.status='active'
  join public.quiz_versions v on v.quiz_id=q.id and v.workspace_id=q.workspace_id and v.state='published'
  join public.learning_concepts c on c.id=p_concept_id and c.workspace_id=l.workspace_id
  where l.workspace_id=p_workspace_id and l.id=p_learner_id and l.is_active
   and v.id=p_version_id and p.id=p_program_id
   and p.curriculum_id=p_curriculum_id and q.curriculum_id=p_curriculum_id and c.curriculum_id=p_curriculum_id
   and p.grade_level=p_grade and c.grade_level=p_grade
   and q.subject_id=p_subject_id and c.subject_id=p_subject_id
   and exists (select 1 from public.quiz_questions question join public.quiz_question_concepts qc on qc.question_id=question.id and qc.workspace_id=question.workspace_id
     where question.quiz_version_id=v.id and question.workspace_id=v.workspace_id and question.delivery_role='core' and qc.concept_id=c.id and qc.is_primary)
 );
$$;
revoke all on function private.flh_learning_video_context_matches(uuid,uuid,uuid,uuid,uuid,smallint,bigint,uuid) from public,anon,authenticated;
grant execute on function private.flh_learning_video_context_matches(uuid,uuid,uuid,uuid,uuid,smallint,bigint,uuid) to service_role;

create function public.flh_learning_video_attach(p_workspace_id uuid,p_parent_id uuid,p_candidate jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v public.learning_video_assignments%rowtype; c jsonb:=p_candidate;
begin
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=p_parent_id and role in ('owner','admin')) then return jsonb_build_object('error','VIDEO_ATTACHMENT_FORBIDDEN'); end if;
 if c->'embeddable' is distinct from 'true'::jsonb or jsonb_typeof(c->'made_for_kids') is distinct from 'boolean'
   or c->>'verified_at' is null or c->>'verification_expires_at' is null
   or (c->>'verified_at')::timestamptz < now()-interval '5 minutes'
   or (c->>'verified_at')::timestamptz > now()+interval '1 minute'
   or (c->>'verification_expires_at')::timestamptz > (c->>'verified_at')::timestamptz+interval '7 days'
   or not private.flh_learning_video_context_matches(p_workspace_id,(c->>'learner_id')::uuid,(c->>'quiz_version_id')::uuid,(c->>'program_id')::uuid,(c->>'curriculum_id')::uuid,(c->>'grade_level')::smallint,(c->>'subject_id')::bigint,(c->>'concept_id')::uuid)
 then return jsonb_build_object('error','VIDEO_CONTEXT_MISMATCH'); end if;
 insert into public.learning_video_assignments(workspace_id,learner_id,quiz_version_id,program_id,curriculum_id,grade_level,subject_id,concept_id,video_ref,title,language,rationale,verification_state,embeddable,made_for_kids,verified_at,verification_expires_at,reviewed_by)
 values(p_workspace_id,(c->>'learner_id')::uuid,(c->>'quiz_version_id')::uuid,(c->>'program_id')::uuid,(c->>'curriculum_id')::uuid,(c->>'grade_level')::smallint,(c->>'subject_id')::bigint,(c->>'concept_id')::uuid,c->>'video_ref',c->>'title',c->>'language',c->>'rationale','verified',true,(c->>'made_for_kids')::boolean,(c->>'verified_at')::timestamptz,(c->>'verification_expires_at')::timestamptz,p_parent_id)
 on conflict(workspace_id,learner_id,quiz_version_id) do update set
  video_revision=case when (learning_video_assignments.video_ref,learning_video_assignments.program_id,learning_video_assignments.curriculum_id,learning_video_assignments.grade_level,learning_video_assignments.subject_id,learning_video_assignments.concept_id) is distinct from (excluded.video_ref,excluded.program_id,excluded.curriculum_id,excluded.grade_level,excluded.subject_id,excluded.concept_id) then gen_random_uuid() else learning_video_assignments.video_revision end,
  program_id=excluded.program_id,curriculum_id=excluded.curriculum_id,grade_level=excluded.grade_level,subject_id=excluded.subject_id,concept_id=excluded.concept_id,
  video_ref=excluded.video_ref,title=excluded.title,language=excluded.language,rationale=excluded.rationale,verification_state='verified',embeddable=true,made_for_kids=excluded.made_for_kids,verified_at=excluded.verified_at,verification_expires_at=excluded.verification_expires_at,reviewed_by=p_parent_id,updated_at=now()
 returning * into v;
 -- Refresh policy status for pinned snapshots of the same provider reference only.
 update public.learning_video_attempts set verification_state='verified',embeddable=true,made_for_kids=v.made_for_kids,verified_at=v.verified_at,verification_expires_at=v.verification_expires_at
 where workspace_id=p_workspace_id and video_ref=v.video_ref;
 return jsonb_build_object('ok',true,'assignment_id',v.id,'video_id',v.video_revision,'verification_expires_at',v.verification_expires_at);
exception when invalid_text_representation or check_violation or not_null_violation then return jsonb_build_object('error','INVALID_VIDEO_INPUT');
end;
$$;
revoke all on function public.flh_learning_video_attach(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.flh_learning_video_attach(uuid,uuid,jsonb) to service_role;

create function private.flh_learning_optional_video(p_workspace_id uuid,p_learner_id uuid,p_attempt_id uuid,p_version_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare s public.learning_video_attempts%rowtype; a public.learning_video_assignments%rowtype; flags jsonb;
begin
 select value into flags from public.workspace_settings where workspace_id=p_workspace_id and key='optional_learning_videos';
 if flags->'enabled' is distinct from 'true'::jsonb then return null; end if;
 if flags->'test_only' = 'true'::jsonb and not exists(select 1 from public.learners where workspace_id=p_workspace_id and id=p_learner_id and metadata->'is_test'='true'::jsonb) then return null; end if;
 select * into s from public.learning_video_attempts where workspace_id=p_workspace_id and attempt_id=p_attempt_id and learner_id=p_learner_id and quiz_version_id=p_version_id;
 if not found then
  select * into a from public.learning_video_assignments where workspace_id=p_workspace_id and learner_id=p_learner_id and quiz_version_id=p_version_id;
  if not found then return null; end if;
  if not private.flh_learning_video_context_matches(p_workspace_id,p_learner_id,p_version_id,a.program_id,a.curriculum_id,a.grade_level,a.subject_id,a.concept_id) then return null; end if;
  insert into public.learning_video_attempts(attempt_id,video_id,workspace_id,learner_id,quiz_version_id,program_id,curriculum_id,grade_level,subject_id,concept_id,video_ref,title,language,verification_state,embeddable,made_for_kids,verified_at,verification_expires_at)
  values(p_attempt_id,a.video_revision,p_workspace_id,p_learner_id,p_version_id,a.program_id,a.curriculum_id,a.grade_level,a.subject_id,a.concept_id,a.video_ref,a.title,a.language,a.verification_state,a.embeddable,a.made_for_kids,a.verified_at,a.verification_expires_at)
  on conflict(attempt_id) do nothing;
  select * into s from public.learning_video_attempts where workspace_id=p_workspace_id and attempt_id=p_attempt_id and learner_id=p_learner_id and quiz_version_id=p_version_id;
 end if;
 if not private.flh_learning_video_context_matches(p_workspace_id,p_learner_id,p_version_id,s.program_id,s.curriculum_id,s.grade_level,s.subject_id,s.concept_id) then return null; end if;
 return jsonb_build_object('id',s.video_id,'provider','youtube','video_ref',s.video_ref,'title',s.title,'language',s.language,
  'availability',case when s.verification_state='verified' and s.embeddable is true and s.made_for_kids is not null and s.verification_expires_at>now() then 'available' else 'unavailable' end,
  'made_for_kids',s.made_for_kids,'verification_expires_at',s.verification_expires_at,'self_report',s.self_report,'report_revision',s.report_revision,
  'only_before_first_question',not exists(select 1 from public.quiz_answer_attempts where workspace_id=p_workspace_id and quiz_attempt_id=p_attempt_id));
end;
$$;
revoke all on function private.flh_learning_optional_video(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.flh_learning_optional_video(uuid,uuid,uuid,uuid) to service_role;

create function public.flh_learning_video_report(p_workspace_id uuid,p_learner_id uuid,p_attempt_id uuid,p_video_id uuid,p_self_report text,p_expected_revision integer,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare s public.learning_video_attempts%rowtype; receipt public.learning_video_report_requests%rowtype;
begin
 if p_request_id is null or p_expected_revision is null or p_expected_revision<0 or p_self_report is null or p_self_report not in ('not_reported','not_watched','watched_part','watched_full') then return jsonb_build_object('error','INVALID_VIDEO_INPUT'); end if;
 if not exists(select 1 from public.quiz_attempts a join public.learners l on l.id=a.learner_id and l.workspace_id=a.workspace_id where a.workspace_id=p_workspace_id and a.id=p_attempt_id and a.learner_id=p_learner_id and a.delivery_mode='learning' and a.status='in_progress' and l.is_active) then return jsonb_build_object('error','ATTEMPT_NOT_ACTIVE'); end if;
 select * into s from public.learning_video_attempts where workspace_id=p_workspace_id and attempt_id=p_attempt_id and learner_id=p_learner_id and video_id=p_video_id for update;
 if not found then return jsonb_build_object('error','VIDEO_NOT_AVAILABLE'); end if;
 select * into receipt from public.learning_video_report_requests where workspace_id=p_workspace_id and attempt_id=p_attempt_id and request_id=p_request_id;
 if found then
  if receipt.video_id<>p_video_id or receipt.self_report<>p_self_report or receipt.expected_revision<>p_expected_revision then return jsonb_build_object('error','VIDEO_REPORT_REQUEST_CONFLICT'); end if;
  return jsonb_build_object('ok',true,'duplicate',true,'self_report',s.self_report,'report_revision',s.report_revision);
 end if;
 if s.report_revision<>p_expected_revision then return jsonb_build_object('error','REPORT_CONFLICT','self_report',s.self_report,'report_revision',s.report_revision); end if;
 update public.learning_video_attempts set self_report=p_self_report,report_revision=report_revision+1,reported_at=now() where attempt_id=p_attempt_id returning * into s;
 insert into public.learning_video_report_requests(workspace_id,attempt_id,request_id,video_id,self_report,expected_revision,result_revision) values(p_workspace_id,p_attempt_id,p_request_id,p_video_id,p_self_report,p_expected_revision,s.report_revision);
 return jsonb_build_object('ok',true,'duplicate',false,'self_report',s.self_report,'report_revision',s.report_revision);
end;
$$;
revoke all on function public.flh_learning_video_report(uuid,uuid,uuid,uuid,text,integer,uuid) from public,anon,authenticated;
grant execute on function public.flh_learning_video_report(uuid,uuid,uuid,uuid,text,integer,uuid) to service_role;

create function public.flh_learning_video_refresh(p_workspace_id uuid,p_assignment_id uuid,p_video_revision uuid,p_status jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v public.learning_video_assignments%rowtype;
begin
 select * into v from public.learning_video_assignments where workspace_id=p_workspace_id and id=p_assignment_id and video_revision=p_video_revision for update;
 if not found then return jsonb_build_object('error','VIDEO_NOT_AVAILABLE'); end if;
 if p_status is null then
  update public.learning_video_assignments set verification_state='unavailable',embeddable=null,made_for_kids=null,verified_at=null,verification_expires_at=null where id=v.id;
  update public.learning_video_attempts set verification_state='unavailable',embeddable=null,made_for_kids=null,verified_at=null,verification_expires_at=null where workspace_id=p_workspace_id and video_ref=v.video_ref;
  return jsonb_build_object('ok',true,'availability','unavailable');
 end if;
 if p_status->'embeddable' is distinct from 'true'::jsonb or jsonb_typeof(p_status->'made_for_kids') is distinct from 'boolean'
  or p_status->>'verified_at' is null or p_status->>'verification_expires_at' is null
  or (p_status->>'verified_at')::timestamptz<now()-interval '5 minutes' or (p_status->>'verified_at')::timestamptz>now()+interval '1 minute'
  or (p_status->>'verification_expires_at')::timestamptz<=(p_status->>'verified_at')::timestamptz
  or (p_status->>'verification_expires_at')::timestamptz>(p_status->>'verified_at')::timestamptz+interval '7 days'
 then return jsonb_build_object('error','INVALID_VIDEO_INPUT'); end if;
 update public.learning_video_assignments set verification_state='verified',embeddable=true,made_for_kids=(p_status->>'made_for_kids')::boolean,verified_at=(p_status->>'verified_at')::timestamptz,verification_expires_at=(p_status->>'verification_expires_at')::timestamptz where id=v.id;
 update public.learning_video_attempts set verification_state='verified',embeddable=true,made_for_kids=(p_status->>'made_for_kids')::boolean,verified_at=(p_status->>'verified_at')::timestamptz,verification_expires_at=(p_status->>'verification_expires_at')::timestamptz where workspace_id=p_workspace_id and video_ref=v.video_ref;
 return jsonb_build_object('ok',true,'availability','available');
exception when invalid_text_representation then return jsonb_build_object('error','INVALID_VIDEO_INPUT');
end;
$$;
revoke all on function public.flh_learning_video_refresh(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.flh_learning_video_refresh(uuid,uuid,uuid,jsonb) to service_role;

-- Maintenance must run at least daily before activation; no provider data older than 30 days is retained.
create function public.flh_learning_video_prune_status(p_workspace_id uuid) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare a integer; b integer;
begin
 update public.learning_video_assignments set verification_state='expired',embeddable=null,made_for_kids=null,verified_at=null,verification_expires_at=null where workspace_id=p_workspace_id and verified_at<now()-interval '29 days'; get diagnostics a=row_count;
 update public.learning_video_attempts set verification_state='expired',embeddable=null,made_for_kids=null,verified_at=null,verification_expires_at=null where workspace_id=p_workspace_id and verified_at<now()-interval '29 days'; get diagnostics b=row_count;
 return jsonb_build_object('ok',true,'assignments_pruned',a,'attempts_pruned',b);
end;
$$;
revoke all on function public.flh_learning_video_prune_status(uuid) from public,anon,authenticated;
grant execute on function public.flh_learning_video_prune_status(uuid) to service_role;

insert into public.workspace_settings(workspace_id,key,value,description)
 select id,'optional_learning_videos','{"enabled":false,"test_only":true}'::jsonb,'Optional pre-Learning videos: remain disabled until provider, ads/navigation and restricted-device QA clears.' from public.workspaces
 on conflict(workspace_id,key) do nothing;
create or replace function public.flh_learning_start(
  p_workspace_id uuid,
  p_learner_id uuid,
  p_quiz_slug text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_quiz public.quizzes%rowtype;
  v_version public.quiz_versions%rowtype;
  v_attempt public.quiz_attempts%rowtype;
  v_assignment_id uuid;
  v_via_program boolean := false;
  v_via_assignment boolean := false;
  v_resumed boolean := false;
  v_queue jsonb := '[]'::jsonb;
  v_create_stage text := 'attempt';
  v_optional_video jsonb := null;
begin
  if p_workspace_id is null
     or p_learner_id is null
     or nullif(btrim(p_quiz_slug), '') is null then
    return jsonb_build_object('error', 'QUIZ_NOT_FOUND');
  end if;

  select q.*
  into v_quiz
  from public.quizzes q
  where q.workspace_id = p_workspace_id
    and q.slug = p_quiz_slug
    and q.status = 'active'
  limit 1;

  if not found then
    return jsonb_build_object('error', 'QUIZ_NOT_FOUND');
  end if;

  -- Resume routing is version-stable: an in-progress attempt keeps its
  -- original immutable quiz_version_id even after a successor is published.
  select qv.*
  into v_version
  from public.quiz_attempts a
  join public.quiz_versions qv
    on qv.workspace_id = a.workspace_id
   and qv.id = a.quiz_version_id
  where a.workspace_id = p_workspace_id
    and a.learner_id = p_learner_id
    and a.status = 'in_progress'
    and a.delivery_mode = 'learning'
    and qv.quiz_id = v_quiz.id
    and qv.state = 'published'
  order by a.started_at desc
  limit 1;

  if not found then
    -- Preserve an eligible explicit assignment's immutable version before
    -- choosing the newest published version for an unassigned program start.
    select qv.*
    into v_version
    from public.quiz_assignments qa
    join public.quiz_versions qv
      on qv.workspace_id = qa.workspace_id
     and qv.id = qa.quiz_version_id
    where qa.workspace_id = p_workspace_id
      and qa.learner_id = p_learner_id
      and qa.status in ('assigned', 'in_progress')
      and (qa.available_at is null or qa.available_at <= now())
      and (qa.due_at is null or qa.due_at >= now())
      and qv.quiz_id = v_quiz.id
      and qv.state = 'published'
    order by qa.created_at desc
    limit 1;

    if not found then
      select qv.*
      into v_version
      from public.quiz_versions qv
      where qv.workspace_id = p_workspace_id
        and qv.quiz_id = v_quiz.id
        and qv.state = 'published'
      order by qv.version_no desc
      limit 1;

      if not found then
        return jsonb_build_object('error', 'VERSION_NOT_FOUND');
      end if;
    end if;
  end if;

  -- The Edge session is authoritative, but the referenced learner must still
  -- be an active member of this workspace before any attempt can be resumed or
  -- created. Keep the public error indistinguishable from missing access.
  if not exists (
    select 1
    from public.learners l
    where l.id = p_learner_id
      and l.workspace_id = p_workspace_id
      and l.is_active
  ) then
    return jsonb_build_object('error', 'QUIZ_NOT_AVAILABLE');
  end if;

  select exists (
    select 1
    from public.learner_program_enrollments e
    join public.program_quizzes pq
      on pq.workspace_id = e.workspace_id
     and pq.program_id = e.program_id
     and pq.quiz_id = v_quiz.id
     and pq.availability = 'available'
    where e.workspace_id = p_workspace_id
      and e.learner_id = p_learner_id
      and e.status = 'active'
  ) into v_via_program;

  select qa.id
  into v_assignment_id
  from public.quiz_assignments qa
  where qa.workspace_id = p_workspace_id
    and qa.learner_id = p_learner_id
    and qa.quiz_version_id = v_version.id
    and qa.status in ('assigned', 'in_progress')
    and (qa.available_at is null or qa.available_at <= now())
    and (qa.due_at is null or qa.due_at >= now())
  order by qa.created_at desc
  limit 1;
  v_via_assignment := found;

  if not v_via_program and not v_via_assignment then
    return jsonb_build_object('error', 'QUIZ_NOT_AVAILABLE');
  end if;

  -- Serialize one learner/version start. The second simultaneous call sees the
  -- committed attempt and resumes it instead of creating a duplicate attempt
  -- or queue. This lock is released automatically at transaction end.
  perform pg_advisory_xact_lock(
    hashtextextended(
      p_workspace_id::text || ':' || p_learner_id::text || ':' || v_version.id::text || ':learning',
      0
    )
  );

  select a.*
  into v_attempt
  from public.quiz_attempts a
  where a.workspace_id = p_workspace_id
    and a.learner_id = p_learner_id
    and a.quiz_version_id = v_version.id
    and a.status = 'in_progress'
    and a.delivery_mode = 'learning'
  order by a.started_at desc
  limit 1
  for update;

  if found then
    v_resumed := true;
  else
    -- One exception block makes attempt and queue creation atomic. A queue
    -- failure rolls back the attempt insert before the error JSON is returned.
    begin
      insert into public.quiz_attempts(
        workspace_id,
        learner_id,
        quiz_version_id,
        assignment_id,
        status,
        delivery_mode,
        metadata
      ) values (
        p_workspace_id,
        p_learner_id,
        v_version.id,
        case when v_via_assignment then v_assignment_id else null end,
        'in_progress',
        'learning',
        jsonb_build_object(
          'engine', 'learning-api-v2',
          'quiz_slug', p_quiz_slug,
          'server_state', true
        )
      )
      returning * into v_attempt;

      v_create_stage := 'queue';
      insert into public.quiz_attempt_question_queue(
        workspace_id,
        quiz_attempt_id,
        sequence_no,
        question_id,
        source_role,
        concept_id,
        difficulty_level,
        status,
        selection_reason
      )
      select
        p_workspace_id,
        v_attempt.id,
        row_number() over (order by q.position)::integer,
        q.id,
        'core',
        qc.concept_id,
        q.difficulty_level,
        case when row_number() over (order by q.position) = 1 then 'active' else 'pending' end,
        'published_core_question'
      from public.quiz_questions q
      left join public.quiz_question_concepts qc
        on qc.workspace_id = q.workspace_id
       and qc.question_id = q.id
       and qc.is_primary
      where q.workspace_id = p_workspace_id
        and q.quiz_version_id = v_version.id
        and q.delivery_role = 'core'
      order by q.position;
    exception when others then
      raise warning 'flh_learning_start create failed at stage % (SQLSTATE %, message %)',
        v_create_stage,
        sqlstate,
        sqlerrm;
      if v_create_stage = 'attempt' then
        return jsonb_build_object('error', 'ATTEMPT_CREATE_FAILED');
      end if;
      return jsonb_build_object('error', 'QUEUE_CREATE_FAILED');
    end;
  end if;

  select coalesce(jsonb_agg(item order by sequence_no), '[]'::jsonb)
  into v_queue
  from (
    select
      qq.sequence_no,
      jsonb_build_object(
        'id', qq.id,
        'sequence_no', qq.sequence_no,
        'question_id', qq.question_id,
        'source_role', qq.source_role,
        'concept_id', qq.concept_id,
        'difficulty_level', qq.difficulty_level,
        'status', qq.status,
        'draft_option_position', qq.draft_option_position,
        'hint_level_requested', qq.hint_level_requested,
        'last_hint', case
          when coalesce(qq.hint_level_requested,0) > 0 then (
            select jsonb_build_object(
              'hint_level', h.hint_level,
              'pedagogical_role', h.pedagogical_role,
              'content', h.content,
              'language', h.language,
              'terminology_display_mode', h.terminology_display_mode
            )
            from public.quiz_question_hints h
            where h.workspace_id = p_workspace_id
              and h.question_id = qq.question_id
              and h.hint_level = qq.hint_level_requested
            limit 1
          )
          else null
        end,
        'is_flagged', qq.is_flagged,
        'question', jsonb_build_object(
          'id', q.id,
          'question_code', q.question_code,
          'position', q.position,
          'question_type', q.question_type,
          'prompt', q.prompt,
          'prompt_language', q.prompt_language,
          'origin', q.origin,
          'source_page_start', q.source_page_start,
          'source_page_end', q.source_page_end,
          'source_metadata', q.source_metadata,
          'points', q.points,
          'difficulty_level', q.difficulty_level,
          'max_attempts', q.max_attempts,
          'remediation_after_attempt', q.remediation_after_attempt,
          'delivery_role', q.delivery_role,
          'options', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', o.id,
                'position', o.position,
                'label', o.label,
                'content', o.content
              )
              order by o.position
            )
            from public.quiz_question_options o
            where o.workspace_id = p_workspace_id
              and o.question_id = q.id
          ), '[]'::jsonb),
          'assets', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'position', qa.position,
                'purpose', qa.purpose,
                'alt_text', qa.alt_text,
                'kind', asset.kind,
                'mime_type', asset.mime_type,
                'url', coalesce(
                  nullif(asset.metadata->>'public_url', ''),
                  nullif(asset.metadata->>'url', '')
                ),
                'storage_bucket', asset.storage_bucket,
                'storage_path', asset.storage_path
              )
              order by qa.position
            )
            from public.quiz_question_assets qa
            join public.assets asset
              on asset.id = qa.asset_id
             and asset.workspace_id = qa.workspace_id
            where qa.workspace_id = p_workspace_id
              and qa.question_id = q.id
          ), '[]'::jsonb)
        )
      ) as item
    from public.quiz_attempt_question_queue qq
    join public.quiz_questions q
      on q.id = qq.question_id
     and q.workspace_id = qq.workspace_id
    where qq.workspace_id = p_workspace_id
      and qq.quiz_attempt_id = v_attempt.id
  ) payload;

  begin
    v_optional_video := private.flh_learning_optional_video(p_workspace_id,p_learner_id,v_attempt.id,v_version.id);
  exception when others then
    v_optional_video := null; -- Optional failures never roll back an authorized start.
  end;

  return jsonb_build_object(
    'optional_video', v_optional_video,
    'attempt_id', v_attempt.id,
    'started_at', v_attempt.started_at,
    'resumed', v_resumed,
    'quiz', jsonb_build_object(
      'slug', v_quiz.slug,
      'title', v_quiz.title,
      'description', v_quiz.description
    ),
    'queue', v_queue
  );
end;
$function$;

revoke all on function public.flh_learning_start(uuid,uuid,text) from public;
revoke all on function public.flh_learning_start(uuid,uuid,text) from anon, authenticated;
grant execute on function public.flh_learning_start(uuid,uuid,text) to service_role;
