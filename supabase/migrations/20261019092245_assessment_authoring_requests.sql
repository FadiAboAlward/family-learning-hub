-- FLH-FEAT-2026-033 v1.0 / Drive revision 1. Prospective integration requests only.
-- No historical adoption, RLS changes, learner writes or publication-gate replacement.
-- Do not add erasure blockers to fresh drafts; existing publication guards still apply.
create table private.assessment_authoring_requests (
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 request_id uuid not null,
 created_by uuid not null references auth.users(id) on delete cascade,
 quiz_id uuid not null,
 quiz_version_id uuid not null,
 learner_id uuid not null,
 program_id uuid not null,
 candidate_sha256 text not null check(candidate_sha256 ~ '^[a-f0-9]{64}$'),
 request_fingerprint text not null,
 quiz_definition jsonb not null,
 created_at timestamptz not null default now(),
 primary key(workspace_id,request_id),
 unique(workspace_id,quiz_id), unique(workspace_id,quiz_version_id),
 unique(workspace_id,learner_id,program_id,candidate_sha256),
 foreign key(quiz_id,workspace_id) references public.quizzes(id,workspace_id) on delete cascade,
 foreign key(quiz_version_id,workspace_id) references public.quiz_versions(id,workspace_id) on delete cascade,
 foreign key(learner_id,workspace_id) references public.learners(id,workspace_id) on delete cascade,
 foreign key(program_id,workspace_id) references public.learning_programs(id,workspace_id) on delete cascade
);
alter table private.assessment_authoring_requests enable row level security;
revoke all on private.assessment_authoring_requests from public,anon,authenticated;
grant select,insert on private.assessment_authoring_requests to service_role;

