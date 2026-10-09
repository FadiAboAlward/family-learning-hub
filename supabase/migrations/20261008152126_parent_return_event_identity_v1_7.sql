-- FLH-FEAT-2026-025 v1.1 / Drive revision 2; FLH-010 v1.7 / Drive revision 3.
-- Parent adjudication maps a physical return to its canonical server record.
-- No timestamp-based physical inference, completed-history backfill or new wallet.
create table if not exists public.family_return_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  occurred_at timestamptz not null check (isfinite(occurred_at)),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  idempotency_key text not null check (length(idempotency_key) between 8 and 200),
  request_payload jsonb not null check (jsonb_typeof(request_payload)='object'),
  unique(id,workspace_id),
  unique(workspace_id,idempotency_key)
);
create index if not exists family_return_events_day_page_idx on public.family_return_events(workspace_id,occurred_at desc,id desc);
alter table public.family_return_events enable row level security;
revoke all on public.family_return_events from public,anon,authenticated;
grant all on public.family_return_events to service_role;
-- The approved browser carrier is the bounded, safe family-api catalog, not
-- direct table reads of creator IDs, request keys or normalized provenance.
drop policy if exists family_return_events_parent_read on public.family_return_events;

alter table public.behavior_submissions add column if not exists return_event_id uuid;
do $constraints$
begin
  if not exists(select 1 from pg_constraint where conrelid='public.behavior_submissions'::regclass and conname='behavior_submissions_return_event_workspace_fkey') then
    alter table public.behavior_submissions add constraint behavior_submissions_return_event_workspace_fkey
      foreign key(return_event_id,workspace_id) references public.family_return_events(id,workspace_id)
      deferrable initially deferred;
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.behavior_submissions'::regclass and conname='behavior_submissions_return_event_rule_check') then
    alter table public.behavior_submissions add constraint behavior_submissions_return_event_rule_check
      check(return_event_id is null or rule_id='a315e8af-9d9b-473b-95ac-c5425ad7de5b');
  end if;
end $constraints$;
create unique index if not exists behavior_submissions_return_event_award_idx
  on public.behavior_submissions(workspace_id,learner_id,return_event_id)
  where status='approved' and return_event_id is not null;

create or replace function public.flh_family_return_event_guard()
returns trigger language plpgsql security invoker set search_path='' as $guard$
begin
  if tg_op='DELETE' and pg_trigger_depth()>1 and not exists(select 1 from public.workspaces where id=old.workspace_id) then return old; end if;
  if exists(select 1 from public.behavior_submissions where workspace_id=old.workspace_id and return_event_id=old.id) then
    raise exception 'RETURN_EVENT_IMMUTABLE' using errcode='23514';
  end if;
  if tg_op='DELETE' then return old; end if;
  -- There is no product edit endpoint; even unused registered provenance is frozen.
  if new is distinct from old then raise exception 'RETURN_EVENT_IMMUTABLE' using errcode='23514'; end if;
  return new;
end $guard$;
drop trigger if exists family_return_event_guard on public.family_return_events;
create trigger family_return_event_guard before update or delete on public.family_return_events
  for each row execute function public.flh_family_return_event_guard();
revoke all on function public.flh_family_return_event_guard() from public,anon,authenticated;
grant execute on function public.flh_family_return_event_guard() to service_role;

create or replace function public.flh_family_return_binding_guard()
returns trigger language plpgsql security invoker set search_path='' as $guard$
begin
  if old.status='approved' and old.return_event_id is not null and (
    (new.workspace_id,new.learner_id,new.rule_id,new.return_event_id,new.occurred_at,new.requested_at,new.status,new.total_points,new.snapshot,
      new.base_points,new.initiative_bonus_points,new.adhkar_bonus_points,new.congregation_bonus_points,new.mosque_bonus_points,new.sunnah_bonus_points,
      new.initiative,new.adhkar_completed,new.congregation_completed,new.mosque_completed,new.sunnah_completed,
      new.approved_at,new.reviewed_at,new.reason,new.review_reason,new.request_payload,new.idempotency_key)
      is distinct from
    (old.workspace_id,old.learner_id,old.rule_id,old.return_event_id,old.occurred_at,old.requested_at,old.status,old.total_points,old.snapshot,
      old.base_points,old.initiative_bonus_points,old.adhkar_bonus_points,old.congregation_bonus_points,old.mosque_bonus_points,old.sunnah_bonus_points,
      old.initiative,old.adhkar_completed,old.congregation_completed,old.mosque_completed,old.sunnah_completed,
      old.approved_at,old.reviewed_at,old.reason,old.review_reason,old.request_payload,old.idempotency_key)
  ) then raise exception 'RETURN_EVENT_IMMUTABLE' using errcode='23514'; end if;
  return new;
end $guard$;
drop trigger if exists family_return_binding_guard on public.behavior_submissions;
create trigger family_return_binding_guard before update on public.behavior_submissions
  for each row execute function public.flh_family_return_binding_guard();
revoke all on function public.flh_family_return_binding_guard() from public,anon,authenticated;
grant execute on function public.flh_family_return_binding_guard() to service_role;

