-- FLH-FEAT-2026-010 / SPEC_VERSION 1.1
-- Forward-only rewards UX safety refinement.
-- Historical migrations are intentionally unchanged.
-- New self-reports reuse an exact pending learner+rule+occurred_at occurrence;
-- approval refuses a second award for an occurrence already approved.

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
  v_delta integer;
  v_count integer;
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
        and (v_report_category_id is null or r.category_id=v_report_category_id)
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
      'badges',case when v_parent then (select coalesce(jsonb_agg(jsonb_build_object('code',code,'title',title,'is_active',is_active) order by title),'[]'::jsonb) from public.gamification_badges where workspace_id=p_workspace_id) else '[]'::jsonb end,
      'rules',(select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object('category_title',c.title,'learner_ids',(select coalesce(jsonb_agg(rl.learner_id),'[]'::jsonb) from public.behavior_rule_learners rl where rl.rule_id=r.id and rl.workspace_id=p_workspace_id and (v_parent or rl.learner_id=p_learner_id))) order by r.created_at),'[]'::jsonb) from public.behavior_rules r join public.behavior_categories c on c.id=r.category_id and c.workspace_id=r.workspace_id where r.workspace_id=p_workspace_id and (v_parent or (r.is_active and c.is_active and r.self_report_allowed and ((r.learner_scope='all' and not coalesce((v_learner.metadata->>'is_test')::boolean,false)) or exists(select 1 from public.behavior_rule_learners rl where rl.rule_id=r.id and rl.workspace_id=p_workspace_id and rl.learner_id=p_learner_id))))),
      'rewards',(select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object('learner_ids',(select coalesce(jsonb_agg(rl.learner_id),'[]'::jsonb) from public.reward_learner_scopes rl where rl.reward_id=r.id and rl.workspace_id=p_workspace_id and (v_parent or rl.learner_id=p_learner_id))) || case when p_action='student_catalog' then public.flh_family_reward_eligibility(p_workspace_id,p_learner_id,r.id) else '{}'::jsonb end order by r.created_at),'[]'::jsonb) from public.gamification_rewards r where r.workspace_id=p_workspace_id and (v_parent or (r.is_active and ((r.learner_scope='all' and not coalesce((v_learner.metadata->>'is_test')::boolean,false)) or exists(select 1 from public.reward_learner_scopes rl where rl.reward_id=r.id and rl.workspace_id=p_workspace_id and rl.learner_id=p_learner_id))))),
      'submissions',(select coalesce(jsonb_agg(to_jsonb(x) order by x.requested_at desc),'[]'::jsonb) from (select s.*, coalesce(s.snapshot->>'rule_title',r.title) as rule_title, coalesce(s.snapshot->>'category_title',c.title) as category_title from public.behavior_submissions s join public.behavior_rules r on r.id=s.rule_id and r.workspace_id=s.workspace_id join public.behavior_categories c on c.id=r.category_id and c.workspace_id=r.workspace_id where s.workspace_id=p_workspace_id and s.learner_id=any(v_ids) and (s.status='pending' or s.id in(select id from public.behavior_submissions where workspace_id=p_workspace_id and learner_id=any(v_ids) order by requested_at desc limit 200)) order by s.requested_at desc) x),
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
      v_request_payload := jsonb_build_object('action',p_action,'actor_id',p_actor_id,'learner_id',p_learner_id,'rule_id',v_rule.id,'initiative',coalesce((p_payload->>'initiative')::boolean,false),'adhkar_completed',coalesce((p_payload->>'adhkar_completed')::boolean,false),'reason',coalesce(p_payload->>'reason',''),'occurred_at',extract(epoch from v_explicit_occurred_at));
      select * into v_submission from public.behavior_submissions where workspace_id=p_workspace_id and learner_id=p_learner_id and idempotency_key=v_key;
      if found then
        if v_submission.request_payload is distinct from v_request_payload then return jsonb_build_object('error','IDEMPOTENCY_CONFLICT'); end if;
        return jsonb_build_object('ok',true,'submission',to_jsonb(v_submission),'already_recorded',true);
      end if;
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
          return jsonb_build_object('ok',true,'submission',to_jsonb(v_submission),'duplicate_pending',true);
        end if;
      end if;
    end if;
    select * into v_category from public.behavior_categories where id=v_rule.category_id and workspace_id=p_workspace_id;
    if not v_rule.is_active or not v_category.is_active then return jsonb_build_object('error','RULE_INACTIVE'); end if;
    if (v_rule.learner_scope='all' and coalesce((v_learner.metadata->>'is_test')::boolean,false)) or (v_rule.learner_scope='selected' and not exists(select 1 from public.behavior_rule_learners where rule_id=v_rule.id and workspace_id=p_workspace_id and learner_id=p_learner_id)) then return jsonb_build_object('error','RULE_SCOPE_FORBIDDEN'); end if;
    if p_action='behavior_submit' and not v_rule.self_report_allowed then return jsonb_build_object('error','SELF_REPORT_FORBIDDEN'); end if;
    if p_action<>'behavior_review' then
      if coalesce(v_explicit_occurred_at,v_now)>v_now then return jsonb_build_object('error','INVALID_OCCURRED_AT'); end if;
      if coalesce((p_payload->>'adhkar_completed')::boolean,false) and coalesce(v_rule.adhkar_bonus_points,0)=0 then return jsonb_build_object('error','INVALID_INPUT'); end if;
      insert into public.behavior_submissions(workspace_id,learner_id,rule_id,initiative,adhkar_completed,occurred_at,requester_type,requester_id,reason,idempotency_key,requested_at,request_payload)
      values(p_workspace_id,p_learner_id,v_rule.id,coalesce((p_payload->>'initiative')::boolean,false),coalesce((p_payload->>'adhkar_completed')::boolean,false),coalesce(v_explicit_occurred_at,v_now),case when p_action='behavior_submit' then 'learner' else 'parent' end,case when p_action='behavior_submit' then null else p_actor_id end,coalesce(p_payload->>'reason',''),v_key,v_now,v_request_payload) returning * into v_submission;
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
    v_snapshot := jsonb_build_object('category_id',v_category.id,'category_title',v_category.title,'rule_id',v_rule.id,'rule_title',v_rule.title,'base_points',v_points,'initiative_bonus_points',v_bonus,'adhkar_completed',v_submission.adhkar_completed,'adhkar_bonus_points',v_adhkar_bonus,'total_points',v_points+v_bonus+v_adhkar_bonus,'requester_type',v_submission.requester_type,'requester_id',v_submission.requester_id,'requester_learner_id',case when v_submission.requester_type='learner' then p_learner_id else null end,'requester',jsonb_build_object('type',v_submission.requester_type,'id',case when v_submission.requester_type='learner' then p_learner_id else v_submission.requester_id end),'reviewer',p_actor_id,'reviewer_id',p_actor_id,'occurred_at',v_submission.occurred_at,'approved_at',v_now,'status','approved','is_test',coalesce((v_learner.metadata->>'is_test')::boolean,false));
    insert into public.learner_gamification_state(workspace_id,learner_id,reward_points) values(p_workspace_id,p_learner_id,v_points+v_bonus+v_adhkar_bonus) on conflict(learner_id) do update set reward_points=learner_gamification_state.reward_points+excluded.reward_points returning reward_points into v_balance;
    insert into public.gamification_events(workspace_id,learner_id,event_type,xp_delta,reward_points_delta,source_type,source_id,reason,metadata,created_at) values(p_workspace_id,p_learner_id,'other',0,v_points+v_bonus+v_adhkar_bonus,'family_behavior',v_submission.id::text,coalesce(nullif(v_submission.reason,''),v_rule.title),v_snapshot,v_now);
    update public.behavior_submissions set status='approved',reviewer_id=p_actor_id,reviewed_at=v_now,approved_at=v_now,review_reason=coalesce(p_payload->>'reason',''),base_points=v_points,initiative_bonus_points=v_bonus,adhkar_bonus_points=v_adhkar_bonus,total_points=v_points+v_bonus+v_adhkar_bonus,snapshot=v_snapshot where id=v_submission.id returning * into v_submission;
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
comment on function public.flh_family_rewards_command(uuid,uuid,uuid,text,jsonb) is 'FLH-FEAT-2026-010 v1.1 + FLH-FEAT-2026-017. Service-only atomic family rewards command with exact pending self-report reuse, duplicate-occurrence approval guard, and complete learner-scoped behavior reports.';