create function public.flh_assessment_authoring_command(p_workspace_id uuid,p_parent_id uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
#variable_conflict use_column
declare
 r private.assessment_authoring_requests%rowtype;
 q public.quizzes%rowtype; v public.quiz_versions%rowtype;
 a public.assessment_publications%rowtype;
 t jsonb:=p_payload->'target'; m jsonb:=p_payload->'quiz'; review jsonb:=p_payload->'semantic_review';
 request_uuid uuid:=(p_payload->>'request_id')::uuid;
 fingerprint text; duplicate boolean:=false; status text;
begin
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=p_parent_id and role in ('owner','admin'))
 then raise exception 'ASSESSMENT_FORBIDDEN'; end if;
 if request_uuid is null or p_action not in ('create','read') or p_action is null then raise exception 'ASSESSMENT_AUTHORING_INPUT_INVALID'; end if;
 -- Serialize identical requests before checking or inserting; no exception-driven partial writes.
 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':assessment-authoring:'||request_uuid::text,0));
 select * into r from private.assessment_authoring_requests where workspace_id=p_workspace_id and request_id=request_uuid;
 if p_action='create' then
  if jsonb_typeof(t) is distinct from 'object' or jsonb_typeof(m) is distinct from 'object'
   or p_payload->>'candidate_sha256' is null or (p_payload->>'candidate_sha256' ~ '^[a-f0-9]{64}$') is not true
   or p_payload->'validation'->'ok' is distinct from 'true'::jsonb
   or jsonb_typeof(p_payload->'candidate'->'questions') is distinct from 'array'
   or review->>'result' is distinct from 'PASS' or review->>'reviewed_by' is distinct from p_parent_id::text
   or review->>'candidate_sha256' is distinct from p_payload->>'candidate_sha256'
   or review->>'workspace_id' is distinct from p_workspace_id::text
   or exists(select 1 from unnest(array['quiz_id','quiz_version_id','learner_id','program_id']) k where nullif(t->>k,'') is null or review->>k is distinct from t->>k)
   or exists(select 1 from unnest(array['reviewer_ref','source_review_ref','learner_scope_review_ref','authority_ref','reviewed_at']) k where nullif(btrim(review->>k),'') is null)
   or jsonb_typeof(review->'warning_dispositions') is distinct from 'array'
   or jsonb_typeof(p_payload->'validation'->'warnings') is distinct from 'array'
   or (m->>'slug' ~ '^[a-z0-9]+(-[a-z0-9]+)*$') is not true or length(m->>'slug')>160
   or nullif(btrim(m->>'title'),'') is null or length(m->>'title')>300
  then raise exception 'ASSESSMENT_AUTHORING_INPUT_INVALID'; end if;
  if jsonb_array_length(p_payload->'candidate'->'questions')<>40 or (review->>'reviewed_at')::timestamptz>now()+interval '1 minute'
   or exists(select 1 from jsonb_array_elements(p_payload->'validation'->'warnings') w where not exists(
    select 1 from jsonb_array_elements(review->'warning_dispositions') d where d->>'code'=w->>'code' and d->>'path'=w->>'path' and d->>'result'='ACCEPTED' and nullif(btrim(d->>'reason'),'') is not null))
  then raise exception 'ASSESSMENT_ACADEMIC_REJECTED'; end if;
  fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object('target',t,'quiz',m,'hash',p_payload->>'candidate_sha256')::text,'UTF8'),'sha256'),'hex');
  if r.request_id is not null then
   if r.created_by<>p_parent_id or r.request_fingerprint<>fingerprint then raise exception 'ASSESSMENT_RETRY_CONFLICT'; end if;
   duplicate:=true;
  else
   if not exists(select 1 from public.learning_programs p join public.learner_program_enrollments e on e.workspace_id=p.workspace_id and e.program_id=p.id
     join public.learners l on l.workspace_id=e.workspace_id and l.id=e.learner_id
     where p.workspace_id=p_workspace_id and p.id=(t->>'program_id')::uuid and p.status='active' and e.status='active' and l.is_active
      and l.id=(t->>'learner_id')::uuid and p.curriculum_id=(m->>'curriculum_id')::uuid
      and p.grade_level=(p_payload->'candidate'->'academic_context'->>'grade')::smallint)
    or not exists(select 1 from public.subjects where id=(m->>'subject_id')::bigint)
   then raise exception 'ASSESSMENT_CONTEXT_MISMATCH'; end if;
   -- Reject any existing quiz/version. No adoption, upsert or mutation of previous packages.
   insert into public.quizzes(id,workspace_id,subject_id,curriculum_id,slug,title,status,created_by,delivery_config)
   values((t->>'quiz_id')::uuid,p_workspace_id,(m->>'subject_id')::bigint,(m->>'curriculum_id')::uuid,m->>'slug',m->>'title','draft',p_parent_id,
    '{"learning":{"instant_feedback":true,"hints":true,"retry":true},"exam":{"question_count":20,"instant_feedback":false,"hints":false,"retry":false,"show_results_after_submit":true}}');
   insert into public.quiz_versions(id,workspace_id,quiz_id,version_no,state,created_by)
   values((t->>'quiz_version_id')::uuid,p_workspace_id,(t->>'quiz_id')::uuid,1,'draft',p_parent_id);
   insert into public.program_quizzes(workspace_id,program_id,quiz_id,availability)
   values(p_workspace_id,(t->>'program_id')::uuid,(t->>'quiz_id')::uuid,'available');
   insert into private.assessment_authoring_requests(workspace_id,request_id,created_by,quiz_id,quiz_version_id,learner_id,program_id,candidate_sha256,request_fingerprint,quiz_definition)
   values(p_workspace_id,request_uuid,p_parent_id,(t->>'quiz_id')::uuid,(t->>'quiz_version_id')::uuid,(t->>'learner_id')::uuid,(t->>'program_id')::uuid,p_payload->>'candidate_sha256',fingerprint,m)
   returning * into r;
  end if;
 end if;
 if r.request_id is null or r.created_by<>p_parent_id then raise exception 'ASSESSMENT_TARGET_INVALID'; end if;
 select * into q from public.quizzes where workspace_id=p_workspace_id and id=r.quiz_id;
 select * into v from public.quiz_versions where workspace_id=p_workspace_id and id=r.quiz_version_id and quiz_id=r.quiz_id;
 if q.id is null or v.id is null then raise exception 'ASSESSMENT_TARGET_INVALID'; end if;
 if q.created_by is distinct from r.created_by or v.created_by is distinct from r.created_by or v.version_no<>1
  or q.slug is distinct from r.quiz_definition->>'slug' or q.title is distinct from r.quiz_definition->>'title'
  or q.subject_id is distinct from (r.quiz_definition->>'subject_id')::bigint or q.curriculum_id is distinct from (r.quiz_definition->>'curriculum_id')::uuid
 then raise exception 'ASSESSMENT_CONTENT_DRIFT'; end if;
 select * into a from public.assessment_publications where workspace_id=p_workspace_id and quiz_version_id=r.quiz_version_id;
 if a.quiz_version_id is not null then
  if a.candidate_sha256<>r.candidate_sha256 or a.learner_id<>r.learner_id or a.program_id<>r.program_id
  then raise exception 'ASSESSMENT_CONTENT_DRIFT'; end if;
  -- Reuse existing graph integrity verification; never return answer keys/candidate in MCP status.
  perform public.flh_assessment_command(p_workspace_id,p_parent_id,'read',jsonb_build_object('quiz_version_id',r.quiz_version_id,'candidate_sha256',r.candidate_sha256));
  status:=a.state;
 elsif q.status='draft' and v.state='draft' and not exists(select 1 from public.quiz_questions where workspace_id=p_workspace_id and quiz_version_id=v.id)
 then status:='draft';
 else raise exception 'ASSESSMENT_CONTENT_DRIFT'; end if;
 return jsonb_build_object('ok',true,'request_id',request_uuid,'duplicate',duplicate,'state',status,'candidate_sha256',r.candidate_sha256,
  'target',jsonb_build_object('quiz_id',r.quiz_id,'quiz_version_id',r.quiz_version_id,'learner_id',r.learner_id,'program_id',r.program_id),
  'quiz_status',q.status,'version_state',v.state,'released_at',a.released_at,
  'question_count',(select count(*) from public.quiz_questions where workspace_id=p_workspace_id and quiz_version_id=v.id),
  'video_count',(select count(*) from public.learning_video_assignments where workspace_id=p_workspace_id and quiz_version_id=v.id and learner_id=r.learner_id and verification_state='verified' and verification_expires_at>now()),
  'learning_path',case when status='released' then 'index.html?quiz='||q.slug||'&mode=learning&learner='||(select slug from public.learners where workspace_id=p_workspace_id and id=r.learner_id) end,
  'exam_path',case when status='released' then 'index.html?quiz='||q.slug||'&mode=exam&learner='||(select slug from public.learners where workspace_id=p_workspace_id and id=r.learner_id) end);