create or replace function public.flh_family_rewards_command(
  p_workspace_id uuid, p_actor_id uuid, p_learner_id uuid, p_action text, p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
  v_rule public.behavior_rules%rowtype;
  v_category public.behavior_categories%rowtype;
  v_submission public.behavior_submissions%rowtype;
  v_reward public.gamification_rewards%rowtype;
  v_claim public.reward_claims%rowtype;
  v_learner public.learners%rowtype;
  v_event public.gamification_events%rowtype;
  v_key text;
  v_reason text;
  v_decision text;
  v_scope text;
  v_cadence text;
  v_points integer;
  v_bonus integer;
  v_adhkar_bonus integer;
  v_congregation_bonus integer;
  v_mosque_bonus integer;
  v_sunnah_bonus integer;
  v_count integer;
  v_delta integer;
  v_window timestamptz;
  v_now timestamptz := clock_timestamp();
  v_snapshot jsonb;
  v_result jsonb;
  v_eligibility jsonb;
  v_criteria jsonb;
  v_ids uuid[];
  v_scope_ids uuid[];
  v_parent boolean := p_actor_id is not null;
  v_balance integer;
  v_is_test boolean;
  v_page_size integer;
  v_page jsonb;
  v_cursor bigint;
  v_request_payload jsonb;
  v_explicit_occurred_at timestamptz;
  v_report_category_id uuid;
  v_report_rule_id uuid;
  v_period text;
  v_parent_return_rule constant uuid := 'a315e8af-9d9b-473b-95ac-c5425ad7de5b';
  v_captured jsonb;
  v_has_capture boolean := false;
  v_return_event public.family_return_events%rowtype;
  v_return_id uuid;
  v_return_day date;
  v_return_before timestamptz;
  v_return_before_id uuid;
  v_return_page jsonb := '[]'::jsonb;
  v_return_cursor jsonb;
  v_return_time timestamptz;
begin
  if p_workspace_id is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' then return jsonb_build_object('error','INVALID_INPUT'); end if;
  if v_parent then
    if not exists(select 1 from public.workspace_members where workspace_id = p_workspace_id and user_id = p_actor_id and role in ('owner','admin')) then return jsonb_build_object('error','PARENT_MANAGE_FORBIDDEN'); end if;
  elsif p_action not in ('student_catalog','student_ledger','student_report','behavior_submit','reward_request') then return jsonb_build_object('error','PARENT_MANAGE_FORBIDDEN');
  end if;

  if p_action='return_event_create' then
    v_key := p_payload->>'idempotency_key';
    if v_key is null or length(v_key) not between 8 and 200 then return jsonb_build_object('error','IDEMPOTENCY_KEY_REQUIRED'); end if;
    if jsonb_typeof(p_payload->'occurred_at') is distinct from 'string' then return jsonb_build_object('error','INVALID_OCCURRED_AT'); end if;
    begin
      v_return_time := nullif(p_payload->>'occurred_at','')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
      return jsonb_build_object('error','INVALID_OCCURRED_AT');
    end;
    if v_return_time is null or not isfinite(v_return_time) then return jsonb_build_object('error','INVALID_OCCURRED_AT'); end if;
    -- Creation retries serialize independently of learner financial locks.
    perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':family-return:'||v_key,0));
    v_now := clock_timestamp();
    v_request_payload := jsonb_build_object('actor_id',p_actor_id,'occurred_at',extract(epoch from v_return_time));
    select * into v_return_event from public.family_return_events where workspace_id=p_workspace_id and idempotency_key=v_key;
    if found then
      if v_return_event.request_payload is distinct from v_request_payload then return jsonb_build_object('error','IDEMPOTENCY_CONFLICT'); end if;
      return jsonb_build_object('ok',true,'return_event',jsonb_build_object('id',v_return_event.id,'occurred_at',v_return_event.occurred_at,'created_at',v_return_event.created_at),'already_created',true);
    end if;
    if v_return_time>v_now then return jsonb_build_object('error','INVALID_OCCURRED_AT'); end if;
    insert into public.family_return_events(workspace_id,occurred_at,created_by,created_at,idempotency_key,request_payload)
      values(p_workspace_id,v_return_time,p_actor_id,v_now,v_key,v_request_payload) returning * into v_return_event;
    return jsonb_build_object('ok',true,'return_event',jsonb_build_object('id',v_return_event.id,'occurred_at',v_return_event.occurred_at,'created_at',v_return_event.created_at));
  end if;

  if not v_parent and p_learner_id is null then return jsonb_build_object('error','LEARNER_NOT_FOUND'); end if;
  if p_learner_id is not null then
    select * into v_learner from public.learners where workspace_id = p_workspace_id and id = p_learner_id and is_active;
    if not found then return jsonb_build_object('error','LEARNER_NOT_FOUND'); end if;
  end if;
  if p_action in ('parent_report','student_report') then
    if p_action='parent_report' and not v_parent then return jsonb_build_object('error','PARENT_MANAGE_FORBIDDEN'); end if;
    if p_learner_id is null then return jsonb_build_object('error','LEARNER_NOT_FOUND'); end if;
    v_period := coalesce(nullif(p_payload->>'period',''),'last7');
    if v_period not in ('last7','last30') then return jsonb_build_object('error','INVALID_INPUT'); end if;
    begin
      v_report_category_id := nullif(p_payload->>'category_id','')::uuid;
      v_report_rule_id := nullif(p_payload->>'rule_id','')::uuid;
    exception when invalid_text_representation then
      return jsonb_build_object('error','INVALID_INPUT');
    end;
    if v_report_category_id is not null and not exists(
      select 1 from public.behavior_categories c
      where c.id=v_report_category_id and c.workspace_id=p_workspace_id
    ) then return jsonb_build_object('error','CATEGORY_NOT_FOUND'); end if;
    if v_report_rule_id is not null and not exists(
      select 1 from public.behavior_rules r
      where r.id=v_report_rule_id and r.workspace_id=p_workspace_id
    ) then return jsonb_build_object('error','RULE_NOT_FOUND'); end if;
    with ranked as (
      select
        s.*,
        coalesce(nullif(s.snapshot->>'category_id','')::uuid,r.category_id) as category_id,
        coalesce(s.snapshot->>'rule_title',r.title) as rule_title,
        coalesce(s.snapshot->>'category_title',c.title) as category_title,
        row_number() over(order by s.occurred_at desc,s.requested_at desc,s.id desc) as report_rank
      from public.behavior_submissions s
      join public.behavior_rules r on r.id=s.rule_id and r.workspace_id=s.workspace_id
      join public.behavior_categories c on c.id=r.category_id and c.workspace_id=r.workspace_id
      where s.workspace_id=p_workspace_id
        and s.learner_id=p_learner_id
        and (v_report_category_id is null or coalesce(nullif(s.snapshot->>'category_id','')::uuid,r.category_id)=v_report_category_id)
        and (v_report_rule_id is null or r.id=v_report_rule_id)
        and (v_period<>'last30' or s.occurred_at>=v_now-interval '30 days')
    ),
    visible as (
      select * from ranked
      where v_period='last30' or report_rank<=7
    )
    select jsonb_build_object(
      'ok',true,
      'rows',coalesce(jsonb_agg((to_jsonb(v)-'report_rank') order by v.occurred_at desc,v.requested_at desc,v.id desc),'[]'::jsonb),
      'summary',jsonb_build_object(
        'approved_count',count(*) filter(where v.status='approved'),
        'pending_count',count(*) filter(where v.status='pending'),
        'total_points',coalesce(sum(case when v.status='approved' then v.total_points else 0 end),0)
      )
    ) into v_result
    from visible v;
    return v_result;
  end if;

  if p_action in ('parent_ledger','student_ledger') then
    if p_action='parent_ledger' and not v_parent then return jsonb_build_object('error','PARENT_MANAGE_FORBIDDEN'); end if;
    v_page_size := greatest(1,least(100,coalesce((p_payload->>'page_size')::integer,50)));
    select coalesce(jsonb_agg(to_jsonb(e) order by e.id desc),'[]'::jsonb) into v_page from (
      select e.* from public.gamification_events e join public.learners l on l.id=e.learner_id and l.workspace_id=e.workspace_id
      where e.workspace_id=p_workspace_id and l.is_active
        and (p_learner_id is null or e.learner_id=p_learner_id)
        and (p_action='student_ledger' or p_learner_id is not null or (not coalesce((l.metadata->>'is_test')::boolean,false) and not coalesce((l.metadata->>'exclude_from_parent_metrics')::boolean,false)))
        and (nullif(p_payload->>'before_id','') is null or e.id<(p_payload->>'before_id')::bigint)
        and (nullif(p_payload->>'source_type','') is null
          or (p_payload->>'source_type'='academic' and coalesce(nullif(e.source_type,''),'academic') in ('academic','quiz','quiz_attempt','learning','exam'))
          or (p_payload->>'source_type'<>'academic' and e.source_type=p_payload->>'source_type'))
        and (nullif(p_payload->>'category_id','') is null or e.metadata->>'category_id'=p_payload->>'category_id')
      order by e.id desc limit v_page_size
    ) e;
    if jsonb_array_length(v_page)=v_page_size then v_cursor := (v_page->(v_page_size-1)->>'id')::bigint; end if;
    return jsonb_build_object('ok',true,'ledger',v_page,'next_cursor',v_cursor);
  end if;

  if p_action in ('parent_catalog','student_catalog','return_events_list') then
    if p_action in ('parent_catalog','return_events_list') and not v_parent then return jsonb_build_object('error','PARENT_MANAGE_FORBIDDEN'); end if;
    select coalesce(array_agg(id),'{}'::uuid[]) into v_ids from public.learners where workspace_id = p_workspace_id and is_active and
      case when p_action = 'student_catalog' then id = p_learner_id when coalesce((p_payload->>'test_only')::boolean,false) then coalesce((metadata->>'is_test')::boolean,false) else not coalesce((metadata->>'is_test')::boolean,false) and not coalesce((metadata->>'exclude_from_parent_metrics')::boolean,false) end;
    if p_action in ('parent_catalog','return_events_list') then
      begin
        v_return_day := coalesce(nullif(p_payload->>'return_event_day','')::date,(v_now at time zone 'Europe/Istanbul')::date);
        v_return_before := nullif(p_payload->>'return_event_before_at','')::timestamptz;
        v_return_before_id := nullif(p_payload->>'return_event_before_id','')::uuid;
        v_page_size := greatest(1,least(100,coalesce((p_payload->>'return_event_page_size')::integer,50)));
      exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
        return jsonb_build_object('error','INVALID_INPUT');
      end;
      if not isfinite(v_return_day) or (v_return_before is null)<>(v_return_before_id is null)
        or (v_return_before is not null and not isfinite(v_return_before))
      then return jsonb_build_object('error','INVALID_INPUT'); end if;
      select coalesce(jsonb_agg(jsonb_build_object(
        'id',e.id,'occurred_at',e.occurred_at,'created_at',e.created_at,
        'awarded_learner_ids',(select coalesce(jsonb_agg(s.learner_id),'[]'::jsonb) from public.behavior_submissions s
          where s.workspace_id=p_workspace_id and s.return_event_id=e.id and s.status='approved' and s.learner_id=any(v_ids))
      ) order by e.occurred_at desc,e.id desc),'[]'::jsonb) into v_return_page from (
        select e.* from public.family_return_events e
        where e.workspace_id=p_workspace_id
          and e.occurred_at >= (v_return_day::timestamp at time zone 'Europe/Istanbul')
          and e.occurred_at < ((v_return_day+1)::timestamp at time zone 'Europe/Istanbul')
          and (v_return_before is null or (e.occurred_at,e.id)<(v_return_before,v_return_before_id))
        order by e.occurred_at desc,e.id desc limit v_page_size
      ) e;
      if jsonb_array_length(v_return_page)=v_page_size then
        v_return_cursor := jsonb_build_object('occurred_at',v_return_page->(v_page_size-1)->>'occurred_at','id',v_return_page->(v_page_size-1)->>'id');
      end if;
    end if;
    -- Page-only reads reuse the same authorization, visible-learner scope and
    -- keyset query, then stop before full catalog/history aggregates.
    if p_action='return_events_list' then
      return jsonb_build_object('ok',true,'return_events',v_return_page,
        'return_event_day',v_return_day,'return_event_next_cursor',v_return_cursor);
    end if;
    return jsonb_build_object(
      'ok',true,
      'return_events',case when v_parent then v_return_page else '[]'::jsonb end,
      'return_event_day',case when v_parent then v_return_day else null end,
      'return_event_next_cursor',case when v_parent then v_return_cursor else null end,
      'learners',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'display_name',display_name,'slug',slug,'is_test',coalesce((metadata->>'is_test')::boolean,false)) order by display_name),'[]'::jsonb) from public.learners where id = any(v_ids) and workspace_id = p_workspace_id),
      'inactive_scope_learners',case when v_parent then (select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'display_name',l.display_name) order by l.display_name),'[]'::jsonb) from public.learners l where l.workspace_id=p_workspace_id and not l.is_active and
        (case when coalesce((p_payload->>'test_only')::boolean,false) then coalesce((l.metadata->>'is_test')::boolean,false) else not coalesce((l.metadata->>'is_test')::boolean,false) and not coalesce((l.metadata->>'exclude_from_parent_metrics')::boolean,false) end) and
        (exists(select 1 from public.behavior_rule_learners scopes where scopes.workspace_id=p_workspace_id and scopes.learner_id=l.id) or exists(select 1 from public.reward_learner_scopes scopes where scopes.workspace_id=p_workspace_id and scopes.learner_id=l.id))) else '[]'::jsonb end,
      'states',(select coalesce(jsonb_agg(jsonb_build_object('learner_id',l.id,'xp',coalesce(s.xp,0),'reward_points',coalesce(s.reward_points,0),'current_level',coalesce(s.current_level,1),'current_streak',coalesce(s.current_streak,0),'longest_streak',coalesce(s.longest_streak,0))),'[]'::jsonb) from public.learners l left join public.learner_gamification_state s on s.learner_id=l.id and s.workspace_id=l.workspace_id where l.id=any(v_ids) and l.workspace_id=p_workspace_id),
      'categories',(select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at),'[]'::jsonb) from public.behavior_categories c where c.workspace_id=p_workspace_id and (v_parent or c.is_active)),
      'report_categories',case when v_parent then '[]'::jsonb else (
        select coalesce(jsonb_agg(jsonb_build_object('id',x.category_id,'title',x.category_title) order by x.category_title),'[]'::jsonb)
        from (
          select distinct on (q.category_id) q.category_id,q.category_title
          from (
            select coalesce(nullif(s.snapshot->>'category_id','')::uuid,r.category_id) as category_id,
                   coalesce(s.snapshot->>'category_title',c.title) as category_title,
                   s.requested_at,s.id
            from public.behavior_submissions s
            join public.behavior_rules r on r.id=s.rule_id and r.workspace_id=s.workspace_id
            join public.behavior_categories c on c.id=r.category_id and c.workspace_id=r.workspace_id
            where s.workspace_id=p_workspace_id and s.learner_id=p_learner_id
          ) q
          order by q.category_id,q.requested_at desc,q.id desc
        ) x
      ) end,
      'report_rules',case when v_parent then '[]'::jsonb else (
        select coalesce(jsonb_agg(jsonb_build_object('id',x.rule_id,'title',x.rule_title) order by x.rule_title),'[]'::jsonb)
        from (
          select distinct on (s.rule_id) s.rule_id,coalesce(s.snapshot->>'rule_title',r.title) as rule_title
          from public.behavior_submissions s
          join public.behavior_rules r on r.id=s.rule_id and r.workspace_id=s.workspace_id
          where s.workspace_id=p_workspace_id and s.learner_id=p_learner_id
          order by s.rule_id,s.requested_at desc,s.id desc
        ) x
      ) end,
      'badges',case when v_parent then (select coalesce(jsonb_agg(jsonb_build_object('code',code,'title',title,'is_active',is_active) order by title),'[]'::jsonb) from public.gamification_badges where workspace_id=p_workspace_id) else '[]'::jsonb end,
      'rules',(select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object('category_title',c.title,'learner_ids',(select coalesce(jsonb_agg(rl.learner_id),'[]'::jsonb) from public.behavior_rule_learners rl where rl.rule_id=r.id and rl.workspace_id=p_workspace_id and (v_parent or rl.learner_id=p_learner_id))) order by r.created_at),'[]'::jsonb) from public.behavior_rules r join public.behavior_categories c on c.id=r.category_id and c.workspace_id=r.workspace_id where r.workspace_id=p_workspace_id and (v_parent or (r.is_active and c.is_active and r.self_report_allowed and ((r.learner_scope='all' and not coalesce((v_learner.metadata->>'is_test')::boolean,false)) or exists(select 1 from public.behavior_rule_learners rl where rl.rule_id=r.id and rl.workspace_id=p_workspace_id and rl.learner_id=p_learner_id))))),
      'rewards',(select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object('learner_ids',(select coalesce(jsonb_agg(rl.learner_id),'[]'::jsonb) from public.reward_learner_scopes rl where rl.reward_id=r.id and rl.workspace_id=p_workspace_id and (v_parent or rl.learner_id=p_learner_id))) || case when p_action='student_catalog' then public.flh_family_reward_eligibility(p_workspace_id,p_learner_id,r.id) else '{}'::jsonb end order by r.created_at),'[]'::jsonb) from public.gamification_rewards r where r.workspace_id=p_workspace_id and (v_parent or (r.is_active and ((r.learner_scope='all' and not coalesce((v_learner.metadata->>'is_test')::boolean,false)) or exists(select 1 from public.reward_learner_scopes rl where rl.reward_id=r.id and rl.workspace_id=p_workspace_id and rl.learner_id=p_learner_id))))),
      'submissions',(select coalesce(jsonb_agg(to_jsonb(x) order by x.requested_at desc),'[]'::jsonb) from (select s.*, coalesce(s.snapshot->>'rule_title',r.title) as rule_title, coalesce(s.snapshot->>'category_title',c.title) as category_title, exists(select 1 from public.behavior_submissions approved where approved.workspace_id=s.workspace_id and approved.learner_id=s.learner_id and approved.rule_id=s.rule_id and approved.status='approved' and (case when s.rule_id=v_parent_return_rule then s.return_event_id is not null and approved.return_event_id=s.return_event_id else approved.occurred_at=s.occurred_at end) and approved.id<>s.id) as possible_duplicate from public.behavior_submissions s join public.behavior_rules r on r.id=s.rule_id and r.workspace_id=s.workspace_id join public.behavior_categories c on c.id=r.category_id and c.workspace_id=r.workspace_id where s.workspace_id=p_workspace_id and s.learner_id=any(v_ids) and (s.status='pending' or s.id in(select id from public.behavior_submissions where workspace_id=p_workspace_id and learner_id=any(v_ids) order by requested_at desc limit 200)) order by s.requested_at desc) x),
      'claims',(select coalesce(jsonb_agg(to_jsonb(x) order by x.requested_at desc),'[]'::jsonb) from (select c.*,coalesce(c.metadata->>'reward_title',r.title) as reward_title from public.reward_claims c join public.gamification_rewards r on r.id=c.reward_id and r.workspace_id=c.workspace_id where c.workspace_id=p_workspace_id and c.learner_id=any(v_ids) and (c.status in ('pending','approved') or c.id in(select id from public.reward_claims where workspace_id=p_workspace_id and learner_id=any(v_ids) order by requested_at desc limit 200)) order by c.requested_at desc) x),
      'ledger',(select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc,e.id desc),'[]'::jsonb) from (select * from public.gamification_events where workspace_id=p_workspace_id and learner_id=any(v_ids) order by created_at desc,id desc limit 100) e),
      'breakdown',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (select learner_id, metadata->>'category_id' as category_id, coalesce(metadata->>'category_title',case when source_type='reward_claim' then 'الجوائز' when source_type='manual_adjustment' then 'تعديل موثّق' else 'التعلّم' end) as category_title,case when coalesce(nullif(source_type,''),'academic') in ('academic','quiz','quiz_attempt','learning','exam') then 'academic' else source_type end as source_type,sum(reward_points_delta) as points from public.gamification_events where workspace_id=p_workspace_id and learner_id=any(v_ids) group by learner_id,metadata->>'category_id',coalesce(metadata->>'category_title',case when source_type='reward_claim' then 'الجوائز' when source_type='manual_adjustment' then 'تعديل موثّق' else 'التعلّم' end),case when coalesce(nullif(source_type,''),'academic') in ('academic','quiz','quiz_attempt','learning','exam') then 'academic' else source_type end) x)
    );
  end if;

  if p_action = 'category_save' then
    v_id := coalesce(nullif(p_payload->>'id','')::uuid,gen_random_uuid());
    if p_payload ? 'id' and not exists(select 1 from public.behavior_categories where id=v_id and workspace_id=p_workspace_id) then return jsonb_build_object('error','CATEGORY_NOT_FOUND'); end if;
    insert into public.behavior_categories(id,workspace_id,title,description,is_active) values(v_id,p_workspace_id,btrim(p_payload->>'title'),coalesce(p_payload->>'description',''),coalesce((p_payload->>'is_active')::boolean,true)) on conflict(id) do update set title=excluded.title,description=excluded.description,is_active=excluded.is_active,updated_at=v_now where behavior_categories.workspace_id=p_workspace_id returning to_jsonb(behavior_categories.*) into v_result;
    return jsonb_build_object('ok',true,'category',v_result);
  end if;

  if p_action in ('rule_save','reward_save') then
    v_id := coalesce(nullif(p_payload->>'id','')::uuid,gen_random_uuid());
    v_scope := coalesce(p_payload->>'learner_scope','all');
    if v_scope not in ('all','selected') or jsonb_typeof(coalesce(p_payload->'learner_ids','[]'::jsonb)) <> 'array' then return jsonb_build_object('error','INVALID_SCOPE'); end if;
    select coalesce(array_agg(distinct id::uuid),'{}'::uuid[]) into v_scope_ids from jsonb_array_elements_text(coalesce(p_payload->'learner_ids','[]'::jsonb)) id;
    -- Existing assignments survive learner deactivation; new assignments require active learners.
    if (v_scope='selected' and cardinality(v_scope_ids)=0) or exists(
      select 1 from unnest(v_scope_ids) scope_learner(learner_id)
      left join public.learners l on l.id=scope_learner.learner_id and l.workspace_id=p_workspace_id
      where l.id is null or (not l.is_active and not (
        p_payload ? 'id' and case when p_action='rule_save'
          then exists(select 1 from public.behavior_rule_learners scope where scope.rule_id=v_id and scope.workspace_id=p_workspace_id and scope.learner_id=l.id)
          else exists(select 1 from public.reward_learner_scopes scope where scope.reward_id=v_id and scope.workspace_id=p_workspace_id and scope.learner_id=l.id)
        end
      ))
    ) then return jsonb_build_object('error','INVALID_SCOPE'); end if;
    if p_action='rule_save' then
      if p_payload ? 'id' and not exists(select 1 from public.behavior_rules where id=v_id and workspace_id=p_workspace_id) then return jsonb_build_object('error','RULE_NOT_FOUND'); end if;
      v_cadence := coalesce(p_payload->>'cadence','day');
      -- This approved rule's fixed price and shared cap are not editable policy knobs.
      if v_id=v_parent_return_rule and (
        coalesce(p_payload->>'title','')<>'تقبيل يد الأب أو الأم عند العودة إلى المنزل'
        or coalesce((p_payload->>'base_points')::integer,0)<>2
        or coalesce((p_payload->>'initiative_bonus_points')::integer,0)<>0
        or v_cadence<>'day' or coalesce((p_payload->>'max_awards')::integer,1)<>2
        or not exists(select 1 from public.behavior_categories where id=(p_payload->>'category_id')::uuid and workspace_id=p_workspace_id and code='parental_respect')
      ) then return jsonb_build_object('error','INVALID_INPUT'); end if;
      insert into public.behavior_rules(id,workspace_id,category_id,title,description,base_points,initiative_bonus_points,learner_scope,cadence,max_awards,self_report_allowed,parent_approval_required,is_active)
      values(v_id,p_workspace_id,(p_payload->>'category_id')::uuid,btrim(p_payload->>'title'),coalesce(p_payload->>'description',''),coalesce((p_payload->>'base_points')::integer,0),coalesce((p_payload->>'initiative_bonus_points')::integer,0),v_scope,v_cadence,case when v_cadence='unlimited' then null else coalesce((p_payload->>'max_awards')::integer,1) end,coalesce((p_payload->>'self_report_allowed')::boolean,false),coalesce((p_payload->>'parent_approval_required')::boolean,true),coalesce((p_payload->>'is_active')::boolean,true))
      on conflict(id) do update set category_id=excluded.category_id,title=excluded.title,description=excluded.description,base_points=excluded.base_points,initiative_bonus_points=excluded.initiative_bonus_points,learner_scope=excluded.learner_scope,cadence=excluded.cadence,max_awards=excluded.max_awards,self_report_allowed=excluded.self_report_allowed,parent_approval_required=excluded.parent_approval_required,is_active=excluded.is_active,updated_at=v_now where behavior_rules.workspace_id=p_workspace_id returning to_jsonb(behavior_rules.*) into v_result;
      delete from public.behavior_rule_learners where rule_id=v_id and workspace_id=p_workspace_id;
      if v_scope='selected' then insert into public.behavior_rule_learners(workspace_id,rule_id,learner_id) select p_workspace_id,v_id,id from unnest(v_scope_ids) id; end if;
      return jsonb_build_object('ok',true,'rule',v_result || jsonb_build_object('learner_ids',to_jsonb(v_scope_ids)));
    end if;
    if p_payload ? 'id' and not exists(select 1 from public.gamification_rewards where id=v_id and workspace_id=p_workspace_id) then return jsonb_build_object('error','REWARD_NOT_FOUND'); end if;
    v_criteria := coalesce(p_payload->'criteria','{}'::jsonb);
    if not public.flh_family_reward_criteria_valid(v_criteria) then return jsonb_build_object('error','INVALID_CRITERIA'); end if;
    if v_criteria ? 'required_badge_codes' then
      if exists(select 1 from jsonb_array_elements(v_criteria->'required_badge_codes') x where jsonb_typeof(x)<>'string' or not exists(select 1 from public.gamification_badges where workspace_id=p_workspace_id and code=x#>>'{}')) then return jsonb_build_object('error','INVALID_CRITERIA'); end if;
    end if;
    if length(coalesce(p_payload->>'title','')) > 120 or length(coalesce(p_payload->>'description','')) > 1000 or length(btrim(coalesce(p_payload->>'title','')))=0 then return jsonb_build_object('error','INVALID_INPUT'); end if;
    insert into public.gamification_rewards(id,workspace_id,title,description,reward_type,required_level,required_reward_points,criteria,parent_approval_required,is_active,max_redemptions_per_learner,available_from,available_until,learner_scope)
    values(v_id,p_workspace_id,btrim(p_payload->>'title'),coalesce(p_payload->>'description',''),coalesce(p_payload->>'reward_type','custom'),nullif(p_payload->>'required_level','')::integer,nullif(p_payload->>'required_reward_points','')::integer,v_criteria,true,coalesce((p_payload->>'is_active')::boolean,true),nullif(p_payload->>'max_redemptions_per_learner','')::integer,nullif(p_payload->>'available_from','')::timestamptz,nullif(p_payload->>'available_until','')::timestamptz,v_scope)
    on conflict(id) do update set title=excluded.title,description=excluded.description,reward_type=excluded.reward_type,required_level=excluded.required_level,required_reward_points=excluded.required_reward_points,criteria=excluded.criteria,parent_approval_required=true,is_active=excluded.is_active,max_redemptions_per_learner=excluded.max_redemptions_per_learner,available_from=excluded.available_from,available_until=excluded.available_until,learner_scope=excluded.learner_scope,updated_at=v_now where gamification_rewards.workspace_id=p_workspace_id returning to_jsonb(gamification_rewards.*) into v_result;
    delete from public.reward_learner_scopes where reward_id=v_id and workspace_id=p_workspace_id;
    if v_scope='selected' then insert into public.reward_learner_scopes(workspace_id,reward_id,learner_id) select p_workspace_id,v_id,id from unnest(v_scope_ids) id; end if;
    return jsonb_build_object('ok',true,'reward',v_result || jsonb_build_object('learner_ids',to_jsonb(v_scope_ids)));
  end if;

  if p_action in ('behavior_record','behavior_submit','behavior_review') then
    if p_action='behavior_review' then
      select * into v_submission from public.behavior_submissions where id=(p_payload->>'submission_id')::uuid and workspace_id=p_workspace_id for update;
      if not found then return jsonb_build_object('error','SUBMISSION_NOT_FOUND'); end if;
      v_now := clock_timestamp();
      if p_payload ? 'return_event_id' and v_submission.rule_id<>v_parent_return_rule then return jsonb_build_object('error','INVALID_RETURN_EVENT'); end if;
      v_decision := p_payload->>'decision';
      if v_decision not in ('approved','rejected') or v_decision is null then return jsonb_build_object('error','INVALID_DECISION'); end if;
      if v_submission.status<>'pending' then
        if v_submission.status=v_decision then
          if v_submission.rule_id=v_parent_return_rule and nullif(p_payload->>'return_event_id','') is not null
            and (p_payload->>'return_event_id')::uuid is distinct from v_submission.return_event_id
          then return jsonb_build_object('error','RETURN_EVENT_IMMUTABLE'); end if;
          return jsonb_build_object('ok',true,'submission',to_jsonb(v_submission),'already_reviewed',true);
        end if;
        return jsonb_build_object('error','INVALID_TRANSITION');
      end if;
      if v_decision='rejected' then
        update public.behavior_submissions set status='rejected',reviewer_id=p_actor_id,reviewed_at=v_now,review_reason=coalesce(p_payload->>'reason','') where id=v_submission.id returning * into v_submission;
        return jsonb_build_object('ok',true,'submission',to_jsonb(v_submission));
      end if;
      p_learner_id := v_submission.learner_id;
      select * into v_rule from public.behavior_rules where id=v_submission.rule_id and workspace_id=p_workspace_id for share;
    else
      if p_learner_id is null then return jsonb_build_object('error','LEARNER_NOT_FOUND'); end if;
      v_key := p_payload->>'idempotency_key';
      if v_key is null or length(v_key) not between 8 and 200 then return jsonb_build_object('error','IDEMPOTENCY_KEY_REQUIRED'); end if;
      select * into v_rule from public.behavior_rules where id=(p_payload->>'rule_id')::uuid and workspace_id=p_workspace_id for share;
    end if;
    if v_rule.id is null then return jsonb_build_object('error','RULE_NOT_FOUND'); end if;
    if p_payload ? 'return_event_id' and (v_rule.id<>v_parent_return_rule or p_action='behavior_submit') then return jsonb_build_object('error','INVALID_RETURN_EVENT'); end if;
    if p_action='behavior_record' and v_rule.id=v_parent_return_rule then
      begin v_return_id := nullif(p_payload->>'return_event_id','')::uuid;
      exception when invalid_text_representation then return jsonb_build_object('error','INVALID_RETURN_EVENT'); end;
    end if;
    select * into v_category from public.behavior_categories where id=v_rule.category_id and workspace_id=p_workspace_id for share;
    -- Match academic finish's learner lock; state-only locks would lose updates.
    select * into v_learner from public.learners where id=p_learner_id and workspace_id=p_workspace_id and is_active for update;
    if not found then return jsonb_build_object('error','LEARNER_NOT_FOUND'); end if;
    v_now := clock_timestamp();
    -- The prior SHARE lock keeps configuration stable; reread after any wait.
    select * into v_rule from public.behavior_rules where id=v_rule.id and workspace_id=p_workspace_id;
    if p_action<>'behavior_review' then
      v_explicit_occurred_at := nullif(p_payload->>'occurred_at','')::timestamptz;
      -- Preserve optional-time intent separately from the server-assigned occurrence time.
      -- Equivalent timezone forms compare by instant; omitted times stay null on retry.
      v_request_payload := jsonb_build_object('action',p_action,'actor_id',p_actor_id,'learner_id',p_learner_id,'rule_id',v_rule.id,'initiative',coalesce((p_payload->>'initiative')::boolean,false),'adhkar_completed',coalesce((p_payload->>'adhkar_completed')::boolean,false),'congregation_completed',coalesce((p_payload->>'congregation_completed')::boolean,false),'mosque_completed',coalesce((p_payload->>'mosque_completed')::boolean,false),'sunnah_completed',coalesce((p_payload->>'sunnah_completed')::boolean,false),'reason',coalesce(p_payload->>'reason',''),'occurred_at',extract(epoch from v_explicit_occurred_at))
        || case when p_action='behavior_record' and v_rule.id=v_parent_return_rule then jsonb_build_object('return_event_id',v_return_id) else '{}'::jsonb end;
      select * into v_submission
      from public.behavior_submissions
      where workspace_id=p_workspace_id
        and learner_id=p_learner_id
        and (
          idempotency_key=v_key
          or coalesce(request_payload->'idempotency_aliases','{}'::jsonb) ? v_key
        )
      order by case when idempotency_key=v_key then 0 else 1 end, requested_at asc, id asc
      limit 1;
      if found then
        if v_submission.idempotency_key=v_key then
          if (
            jsonb_build_object(
              'adhkar_completed',false,
              'congregation_completed',false,
              'mosque_completed',false,
              'sunnah_completed',false
            )
            || (coalesce(v_submission.request_payload,'{}'::jsonb)-'idempotency_aliases')
          ) is distinct from v_request_payload then
            return jsonb_build_object('error','IDEMPOTENCY_CONFLICT');
          end if;
        elsif (
          jsonb_build_object(
            'adhkar_completed',false,
            'congregation_completed',false,
            'mosque_completed',false,
            'sunnah_completed',false
          )
          || coalesce(v_submission.request_payload->'idempotency_aliases'->v_key,'{}'::jsonb)
        ) is distinct from v_request_payload then
          return jsonb_build_object('error','IDEMPOTENCY_CONFLICT');
        end if;
        return jsonb_build_object('ok',true,'submission',to_jsonb(v_submission),'already_recorded',true);
      end if;
    end if;
    select * into v_category from public.behavior_categories where id=v_rule.category_id and workspace_id=p_workspace_id;
    if not v_rule.is_active or not v_category.is_active then return jsonb_build_object('error','RULE_INACTIVE'); end if;
    if (v_rule.learner_scope='all' and coalesce((v_learner.metadata->>'is_test')::boolean,false)) or (v_rule.learner_scope='selected' and not exists(select 1 from public.behavior_rule_learners where rule_id=v_rule.id and workspace_id=p_workspace_id and learner_id=p_learner_id)) then return jsonb_build_object('error','RULE_SCOPE_FORBIDDEN'); end if;
    if p_action='behavior_submit' and not v_rule.self_report_allowed then return jsonb_build_object('error','SELF_REPORT_FORBIDDEN'); end if;
    if v_rule.id=v_parent_return_rule and p_action in ('behavior_record','behavior_review') then
      begin v_return_id := nullif(p_payload->>'return_event_id','')::uuid;
      exception when invalid_text_representation then return jsonb_build_object('error','INVALID_RETURN_EVENT'); end;
      if v_return_id is null then return jsonb_build_object('error','RETURN_EVENT_REQUIRED'); end if;
      select * into v_return_event from public.family_return_events where id=v_return_id and workspace_id=p_workspace_id for share;
      if not found then return jsonb_build_object('error','RETURN_EVENT_NOT_FOUND'); end if;
      if not isfinite(v_return_event.occurred_at) or v_return_event.occurred_at>clock_timestamp() then return jsonb_build_object('error','INVALID_RETURN_EVENT'); end if;
    end if;
    if p_action<>'behavior_review' then
      if coalesce(v_explicit_occurred_at,v_now)>v_now then return jsonb_build_object('error','INVALID_OCCURRED_AT'); end if;
      if coalesce((p_payload->>'adhkar_completed')::boolean,false) and coalesce(v_rule.adhkar_bonus_points,0)=0 then return jsonb_build_object('error','INVALID_INPUT'); end if;
      if coalesce((p_payload->>'congregation_completed')::boolean,false) and coalesce(v_rule.congregation_bonus_points,0)=0 then return jsonb_build_object('error','INVALID_INPUT'); end if;
      if coalesce((p_payload->>'mosque_completed')::boolean,false) and coalesce(v_rule.mosque_bonus_points,0)=0 then return jsonb_build_object('error','INVALID_INPUT'); end if;
      if coalesce((p_payload->>'sunnah_completed')::boolean,false) and coalesce(v_rule.sunnah_bonus_points,0)=0 then return jsonb_build_object('error','INVALID_INPUT'); end if;
      if v_rule.id=v_parent_return_rule and (
        coalesce((p_payload->>'initiative')::boolean,false)
        or coalesce((p_payload->>'adhkar_completed')::boolean,false)
        or coalesce((p_payload->>'congregation_completed')::boolean,false)
        or coalesce((p_payload->>'mosque_completed')::boolean,false)
        or coalesce((p_payload->>'sunnah_completed')::boolean,false)
      ) then return jsonb_build_object('error','INVALID_INPUT'); end if;
      if length(coalesce(p_payload->>'reason',''))>1000 then return jsonb_build_object('error','INVALID_INPUT'); end if;
      if p_action='behavior_submit' then
        select * into v_submission
        from public.behavior_submissions
        where workspace_id=p_workspace_id
          and learner_id=p_learner_id
          and rule_id=v_rule.id
          and status='pending'
          and occurred_at=coalesce(v_explicit_occurred_at,v_now)
        order by requested_at asc, id asc
        limit 1;
        if found then
          update public.behavior_submissions
          set request_payload =
            coalesce(request_payload,'{}'::jsonb)
            || jsonb_build_object(
              'idempotency_aliases',
              coalesce(request_payload->'idempotency_aliases','{}'::jsonb)
              || jsonb_build_object(v_key,v_request_payload)
            )
          where id=v_submission.id
          returning * into v_submission;
          return jsonb_build_object('ok',true,'submission',to_jsonb(v_submission),'duplicate_pending',true);
        end if;
      end if;
      -- Prospective server snapshot. Pending award columns and spendable points remain zero.
      v_points := case when v_rule.id=v_parent_return_rule then 2 else v_rule.base_points end;
      v_bonus := case when v_rule.id<>v_parent_return_rule and coalesce((p_payload->>'initiative')::boolean,false) then v_rule.initiative_bonus_points else 0 end;
      v_adhkar_bonus := case when v_rule.id<>v_parent_return_rule and coalesce((p_payload->>'adhkar_completed')::boolean,false) then v_rule.adhkar_bonus_points else 0 end;
      v_congregation_bonus := case when v_rule.id<>v_parent_return_rule and coalesce((p_payload->>'congregation_completed')::boolean,false) then v_rule.congregation_bonus_points else 0 end;
      v_mosque_bonus := case when v_rule.id<>v_parent_return_rule and coalesce((p_payload->>'mosque_completed')::boolean,false) then v_rule.mosque_bonus_points else 0 end;
      v_sunnah_bonus := case when v_rule.id<>v_parent_return_rule and coalesce((p_payload->>'sunnah_completed')::boolean,false) then v_rule.sunnah_bonus_points else 0 end;
      v_snapshot := jsonb_build_object(
        'policy_version','flh-010-v1.5','captured_at',v_now,'status','pending',
        'category_id',v_category.id,'category_title',v_category.title,'rule_id',v_rule.id,'rule_title',v_rule.title,
        'base_points',v_points,'initiative_bonus_points',v_bonus,'adhkar_bonus_points',v_adhkar_bonus,
        'congregation_bonus_points',v_congregation_bonus,'mosque_bonus_points',v_mosque_bonus,'sunnah_bonus_points',v_sunnah_bonus,
        'total_points',v_points+v_bonus+v_adhkar_bonus+v_congregation_bonus+v_mosque_bonus+v_sunnah_bonus,
        'initiative',coalesce((p_payload->>'initiative')::boolean,false),
        'adhkar_completed',coalesce((p_payload->>'adhkar_completed')::boolean,false),
        'congregation_completed',coalesce((p_payload->>'congregation_completed')::boolean,false),
        'mosque_completed',coalesce((p_payload->>'mosque_completed')::boolean,false),
        'sunnah_completed',coalesce((p_payload->>'sunnah_completed')::boolean,false)
      );
      insert into public.behavior_submissions(workspace_id,learner_id,rule_id,initiative,adhkar_completed,congregation_completed,mosque_completed,sunnah_completed,occurred_at,requester_type,requester_id,reason,idempotency_key,requested_at,request_payload,snapshot)
      values(p_workspace_id,p_learner_id,v_rule.id,coalesce((p_payload->>'initiative')::boolean,false),coalesce((p_payload->>'adhkar_completed')::boolean,false),coalesce((p_payload->>'congregation_completed')::boolean,false),coalesce((p_payload->>'mosque_completed')::boolean,false),coalesce((p_payload->>'sunnah_completed')::boolean,false),coalesce(v_explicit_occurred_at,v_now),case when p_action='behavior_submit' then 'learner' else 'parent' end,case when p_action='behavior_submit' then null else p_actor_id end,coalesce(p_payload->>'reason',''),v_key,v_now,v_request_payload,v_snapshot) returning * into v_submission;
      -- AC06 always requires parent review, regardless of configurable policy flag.
      if p_action='behavior_submit' then return jsonb_build_object('ok',true,'submission',to_jsonb(v_submission)); end if;
    end if;
    if v_rule.id<>v_parent_return_rule and p_action in ('behavior_review','behavior_record') and exists(
      select 1
      from public.behavior_submissions existing
      where existing.workspace_id=p_workspace_id
        and existing.learner_id=p_learner_id
        and existing.rule_id=v_rule.id
        and existing.status='approved'
        and existing.occurred_at=v_submission.occurred_at
        and existing.id<>v_submission.id
    ) then
      -- A direct parent record has already inserted a pending row in this transaction.
      -- Remove only that newly created row before returning the stable duplicate conflict.
      if p_action='behavior_record' then delete from public.behavior_submissions where id=v_submission.id; end if;
      return jsonb_build_object('error','DUPLICATE_OCCURRENCE');
    end if;
    if v_rule.id=v_parent_return_rule then
      if v_submission.initiative or v_submission.adhkar_completed or v_submission.congregation_completed
        or v_submission.mosque_completed or v_submission.sunnah_completed
      then
        if p_action='behavior_record' then delete from public.behavior_submissions where id=v_submission.id; end if;
        return jsonb_build_object('error','INVALID_INPUT');
      end if;
      -- A parent's canonical occasion, not a claim clock/key, identifies this award.
      if exists(select 1 from public.behavior_submissions s
        where s.workspace_id=p_workspace_id and s.learner_id=p_learner_id and s.rule_id=v_parent_return_rule
          and s.status='approved' and s.return_event_id=v_return_id and s.id<>v_submission.id)
      then
        if p_action='behavior_record' then delete from public.behavior_submissions where id=v_submission.id; end if;
        return jsonb_build_object('error','DUPLICATE_OCCURRENCE');
      end if;
      -- Both parents share one learner bucket under the existing financial lock.
      -- Legacy NULL-event awards continue to consume their original local day, unchanged.
      select count(*) into v_count from public.behavior_submissions s
      left join public.family_return_events e on e.id=s.return_event_id and e.workspace_id=s.workspace_id
      where s.workspace_id=p_workspace_id and s.learner_id=p_learner_id and s.rule_id=v_parent_return_rule and s.status='approved'
        and (coalesce(e.occurred_at,s.occurred_at) at time zone 'Europe/Istanbul')::date=(v_return_event.occurred_at at time zone 'Europe/Istanbul')::date;
      if v_count>=2 then
        if p_action='behavior_record' then delete from public.behavior_submissions where id=v_submission.id; end if;
        return jsonb_build_object('error','CADENCE_LIMIT');
      end if;
    elsif v_rule.cadence<>'unlimited' then
      v_window := date_trunc(case when v_rule.cadence='day' then 'day' else 'week' end,v_now at time zone 'UTC') at time zone 'UTC';
      select count(*) into v_count from public.behavior_submissions where workspace_id=p_workspace_id and learner_id=p_learner_id and rule_id=v_rule.id and status='approved' and approved_at>=v_window;
      if v_count>=v_rule.max_awards then
        -- Parent direct recording must not leave a pending row on failed award.
        if p_action='behavior_record' then delete from public.behavior_submissions where id=v_submission.id; end if;
        return jsonb_build_object('error','CADENCE_LIMIT');
      end if;
    end if;
    v_captured := v_submission.snapshot;
    v_has_capture := coalesce(v_captured->>'policy_version'='flh-010-v1.5',false);
    if v_has_capture then
      -- Only our server-created complete integer snapshot is eligible; malformed marked data fails closed.
      if v_captured->>'status' is distinct from 'pending' or v_captured->>'rule_id' is distinct from v_rule.id::text
        or exists(select 1 from unnest(array['base_points','initiative_bonus_points','adhkar_bonus_points','congregation_bonus_points','mosque_bonus_points','sunnah_bonus_points']) component
          where jsonb_typeof(v_captured->component) is distinct from 'number'
            or coalesce(v_captured->>component,'') !~ '^[0-9]{1,6}$'
            or (v_captured->>component)::integer not between 0 and 100000)
        or jsonb_typeof(v_captured->'total_points') is distinct from 'number'
        or coalesce(v_captured->>'total_points','') !~ '^[0-9]{1,6}$'
      then return jsonb_build_object('error','INVALID_INPUT'); end if;
      v_points := (v_captured->>'base_points')::integer;
      v_bonus := (v_captured->>'initiative_bonus_points')::integer;
      v_adhkar_bonus := (v_captured->>'adhkar_bonus_points')::integer;
      v_congregation_bonus := (v_captured->>'congregation_bonus_points')::integer;
      v_mosque_bonus := (v_captured->>'mosque_bonus_points')::integer;
      v_sunnah_bonus := (v_captured->>'sunnah_bonus_points')::integer;
      if (v_captured->>'total_points')::integer<>v_points+v_bonus+v_adhkar_bonus+v_congregation_bonus+v_mosque_bonus+v_sunnah_bonus
      then return jsonb_build_object('error','INVALID_INPUT'); end if;
    else
      -- Legacy pending rows are not backfilled; retain their existing approval calculation.
      v_points := v_rule.base_points;
      v_bonus := case when v_submission.initiative then v_rule.initiative_bonus_points else 0 end;
      v_adhkar_bonus := case when v_submission.adhkar_completed then coalesce(v_rule.adhkar_bonus_points,0) else 0 end;
      v_congregation_bonus := case when v_submission.congregation_completed then coalesce(v_rule.congregation_bonus_points,0) else 0 end;
      v_mosque_bonus := case when v_submission.mosque_completed then coalesce(v_rule.mosque_bonus_points,0) else 0 end;
      v_sunnah_bonus := case when v_submission.sunnah_completed then coalesce(v_rule.sunnah_bonus_points,0) else 0 end;
    end if;
    if v_rule.id=v_parent_return_rule then
      v_points := 2; v_bonus := 0; v_adhkar_bonus := 0; v_congregation_bonus := 0; v_mosque_bonus := 0; v_sunnah_bonus := 0;
    end if;
    v_snapshot := coalesce(v_submission.snapshot,'{}'::jsonb)||jsonb_build_object('category_id',coalesce(v_submission.snapshot->'category_id',to_jsonb(v_category.id)),'category_title',coalesce(v_submission.snapshot->>'category_title',v_category.title),'rule_id',v_rule.id,'rule_title',coalesce(v_submission.snapshot->>'rule_title',v_rule.title),'base_points',v_points,'initiative_bonus_points',v_bonus,'adhkar_completed',v_submission.adhkar_completed,'adhkar_bonus_points',v_adhkar_bonus,'congregation_completed',v_submission.congregation_completed,'congregation_bonus_points',v_congregation_bonus,'mosque_completed',v_submission.mosque_completed,'mosque_bonus_points',v_mosque_bonus,'sunnah_completed',v_submission.sunnah_completed,'sunnah_bonus_points',v_sunnah_bonus,'total_points',v_points+v_bonus+v_adhkar_bonus+v_congregation_bonus+v_mosque_bonus+v_sunnah_bonus,'requester_type',v_submission.requester_type,'requester_id',v_submission.requester_id,'requester_learner_id',case when v_submission.requester_type='learner' then p_learner_id else null end,'requester',jsonb_build_object('type',v_submission.requester_type,'id',case when v_submission.requester_type='learner' then p_learner_id else v_submission.requester_id end),'reviewer',p_actor_id,'reviewer_id',p_actor_id,'occurred_at',v_submission.occurred_at,'approved_at',v_now,'status','approved','is_test',coalesce((v_learner.metadata->>'is_test')::boolean,false));
    if v_rule.id=v_parent_return_rule then
      v_snapshot := v_snapshot||jsonb_build_object('return_event_id',v_return_event.id,'verified_occurred_at',v_return_event.occurred_at,
        'verified_event_day',(v_return_event.occurred_at at time zone 'Europe/Istanbul')::date,'return_event_policy','flh-010-v1.7');
    end if;
    insert into public.learner_gamification_state(workspace_id,learner_id,reward_points) values(p_workspace_id,p_learner_id,v_points+v_bonus+v_adhkar_bonus+v_congregation_bonus+v_mosque_bonus+v_sunnah_bonus) on conflict(learner_id) do update set reward_points=learner_gamification_state.reward_points+excluded.reward_points returning reward_points into v_balance;
    insert into public.gamification_events(workspace_id,learner_id,event_type,xp_delta,reward_points_delta,source_type,source_id,reason,metadata,created_at) values(p_workspace_id,p_learner_id,'other',0,v_points+v_bonus+v_adhkar_bonus+v_congregation_bonus+v_mosque_bonus+v_sunnah_bonus,'family_behavior',v_submission.id::text,coalesce(nullif(v_submission.reason,''),v_rule.title),v_snapshot,v_now);
    update public.behavior_submissions set return_event_id=case when v_rule.id=v_parent_return_rule then v_return_id else null end,status='approved',reviewer_id=p_actor_id,reviewed_at=v_now,approved_at=v_now,review_reason=coalesce(p_payload->>'reason',''),base_points=v_points,initiative_bonus_points=v_bonus,adhkar_bonus_points=v_adhkar_bonus,congregation_bonus_points=v_congregation_bonus,mosque_bonus_points=v_mosque_bonus,sunnah_bonus_points=v_sunnah_bonus,total_points=v_points+v_bonus+v_adhkar_bonus+v_congregation_bonus+v_mosque_bonus+v_sunnah_bonus,snapshot=v_snapshot where id=v_submission.id returning * into v_submission;
    return jsonb_build_object('ok',true,'submission',to_jsonb(v_submission),'reward_points',v_balance);
  end if;

  if p_action in ('reward_request','reward_review','reward_redeem') then
    if p_action<>'reward_request' then
      select * into v_claim from public.reward_claims where id=(p_payload->>'claim_id')::uuid and workspace_id=p_workspace_id for update;
      if not found then return jsonb_build_object('error','CLAIM_NOT_FOUND'); end if;
      v_now := clock_timestamp();
      if p_action='reward_redeem' then
        if v_claim.status='redeemed' then return jsonb_build_object('ok',true,'claim',to_jsonb(v_claim),'already_redeemed',true); end if;
        if v_claim.status<>'approved' then return jsonb_build_object('error','CLAIM_NOT_APPROVED'); end if;
        update public.reward_claims set status='redeemed',redeemed_at=v_now,metadata=metadata||jsonb_build_object('redeemed_by',p_actor_id) where id=v_claim.id returning * into v_claim;
        return jsonb_build_object('ok',true,'claim',to_jsonb(v_claim));
      end if;
      v_decision := p_payload->>'decision';
      if v_decision not in ('approved','rejected') or v_decision is null then return jsonb_build_object('error','INVALID_DECISION'); end if;
      if v_claim.status<>'pending' then
        if v_claim.status=v_decision or (v_claim.status='redeemed' and v_decision='approved') then return jsonb_build_object('ok',true,'claim',to_jsonb(v_claim),'already_reviewed',true); end if;
        return jsonb_build_object('error','INVALID_TRANSITION');
      end if;
      if v_decision='rejected' then
        update public.reward_claims set status='rejected',reviewed_by=p_actor_id,reviewed_at=v_now,note=coalesce(p_payload->>'reason','') where id=v_claim.id returning * into v_claim;
        return jsonb_build_object('ok',true,'claim',to_jsonb(v_claim));
      end if;
      p_learner_id := v_claim.learner_id;
      select * into v_reward from public.gamification_rewards where id=v_claim.reward_id and workspace_id=p_workspace_id for share;
    else
      v_key := p_payload->>'idempotency_key';
      if v_key is null or length(v_key) not between 8 and 200 then return jsonb_build_object('error','IDEMPOTENCY_KEY_REQUIRED'); end if;
      select * into v_reward from public.gamification_rewards where id=(p_payload->>'reward_id')::uuid and workspace_id=p_workspace_id for share;
    end if;
    if v_reward.id is null then return jsonb_build_object('error','REWARD_NOT_FOUND'); end if;
    select * into v_learner from public.learners where id=p_learner_id and workspace_id=p_workspace_id and is_active for update;
    if not found then return jsonb_build_object('error','LEARNER_NOT_FOUND'); end if;
    v_now := clock_timestamp();
    -- Price/scope stay locked through eligibility, spend, and claim transition.
    select * into v_reward from public.gamification_rewards where id=v_reward.id and workspace_id=p_workspace_id;
    if p_action='reward_request' then
      if length(coalesce(p_payload->>'note',''))>1000 then return jsonb_build_object('error','INVALID_INPUT'); end if;
      v_request_payload := jsonb_build_object('action',p_action,'requester_learner_id',p_learner_id,'reward_id',v_reward.id,'note',coalesce(p_payload->>'note',''));
      select * into v_claim from public.reward_claims where workspace_id=p_workspace_id and learner_id=p_learner_id and idempotency_key=v_key;
      if found then
        if v_claim.metadata->'request_payload' is distinct from v_request_payload then return jsonb_build_object('error','IDEMPOTENCY_CONFLICT'); end if;
        return jsonb_build_object('ok',true,'claim',to_jsonb(v_claim),'already_requested',true);
      end if;
    end if;
    v_eligibility := public.flh_family_reward_eligibility(p_workspace_id,p_learner_id,v_reward.id);
    if not (v_eligibility->>'eligible')::boolean then return jsonb_build_object('error',v_eligibility->'ineligibility_reasons'->>0,'ineligibility_reasons',v_eligibility->'ineligibility_reasons'); end if;
    if p_action='reward_request' then
      if exists(select 1 from public.reward_claims where workspace_id=p_workspace_id and learner_id=p_learner_id and reward_id=v_reward.id and status='pending') then return jsonb_build_object('error','CLAIM_ALREADY_PENDING'); end if;
      insert into public.reward_claims(workspace_id,learner_id,reward_id,idempotency_key,note,metadata,requested_at) values(p_workspace_id,p_learner_id,v_reward.id,v_key,coalesce(p_payload->>'note',''),jsonb_build_object('requester_learner_id',p_learner_id,'reward_title',v_reward.title,'requested_points',coalesce(v_reward.required_reward_points,0),'request_note',coalesce(p_payload->>'note',''),'request_payload',v_request_payload,'is_test',coalesce((v_learner.metadata->>'is_test')::boolean,false)),v_now) returning * into v_claim;
      return jsonb_build_object('ok',true,'claim',to_jsonb(v_claim));
    end if;
    v_points := coalesce(v_reward.required_reward_points,0);
    insert into public.learner_gamification_state(workspace_id,learner_id) values(p_workspace_id,p_learner_id) on conflict(learner_id) do nothing;
    update public.learner_gamification_state set reward_points=reward_points-v_points where workspace_id=p_workspace_id and learner_id=p_learner_id and reward_points>=v_points returning reward_points into v_balance;
    if not found then return jsonb_build_object('error','INSUFFICIENT_POINTS'); end if;
    v_snapshot := jsonb_build_object('reward_id',v_reward.id,'reward_title',v_reward.title,'claim_id',v_claim.id,'reviewer_id',p_actor_id,'requester_learner_id',p_learner_id,'status','approved','approved_at',v_now,'points_spent',v_points,'is_test',coalesce((v_learner.metadata->>'is_test')::boolean,false));
    insert into public.gamification_events(workspace_id,learner_id,event_type,xp_delta,reward_points_delta,source_type,source_id,reason,metadata,created_at) values(p_workspace_id,p_learner_id,'reward_points_adjustment',0,-v_points,'reward_claim',v_claim.id::text,coalesce(nullif(p_payload->>'reason',''),'استبدال الجائزة: '||v_reward.title),v_snapshot,v_now);
    update public.reward_claims set status='approved',reviewed_by=p_actor_id,reviewed_at=v_now,note=coalesce(p_payload->>'reason',''),points_spent=v_points,metadata=metadata||v_snapshot where id=v_claim.id returning * into v_claim;
    return jsonb_build_object('ok',true,'claim',to_jsonb(v_claim),'reward_points',v_balance);
  end if;

  if p_action='points_adjust' then
    if p_learner_id is null then return jsonb_build_object('error','LEARNER_NOT_FOUND'); end if;
    v_key := p_payload->>'idempotency_key'; v_reason := btrim(coalesce(p_payload->>'reason',''));
    if v_key is null or length(v_key) not between 8 and 200 then return jsonb_build_object('error','IDEMPOTENCY_KEY_REQUIRED'); end if;
    if length(v_reason) not between 1 and 1000 then return jsonb_build_object('error','ADJUSTMENT_REASON_REQUIRED'); end if;
    select * into v_learner from public.learners where id=p_learner_id and workspace_id=p_workspace_id and is_active for update;
    if not found then return jsonb_build_object('error','LEARNER_NOT_FOUND'); end if;
    v_now := clock_timestamp();
    v_request_payload := jsonb_build_object('action',p_action,'actor_id',p_actor_id,'learner_id',p_learner_id,'reason',v_reason,'delta',case when p_payload ? 'reversal_event_id' then null else (p_payload->>'delta')::integer end,'reversal_event_id',case when p_payload ? 'reversal_event_id' then (p_payload->>'reversal_event_id')::bigint else null end);
    select * into v_event from public.gamification_events where workspace_id=p_workspace_id and learner_id=p_learner_id and source_type='manual_adjustment' and source_id=v_key;
    if found then
      if v_event.metadata->'request_payload' is distinct from v_request_payload then return jsonb_build_object('error','IDEMPOTENCY_CONFLICT'); end if;
      return jsonb_build_object('ok',true,'event',to_jsonb(v_event),'already_adjusted',true);
    end if;
    v_snapshot := jsonb_build_object('actor_id',p_actor_id,'request_payload',v_request_payload,'status','approved','is_test',coalesce((v_learner.metadata->>'is_test')::boolean,false));
    if p_payload ? 'reversal_event_id' then
      select * into v_event from public.gamification_events where id=(p_payload->>'reversal_event_id')::bigint and workspace_id=p_workspace_id and learner_id=p_learner_id;
      if not found or v_event.reward_points_delta=0 then return jsonb_build_object('error','REVERSAL_EVENT_NOT_FOUND'); end if;
      if exists(select 1 from public.gamification_events where workspace_id=p_workspace_id and learner_id=p_learner_id and source_type='manual_adjustment' and metadata->>'reversal_event_id'=v_event.id::text) then return jsonb_build_object('error','ALREADY_REVERSED'); end if;
      v_delta := -v_event.reward_points_delta;
      v_snapshot := v_snapshot||jsonb_build_object('reversal_event_id',v_event.id::text,'reversal_source_type',v_event.source_type);
    else v_delta := (p_payload->>'delta')::integer; end if;
    if v_delta is null or v_delta=0 or v_delta not between -1000000 and 1000000 then return jsonb_build_object('error','INVALID_ADJUSTMENT'); end if;
    insert into public.learner_gamification_state(workspace_id,learner_id) values(p_workspace_id,p_learner_id) on conflict(learner_id) do nothing;
    update public.learner_gamification_state set reward_points=reward_points+v_delta where workspace_id=p_workspace_id and learner_id=p_learner_id and reward_points+v_delta>=0 returning reward_points into v_balance;
    if not found then return jsonb_build_object('error','INSUFFICIENT_POINTS'); end if;
    insert into public.gamification_events(workspace_id,learner_id,event_type,xp_delta,reward_points_delta,source_type,source_id,reason,metadata,created_at) values(p_workspace_id,p_learner_id,'reward_points_adjustment',0,v_delta,'manual_adjustment',v_key,v_reason,v_snapshot,v_now) returning * into v_event;
    return jsonb_build_object('ok',true,'event',to_jsonb(v_event),'reward_points',v_balance);
  end if;
  return jsonb_build_object('error','UNKNOWN_ACTION');
exception
  when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format or check_violation or not_null_violation or foreign_key_violation then return jsonb_build_object('error','INVALID_INPUT');
end $$;
revoke all on function public.flh_family_rewards_command(uuid,uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.flh_family_rewards_command(uuid,uuid,uuid,text,jsonb) to service_role;
comment on function public.flh_family_rewards_command(uuid,uuid,uuid,text,jsonb) is 'FLH-025 v1.1 and FLH-010 v1.7: parent-verified canonical return identity, learner/event uniqueness and verified Istanbul-day cap; original claim history, captures, one wallet and other-rule cadence preserved.';
