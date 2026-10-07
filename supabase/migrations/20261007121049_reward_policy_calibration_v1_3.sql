-- FLH-FEAT-2026-010 / SPEC_VERSION 1.3
-- Reward policy calibration. Forward-only: historical ledger rows and attempts remain unchanged.

alter table public.behavior_rules
  add column if not exists congregation_bonus_points integer not null default 0,
  add column if not exists mosque_bonus_points integer not null default 0,
  add column if not exists sunnah_bonus_points integer not null default 0;

alter table public.behavior_submissions
  add column if not exists congregation_completed boolean not null default false,
  add column if not exists congregation_bonus_points integer not null default 0,
  add column if not exists mosque_completed boolean not null default false,
  add column if not exists mosque_bonus_points integer not null default 0,
  add column if not exists sunnah_completed boolean not null default false,
  add column if not exists sunnah_bonus_points integer not null default 0;

do $constraints$
begin
  if not exists(select 1 from pg_constraint where conname='behavior_rules_congregation_bonus_points_check' and conrelid='public.behavior_rules'::regclass) then
    alter table public.behavior_rules add constraint behavior_rules_congregation_bonus_points_check check(congregation_bonus_points between 0 and 100000);
  end if;
  if not exists(select 1 from pg_constraint where conname='behavior_rules_mosque_bonus_points_check' and conrelid='public.behavior_rules'::regclass) then
    alter table public.behavior_rules add constraint behavior_rules_mosque_bonus_points_check check(mosque_bonus_points between 0 and 100000);
  end if;
  if not exists(select 1 from pg_constraint where conname='behavior_rules_sunnah_bonus_points_check' and conrelid='public.behavior_rules'::regclass) then
    alter table public.behavior_rules add constraint behavior_rules_sunnah_bonus_points_check check(sunnah_bonus_points between 0 and 100000);
  end if;
  if not exists(select 1 from pg_constraint where conname='behavior_submissions_congregation_bonus_points_check' and conrelid='public.behavior_submissions'::regclass) then
    alter table public.behavior_submissions add constraint behavior_submissions_congregation_bonus_points_check check(congregation_bonus_points >= 0);
  end if;
  if not exists(select 1 from pg_constraint where conname='behavior_submissions_mosque_bonus_points_check' and conrelid='public.behavior_submissions'::regclass) then
    alter table public.behavior_submissions add constraint behavior_submissions_mosque_bonus_points_check check(mosque_bonus_points >= 0);
  end if;
  if not exists(select 1 from pg_constraint where conname='behavior_submissions_sunnah_bonus_points_check' and conrelid='public.behavior_submissions'::regclass) then
    alter table public.behavior_submissions add constraint behavior_submissions_sunnah_bonus_points_check check(sunnah_bonus_points >= 0);
  end if;
end
$constraints$;

alter table public.behavior_submissions
  drop constraint if exists behavior_submissions_total_points_with_adhkar_check;
alter table public.behavior_submissions
  drop constraint if exists behavior_submissions_total_points_with_prayer_bonuses_check;
