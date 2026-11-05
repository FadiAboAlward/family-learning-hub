-- FLH-FEAT-2026-044 v1.1 / Drive revision 4. No historical data changes.
-- Opt-in publishing is OFF unless a workspace owner separately enables it.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('assessment-assets','assessment-assets',false,4194304,array['image/png','image/jpeg','image/webp'])
on conflict(id) do nothing;
do $$ begin
 if exists(select 1 from storage.buckets where id='assessment-assets' and (public or file_size_limit is distinct from 4194304 or allowed_mime_types is distinct from array['image/png','image/jpeg','image/webp']))
 then raise exception 'ASSESSMENT_STORAGE_CONTRACT_CONFLICT'; end if;
end $$;
-- No anon/authenticated object policies: custom learner tokens are not Auth JWTs.

create or replace function public.flh_assessment_media_parent(p_workspace_id uuid,p_parent_id uuid,p_version_id uuid,p_upload boolean default false)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=p_parent_id and role in ('owner','admin'))
 and case when p_upload then
   exists(select 1 from public.workspace_settings where workspace_id=p_workspace_id and key='visual_assessments' and value->'enabled'='true'::jsonb)
   and not exists(select 1 from public.quiz_versions where id=p_version_id and (workspace_id<>p_workspace_id or created_by is distinct from p_parent_id or state<>'draft'))
   and not exists(select 1 from public.assessment_publications where quiz_version_id=p_version_id)
 else exists(select 1 from public.assessment_publications where workspace_id=p_workspace_id and quiz_version_id=p_version_id and created_by=p_parent_id)
 end;
$$;
revoke all on function public.flh_assessment_media_parent(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.flh_assessment_media_parent(uuid,uuid,uuid,boolean) to service_role;

-- One canonical projection shared by graph/paper and the authorized runtime read.
create or replace function private.flh_visual_assets(w uuid,qid uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
  'asset_id',a.id,'position',link.position,'purpose',link.purpose,'alt_text',link.alt_text,
  'label',ctx->'label','required',ctx->'required','mime_type',a.mime_type,
  'width',a.metadata->'width','height',a.metadata->'height','checksum_sha256',a.checksum_sha256,
  'storage_bucket',a.storage_bucket,'storage_path',a.storage_path,'provenance',a.metadata->'provenance'
 ) order by link.position),'[]'::jsonb)
 from public.quiz_question_assets link
 join public.assets a on a.id=link.asset_id and a.workspace_id=link.workspace_id
 join public.quiz_questions q on q.id=link.question_id and q.workspace_id=link.workspace_id
 cross join lateral (select value as ctx from jsonb_array_elements(coalesce(q.source_metadata->'visual_assessment'->'assets','[]')) where value->>'asset_id'=a.id::text) context
 where link.workspace_id=w and link.question_id=qid;
$$;
revoke all on function private.flh_visual_assets(uuid,uuid) from public,anon,authenticated;
grant execute on function private.flh_visual_assets(uuid,uuid) to service_role;

