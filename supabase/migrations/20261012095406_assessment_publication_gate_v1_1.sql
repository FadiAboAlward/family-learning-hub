-- FLH-FEAT-2026-027 v1.1, approved Drive revision 4. No historical backfill.
-- Prospective managed drafts only; the learner-runtime video predicate is unchanged.
create table public.assessment_publications (
 workspace_id uuid not null,
 quiz_id uuid not null,
 quiz_version_id uuid primary key,
 learner_id uuid not null,
 program_id uuid not null,
 candidate_sha256 text not null check (candidate_sha256 ~ '^[a-f0-9]{64}$'),
 candidate jsonb not null,
 validation jsonb not null,
 semantic_review jsonb not null,
 expected_graph jsonb not null,
 state text not null default 'staged' check(state in ('staged','held','released')),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 released_at timestamptz,
 video_receipt jsonb,
 delivery_state text not null default 'pending' check(delivery_state in ('pending','claimed','confirmed','uncertain')),
 delivery_receipt jsonb,
 unique (workspace_id,quiz_id),
 foreign key (quiz_id,workspace_id) references public.quizzes(id,workspace_id),
 foreign key (quiz_version_id,workspace_id) references public.quiz_versions(id,workspace_id),
 foreign key (learner_id,workspace_id) references public.learners(id,workspace_id),
 foreign key (program_id,workspace_id) references public.learning_programs(id,workspace_id)
);
alter table public.assessment_publications enable row level security;
revoke all on public.assessment_publications from public,anon,authenticated;
grant select,insert,update on public.assessment_publications to service_role;

-- Capture all imported academic fields, including private keys/rationales. Parent/service only.
create function private.flh_assessment_graph(w uuid,v uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
  'position',q.position,'code',q.question_code,'type',q.question_type,'prompt',q.prompt,
  'language',q.prompt_language,'difficulty',q.difficulty_level,'role',q.delivery_role,
  'origin',q.origin,'source',q.source_metadata,'points',q.points,
  'options',(select coalesce(jsonb_agg(jsonb_build_object('position',o.position,'label',o.label,'content',o.content) order by o.position),'[]'::jsonb) from public.quiz_question_options o where o.workspace_id=w and o.question_id=q.id),
  'key',(select jsonb_build_object('answer',k.correct_answer,'explanation',k.explanation,'grading',k.grading_config,'correct',k.correct_explanation,'incorrect',k.final_incorrect_explanation) from public.quiz_question_answer_keys k where k.workspace_id=w and k.question_id=q.id),
  'hints',(select coalesce(jsonb_agg(jsonb_build_object('level',h.hint_level,'role',h.pedagogical_role,'content',h.content,'metadata',h.metadata,'language',h.language) order by h.hint_level),'[]'::jsonb) from public.quiz_question_hints h where h.workspace_id=w and h.question_id=q.id),
  'concepts',(select coalesce(jsonb_agg(jsonb_build_object('id',c.concept_id,'primary',c.is_primary,'weight',c.weight) order by c.concept_id),'[]'::jsonb) from public.quiz_question_concepts c where c.workspace_id=w and c.question_id=q.id)
 ) order by q.position),'[]'::jsonb) from public.quiz_questions q where q.workspace_id=w and q.quiz_version_id=v;
$$;
revoke all on function private.flh_assessment_graph(uuid,uuid) from public,anon,authenticated;
grant execute on function private.flh_assessment_graph(uuid,uuid) to service_role;