exception when unique_violation then raise exception 'ASSESSMENT_RETRY_CONFLICT';
 when invalid_text_representation or not_null_violation or check_violation or foreign_key_violation or numeric_value_out_of_range then raise exception 'ASSESSMENT_AUTHORING_INPUT_INVALID';
end;
$$;
revoke all on function public.flh_assessment_authoring_command(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.flh_assessment_authoring_command(uuid,uuid,text,jsonb) to service_role;

-- Keep the same immutable binding when an authorized parent uses learning-api directly.
-- Existing unmanaged FLH-027 assessments retain their current publication behavior.
create function private.flh_assessment_authoring_bind() returns trigger
language plpgsql security invoker set search_path='' as $$
declare r private.assessment_authoring_requests%rowtype;
begin
 select * into r from private.assessment_authoring_requests where workspace_id=new.workspace_id and quiz_version_id=new.quiz_version_id;
 if found and (new.quiz_id is distinct from r.quiz_id or new.learner_id is distinct from r.learner_id
  or new.program_id is distinct from r.program_id or new.created_by is distinct from r.created_by
  or new.candidate_sha256 is distinct from r.candidate_sha256)
 then raise exception 'ASSESSMENT_RETRY_CONFLICT'; end if;
 return new;
end;
$$;
revoke all on function private.flh_assessment_authoring_bind() from public,anon,authenticated;
grant execute on function private.flh_assessment_authoring_bind() to service_role;
create trigger assessment_authoring_bind before insert on public.assessment_publications
for each row execute function private.flh_assessment_authoring_bind();