create or replace function public.flh_assessment_media_preview(p_workspace_id uuid,p_parent_id uuid,p_version_id uuid,p_question_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare assets jsonb;
begin
 if not public.flh_assessment_media_parent(p_workspace_id,p_parent_id,p_version_id,false)
  or not exists(select 1 from public.quiz_questions q join public.quiz_versions v on v.id=q.quiz_version_id and v.workspace_id=q.workspace_id
   where q.workspace_id=p_workspace_id and q.id=p_question_id and v.id=p_version_id and v.settings->>'assessment_profile'='visual-foundation-bridge-v1')
 then raise exception 'ASSESSMENT_MEDIA_FORBIDDEN';end if;
 select coalesce(jsonb_agg(asset-'provenance'-'storage_bucket' order by (asset->>'position')::integer),'[]'::jsonb)
 into assets from jsonb_array_elements(private.flh_visual_assets(p_workspace_id,p_question_id)) asset where asset->>'purpose'='prompt';
 return jsonb_build_object('assessment_profile','visual-foundation-bridge-v1','questions',jsonb_build_array(jsonb_build_object('question_id',p_question_id,'assets',assets)));
end;
$$;
revoke all on function public.flh_assessment_media_preview(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.flh_assessment_media_preview(uuid,uuid,uuid,uuid) to service_role;

-- Enforce the opt-in creation flag at the existing service-only draft transaction too.
do $$ declare definition text; anchor text:=' if request_uuid is null or p_action not in'; begin
 select pg_get_functiondef('public.flh_assessment_authoring_command(uuid,uuid,text,jsonb)'::regprocedure) into definition;
 if position('FLH044_CREATE_FLAG' in definition)=0 then
  if position(anchor in definition)=0 then raise exception 'ASSESSMENT_AUTHORING_CONTRACT_DRIFT';end if;
  definition:=replace(definition,anchor,
   ' -- FLH044_CREATE_FLAG'||chr(10)||
   ' if p_action=''create'' and p_payload->''candidate''->>''assessment_profile''=''visual-foundation-bridge-v1'' then'||chr(10)||
   '  perform 1 from public.workspace_settings where workspace_id=p_workspace_id and key=''visual_assessments'' for share;'||chr(10)||
   '  if not exists(select 1 from public.workspace_settings where workspace_id=p_workspace_id and key=''visual_assessments'' and value->''enabled''=''true''::jsonb) then raise exception ''ASSESSMENT_VISUAL_DISABLED'';end if;'||chr(10)||
   ' end if;'||chr(10)||anchor);
  execute definition;
 end if;
end $$;

do $$ begin
 if to_regprocedure('private.flh_assessment_graph_before_flh044(uuid,uuid)') is null then
  alter function private.flh_assessment_graph(uuid,uuid) rename to flh_assessment_graph_before_flh044;
 end if;
end $$;
create or replace function private.flh_assessment_graph(w uuid,v uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare base jsonb:=private.flh_assessment_graph_before_flh044(w,v);
begin
 if not exists(select 1 from public.quiz_versions where workspace_id=w and id=v and settings->>'assessment_profile'='visual-foundation-bridge-v1') then return base; end if;
 return (select coalesce(jsonb_agg(item||jsonb_build_object('assessment_profile','visual-foundation-bridge-v1','assets',private.flh_visual_assets(w,q.id)) order by q.position),'[]'::jsonb)
 from jsonb_array_elements(base) item join public.quiz_questions q on q.workspace_id=w and q.quiz_version_id=v and q.position=(item->>'position')::integer);
end;
$$;
revoke all on function private.flh_assessment_graph(uuid,uuid) from public,anon,authenticated;
grant execute on function private.flh_assessment_graph(uuid,uuid) to service_role;

create or replace function private.flh_import_visual_question(w uuid,v uuid,qid uuid,item jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare a jsonb; ordinal bigint; existing public.assets%rowtype; expected_meta jsonb;
begin
 if not exists(select 1 from public.quiz_versions where workspace_id=w and id=v and settings->>'assessment_profile'='visual-foundation-bridge-v1') then return; end if;
 update public.quiz_questions set source_metadata=source_metadata||jsonb_build_object('visual_assessment',jsonb_build_object(
   'profile','visual-foundation-bridge-v1','learning_stage',item->'learning_stage','assets',
   (select coalesce(jsonb_agg(jsonb_build_object('asset_id',entry.value->'asset_id','label',entry.value->'label','required',entry.value->'required') order by (entry.value->>'position')::integer),'[]'::jsonb) from jsonb_array_elements(coalesce(item->'assets','[]')) entry(value))))
 where workspace_id=w and id=qid and quiz_version_id=v;
 for a,ordinal in select value,ordinality from jsonb_array_elements(coalesce(item->'assets','[]')) with ordinality loop
  if a->>'storage_bucket' is distinct from 'assessment-assets' or a->>'purpose' is distinct from 'prompt'
   or coalesce(a->>'mime_type','') not in ('image/png','image/jpeg','image/webp')
   or jsonb_typeof(a->'width') is distinct from 'number' or jsonb_typeof(a->'height') is distinct from 'number'
   or coalesce(a->'provenance'->>'origin','') not in ('generated','book_crop')
   or a->>'storage_path' is distinct from (w::text||'/'||v::text||'/'||(a->>'checksum_sha256')||(case a->>'mime_type' when 'image/png' then '.png' when 'image/jpeg' then '.jpg' when 'image/webp' then '.webp' else '.invalid' end))
   or (a->>'checksum_sha256' ~ '^[a-f0-9]{64}$') is not true or (a->>'position')::integer is distinct from ordinal
   or jsonb_typeof(a->'required') is distinct from 'boolean' or nullif(btrim(a->>'alt_text'),'') is null
   or (a->>'width')::integer not between 16 and 4096 or (a->>'height')::integer not between 16 and 4096
   or (a->>'width')::bigint*(a->>'height')::bigint>8388608
   or (a->'provenance'->>'origin'='generated' and a->'provenance'->>'rights_status' is distinct from 'owned')
   or (a->'provenance'->>'origin'='book_crop' and (a->'provenance'->>'rights_status' is distinct from 'authorized' or nullif(a->'provenance'->>'rights_ref','') is null))
  then raise exception 'ASSESSMENT_MEDIA_INVALID'; end if;
  expected_meta:=jsonb_build_object('quiz_version_id',v,'width',a->'width','height',a->'height','provenance',a->'provenance');
  insert into public.assets(id,workspace_id,kind,storage_bucket,storage_path,mime_type,checksum_sha256,metadata)
  values((a->>'asset_id')::uuid,w,'image','assessment-assets',a->>'storage_path',a->>'mime_type',a->>'checksum_sha256',expected_meta) on conflict(id) do nothing;
  select * into existing from public.assets where id=(a->>'asset_id')::uuid for update;
  if existing.workspace_id is distinct from w or existing.storage_bucket is distinct from 'assessment-assets'
   or existing.storage_path is distinct from a->>'storage_path' or existing.mime_type is distinct from a->>'mime_type'
   or existing.checksum_sha256 is distinct from a->>'checksum_sha256' or existing.metadata is distinct from expected_meta
  then raise exception 'ASSESSMENT_MEDIA_CONFLICT'; end if;
  insert into public.quiz_question_assets(workspace_id,question_id,asset_id,position,purpose,alt_text)
  values(w,qid,existing.id,ordinal,'prompt',a->>'alt_text');
 end loop;
end;
$$;
revoke all on function private.flh_import_visual_question(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.flh_import_visual_question(uuid,uuid,uuid,jsonb) to service_role;

-- Preserve the established transaction. Insert links BEFORE its immutable receipt.
-- Fail on unexpected function drift; repeat application never patches it twice.
do $$ declare definition text; anchor text:='   for opt in select value from jsonb_array_elements(question->''options'') loop'; begin
 if to_regprocedure('private.flh_assessment_command_before_flh044(uuid,uuid,text,jsonb)') is null then
  select pg_get_functiondef('public.flh_assessment_command(uuid,uuid,text,jsonb)'::regprocedure) into definition;
  if position(anchor in definition)=0 then raise exception 'ASSESSMENT_IMPORT_CONTRACT_DRIFT'; end if;
  definition:=replace(definition,anchor,'   perform private.flh_import_visual_question(p_workspace_id,version_id,question_id,question);'||chr(10)||anchor);
  execute definition;
  alter function public.flh_assessment_command(uuid,uuid,text,jsonb) rename to flh_assessment_command_before_flh044;
  alter function public.flh_assessment_command_before_flh044(uuid,uuid,text,jsonb) set schema private;
 end if;
end $$;

create or replace function public.flh_assessment_command(p_workspace_id uuid,p_parent_id uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v uuid:=case when p_action='stage' then (p_payload->'target'->>'quiz_version_id')::uuid else (p_payload->>'quiz_version_id')::uuid end;
 c jsonb; proof jsonb:=p_payload->'media_verification'; stage_count integer;
begin
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=p_parent_id and role in ('owner','admin')) then raise exception 'ASSESSMENT_FORBIDDEN'; end if;
 perform 1 from public.quiz_versions where workspace_id=p_workspace_id and id=v for update;
 if p_action='stage' then c:=p_payload->'candidate'; else select candidate into c from public.assessment_publications where workspace_id=p_workspace_id and quiz_version_id=v; end if;
 if c->>'assessment_profile'='visual-foundation-bridge-v1' and p_action in ('stage','publish','release') then
  perform 1 from public.workspace_settings where workspace_id=p_workspace_id and key='visual_assessments' for share;
  if not exists(select 1 from public.workspace_settings where workspace_id=p_workspace_id and key='visual_assessments' and value->'enabled'='true'::jsonb) then raise exception 'ASSESSMENT_VISUAL_DISABLED'; end if;
  if p_action in ('stage','release') then
   if proof->>'candidate_sha256' is distinct from p_payload->>'candidate_sha256' or proof->>'verified_at' is null
    or (proof->>'verified_at')::timestamptz not between now()-interval '5 minutes' and now()+interval '1 minute'
    or jsonb_typeof(proof->'files') is distinct from 'array'
   then raise exception 'ASSESSMENT_MEDIA_VERIFICATION_REQUIRED'; end if;
   if exists(select 1 from jsonb_array_elements(c->'questions') q cross join lateral jsonb_array_elements(coalesce(q->'assets','[]')) a where not exists(
     select 1 from jsonb_array_elements(proof->'files') f where f->>'asset_id'=a->>'asset_id' and f->>'checksum_sha256'=a->>'checksum_sha256' and (f->>'bytes')::bigint between 1 and 4194304))
   then raise exception 'ASSESSMENT_MEDIA_VERIFICATION_REQUIRED'; end if;
  end if;
  if p_action='stage' then
   if jsonb_array_length(c->'questions')<>40 then raise exception 'ASSESSMENT_ACADEMIC_REJECTED'; end if;
   select count(*) into stage_count from (select value,row_number() over() as n from jsonb_array_elements(c->'questions') where value->>'delivery_surface'='learning') q
     where value->>'learning_stage'=case when n<=10 then 'FOUNDATION' else 'BRIDGE' end;
   if stage_count<>20 or exists(select 1 from jsonb_array_elements(c->'questions') q where q->>'delivery_surface'='exam' and q ? 'learning_stage') then raise exception 'ASSESSMENT_ACADEMIC_REJECTED'; end if;
   if not exists(select 1 from public.assessment_publications where workspace_id=p_workspace_id and quiz_version_id=v) then
    update public.quiz_versions set settings=settings||jsonb_build_object('assessment_profile','visual-foundation-bridge-v1') where workspace_id=p_workspace_id and id=v and state='draft';
   end if;
  end if;
 end if;
 return private.flh_assessment_command_before_flh044(p_workspace_id,p_parent_id,p_action,p_payload);
end;
$$;
revoke all on function public.flh_assessment_command(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.flh_assessment_command(uuid,uuid,text,jsonb) to service_role;

create or replace function private.flh_visual_media_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare r jsonb; version_id uuid;
begin
 for r in select value from jsonb_array_elements(jsonb_build_array(case when tg_op<>'INSERT' then to_jsonb(old) end,case when tg_op<>'DELETE' then to_jsonb(new) end)) where value<>'null'::jsonb loop
  if tg_table_schema='storage' then
   if tg_op='UPDATE' and (to_jsonb(old)-'last_accessed_at') is not distinct from (to_jsonb(new)-'last_accessed_at') then continue; end if;
   if r->>'bucket_id'='assessment-assets' and exists(select 1 from public.assets a join public.quiz_question_assets l on l.asset_id=a.id and l.workspace_id=a.workspace_id where a.storage_bucket=r->>'bucket_id' and a.storage_path=r->>'name') then raise exception 'ASSESSMENT_MEDIA_IMMUTABLE'; end if;
  else
   for version_id in select distinct q.quiz_version_id from public.quiz_questions q
     join public.quiz_versions v on v.id=q.quiz_version_id and v.workspace_id=q.workspace_id
     left join public.quiz_question_assets l on l.question_id=q.id and l.workspace_id=q.workspace_id
     where q.workspace_id=(r->>'workspace_id')::uuid and v.settings->>'assessment_profile'='visual-foundation-bridge-v1'
      and case when tg_table_name='assets' then l.asset_id=(r->>'id')::uuid else q.id=(r->>'question_id')::uuid end loop
    perform 1 from public.quiz_versions where id=version_id for update;
    if exists(select 1 from public.assessment_publications where quiz_version_id=version_id)
     or exists(select 1 from public.quiz_versions where id=version_id and state='published') then raise exception 'ASSESSMENT_MEDIA_IMMUTABLE'; end if;
   end loop;
  end if;
 end loop;
 if tg_op='DELETE' then return old; end if;return new;
end;
$$;
revoke all on function private.flh_visual_media_guard() from public,anon,authenticated;
drop trigger if exists visual_media_guard on public.assets;
create trigger visual_media_guard before update or delete on public.assets for each row execute function private.flh_visual_media_guard();
drop trigger if exists visual_media_guard on public.quiz_question_assets;
create trigger visual_media_guard before insert or update or delete on public.quiz_question_assets for each row execute function private.flh_visual_media_guard();
drop trigger if exists visual_media_guard on storage.objects;
create trigger visual_media_guard before update or delete on storage.objects for each row execute function private.flh_visual_media_guard();

/** Service-only, read-only resolver. No attempt creation, scoring, keys or early feedback. */
create or replace function public.flh_assessment_media_context(p_workspace_id uuid,p_learner_id uuid,p_attempt_id uuid,p_question_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare a public.quiz_attempts%rowtype; profile text; questions jsonb; evidence jsonb;
begin
 select * into a from public.quiz_attempts where workspace_id=p_workspace_id and learner_id=p_learner_id and id=p_attempt_id
  and exists(select 1 from public.learners where workspace_id=p_workspace_id and id=p_learner_id and is_active);
 if not found then raise exception 'ASSESSMENT_MEDIA_FORBIDDEN'; end if;
 select settings->>'assessment_profile' into profile from public.quiz_versions where workspace_id=p_workspace_id and id=a.quiz_version_id;
 if profile is distinct from 'visual-foundation-bridge-v1' then return null; end if;
 if exists(select 1 from public.assessment_publications where workspace_id=p_workspace_id and quiz_version_id=a.quiz_version_id and state<>'released') then raise exception 'ASSESSMENT_MEDIA_FORBIDDEN'; end if;
 if p_question_id is not null and not exists(select 1 from public.quiz_attempt_question_queue where workspace_id=p_workspace_id and quiz_attempt_id=a.id and question_id=p_question_id) then raise exception 'ASSESSMENT_MEDIA_FORBIDDEN'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('question_id',q.id,'learning_stage',q.source_metadata->'visual_assessment'->'learning_stage','assets',
  (select coalesce(jsonb_agg(asset-'provenance'-'storage_bucket' order by (asset->>'position')::integer),'[]'::jsonb) from jsonb_array_elements(private.flh_visual_assets(p_workspace_id,q.id)) asset where asset->>'purpose'='prompt')) order by queue.sequence_no),'[]'::jsonb)
 into questions from public.quiz_attempt_question_queue queue join public.quiz_questions q on q.workspace_id=queue.workspace_id and q.id=queue.question_id
 where queue.workspace_id=p_workspace_id and queue.quiz_attempt_id=a.id and (p_question_id is null or q.id=p_question_id);
 if a.delivery_mode='learning' then
  select coalesce(jsonb_agg(jsonb_build_object('question_id',q.id,'question_code',q.question_code,'concept_id',queue.concept_id,'concept_label',(select title from public.learning_concepts where workspace_id=queue.workspace_id and id=queue.concept_id),
   'learning_stage',q.source_metadata->'visual_assessment'->'learning_stage','status',queue.status,
   'is_correct',case when queue.status='completed' then answer.is_correct end,
   'attempts_used',case when queue.status='completed' then answer.attempts_used end,
   'hints_used',case when queue.status='completed' then greatest(answer.hints_used,queue.hint_level_requested) end,
   'explanation',case when queue.status='completed' then case when answer.is_correct then coalesce(key.correct_explanation,key.explanation) else coalesce(key.final_incorrect_explanation,key.explanation) end end
  ) order by queue.sequence_no),'[]'::jsonb) into evidence
  from public.quiz_attempt_question_queue queue join public.quiz_questions q on q.id=queue.question_id and q.workspace_id=queue.workspace_id
  left join public.quiz_attempt_answers answer on answer.question_id=q.id and answer.attempt_id=a.id and answer.workspace_id=queue.workspace_id
  left join public.quiz_question_answer_keys key on key.question_id=q.id and key.workspace_id=queue.workspace_id
  where queue.workspace_id=p_workspace_id and queue.quiz_attempt_id=a.id;
 end if;
 return jsonb_build_object('assessment_profile',profile,'questions',questions,'learning_evidence',evidence);
end;
$$;
revoke all on function public.flh_assessment_media_context(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.flh_assessment_media_context(uuid,uuid,uuid,uuid) to service_role;

-- New paper projections only. Existing paper hashes delegate byte-for-byte.
do $$ begin
 if to_regprocedure('private.flh_paper_package_before_flh044(uuid,uuid)') is null then
  alter function public.flh_paper_exam_runtime_package(uuid,uuid) rename to flh_paper_package_before_flh044;
  alter function public.flh_paper_package_before_flh044(uuid,uuid) set schema private;
 end if;
end $$;
create or replace function public.flh_paper_exam_runtime_package(p_workspace_id uuid,p_quiz_version_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare base jsonb:=private.flh_paper_package_before_flh044(p_workspace_id,p_quiz_version_id);
begin
 if not exists(select 1 from public.quiz_versions where workspace_id=p_workspace_id and id=p_quiz_version_id and settings->>'assessment_profile'='visual-foundation-bridge-v1') then return base; end if;
 return (select jsonb_agg(item||jsonb_build_object('assets',private.flh_visual_assets(p_workspace_id,q.id)) order by (item->>'paper_question_number')::integer)
  from jsonb_array_elements(base) item join public.quiz_questions q on q.workspace_id=p_workspace_id and q.quiz_version_id=p_quiz_version_id and q.question_code=item->>'question_code');
end;
$$;
revoke all on function public.flh_paper_exam_runtime_package(uuid,uuid) from public,anon,authenticated;
grant execute on function public.flh_paper_exam_runtime_package(uuid,uuid) to service_role;