-- Distinct authoring predicate: never used by learner start, preview or attempt snapshots.
create function private.flh_assessment_video_authoring_context(
 w uuid,l uuid,v uuid,p uuid,curr uuid,grade smallint,subject bigint,concept uuid
) returns boolean language sql stable security invoker set search_path='' as $$
 select exists (
  select 1 from public.assessment_publications a
  join public.quizzes q on q.id=a.quiz_id and q.workspace_id=a.workspace_id and q.status='draft'
  join public.quiz_versions qv on qv.id=a.quiz_version_id and qv.workspace_id=a.workspace_id and qv.quiz_id=q.id and qv.state='published'
  join public.learners learner on learner.id=a.learner_id and learner.workspace_id=a.workspace_id and learner.is_active
  join public.learner_program_enrollments e on e.workspace_id=a.workspace_id and e.learner_id=a.learner_id and e.program_id=a.program_id and e.status='active'
  join public.learning_programs program on program.id=e.program_id and program.workspace_id=e.workspace_id and program.status='active'
  join public.program_quizzes pq on pq.workspace_id=a.workspace_id and pq.program_id=program.id and pq.quiz_id=q.id and pq.availability='available'
  join public.learning_concepts c on c.id=concept and c.workspace_id=a.workspace_id
  where a.workspace_id=w and a.quiz_version_id=v and a.learner_id=l and a.program_id=p and a.state='held'
    and q.curriculum_id=curr and program.curriculum_id=curr and c.curriculum_id=curr
    and program.grade_level=grade and c.grade_level=grade and q.subject_id=subject and c.subject_id=subject
    and program.grade_level=(a.candidate->'academic_context'->>'grade')::smallint
    and exists(select 1 from public.quiz_questions question join public.quiz_question_concepts qc on qc.question_id=question.id and qc.workspace_id=question.workspace_id
      where question.workspace_id=w and question.quiz_version_id=v and question.delivery_role='core' and qc.concept_id=concept and qc.is_primary)
 );
$$;
revoke all on function private.flh_assessment_video_authoring_context(uuid,uuid,uuid,uuid,uuid,smallint,bigint,uuid) from public,anon,authenticated;
grant execute on function private.flh_assessment_video_authoring_context(uuid,uuid,uuid,uuid,uuid,smallint,bigint,uuid) to service_role;