alter table public.behavior_submissions
  add constraint behavior_submissions_total_points_with_prayer_bonuses_check
  check(total_points = base_points + initiative_bonus_points + adhkar_bonus_points + congregation_bonus_points + mosque_bonus_points + sunnah_bonus_points);

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
begin
  if p_workspace_id is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' then return jsonb_build_object('error','INVALID_INPUT'); end if;
  if v_parent then
    if not exists(select 1 from public.workspace_members where workspace_id = p_workspace_id and user_id = p_actor_id and role in ('owner','admin')) then return jsonb_build_object('error','PARENT_MANAGE_FORBIDDEN'); end if;
  elsif p_action not in ('student_catalog','student_ledger','student_report','behavior_submit','reward_request') then return jsonb_build_object('error','PARENT_MANAGE_FORBIDDEN');
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

  if p_action in ('parent_catalog','student_catalog') then
    if p_action = 'parent_catalog' and not v_parent then return jsonb_build_object('error','PARENT_MANAGE_FORBIDDEN'); end if;
    select coalesce(array_agg(id),'{}'::uuid[]) into v_ids from public.learners where workspace_id = p_workspace_id and is_active and
      case when p_action = 'student_catalog' then id = p_learner_id when coalesce((p_payload->>'test_only')::boolean,false) then coalesce((metadata->>'is_test')::boolean,false) else not coalesce((metadata->>'is_test')::boolean,false) and not coalesce((metadata->>'exclude_from_parent_metrics')::boolean,false) end;
    return jsonb_build_object(
      'ok',true,
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
      'submissions',(select coalesce(jsonb_agg(to_jsonb(x) order by x.requested_at desc),'[]'::jsonb) from (select s.*, coalesce(s.snapshot->>'rule_title',r.title) as rule_title, coalesce(s.snapshot->>'category_title',c.title) as category_title, exists(select 1 from public.behavior_submissions approved where approved.workspace_id=s.workspace_id and approved.learner_id=s.learner_id and approved.rule_id=s.rule_id and approved.status='approved' and approved.occurred_at=s.occurred_at and approved.id<>s.id) as possible_duplicate from public.behavior_submissions s join public.behavior_rules r on r.id=s.rule_id and r.workspace_id=s.workspace_id join public.behavior_categories c on c.id=r.category_id and c.workspace_id=r.workspace_id where s.workspace_id=p_workspace_id and s.learner_id=any(v_ids) and (s.status='pending' or s.id in(select id from public.behavior_submissions where workspace_id=p_workspace_id and learner_id=any(v_ids) order by requested_at desc limit 200)) order by s.requested_at desc) x),
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
      v_decision := p_payload->>'decision';
      if v_decision not in ('approved','rejected') or v_decision is null then return jsonb_build_object('error','INVALID_DECISION'); end if;
      if v_submission.status<>'pending' then
        if v_submission.status=v_decision then return jsonb_build_object('ok',true,'submission',to_jsonb(v_submission),'already_reviewed',true); end if;
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
      v_request_payload := jsonb_build_object('action',p_action,'actor_id',p_actor_id,'learner_id',p_learner_id,'rule_id',v_rule.id,'initiative',coalesce((p_payload->>'initiative')::boolean,false),'adhkar_completed',coalesce((p_payload->>'adhkar_completed')::boolean,false),'congregation_completed',coalesce((p_payload->>'congregation_completed')::boolean,false),'mosque_completed',coalesce((p_payload->>'mosque_completed')::boolean,false),'sunnah_completed',coalesce((p_payload->>'sunnah_completed')::boolean,false),'reason',coalesce(p_payload->>'reason',''),'occurred_at',extract(epoch from v_explicit_occurred_at));
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
          if (coalesce(v_submission.request_payload,'{}'::jsonb)-'idempotency_aliases') is distinct from v_request_payload then return jsonb_build_object('error','IDEMPOTENCY_CONFLICT'); end if;
        elsif v_submission.request_payload->'idempotency_aliases'->v_key is distinct from v_request_payload then
          return jsonb_build_object('error','IDEMPOTENCY_CONFLICT');
        end if;
        return jsonb_build_object('ok',true,'submission',to_jsonb(v_submission),'already_recorded',true);
      end if;
    end if;
    select * into v_category from public.behavior_categories where id=v_rule.category_id and workspace_id=p_workspace_id;
    if not v_rule.is_active or not v_category.is_active then return jsonb_build_object('error','RULE_INACTIVE'); end if;
    if (v_rule.learner_scope='all' and coalesce((v_learner.metadata->>'is_test')::boolean,false)) or (v_rule.learner_scope='selected' and not exists(select 1 from public.behavior_rule_learners where rule_id=v_rule.id and workspace_id=p_workspace_id and learner_id=p_learner_id)) then return jsonb_build_object('error','RULE_SCOPE_FORBIDDEN'); end if;
    if p_action='behavior_submit' and not v_rule.self_report_allowed then return jsonb_build_object('error','SELF_REPORT_FORBIDDEN'); end if;
    if p_action<>'behavior_review' then
      if coalesce(v_explicit_occurred_at,v_now)>v_now then return jsonb_build_object('error','INVALID_OCCURRED_AT'); end if;
      if coalesce((p_payload->>'adhkar_completed')::boolean,false) and coalesce(v_rule.adhkar_bonus_points,0)=0 then return jsonb_build_object('error','INVALID_INPUT'); end if;
      if coalesce((p_payload->>'congregation_completed')::boolean,false) and coalesce(v_rule.congregation_bonus_points,0)=0 then return jsonb_build_object('error','INVALID_INPUT'); end if;
      if coalesce((p_payload->>'mosque_completed')::boolean,false) and coalesce(v_rule.mosque_bonus_points,0)=0 then return jsonb_build_object('error','INVALID_INPUT'); end if;
      if coalesce((p_payload->>'sunnah_completed')::boolean,false) and coalesce(v_rule.sunnah_bonus_points,0)=0 then return jsonb_build_object('error','INVALID_INPUT'); end if;
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
      insert into public.behavior_submissions(workspace_id,learner_id,rule_id,initiative,adhkar_completed,congregation_completed,mosque_completed,sunnah_completed,occurred_at,requester_type,requester_id,reason,idempotency_key,requested_at,request_payload)
      values(p_workspace_id,p_learner_id,v_rule.id,coalesce((p_payload->>'initiative')::boolean,false),coalesce((p_payload->>'adhkar_completed')::boolean,false),coalesce((p_payload->>'congregation_completed')::boolean,false),coalesce((p_payload->>'mosque_completed')::boolean,false),coalesce((p_payload->>'sunnah_completed')::boolean,false),coalesce(v_explicit_occurred_at,v_now),case when p_action='behavior_submit' then 'learner' else 'parent' end,case when p_action='behavior_submit' then null else p_actor_id end,coalesce(p_payload->>'reason',''),v_key,v_now,v_request_payload) returning * into v_submission;
      -- AC06 always requires parent review, regardless of configurable policy flag.
      if p_action='behavior_submit' then return jsonb_build_object('ok',true,'submission',to_jsonb(v_submission)); end if;
    end if;
    if p_action in ('behavior_review','behavior_record') and exists(
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
    if v_rule.cadence<>'unlimited' then
      v_window := date_trunc(case when v_rule.cadence='day' then 'day' else 'week' end,v_now at time zone 'UTC') at time zone 'UTC';
      select count(*) into v_count from public.behavior_submissions where workspace_id=p_workspace_id and learner_id=p_learner_id and rule_id=v_rule.id and status='approved' and approved_at>=v_window;
      if v_count>=v_rule.max_awards then
        -- Parent direct recording must not leave a pending row on failed award.
        if p_action='behavior_record' then delete from public.behavior_submissions where id=v_submission.id; end if;
        return jsonb_build_object('error','CADENCE_LIMIT');
      end if;
    end if;
    v_points := v_rule.base_points;
    v_bonus := case when v_submission.initiative then v_rule.initiative_bonus_points else 0 end;
    v_adhkar_bonus := case when v_submission.adhkar_completed then coalesce(v_rule.adhkar_bonus_points,0) else 0 end;
    v_congregation_bonus := case when v_submission.congregation_completed then coalesce(v_rule.congregation_bonus_points,0) else 0 end;
    v_mosque_bonus := case when v_submission.mosque_completed then coalesce(v_rule.mosque_bonus_points,0) else 0 end;
    v_sunnah_bonus := case when v_submission.sunnah_completed then coalesce(v_rule.sunnah_bonus_points,0) else 0 end;
    v_snapshot := jsonb_build_object('category_id',v_category.id,'category_title',v_category.title,'rule_id',v_rule.id,'rule_title',v_rule.title,'base_points',v_points,'initiative_bonus_points',v_bonus,'adhkar_completed',v_submission.adhkar_completed,'adhkar_bonus_points',v_adhkar_bonus,'congregation_completed',v_submission.congregation_completed,'congregation_bonus_points',v_congregation_bonus,'mosque_completed',v_submission.mosque_completed,'mosque_bonus_points',v_mosque_bonus,'sunnah_completed',v_submission.sunnah_completed,'sunnah_bonus_points',v_sunnah_bonus,'total_points',v_points+v_bonus+v_adhkar_bonus+v_congregation_bonus+v_mosque_bonus+v_sunnah_bonus+v_congregation_bonus+v_mosque_bonus+v_sunnah_bonus,'requester_type',v_submission.requester_type,'requester_id',v_submission.requester_id,'requester_learner_id',case when v_submission.requester_type='learner' then p_learner_id else null end,'requester',jsonb_build_object('type',v_submission.requester_type,'id',case when v_submission.requester_type='learner' then p_learner_id else v_submission.requester_id end),'reviewer',p_actor_id,'reviewer_id',p_actor_id,'occurred_at',v_submission.occurred_at,'approved_at',v_now,'status','approved','is_test',coalesce((v_learner.metadata->>'is_test')::boolean,false));
    insert into public.learner_gamification_state(workspace_id,learner_id,reward_points) values(p_workspace_id,p_learner_id,v_points+v_bonus+v_adhkar_bonus+v_congregation_bonus+v_mosque_bonus+v_sunnah_bonus) on conflict(learner_id) do update set reward_points=learner_gamification_state.reward_points+excluded.reward_points returning reward_points into v_balance;
    insert into public.gamification_events(workspace_id,learner_id,event_type,xp_delta,reward_points_delta,source_type,source_id,reason,metadata,created_at) values(p_workspace_id,p_learner_id,'other',0,v_points+v_bonus+v_adhkar_bonus+v_congregation_bonus+v_mosque_bonus+v_sunnah_bonus,'family_behavior',v_submission.id::text,coalesce(nullif(v_submission.reason,''),v_rule.title),v_snapshot,v_now);
    update public.behavior_submissions set status='approved',reviewer_id=p_actor_id,reviewed_at=v_now,approved_at=v_now,review_reason=coalesce(p_payload->>'reason',''),base_points=v_points,initiative_bonus_points=v_bonus,adhkar_bonus_points=v_adhkar_bonus,congregation_bonus_points=v_congregation_bonus,mosque_bonus_points=v_mosque_bonus,sunnah_bonus_points=v_sunnah_bonus,total_points=v_points+v_bonus+v_adhkar_bonus+v_congregation_bonus+v_mosque_bonus+v_sunnah_bonus,snapshot=v_snapshot where id=v_submission.id returning * into v_submission;
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
comment on function public.flh_family_rewards_command(uuid,uuid,uuid,text,jsonb) is 'FLH-FEAT-2026-010 v1.3. Service-only atomic family rewards command with linked initiative, adhkar, congregation, mosque and sunnah bonus snapshots plus v1.1 duplicate/idempotency protections.';


create or replace function public.flh_learning_finish(
  p_workspace_id uuid,
  p_learner_id uuid,
  p_attempt_id uuid,
  p_duration_seconds integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_attempt public.quiz_attempts%rowtype;
  v_quiz record;
  v_learner_is_test boolean := false;
  v_cached_result jsonb;
  v_score_points numeric := 0;
  v_max_points numeric := 0;
  v_percentage numeric := 0;
  v_first_try_correct integer := 0;
  v_hints_used integer := 0;
  v_duration_seconds integer := 0;
  v_submitted_at timestamptz := now();
  v_review jsonb := '[]'::jsonb;
  v_award jsonb;
  v_result jsonb;
  v_prior_award boolean := false;
  v_xp_award integer := 25;
  v_reward_points_award integer := 5;
  v_old_xp integer := 0;
  v_old_reward_points integer := 0;
  v_old_current_streak integer := 0;
  v_old_longest_streak integer := 0;
  v_old_last_learning_date date;
  v_new_xp integer;
  v_new_reward_points integer;
  v_new_level integer := 1;
  v_new_streak integer := 1;
  v_today date := (now() at time zone 'UTC')::date;
  v_yesterday date := ((now() at time zone 'UTC')::date - 1);
  v_badge_codes text[] := array[]::text[];
  v_badge_code text;
  v_badge_id uuid;
begin
  if p_workspace_id is null
     or p_learner_id is null
     or p_attempt_id is null then
    return jsonb_build_object('error', 'ATTEMPT_NOT_ACTIVE');
  end if;

  -- Lock the attempt first, matching the Learning answer lock order. A second
  -- finish waits here, then returns the first transaction's cached response.
  select a.*
  into v_attempt
  from public.quiz_attempts a
  where a.id = p_attempt_id
    and a.workspace_id = p_workspace_id
    and a.learner_id = p_learner_id
  for update;

  if not found or v_attempt.delivery_mode <> 'learning' then
    return jsonb_build_object('error', 'ATTEMPT_NOT_ACTIVE');
  end if;

  if v_attempt.status = 'submitted' then
    v_cached_result := v_attempt.metadata->'learning_finish_last_result';
    if jsonb_typeof(v_cached_result) = 'object' then
      return v_cached_result;
    end if;
    return jsonb_build_object('error', 'ATTEMPT_NOT_ACTIVE');
  end if;

  if v_attempt.status <> 'in_progress' then
    return jsonb_build_object('error', 'ATTEMPT_NOT_ACTIVE');
  end if;

  -- Lock the learner after the attempt. This validates active ownership and
  -- serializes gamification awards across different attempts by one learner.
  select coalesce((l.metadata->>'is_test')::boolean, false)
  into v_learner_is_test
  from public.learners l
  where l.id = p_learner_id
    and l.workspace_id = p_workspace_id
    and l.is_active
  for update;

  if not found then
    return jsonb_build_object('error', 'ATTEMPT_NOT_ACTIVE');
  end if;

  if exists (
    select 1
    from public.quiz_attempt_question_queue qq
    where qq.workspace_id = p_workspace_id
      and qq.quiz_attempt_id = p_attempt_id
      and qq.status in ('pending', 'active')
  ) then
    return jsonb_build_object('error', 'QUIZ_NOT_COMPLETE');
  end if;

  select qz.slug, qz.title
  into v_quiz
  from public.quiz_versions qv
  join public.quizzes qz
    on qz.id = qv.quiz_id
   and qz.workspace_id = qv.workspace_id
  where qv.id = v_attempt.quiz_version_id
    and qv.workspace_id = p_workspace_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'LEARNING_FINISH_QUIZ_METADATA_MISSING';
  end if;

  -- Score only the original core-question set. Remediation remains learning
  -- evidence but does not change the current completion score denominator.
  select
    coalesce(sum(q.points), 0),
    coalesce(sum(a.points_awarded), 0),
    count(*) filter (where a.first_try_correct)::integer,
    coalesce(sum(a.hints_used), 0)::integer
  into
    v_max_points,
    v_score_points,
    v_first_try_correct,
    v_hints_used
  from public.quiz_attempt_question_queue qq
  join public.quiz_questions q
    on q.id = qq.question_id
   and q.workspace_id = qq.workspace_id
  left join public.quiz_attempt_answers a
    on a.attempt_id = qq.quiz_attempt_id
   and a.question_id = qq.question_id
   and a.workspace_id = qq.workspace_id
  where qq.workspace_id = p_workspace_id
    and qq.quiz_attempt_id = p_attempt_id
    and qq.source_role = 'core';

  v_percentage := case
    when v_max_points > 0 then round(v_score_points / v_max_points * 100, 2)
    else 0
  end;

  v_duration_seconds := case
    when coalesce(p_duration_seconds, 0) > 0
      then greatest(0, least(86400, p_duration_seconds))
    else greatest(0, least(86400, round(extract(epoch from (v_submitted_at - v_attempt.started_at)))::integer))
  end;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'question_id', a.question_id,
      'question_code', q.question_code,
      'prompt', q.prompt,
          'prompt_language', q.prompt_language,
      'response', a.response,
      'is_correct', a.is_correct,
      'correct_answer', k.correct_answer,
      'explanation', case
        when a.is_correct then coalesce(k.correct_explanation, k.explanation)
        else coalesce(k.final_incorrect_explanation, k.explanation)
      end
    ) order by qq.sequence_no
  ), '[]'::jsonb)
  into v_review
  from public.quiz_attempt_question_queue qq
  join public.quiz_attempt_answers a
    on a.attempt_id = qq.quiz_attempt_id
   and a.question_id = qq.question_id
   and a.workspace_id = qq.workspace_id
  join public.quiz_questions q
    on q.id = qq.question_id
   and q.workspace_id = qq.workspace_id
  left join public.quiz_question_answer_keys k
    on k.question_id = qq.question_id
   and k.workspace_id = qq.workspace_id
  where qq.workspace_id = p_workspace_id
    and qq.quiz_attempt_id = p_attempt_id
    and qq.source_role = 'core';

  -- Test learners deliberately receive repeatable per-attempt QA awards; the
  -- existing trigger rewrites their source_id. Production learners retain the
  -- current once-per-quiz award behavior.
  select exists (
    select 1
    from public.gamification_events e
    where e.workspace_id = p_workspace_id
      and e.learner_id = p_learner_id
      and e.event_type = 'quiz_completed'
      and e.source_type = 'quiz'
      and e.source_id = v_quiz.slug
  ) into v_prior_award;

  if v_prior_award then
    v_award := jsonb_build_object(
      'already_awarded', true,
      'xp', 0,
      'reward_points', 0,
      'badges', '[]'::jsonb
    );
  else
    if v_percentage >= 70 then
      v_xp_award := v_xp_award + 20;
    end if;
    if v_percentage >= 80 then
      v_reward_points_award := v_reward_points_award + 5;
    end if;
    if v_first_try_correct >= 2 then
      v_xp_award := v_xp_award + 10;
      v_badge_codes := array_append(v_badge_codes, 'first-try');
    end if;
    if v_hints_used >= 2 and v_percentage >= 40 then
      v_xp_award := v_xp_award + 10;
      v_badge_codes := array_append(v_badge_codes, 'keep-going');
    end if;
    if v_percentage >= 85 then
      v_badge_codes := array_append(v_badge_codes, 'concept-master');
    end if;

    select
      s.xp,
      s.reward_points,
      s.current_streak,
      s.longest_streak,
      s.last_learning_date
    into
      v_old_xp,
      v_old_reward_points,
      v_old_current_streak,
      v_old_longest_streak,
      v_old_last_learning_date
    from public.learner_gamification_state s
    where s.workspace_id = p_workspace_id
      and s.learner_id = p_learner_id;

    if not found then
      v_old_xp := 0;
      v_old_reward_points := 0;
      v_old_current_streak := 0;
      v_old_longest_streak := 0;
      v_old_last_learning_date := null;
    end if;

    v_new_xp := v_old_xp + v_xp_award;
    v_new_reward_points := v_old_reward_points + v_reward_points_award;
    v_new_streak := case
      when v_old_last_learning_date = v_today then v_old_current_streak
      when v_old_last_learning_date = v_yesterday then v_old_current_streak + 1
      else 1
    end;

    select gl.level_no
    into v_new_level
    from public.gamification_levels gl
    where gl.workspace_id = p_workspace_id
      and gl.min_xp <= v_new_xp
    order by gl.min_xp desc
    limit 1;
    v_new_level := coalesce(v_new_level, 1);

    insert into public.learner_gamification_state as state(
      workspace_id,
      learner_id,
      xp,
      reward_points,
      current_level,
      current_streak,
      longest_streak,
      last_learning_date
    ) values (
      p_workspace_id,
      p_learner_id,
      v_new_xp,
      v_new_reward_points,
      v_new_level,
      v_new_streak,
      greatest(v_old_longest_streak, v_new_streak),
      v_today
    )
    on conflict (learner_id) do update
    set xp = excluded.xp,
        reward_points = excluded.reward_points,
        current_level = excluded.current_level,
        current_streak = excluded.current_streak,
        longest_streak = excluded.longest_streak,
        last_learning_date = excluded.last_learning_date;

    insert into public.gamification_events(
      workspace_id,
      learner_id,
      event_type,
      xp_delta,
      reward_points_delta,
      source_type,
      source_id,
      reason,
      metadata
    ) values (
      p_workspace_id,
      p_learner_id,
      'quiz_completed',
      v_xp_award,
      v_reward_points_award,
      'quiz',
      v_quiz.slug,
      'Server-graded quiz completion',
      jsonb_build_object(
        'percentage', v_percentage,
        'first_try_correct', v_first_try_correct,
        'hints_used', v_hints_used,
        'engine', 'learning-api-v2'
      )
    );

    foreach v_badge_code in array v_badge_codes loop
      select b.id
      into v_badge_id
      from public.gamification_badges b
      where b.workspace_id = p_workspace_id
        and b.code = v_badge_code;

      if found then
        insert into public.learner_badges(
          workspace_id,
          learner_id,
          badge_id,
          award_reason,
          metadata
        ) values (
          p_workspace_id,
          p_learner_id,
          v_badge_id,
          'quiz:' || v_quiz.slug,
          jsonb_build_object('percentage', v_percentage)
        )
        on conflict (learner_id, badge_id) do nothing;
      end if;
    end loop;

    v_award := jsonb_build_object(
      'already_awarded', false,
      'xp', v_xp_award,
      'reward_points', v_reward_points_award,
      'badges', to_jsonb(v_badge_codes)
    );
  end if;

  v_result := jsonb_build_object(
    'ok', true,
    'attempt_id', p_attempt_id,
    'quiz', jsonb_build_object('slug', v_quiz.slug, 'title', v_quiz.title),
    'score_points', v_score_points,
    'max_points', v_max_points,
    'percentage', v_percentage,
    'first_try_correct', v_first_try_correct,
    'hints_used', v_hints_used,
    'award', v_award,
    'review', v_review
  );

  update public.quiz_attempts
  set status = 'submitted',
      submitted_at = v_submitted_at,
      score_points = v_score_points,
      max_points = v_max_points,
      percentage = v_percentage,
      duration_seconds = v_duration_seconds,
      metadata = coalesce(v_attempt.metadata, '{}'::jsonb) || jsonb_build_object(
        'engine', 'learning-api-v2',
        'server_graded', true,
        'first_try_correct', v_first_try_correct,
        'hints_used', v_hints_used,
        'learning_finish_last_result', v_result
      )
  where id = p_attempt_id
    and workspace_id = p_workspace_id
    and learner_id = p_learner_id;

  return v_result;