create function public.flh_assessment_command(p_workspace_id uuid,p_parent_id uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
#variable_conflict use_column
declare
 a public.assessment_publications%rowtype; q public.quizzes%rowtype; v public.quiz_versions%rowtype;
 program public.learning_programs%rowtype; learner public.learners%rowtype;
 target jsonb:=p_payload->'target'; candidate jsonb:=p_payload->'candidate'; review jsonb:=p_payload->'semantic_review';
 version_id uuid; quiz_id uuid; learner_id uuid; program_id uuid; question jsonb; opt jsonb; hint jsonb;
 question_id uuid; concept_id uuid; n integer:=0; correct integer; hash text:=p_payload->>'candidate_sha256'; videos jsonb;
begin
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=p_parent_id and role in ('owner','admin'))
 then raise exception 'ASSESSMENT_FORBIDDEN'; end if;
 if p_action not in ('stage','publish','release','read') or hash is null or hash !~ '^[a-f0-9]{64}$' then raise exception 'ASSESSMENT_INPUT_INVALID'; end if;
 version_id:=case when p_action='stage' then (target->>'quiz_version_id')::uuid else (p_payload->>'quiz_version_id')::uuid end;
 -- Same lock ordering on all authoring/release calls; retries serialize by immutable version.
 select * into v from public.quiz_versions where workspace_id=p_workspace_id and id=version_id for update;
 if not found then raise exception 'ASSESSMENT_TARGET_INVALID'; end if;
 select * into q from public.quizzes where workspace_id=p_workspace_id and id=v.quiz_id for update;
 select * into a from public.assessment_publications where workspace_id=p_workspace_id and quiz_version_id=version_id for update;
 if p_action='stage' then
  quiz_id:=(target->>'quiz_id')::uuid; learner_id:=(target->>'learner_id')::uuid; program_id:=(target->>'program_id')::uuid;
  if q.id is distinct from quiz_id then raise exception 'ASSESSMENT_TARGET_INVALID'; end if;
  if a.quiz_version_id is not null then
   if a.candidate_sha256<>hash or a.candidate is distinct from candidate or a.learner_id is distinct from learner_id or a.program_id is distinct from program_id
   then raise exception 'ASSESSMENT_RETRY_CONFLICT'; end if;
   if private.flh_assessment_graph(p_workspace_id,version_id) is distinct from a.expected_graph then raise exception 'ASSESSMENT_CONTENT_DRIFT'; end if;
   return jsonb_build_object('ok',true,'duplicate',true,'quiz_version_id',version_id,'candidate_sha256',hash,'state',a.state);
  end if;
  if q.status<>'draft' or v.state<>'draft' or exists(select 1 from public.quiz_versions where workspace_id=p_workspace_id and quiz_id=q.id and id<>version_id)
    or exists(select 1 from public.quiz_questions where workspace_id=p_workspace_id and quiz_version_id=version_id)
    or exists(select 1 from public.quiz_attempts where workspace_id=p_workspace_id and quiz_version_id=version_id)
    or exists(select 1 from public.quiz_assignments where workspace_id=p_workspace_id and quiz_version_id=version_id)
  then raise exception 'ASSESSMENT_FRESH_DRAFT_REQUIRED'; end if;
  select * into program from public.learning_programs where workspace_id=p_workspace_id and id=program_id and status='active';
  select * into learner from public.learners where workspace_id=p_workspace_id and id=learner_id and is_active;
  if program.id is null or learner.id is null or q.curriculum_id is null or program.curriculum_id is distinct from q.curriculum_id
    or (case when candidate->'academic_context'->>'grade' ~ '^[0-9]{1,2}$' then (candidate->'academic_context'->>'grade')::smallint else null end) is distinct from program.grade_level
    or not exists(select 1 from public.learner_program_enrollments where workspace_id=p_workspace_id and learner_id=learner.id and program_id=program.id and status='active')
    or not exists(select 1 from public.program_quizzes where workspace_id=p_workspace_id and program_id=program.id and quiz_id=q.id and availability='available')
  then raise exception 'ASSESSMENT_CONTEXT_MISMATCH'; end if;
  -- The Edge runs the official validator. Recheck closed structural/approval gates in the write transaction.
  -- Check container types separately before array operations; SQL NULL must never waive a gate.
  if jsonb_typeof(candidate->'questions') is distinct from 'array'
    or jsonb_typeof(p_payload->'validation'->'warnings') is distinct from 'array'
    or jsonb_typeof(review->'warning_dispositions') is distinct from 'array'
  then raise exception 'ASSESSMENT_ACADEMIC_REJECTED'; end if;
  if p_payload->'validation'->'ok' is distinct from 'true'::jsonb or jsonb_array_length(candidate->'questions')<>40
    or review->>'result' is distinct from 'PASS' or review->>'candidate_sha256' is distinct from hash
    or review->>'reviewed_by' is distinct from p_parent_id::text or review->>'workspace_id' is distinct from p_workspace_id::text
    or review->>'quiz_id' is distinct from q.id::text or review->>'quiz_version_id' is distinct from version_id::text
    or review->>'learner_id' is distinct from learner.id::text or review->>'program_id' is distinct from program.id::text
    or nullif(btrim(review->>'reviewer_ref'),'') is null
    or nullif(btrim(review->>'source_review_ref'),'') is null or nullif(btrim(review->>'learner_scope_review_ref'),'') is null
    or nullif(btrim(review->>'authority_ref'),'') is null or review->>'reviewed_at' is null
    or (review->>'reviewed_at')::timestamptz>now()+interval '1 minute'
    or (select count(*) from jsonb_array_elements(candidate->'questions') x where x->>'delivery_surface'='learning')<>20
    or (select count(*) from jsonb_array_elements(candidate->'questions') x where x->>'delivery_surface'='exam')<>20
    or exists(select 1 from jsonb_array_elements(p_payload->'validation'->'warnings') w where not exists(
      select 1 from jsonb_array_elements(review->'warning_dispositions') d where d->>'code'=w->>'code' and d->>'path'=w->>'path' and d->>'result'='ACCEPTED' and nullif(btrim(d->>'reason'),'') is not null))
  then raise exception 'ASSESSMENT_ACADEMIC_REJECTED'; end if;
  -- Match the existing preflight's native Learning-then-Exam projection. The
  -- manifest/hash stay unchanged and authored order within each mode is retained.
  for question in select value from jsonb_array_elements(candidate->'questions') with ordinality as item(value,source_position)
    order by case value->>'delivery_surface' when 'learning' then 0 else 1 end,source_position loop
   n:=n+1;
   if jsonb_typeof(question) is distinct from 'object' or jsonb_typeof(question->'options') is distinct from 'array'
     or (question ? 'hints' and jsonb_typeof(question->'hints') is distinct from 'array')
   then raise exception 'ASSESSMENT_ACADEMIC_REJECTED'; end if;
   if question->>'question_type' is distinct from 'single_choice' or (question->>'question_code' ~ '^Q-[0-9]{6,}$') is not true
     or jsonb_array_length(question->'options') not between 4 and 6
     or (select count(*) from jsonb_array_elements(question->'options') x where x->'is_correct'='true'::jsonb)<>1
     or (question->>'delivery_surface'='learning' and jsonb_array_length(coalesce(question->'hints','[]'))<>4)
     or (question->>'delivery_surface'='exam' and jsonb_array_length(coalesce(question->'hints','[]'))<>0)
   then raise exception 'ASSESSMENT_ACADEMIC_REJECTED'; end if;
   select id into concept_id from public.learning_concepts where workspace_id=p_workspace_id and code=question->>'concept_code'
     and curriculum_id=q.curriculum_id and subject_id=q.subject_id and grade_level=program.grade_level;
   if concept_id is null then raise exception 'ASSESSMENT_CONTEXT_MISMATCH'; end if;
   insert into public.quiz_questions(workspace_id,quiz_version_id,position,question_code,question_type,prompt,prompt_language,difficulty_level,origin,delivery_role,source_metadata)
   values(p_workspace_id,version_id,n,question->>'question_code','single_choice',question->>'prompt',question->>'prompt_language',(question->>'difficulty_level')::smallint,
     case when question->>'origin'='BOOK_DERIVED' then 'book_adapted' else 'generated' end,
     case when question->>'delivery_surface'='learning' then 'core' else 'exam_pool' end,
     jsonb_build_object('source_ref',question->>'source_ref','decomposable',question->'decomposable')) returning id into question_id;
   for opt in select value from jsonb_array_elements(question->'options') loop
    insert into public.quiz_question_options(workspace_id,question_id,position,label,content) values(p_workspace_id,question_id,(opt->>'position')::integer,coalesce(opt->>'label',chr(64+(opt->>'position')::integer)),opt->>'content');
    if opt->'is_correct'='true'::jsonb then correct:=(opt->>'position')::integer; end if;
   end loop;
   insert into public.quiz_question_answer_keys(workspace_id,question_id,correct_answer,explanation,correct_explanation,final_incorrect_explanation,grading_config)
   values(p_workspace_id,question_id,jsonb_build_object('option_position',correct),question->>'explanation',question->>'correct_explanation',question->>'final_incorrect_explanation',jsonb_build_object('option_rationales',question->'options','candidate_sha256',hash));
   insert into public.quiz_question_concepts(workspace_id,question_id,concept_id,is_primary,weight) values(p_workspace_id,question_id,concept_id,true,1);
   for hint in select value from jsonb_array_elements(coalesce(question->'hints','[]')) loop
    insert into public.quiz_question_hints(workspace_id,question_id,hint_level,pedagogical_role,content,metadata,language)
    values(p_workspace_id,question_id,(hint->>'level')::smallint,hint->>'role',hint->>'content',jsonb_build_object('steps',hint->'steps','expanded_steps',hint->'expanded_steps','decomposable',hint->'decomposable'),coalesce(hint->>'language',case when hint->>'content' ~ '[ء-ي]' then 'ar' else question->>'prompt_language' end));
   end loop;
  end loop;
  insert into public.assessment_publications(workspace_id,quiz_id,quiz_version_id,learner_id,program_id,candidate_sha256,candidate,validation,semantic_review,expected_graph,created_by)
  values(p_workspace_id,q.id,version_id,learner.id,program.id,hash,candidate,p_payload->'validation',review,private.flh_assessment_graph(p_workspace_id,version_id),p_parent_id);
  return jsonb_build_object('ok',true,'quiz_version_id',version_id,'candidate_sha256',hash,'state','staged');
 end if;
 if a.quiz_version_id is null or a.candidate_sha256 is distinct from hash then raise exception 'ASSESSMENT_TARGET_INVALID'; end if;
 if private.flh_assessment_graph(p_workspace_id,version_id) is distinct from a.expected_graph then raise exception 'ASSESSMENT_CONTENT_DRIFT'; end if;
 if p_action='read' then return jsonb_build_object('ok',true,'publication',to_jsonb(a)); end if;
 if p_action='publish' then
  if a.state in ('held','released') then return jsonb_build_object('ok',true,'duplicate',true,'state',a.state); end if;
  if q.status<>'draft' or v.state<>'draft' then raise exception 'ASSESSMENT_STATE_CONFLICT'; end if;
  update public.assessment_publications set state='held' where workspace_id=p_workspace_id and quiz_version_id=version_id;
  update public.quiz_versions set state='published',published_at=now() where workspace_id=p_workspace_id and id=version_id and state='draft';
  return jsonb_build_object('ok',true,'state','held','quiz_version_id',version_id,'candidate_sha256',hash);
 end if;
 if a.state='released' then return jsonb_build_object('ok',true,'duplicate',true,'state','released'); end if;
 if a.state<>'held' or q.status<>'draft' or v.state<>'published' then raise exception 'ASSESSMENT_STATE_CONFLICT'; end if;
 -- Existing rollout controls must permit this learner's verified video preview.
 -- Read-lock settings during release; do not enable them or alter learner scope here.
 perform 1 from public.workspace_settings where workspace_id=p_workspace_id and key='optional_learning_videos' for share;
 if not exists(select 1 from public.workspace_settings s where s.workspace_id=p_workspace_id and s.key='optional_learning_videos'
   and s.value->'enabled'='true'::jsonb and (s.value->'test_only' is distinct from 'true'::jsonb or exists(select 1 from public.learners l where l.workspace_id=p_workspace_id and l.id=a.learner_id and l.metadata->'is_test'='true'::jsonb)))
 then raise exception 'ASSESSMENT_VIDEO_GATE_FAILED'; end if;
 -- Serialize with attachment's existing per-learner/version sequence lock.
 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':'||a.learner_id::text||':'||version_id::text||':optional-video-sequence',0));
 perform 1 from public.learning_video_assignments where workspace_id=p_workspace_id and learner_id=a.learner_id and quiz_version_id=version_id for update;
 select jsonb_agg(jsonb_build_object('id',video_revision,'position',position,'video_ref',video_ref,'verified_at',verified_at,'expires_at',verification_expires_at,'reviewed_by',reviewed_by) order by position) into videos
 from public.learning_video_assignments where workspace_id=p_workspace_id and learner_id=a.learner_id and quiz_version_id=version_id;
 if videos is null or exists(select 1 from public.learning_video_assignments video where video.workspace_id=p_workspace_id and video.learner_id=a.learner_id and video.quiz_version_id=version_id
   and (video.verification_state<>'verified' or not video.embeddable or video.made_for_kids is null or video.verification_expires_at<=now()
     or not private.flh_assessment_video_authoring_context(p_workspace_id,a.learner_id,version_id,video.program_id,video.curriculum_id,video.grade_level,video.subject_id,video.concept_id)))
   or (select max(position)<>count(*) from public.learning_video_assignments where workspace_id=p_workspace_id and learner_id=a.learner_id and quiz_version_id=version_id)
 then raise exception 'ASSESSMENT_VIDEO_GATE_FAILED'; end if;
 update public.assessment_publications set state='released',released_at=now(),video_receipt=videos where workspace_id=p_workspace_id and quiz_version_id=version_id;
 update public.quizzes set status='active' where workspace_id=p_workspace_id and id=q.id and status='draft';
 if not exists(select 1 from public.quiz_assignments where workspace_id=p_workspace_id and learner_id=a.learner_id and quiz_version_id=version_id and status='assigned') then
  insert into public.quiz_assignments(workspace_id,learner_id,quiz_version_id,status,available_at,assigned_by,metadata)
  values(p_workspace_id,a.learner_id,version_id,'assigned',now(),p_parent_id,jsonb_build_object('assessment_publication',true,'candidate_sha256',hash));
 end if;
 return jsonb_build_object('ok',true,'state','released','quiz_version_id',version_id,'candidate_sha256',hash,'learner_id',a.learner_id,
   'learning_path','index.html?quiz='||q.slug||'&mode=learning&learner='||(select slug from public.learners where workspace_id=p_workspace_id and id=a.learner_id),
   'exam_path','index.html?quiz='||q.slug||'&mode=exam&learner='||(select slug from public.learners where workspace_id=p_workspace_id and id=a.learner_id),'delivery_state','pending');
exception when unique_violation then raise exception 'ASSESSMENT_RETRY_CONFLICT';
end;
$$;
revoke all on function public.flh_assessment_command(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.flh_assessment_command(uuid,uuid,text,jsonb) to service_role;

-- Read-only privileged trigger lookup keeps existing unmanaged parent writes working;
-- no browser role can invoke this function or read the private managed receipt.
create function private.flh_assessment_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare row_data jsonb; version_id uuid; managed public.assessment_publications%rowtype; version_state text; data_row jsonb;
begin
 for row_data in select value from jsonb_array_elements(jsonb_build_array(
   case when tg_op<>'INSERT' then to_jsonb(old) else null end,
   case when tg_op<>'DELETE' then to_jsonb(new) else null end)) where value<>'null'::jsonb loop
  if tg_table_name='quizzes' then
   select * into managed from public.assessment_publications where workspace_id=(row_data->>'workspace_id')::uuid and quiz_id=(row_data->>'id')::uuid;
   if managed.quiz_version_id is not null then
    if tg_op='DELETE' or (tg_op='UPDATE' and (to_jsonb(old)-'status'-'updated_at') is distinct from (to_jsonb(new)-'status'-'updated_at'))
      or (tg_op='UPDATE' and old.status='active' and new.status<>'active')
      or (row_data->>'status'='active' and managed.state<>'released') then raise exception 'ASSESSMENT_HELD_OR_IMMUTABLE'; end if;
   end if;
   continue;
  elsif tg_table_name='quiz_versions' then
   version_id:=(row_data->>'id')::uuid;
   if exists(select 1 from public.assessment_publications where workspace_id=(row_data->>'workspace_id')::uuid and quiz_id=(row_data->>'quiz_id')::uuid and quiz_version_id<>version_id)
   then raise exception 'ASSESSMENT_HELD_OR_IMMUTABLE'; end if;
  elsif tg_table_name in ('quiz_questions','quiz_assignments','quiz_attempts','learning_video_assignments') then version_id:=(row_data->>'quiz_version_id')::uuid;
  else
   select quiz_version_id into version_id from public.quiz_questions where workspace_id=(row_data->>'workspace_id')::uuid and id=(row_data->>'question_id')::uuid;
  end if;
  select * into managed from public.assessment_publications where workspace_id=(row_data->>'workspace_id')::uuid and quiz_version_id=version_id;
  if managed.quiz_version_id is null then continue; end if;
  if tg_table_name in ('learning_video_assignments','quiz_assignments','quiz_attempts') then
   select state into version_state from public.quiz_versions where id=version_id and workspace_id=(row_data->>'workspace_id')::uuid;
  else
   select state into version_state from public.quiz_versions where id=version_id and workspace_id=(row_data->>'workspace_id')::uuid for update;
  end if;
  if tg_table_name in ('quiz_assignments','quiz_attempts') then
   if managed.state<>'released' then raise exception 'ASSESSMENT_HELD_OR_IMMUTABLE'; end if;
  elsif tg_table_name='learning_video_assignments' then
   if managed.state='released' and (tg_op<>'UPDATE' or
      (to_jsonb(old)-array['status_revision','verification_state','embeddable','made_for_kids','verified_at','verification_expires_at','reviewed_by','updated_at','self_report','report_revision']) is distinct from
      (to_jsonb(new)-array['status_revision','verification_state','embeddable','made_for_kids','verified_at','verification_expires_at','reviewed_by','updated_at','self_report','report_revision']))
   then raise exception 'ASSESSMENT_HELD_OR_IMMUTABLE'; end if;
  elsif tg_table_name='quiz_versions' then
   if tg_op='UPDATE' and new.state='published' and version_state='draft' and
      (managed.state<>'held' or private.flh_assessment_graph(managed.workspace_id,managed.quiz_version_id) is distinct from managed.expected_graph)
   then raise exception 'ASSESSMENT_HELD_OR_IMMUTABLE'; end if;
   if version_state='published' and (tg_op<>'UPDATE' or (to_jsonb(old)-'updated_at') is distinct from (to_jsonb(new)-'updated_at')) then raise exception 'ASSESSMENT_HELD_OR_IMMUTABLE'; end if;
  elsif version_state='published' then raise exception 'ASSESSMENT_HELD_OR_IMMUTABLE'; end if;
 end loop;
 if tg_op='DELETE' then return old; end if;
 return new;
end;
$$;
revoke all on function private.flh_assessment_guard() from public,anon,authenticated;
do $$ declare relation text; begin
 foreach relation in array array['quizzes','quiz_versions','quiz_questions','quiz_question_options','quiz_question_answer_keys','quiz_question_hints','quiz_question_concepts','quiz_assignments','quiz_attempts','learning_video_assignments'] loop
  execute format('create trigger assessment_publication_guard before insert or update or delete on public.%I for each row execute function private.flh_assessment_guard()',relation);
 end loop;
end; $$;

-- Close explicit held-version progress lookup as well as catalog discovery.
-- Unmanaged versions and existing historical-result behavior delegate unchanged.
alter function public.flh_learner_journey_progress(uuid,uuid,uuid[]) rename to flh_learner_journey_progress_before_assessment_hold;
alter function public.flh_learner_journey_progress_before_assessment_hold(uuid,uuid,uuid[]) set schema private;
create function public.flh_learner_journey_progress(p_workspace_id uuid,p_learner_id uuid,p_version_ids uuid[] default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if exists(select 1 from public.assessment_publications where workspace_id=p_workspace_id and state<>'released' and quiz_version_id=any(p_version_ids))
 then return jsonb_build_object('error','JOURNEY_UNAVAILABLE'); end if;
 return private.flh_learner_journey_progress_before_assessment_hold(p_workspace_id,p_learner_id,p_version_ids);
end;
$$;
revoke all on function public.flh_learner_journey_progress(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.flh_learner_journey_progress(uuid,uuid,uuid[]) to service_role;

-- Preserve the latest closed attachment implementation; only authoring eligibility is extended.
create or replace function public.flh_learning_video_attach(p_workspace_id uuid,p_parent_id uuid,p_candidate jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v public.learning_video_assignments%rowtype;
  c jsonb:=p_candidate;
  v_position smallint;
  v_learner_id uuid;
  v_quiz_version_id uuid;
  v_position_supplied boolean:=c ? 'position';
  v_outcomes text[];
begin
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=p_parent_id and role in ('owner','admin')) then return jsonb_build_object('error','VIDEO_ATTACHMENT_FORBIDDEN'); end if;

 -- Accept only the established authoring fields and four provider status fields.
 -- The Edge validates these too; direct service-role calls keep a closed boundary.
 if jsonb_typeof(c) is distinct from 'object' then return jsonb_build_object('error','INVALID_VIDEO_INPUT'); end if;
 if exists (
   select 1 from jsonb_object_keys(c) as supplied(key)
   where key <> all(array[
     'learner_id','quiz_version_id','program_id','curriculum_id','grade_level','subject_id','concept_id','position',
     'video_ref','title','language','rationale','learning_outcomes',
     'embeddable','made_for_kids','verified_at','verification_expires_at'
   ]::text[])
 ) then return jsonb_build_object('error','INVALID_VIDEO_INPUT'); end if;
 if c ? 'learning_outcomes' then
   if jsonb_typeof(c->'learning_outcomes') is distinct from 'array' then
     return jsonb_build_object('error','INVALID_VIDEO_INPUT');
   end if;
   if jsonb_array_length(c->'learning_outcomes') not between 1 and 3 or exists (
     select 1 from jsonb_array_elements(c->'learning_outcomes') as outcome(value)
     where jsonb_typeof(value) is distinct from 'string'
   ) then return jsonb_build_object('error','INVALID_VIDEO_INPUT'); end if;
   select array_agg(private.flh_learning_video_outcome_trim(value #>> '{}') order by ordinal)
   into v_outcomes
   from jsonb_array_elements(c->'learning_outcomes') with ordinality as outcome(value,ordinal);
   if not private.flh_learning_video_outcomes_valid(v_outcomes) then
     return jsonb_build_object('error','INVALID_VIDEO_INPUT');
   end if;
 end if;

 v_learner_id:=(c->>'learner_id')::uuid;
 v_quiz_version_id:=(c->>'quiz_version_id')::uuid;
 if exists(select 1 from public.assessment_publications where workspace_id=p_workspace_id and quiz_version_id=v_quiz_version_id) then
  perform 1 from public.quiz_versions where workspace_id=p_workspace_id and id=v_quiz_version_id for update;
 end if;
 perform pg_advisory_xact_lock(
   hashtextextended(
     p_workspace_id::text || ':' || v_learner_id::text || ':' || v_quiz_version_id::text || ':optional-video-sequence',
     0
   )
 );

 if v_position_supplied then
   if jsonb_typeof(c->'position') is distinct from 'number' then return jsonb_build_object('error','INVALID_VIDEO_INPUT'); end if;
   v_position:=(c->>'position')::smallint;
 else
   if exists(
     select 1
     from public.learning_video_assignments
     where workspace_id=p_workspace_id
       and learner_id=v_learner_id
       and quiz_version_id=v_quiz_version_id
       and position>1
   ) then
     return jsonb_build_object('error','INVALID_VIDEO_INPUT');
   end if;
   v_position:=1;
 end if;

 if v_position is null or v_position not between 1 and 20
   or c->'embeddable' is distinct from 'true'::jsonb or jsonb_typeof(c->'made_for_kids') is distinct from 'boolean'
   or c->>'verified_at' is null or c->>'verification_expires_at' is null
   or (c->>'verified_at')::timestamptz < now()-interval '5 minutes'
   or (c->>'verified_at')::timestamptz > now()+interval '1 minute'
   or (c->>'verification_expires_at')::timestamptz > (c->>'verified_at')::timestamptz+interval '7 days'
   or not (private.flh_learning_video_context_matches(p_workspace_id,(c->>'learner_id')::uuid,(c->>'quiz_version_id')::uuid,(c->>'program_id')::uuid,(c->>'curriculum_id')::uuid,(c->>'grade_level')::smallint,(c->>'subject_id')::bigint,(c->>'concept_id')::uuid) or private.flh_assessment_video_authoring_context(p_workspace_id,(c->>'learner_id')::uuid,(c->>'quiz_version_id')::uuid,(c->>'program_id')::uuid,(c->>'curriculum_id')::uuid,(c->>'grade_level')::smallint,(c->>'subject_id')::bigint,(c->>'concept_id')::uuid))
 then return jsonb_build_object('error','VIDEO_CONTEXT_MISMATCH'); end if;

 insert into public.learning_video_assignments(workspace_id,learner_id,quiz_version_id,program_id,curriculum_id,grade_level,subject_id,concept_id,position,video_ref,title,language,learning_outcomes,rationale,verification_state,embeddable,made_for_kids,verified_at,verification_expires_at,reviewed_by)
 values(p_workspace_id,v_learner_id,v_quiz_version_id,(c->>'program_id')::uuid,(c->>'curriculum_id')::uuid,(c->>'grade_level')::smallint,(c->>'subject_id')::bigint,(c->>'concept_id')::uuid,v_position,c->>'video_ref',c->>'title',c->>'language',v_outcomes,c->>'rationale','verified',true,(c->>'made_for_kids')::boolean,(c->>'verified_at')::timestamptz,(c->>'verification_expires_at')::timestamptz,p_parent_id)
 on conflict(workspace_id,learner_id,quiz_version_id,position) do update set
  status_revision=gen_random_uuid(),
  video_revision=case when (learning_video_assignments.video_ref,learning_video_assignments.program_id,learning_video_assignments.curriculum_id,learning_video_assignments.grade_level,learning_video_assignments.subject_id,learning_video_assignments.concept_id,learning_video_assignments.title,learning_video_assignments.language,learning_video_assignments.learning_outcomes) is distinct from (excluded.video_ref,excluded.program_id,excluded.curriculum_id,excluded.grade_level,excluded.subject_id,excluded.concept_id,excluded.title,excluded.language,excluded.learning_outcomes) then gen_random_uuid() else learning_video_assignments.video_revision end,
  program_id=excluded.program_id,curriculum_id=excluded.curriculum_id,grade_level=excluded.grade_level,subject_id=excluded.subject_id,concept_id=excluded.concept_id,
  video_ref=excluded.video_ref,title=excluded.title,language=excluded.language,learning_outcomes=excluded.learning_outcomes,rationale=excluded.rationale,verification_state='verified',embeddable=true,made_for_kids=excluded.made_for_kids,verified_at=excluded.verified_at,verification_expires_at=excluded.verification_expires_at,reviewed_by=p_parent_id,updated_at=now()
 returning * into v;

 update public.learning_video_attempts set verification_state='verified',embeddable=true,made_for_kids=v.made_for_kids,verified_at=v.verified_at,verification_expires_at=v.verification_expires_at
 where workspace_id=p_workspace_id and video_id=v.video_revision and video_ref=v.video_ref;

 return jsonb_build_object('ok',true,'assignment_id',v.id,'video_id',v.video_revision,'position',v.position,'verification_expires_at',v.verification_expires_at);
exception
 when invalid_text_representation or check_violation or not_null_violation or numeric_value_out_of_range or unique_violation
 then return jsonb_build_object('error','INVALID_VIDEO_INPUT');
end;
$$;

revoke all on function public.flh_learning_video_attach(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.flh_learning_video_attach(uuid,uuid,jsonb) to service_role;