end;
$function$;

revoke all on function public.flh_learning_finish(uuid,uuid,uuid,integer) from public;
revoke all on function public.flh_learning_finish(uuid,uuid,uuid,integer) from anon, authenticated;
grant execute on function public.flh_learning_finish(uuid,uuid,uuid,integer) to service_role;

do $policy$
declare
  v_workspace uuid;
  v_count integer;
begin
  select id into strict v_workspace from public.workspaces where slug='family-learning-hub';

  update public.behavior_rules set
    base_points=7, initiative_bonus_points=1, congregation_bonus_points=2, mosque_bonus_points=2, sunnah_bonus_points=2, adhkar_bonus_points=1,
    description='٧ نقاط للفرض في وقته، +١ دون تذكير، +٢ جماعة، +٢ في المسجد، +٢ للسنة، +١ لأذكار ما بعد الصلاة. الحد الأعلى ١٥ نقطة.',
    updated_at=now()
  where workspace_id=v_workspace and title='صلاة الفجر في وقتها';

  update public.behavior_rules set
    base_points=4, initiative_bonus_points=1, congregation_bonus_points=1, mosque_bonus_points=1, sunnah_bonus_points=2, adhkar_bonus_points=1,
    description='٤ نقاط للفرض في وقته، +١ دون تذكير، +١ جماعة، +١ في المسجد، +٢ للسنة، +١ لأذكار ما بعد الصلاة. الحد الأعلى ١٠ نقاط.',
    updated_at=now()
  where workspace_id=v_workspace and title='صلاة الظهر في وقتها';

  update public.behavior_rules set
    base_points=6, initiative_bonus_points=1, congregation_bonus_points=1, mosque_bonus_points=1, sunnah_bonus_points=0, adhkar_bonus_points=1,
    description='٦ نقاط للفرض في وقته، +١ دون تذكير، +١ جماعة، +١ في المسجد، +١ لأذكار ما بعد الصلاة. لا توجد مكافأة سنة مرتبطة بالعصر. الحد الأعلى ١٠ نقاط.',
    updated_at=now()
  where workspace_id=v_workspace and title='صلاة العصر في وقتها';

  update public.behavior_rules set
    base_points=4, initiative_bonus_points=1, congregation_bonus_points=1, mosque_bonus_points=1, sunnah_bonus_points=2, adhkar_bonus_points=1,
    description='٤ نقاط للفرض في وقته، +١ دون تذكير، +١ جماعة، +١ في المسجد، +٢ للسنة، +١ لأذكار ما بعد الصلاة. الحد الأعلى ١٠ نقاط.',
    updated_at=now()
  where workspace_id=v_workspace and title='صلاة المغرب في وقتها';

  update public.behavior_rules set
    base_points=4, initiative_bonus_points=1, congregation_bonus_points=1, mosque_bonus_points=1, sunnah_bonus_points=2, adhkar_bonus_points=1,
    description='٤ نقاط للفرض في وقته، +١ دون تذكير، +١ جماعة، +١ في المسجد، +٢ للسنة، +١ لأذكار ما بعد الصلاة. الحد الأعلى ١٠ نقاط.',
    updated_at=now()
  where workspace_id=v_workspace and title='صلاة العشاء في وقتها';

  update public.behavior_rules set
    base_points=5, initiative_bonus_points=3,
    description='خمس نقاط لترتيب الغرفة والأغراض الشخصية، وثلاث نقاط إضافية إذا تم من دون تذكير.',
    updated_at=now()
  where workspace_id=v_workspace and title='ترتيب الغرفة والأغراض الشخصية';

  update public.behavior_rules set
    base_points=5,
    description='خمس نقاط لمساعدة حقيقية في عمل منزلي مفيد لمدة لا تقل عن ٣٠ دقيقة من العمل الفعلي.',
    updated_at=now()
  where workspace_id=v_workspace and title='مساعدة حقيقية في المنزل';

  update public.behavior_rules set
    base_points=10, initiative_bonus_points=5,
    description='عشر نقاط للعب الإيجابي مع الإخوة لمدة ساعة كاملة، وخمس إضافية إذا بدأ الطفل من نفسه دون أن يطلب منه الأهل.',
    updated_at=now()
  where workspace_id=v_workspace and title='اللعب مع الإخوة لمدة ساعة';

  update public.gamification_rewards
  set required_reward_points=800, updated_at=now()
  where workspace_id=v_workspace and title='بوط رياضة جديد';

  update public.gamification_rewards
  set required_reward_points=1500,
      description='البدء بتعلم مبادئ قيادة السيارة بشكل آمن وتحت إشراف بالغ وفي مكان مناسب.',
      updated_at=now()
  where workspace_id=v_workspace and title='البدء بتعلم قيادة السيارة';

  if not exists(select 1 from public.gamification_rewards where workspace_id=v_workspace and title='سهرة بالبيت') then
    insert into public.gamification_rewards(id,workspace_id,title,description,reward_type,required_reward_points,parent_approval_required,is_active,learner_scope)
    values(gen_random_uuid(),v_workspace,'سهرة بالبيت','سهرة عائلية أو شخصية ممتعة في البيت.','activity',200,true,true,'all');
  else
    update public.gamification_rewards set required_reward_points=200,required_level=null,updated_at=now()
    where workspace_id=v_workspace and title='سهرة بالبيت';
  end if;

  if not exists(select 1 from public.gamification_rewards where workspace_id=v_workspace and title='حلوى خارج البيت') then
    insert into public.gamification_rewards(id,workspace_id,title,description,reward_type,required_reward_points,parent_approval_required,is_active,learner_scope)
    values(gen_random_uuid(),v_workspace,'حلوى خارج البيت','اختيار حلوى خارج البيت بعد جمع النقاط المطلوبة.','outing',300,true,true,'all');
  else
    update public.gamification_rewards set required_reward_points=300,required_level=null,updated_at=now()
    where workspace_id=v_workspace and title='حلوى خارج البيت';
  end if;

  if not exists(select 1 from public.gamification_rewards where workspace_id=v_workspace and title='رحلة إلى مدينة ألعاب') then
    insert into public.gamification_rewards(id,workspace_id,title,description,reward_type,required_level,required_reward_points,parent_approval_required,is_active,learner_scope)
    values(gen_random_uuid(),v_workspace,'رحلة إلى مدينة ألعاب','رحلة إلى مدينة ألعاب بعد جمع النقاط المطلوبة والوصول إلى المستوى الخامس.','outing',5,1500,true,true,'all');
  else
    update public.gamification_rewards set required_reward_points=1500,required_level=5,updated_at=now()
    where workspace_id=v_workspace and title='رحلة إلى مدينة ألعاب';
  end if;
end
$policy$;

