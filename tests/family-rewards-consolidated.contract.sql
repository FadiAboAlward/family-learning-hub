-- FLH025 v1.0 rev3 / FLH010 v1.4 rev2, v1.5 rev5, v1.6 rev2.
-- Disposable rebuilt database only. All writes target Testing or synthetic fixtures.
-- The caught success exception rolls back every fixture and canonical-rule preference.
-- Exact instants cover technical duplicate identity only; same physical-return identity
-- is supplemented by family-return-events.contract.sql for the selected v1.7 identity contract.
do $contract$
declare
  w uuid;
  l uuid;
  owner_id constant uuid := '98000000-0000-4000-8000-000000000001';
  admin_id constant uuid := '98000000-0000-4000-8000-000000000002';
  teacher_id constant uuid := '98000000-0000-4000-8000-000000000003';
  outsider_id constant uuid := '98000000-0000-4000-8000-000000000004';
  second_test_learner constant uuid := '98000000-0000-4000-8000-000000000005';
  greeting constant uuid := 'a315e8af-9d9b-473b-95ac-c5425ad7de5b';
  category_id uuid;
  greeting_category uuid;
  ordinary_rule uuid;
  prayer_rule uuid;
  day_rule uuid;
  week_rule uuid;
  current_rule uuid;
  reward_id uuid;
  sid uuid;
  legacy_sid uuid;
  cid uuid;
  result jsonb;
  second jsonb;
  pending_snapshot jsonb;
  original_rule jsonb;
  original_state jsonb;
  original_history jsonb;
  original_ledger jsonb;
  before_points integer;
  before_count integer;
  local_day date := (clock_timestamp() at time zone 'Europe/Istanbul')::date-30;
  occasion timestamptz;
  components text[] := array['base_points','initiative_bonus_points','adhkar_bonus_points','congregation_bonus_points','mosque_bonus_points','sunnah_bonus_points','total_points'];
  modifier text;
begin
  execute $definition$create or replace function pg_temp.consolidated_assert(ok boolean,message text) returns void
    language plpgsql as $body$begin if ok is distinct from true then raise exception 'Consolidated rewards contract: %',message; end if; end$body$$definition$;

  -- Historical cap fixtures intentionally reuse one registered test occasion per known
  -- fixture instant. Production never infers physical identity from timestamps.
  execute $definition$create or replace function pg_temp.consolidated_return(wid uuid,actor uuid,instant timestamptz) returns uuid
    language plpgsql as $body$
    declare eid uuid; response jsonb; request_key text := 'qa025-fixture-event-'||md5(extract(epoch from instant)::text);
    begin
      select id into eid from public.family_return_events where workspace_id=wid and idempotency_key=request_key;
      if eid is null then
        response := public.flh_family_rewards_command(wid,actor,null,'return_event_create',jsonb_build_object('occurred_at',instant,'idempotency_key',request_key));
        if response->>'ok' is distinct from 'true' then raise exception 'Fixture return create failed: %',response->>'error'; end if;
        eid := (response->'return_event'->>'id')::uuid;
      end if;
      return eid;
    end $body$$definition$;

  select id into strict w from public.workspaces where slug='family-learning-hub';
  select id into strict l from public.learners where workspace_id=w and slug='test' and is_active and coalesce((metadata->>'is_test')::boolean,false);
  select to_jsonb(r),r.category_id into strict original_rule,greeting_category from public.behavior_rules r where id=greeting and workspace_id=w;
  select to_jsonb(s) into original_state from public.learner_gamification_state s where learner_id=l and workspace_id=w;
  select coalesce(jsonb_object_agg(s.id::text,md5(to_jsonb(s)::text)),'{}') into original_history from public.behavior_submissions s where learner_id=l and workspace_id=w;
  select coalesce(jsonb_object_agg(e.id::text,md5(to_jsonb(e)::text)),'{}') into original_ledger from public.gamification_events e where learner_id=l and workspace_id=w;
  -- Choose untouched Testing buckets even when this rollback contract is rerun on a local rebuild.
  select least(local_day,coalesce(min((occurred_at at time zone 'Europe/Istanbul')::date)-7,local_day)) into local_day
    from public.behavior_submissions where learner_id=l and workspace_id=w and rule_id=greeting;
  begin
    perform pg_temp.consolidated_assert(original_rule->>'title'='تقبيل يد الأب أو الأم عند العودة إلى المنزل'
      and (original_rule->>'base_points')::integer=2 and (original_rule->>'initiative_bonus_points')::integer=0
      and original_rule->>'cadence'='day' and (original_rule->>'max_awards')::integer=2
      and (select code='parental_respect' and title='الأدب وبرّ الوالدين' from public.behavior_categories where id=greeting_category and workspace_id=w),
      'canonical seed identity, category, price and shared cap');
    perform pg_temp.consolidated_assert(not has_function_privilege('anon','public.flh_family_rewards_command(uuid,uuid,uuid,text,jsonb)','EXECUTE')
      and not has_function_privilege('authenticated','public.flh_family_rewards_command(uuid,uuid,uuid,text,jsonb)','EXECUTE')
      and not has_table_privilege('authenticated','public.behavior_submissions','UPDATE')
      and not has_table_privilege('authenticated','public.gamification_events','INSERT')
      and not has_table_privilege('authenticated','public.learner_gamification_state','UPDATE'), 'service authority and direct financial writes remain closed');
    insert into auth.users(id,email) values(owner_id,'qa-consolidated-owner@example.invalid'),(admin_id,'qa-consolidated-admin@example.invalid'),(teacher_id,'qa-consolidated-teacher@example.invalid'),(outsider_id,'qa-consolidated-outsider@example.invalid');
    insert into public.workspace_members(workspace_id,user_id,role) values(w,owner_id,'owner'),(w,admin_id,'admin'),(w,teacher_id,'teacher');
    insert into public.learner_gamification_state(workspace_id,learner_id,xp,reward_points) values(w,l,240,20)
      on conflict(learner_id) do update set xp=240,reward_points=20;
    insert into public.behavior_categories(workspace_id,title) values(w,'QA consolidated snapshot') returning id into category_id;
    insert into public.behavior_rules(workspace_id,category_id,title,base_points,initiative_bonus_points,learner_scope,cadence,max_awards,self_report_allowed)
      values(w,category_id,'QA frozen original',5,3,'selected','unlimited',null,true) returning id into ordinary_rule;
    insert into public.behavior_rules(workspace_id,category_id,title,base_points,initiative_bonus_points,adhkar_bonus_points,congregation_bonus_points,mosque_bonus_points,sunnah_bonus_points,learner_scope,cadence,max_awards,self_report_allowed)
      values(w,category_id,'QA linked prayer',7,1,1,2,2,2,'selected','unlimited',null,true) returning id into prayer_rule;
    insert into public.behavior_rules(workspace_id,category_id,title,base_points,learner_scope,cadence,max_awards,self_report_allowed)
      values(w,category_id,'QA approval day',1,'selected','day',1,true) returning id into day_rule;
    insert into public.behavior_rules(workspace_id,category_id,title,base_points,learner_scope,cadence,max_awards,self_report_allowed)
      values(w,category_id,'QA approval week',1,'selected','week',1,true) returning id into week_rule;
    insert into public.behavior_rule_learners(workspace_id,rule_id,learner_id) values(w,ordinary_rule,l),(w,prayer_rule,l),(w,day_rule,l),(w,week_rule,l);
    update public.behavior_rules set learner_scope='selected',is_active=true,self_report_allowed=true where id=greeting and workspace_id=w;
    insert into public.behavior_rule_learners(workspace_id,rule_id,learner_id) values(w,greeting,l) on conflict do nothing;

    -- Client estimates never become awarded money. All seven captured numeric components are server values.
    result := public.flh_family_rewards_command(w,null,l,'behavior_submit',jsonb_build_object('rule_id',ordinary_rule,'initiative',true,'occurred_at',(local_day+time '10:00') at time zone 'Europe/Istanbul','idempotency_key','qa025-frozen-pending','base_points',999,'total_points',999,'snapshot',jsonb_build_object('total_points',999)));
    sid := (result->'submission'->>'id')::uuid; pending_snapshot := result->'submission'->'snapshot';
    perform pg_temp.consolidated_assert(result->>'ok'='true' and pending_snapshot->>'policy_version'='flh-010-v1.5'
      and pending_snapshot->>'status'='pending' and pending_snapshot ? 'captured_at'
      and pending_snapshot->>'rule_title'='QA frozen original' and (pending_snapshot->>'total_points')::integer=8
      and not exists(select 1 from unnest(components) key where jsonb_typeof(pending_snapshot->key) is distinct from 'number'), 'prospective complete snapshot ignores client amounts');
    perform pg_temp.consolidated_assert((select status='pending' and base_points=0 and initiative_bonus_points=0 and adhkar_bonus_points=0 and congregation_bonus_points=0 and mosque_bonus_points=0 and sunnah_bonus_points=0 and total_points=0 from public.behavior_submissions where id=sid)
      and (select reward_points=20 from public.learner_gamification_state where learner_id=l)
      and not exists(select 1 from public.gamification_events where source_type='family_behavior' and source_id=sid::text), 'pending capture is not a wallet award');
    update public.behavior_rules set title='QA edited price',base_points=9,initiative_bonus_points=4 where id=ordinary_rule;
    second := public.flh_family_rewards_command(w,null,l,'behavior_submit',jsonb_build_object('rule_id',ordinary_rule,'initiative',true,'occurred_at',(local_day+time '10:00') at time zone 'Europe/Istanbul','idempotency_key','qa025-frozen-pending'));
    perform pg_temp.consolidated_assert(second->>'already_recorded'='true' and second->'submission'->'snapshot'=pending_snapshot, 'retry preserves original captured estimate after rule edit');
    result := public.flh_family_rewards_command(w,owner_id,null,'behavior_review',jsonb_build_object('submission_id',sid,'decision','approved'));
    perform pg_temp.consolidated_assert(result->>'ok'='true' and (result->'submission'->>'total_points')::integer=8
      and result->'submission'->'snapshot'->>'rule_title'='QA frozen original'
      and result->'submission'->'snapshot'->'captured_at'=pending_snapshot->'captured_at'
      and result->'submission'->'snapshot'->>'status'='approved'
      and result->'submission'->'snapshot'->>'reviewer_id'=owner_id::text, 'approval honors capture and appends reviewer provenance');
    second := public.flh_family_rewards_command(w,admin_id,null,'behavior_review',jsonb_build_object('submission_id',sid,'decision','approved'));
    perform pg_temp.consolidated_assert(second->>'already_reviewed'='true'
      and (select count(*)=1 and sum(reward_points_delta)=8 and sum(xp_delta)=0 from public.gamification_events where source_type='family_behavior' and source_id=sid::text), 'second parent approval cannot award twice');

    -- Synthetic pre-feature pending row retains {} until review and uses current rule prices.
    insert into public.behavior_submissions(workspace_id,learner_id,rule_id,initiative,occurred_at,requester_type,idempotency_key)
      values(w,l,ordinary_rule,true,(local_day+time '11:00') at time zone 'Europe/Istanbul','learner','qa025-legacy-pending') returning id into legacy_sid;
    perform pg_temp.consolidated_assert((select snapshot='{}'::jsonb and total_points=0 from public.behavior_submissions where id=legacy_sid), 'no invented legacy capture');
    result := public.flh_family_rewards_command(w,owner_id,null,'behavior_review',jsonb_build_object('submission_id',legacy_sid,'decision','approved'));
    perform pg_temp.consolidated_assert(result->>'ok'='true' and (result->'submission'->>'total_points')::integer=13
      and not (result->'submission'->'snapshot' ? 'policy_version') and not (result->'submission'->'snapshot' ? 'captured_at'), 'legacy approval preserves current-policy fallback without retroactive provenance');

    -- Adjacent linked-prayer amounts survive edits to every bonus component.
    result := public.flh_family_rewards_command(w,null,l,'behavior_submit',jsonb_build_object('rule_id',prayer_rule,'initiative',true,'adhkar_completed',true,'congregation_completed',true,'mosque_completed',true,'sunnah_completed',true,'idempotency_key','qa025-prayer-pending'));
    sid := (result->'submission'->>'id')::uuid;
    perform pg_temp.consolidated_assert((result->'submission'->'snapshot'->>'total_points')::integer=15, 'linked prayer capture 7+1+1+2+2+2');
    update public.behavior_rules set base_points=1,initiative_bonus_points=0,adhkar_bonus_points=0,congregation_bonus_points=0,mosque_bonus_points=0,sunnah_bonus_points=0,is_active=false where id=prayer_rule;
    result := public.flh_family_rewards_command(w,owner_id,null,'behavior_review',jsonb_build_object('submission_id',sid,'decision','approved'));
    perform pg_temp.consolidated_assert(result->>'error'='RULE_INACTIVE', 'capture does not bypass current activity');
    update public.behavior_rules set is_active=true where id=prayer_rule;
    delete from public.behavior_rule_learners where rule_id=prayer_rule and learner_id=l;
    result := public.flh_family_rewards_command(w,owner_id,null,'behavior_review',jsonb_build_object('submission_id',sid,'decision','approved'));
    perform pg_temp.consolidated_assert(result->>'error'='RULE_SCOPE_FORBIDDEN', 'capture does not bypass current scope');
    insert into public.behavior_rule_learners(workspace_id,rule_id,learner_id) values(w,prayer_rule,l);
    result := public.flh_family_rewards_command(w,owner_id,null,'behavior_review',jsonb_build_object('submission_id',sid,'decision','approved'));
    perform pg_temp.consolidated_assert(result->>'ok'='true' and (result->'submission'->>'total_points')::integer=15
      and (result->'submission'->>'adhkar_bonus_points')::integer=1 and (result->'submission'->>'congregation_bonus_points')::integer=2
      and (result->'submission'->>'mosque_bonus_points')::integer=2 and (result->'submission'->>'sunnah_bonus_points')::integer=2, 'all linked prayer components use captured values');
    result := public.flh_family_rewards_command(w,null,l,'behavior_submit',jsonb_build_object('rule_id',prayer_rule,'adhkar_completed',true,'idempotency_key','qa025-unsupported-bonus'));
    perform pg_temp.consolidated_assert(result->>'error'='INVALID_INPUT', 'new unsupported prayer bonus remains rejected');

    -- Generic cadence stays UTC APPROVAL day/week, independent of old occurrence dates.
    foreach current_rule in array array[day_rule,week_rule] loop
      result := public.flh_family_rewards_command(w,null,l,'behavior_submit',jsonb_build_object('rule_id',current_rule,'occurred_at',((local_day+9)+time '08:00') at time zone 'Europe/Istanbul','idempotency_key','qa025-cadence-pending-'||current_rule));
      sid := (result->'submission'->>'id')::uuid;
      perform pg_temp.consolidated_assert(result->>'ok'='true', 'cadence fixture captures before another approval');
      result := public.flh_family_rewards_command(w,owner_id,l,'behavior_record',jsonb_build_object('rule_id',current_rule,'occurred_at',(local_day+time '08:00') at time zone 'Europe/Istanbul','idempotency_key','qa025-cadence-first-'||current_rule));
      second := public.flh_family_rewards_command(w,admin_id,l,'behavior_record',jsonb_build_object('rule_id',current_rule,'occurred_at',((local_day+8)+time '08:00') at time zone 'Europe/Istanbul','idempotency_key','qa025-cadence-second-'||current_rule));
      perform pg_temp.consolidated_assert(result->>'ok'='true' and second->>'error'='CADENCE_LIMIT', 'other rules retain approval-day/week cap for different occurrence days');
      second := public.flh_family_rewards_command(w,admin_id,null,'behavior_review',jsonb_build_object('submission_id',sid,'decision','approved'));
      perform pg_temp.consolidated_assert(second->>'error'='CADENCE_LIMIT' and (select status='pending' and total_points=0 from public.behavior_submissions where id=sid), 'captured amount does not bypass current cadence');
    end loop;

    -- Both parents share two slots. Boundary pair has the SAME UTC date and DIFFERENT local dates.
    occasion := (local_day+time '10:00') at time zone 'Europe/Istanbul';
    result := public.flh_family_rewards_command(w,owner_id,l,'behavior_record',jsonb_build_object('return_event_id',pg_temp.consolidated_return(w,owner_id,occasion),'rule_id',greeting,'occurred_at',occasion,'idempotency_key','qa025-greeting-first'));
    perform pg_temp.consolidated_assert(result->>'ok'='true' and (result->'submission'->>'total_points')::integer=2, 'first parent record awards exactly two');
    second := public.flh_family_rewards_command(w,owner_id,l,'behavior_record',jsonb_build_object('return_event_id',pg_temp.consolidated_return(w,owner_id,occasion),'rule_id',greeting,'occurred_at',occasion,'idempotency_key','qa025-greeting-first'));
    perform pg_temp.consolidated_assert(second->>'already_recorded'='true' and second->'submission'->>'id'=result->'submission'->>'id', 'same request retry retains event identity');
    second := public.flh_family_rewards_command(w,admin_id,l,'behavior_record',jsonb_build_object('return_event_id',pg_temp.consolidated_return(w,admin_id,occasion),'rule_id',greeting,'occurred_at',occasion,'idempotency_key','qa025-greeting-exact-alias'));
    perform pg_temp.consolidated_assert(second->>'error'='DUPLICATE_OCCURRENCE', 'same selected canonical fixture occasion across parents and keys cannot award twice');
    result := public.flh_family_rewards_command(w,admin_id,l,'behavior_record',jsonb_build_object('return_event_id',pg_temp.consolidated_return(w,admin_id,(local_day+time '23:59:59') at time zone 'Europe/Istanbul'),'rule_id',greeting,'occurred_at',(local_day+time '23:59:59') at time zone 'Europe/Istanbul','idempotency_key','qa025-greeting-second'));
    perform pg_temp.consolidated_assert(result->>'ok'='true' and (result->'submission'->>'total_points')::integer=2, 'other parent consumes second shared slot');
    result := public.flh_family_rewards_command(w,owner_id,l,'behavior_record',jsonb_build_object('return_event_id',pg_temp.consolidated_return(w,owner_id,(local_day+time '22:00') at time zone 'Europe/Istanbul'),'rule_id',greeting,'occurred_at',(local_day+time '22:00') at time zone 'Europe/Istanbul','idempotency_key','qa025-greeting-third'));
    perform pg_temp.consolidated_assert(result->>'error'='CADENCE_LIMIT' and not exists(select 1 from public.behavior_submissions where learner_id=l and idempotency_key='qa025-greeting-third'), 'third local-day record fails with no pending residue');
    perform pg_temp.consolidated_assert(((local_day+time '23:59:59') at time zone 'Europe/Istanbul' at time zone 'UTC')::date
      =(((local_day+1)+time '00:00:00') at time zone 'Europe/Istanbul' at time zone 'UTC')::date, 'rollover fixture crosses local midnight within one UTC day');
    result := public.flh_family_rewards_command(w,owner_id,l,'behavior_record',jsonb_build_object('return_event_id',pg_temp.consolidated_return(w,owner_id,((local_day+1)+time '00:00:00') at time zone 'Europe/Istanbul'),'rule_id',greeting,'occurred_at',((local_day+1)+time '00:00:00') at time zone 'Europe/Istanbul','idempotency_key','qa025-greeting-newday-one'));
    second := public.flh_family_rewards_command(w,admin_id,l,'behavior_record',jsonb_build_object('return_event_id',pg_temp.consolidated_return(w,admin_id,((local_day+1)+time '00:00:30') at time zone 'Europe/Istanbul'),'rule_id',greeting,'occurred_at',((local_day+1)+time '00:00:30') at time zone 'Europe/Istanbul','idempotency_key','qa025-greeting-newday-two'));
    perform pg_temp.consolidated_assert(result->>'ok'='true' and second->>'ok'='true', 'late approval uses separate occurrence-day bucket after local midnight');
    perform pg_temp.consolidated_assert((select count(*)=4 and sum(total_points)=8 from public.behavior_submissions where learner_id=l and rule_id=greeting and status='approved' and (occurred_at at time zone 'Europe/Istanbul')::date in (local_day,local_day+1)), 'two local dates each award four points maximum');
    insert into public.learners(id,workspace_id,display_name,slug,metadata) values(second_test_learner,w,'QA independent Testing bucket','qa025-independent-bucket','{"is_test":true,"exclude_from_parent_metrics":true}');
    insert into public.behavior_rule_learners(workspace_id,rule_id,learner_id) values(w,greeting,second_test_learner);
    result := public.flh_family_rewards_command(w,owner_id,second_test_learner,'behavior_record',jsonb_build_object('return_event_id',pg_temp.consolidated_return(w,owner_id,occasion),'rule_id',greeting,'occurred_at',occasion,'idempotency_key','qa025-independent-learner'));
    perform pg_temp.consolidated_assert(result->>'ok'='true' and (result->'submission'->>'total_points')::integer=2
      and (select reward_points=2 and xp=0 from public.learner_gamification_state where learner_id=second_test_learner), 'another Testing learner has an independent cap on the same local day');

    -- New self-reports remain parent-approved even if configuration says otherwise.
    update public.behavior_rules set parent_approval_required=false where id=greeting;
    select reward_points into before_points from public.learner_gamification_state where learner_id=l;
    occasion := ((local_day+2)+time '10:00') at time zone 'Europe/Istanbul';
    result := public.flh_family_rewards_command(w,null,l,'behavior_submit',jsonb_build_object('rule_id',greeting,'occurred_at',occasion,'idempotency_key','qa025-pending-identity-one'));
    sid := (result->'submission'->>'id')::uuid; pending_snapshot := result->'submission'->'snapshot';
    second := public.flh_family_rewards_command(w,null,l,'behavior_submit',jsonb_build_object('rule_id',greeting,'occurred_at',occasion,'idempotency_key','qa025-pending-identity-two'));
    perform pg_temp.consolidated_assert(result->>'ok'='true' and result->'submission'->>'status'='pending'
      and (result->'submission'->>'total_points')::integer=0 and (pending_snapshot->>'total_points')::integer=2
      and second->>'duplicate_pending'='true' and second->'submission'->>'id'=sid::text
      and second->'submission'->'snapshot'=pending_snapshot
      and (select reward_points=before_points from public.learner_gamification_state where learner_id=l), 'pending aliases reuse zero-award snapshot regardless of parent-approval setting');
    result := public.flh_family_rewards_command(w,teacher_id,null,'behavior_review',jsonb_build_object('submission_id',sid,'decision','approved'));
    second := public.flh_family_rewards_command(w,null,l,'behavior_review',jsonb_build_object('submission_id',sid,'decision','approved'));
    perform pg_temp.consolidated_assert(result->>'error'='PARENT_MANAGE_FORBIDDEN' and second->>'error'='PARENT_MANAGE_FORBIDDEN', 'learner and teacher cannot approve');
    result := public.flh_family_rewards_command(w,outsider_id,l,'parent_catalog','{}');
    perform pg_temp.consolidated_assert(result->>'error'='PARENT_MANAGE_FORBIDDEN', 'outsider cannot read this workspace family catalog');
    result := public.flh_family_rewards_command(w,owner_id,null,'behavior_review',jsonb_build_object('submission_id',sid,'decision','rejected'));
    perform pg_temp.consolidated_assert(result->>'ok'='true' and result->'submission'->>'status'='rejected'
      and (result->'submission'->>'total_points')::integer=0
      and not exists(select 1 from public.gamification_events where source_id=sid::text and source_type='family_behavior'), 'rejection grants neither points nor ledger');

    -- Canonical policy cannot be bypassed through rule_save or raw fixture configuration.
    result := public.flh_family_rewards_command(w,owner_id,null,'rule_save',jsonb_build_object('id',greeting,'category_id',greeting_category,'title','تقبيل يد الأب أو الأم عند العودة إلى المنزل','base_points',999,'initiative_bonus_points',0,'cadence','day','max_awards',2,'learner_scope','selected','learner_ids',jsonb_build_array(l)));
    perform pg_temp.consolidated_assert(result->>'error'='INVALID_INPUT', 'canonical price tamper rejected by management command');
    result := public.flh_family_rewards_command(w,owner_id,null,'rule_save',jsonb_build_object('id',greeting,'category_id',greeting_category,'title','تقبيل يد الأب أو الأم عند العودة إلى المنزل','base_points',2,'initiative_bonus_points',0,'cadence','unlimited','learner_scope','selected','learner_ids',jsonb_build_array(l)));
    perform pg_temp.consolidated_assert(result->>'error'='INVALID_INPUT', 'canonical cadence tamper rejected by management command');
    result := public.flh_family_rewards_command(w,owner_id,null,'rule_save',jsonb_build_object('id',greeting,'category_id',greeting_category,'title','تقبيل يد الأب أو الأم عند العودة إلى المنزل','base_points',2,'initiative_bonus_points',1,'cadence','day','max_awards',2,'learner_scope','selected','learner_ids',jsonb_build_array(l)));
    perform pg_temp.consolidated_assert(result->>'error'='INVALID_INPUT', 'canonical initiative price tamper rejected by management command');
    update public.behavior_rules set base_points=999,initiative_bonus_points=999,adhkar_bonus_points=999,congregation_bonus_points=999,mosque_bonus_points=999,sunnah_bonus_points=999,cadence='unlimited',max_awards=null where id=greeting;
    foreach modifier in array array['initiative','adhkar_completed','congregation_completed','mosque_completed','sunnah_completed'] loop
      result := public.flh_family_rewards_command(w,null,l,'behavior_submit',jsonb_build_object('rule_id',greeting,'idempotency_key','qa025-modifier-'||modifier)||jsonb_build_object(modifier,true));
      perform pg_temp.consolidated_assert(result->>'error'='INVALID_INPUT', 'canonical rule rejects every bonus modifier even with tampered config');
    end loop;
    for before_count in 1..3 loop
      result := public.flh_family_rewards_command(w,owner_id,l,'behavior_record',jsonb_build_object('return_event_id',pg_temp.consolidated_return(w,owner_id,(((local_day+3)+time '10:00') at time zone 'Europe/Istanbul')+before_count*interval '1 hour'),'rule_id',greeting,'occurred_at',(((local_day+3)+time '10:00') at time zone 'Europe/Istanbul')+before_count*interval '1 hour','idempotency_key','qa025-tamper-'||before_count));
      perform pg_temp.consolidated_assert(case when before_count<3 then result->>'ok'='true' and (result->'submission'->>'total_points')::integer=2 else result->>'error'='CADENCE_LIMIT' end, 'fixed two-point shared two-occurrence cap survives raw policy config changes');
    end loop;
    insert into public.behavior_submissions(workspace_id,learner_id,rule_id,initiative,occurred_at,requester_type,idempotency_key)
      values(w,l,greeting,true,((local_day+4)+time '10:00') at time zone 'Europe/Istanbul','learner','qa025-legacy-invalid-modifier') returning id into sid;
    result := public.flh_family_rewards_command(w,owner_id,null,'behavior_review',jsonb_build_object('return_event_id',pg_temp.consolidated_return(w,owner_id,((local_day+4)+time '10:00') at time zone 'Europe/Istanbul'),'submission_id',sid,'decision','approved'));
    perform pg_temp.consolidated_assert(result->>'error'='INVALID_INPUT' and (select status='pending' and total_points=0 from public.behavior_submissions where id=sid)
      and not exists(select 1 from public.gamification_events where source_type='family_behavior' and source_id=sid::text), 'legacy canonical bonus flags fail closed at approval');
    result := public.flh_family_rewards_command(w,null,l,'behavior_submit',jsonb_build_object('rule_id',ordinary_rule,'idempotency_key','qa025-malformed-capture'));
    sid := (result->'submission'->>'id')::uuid;
    update public.behavior_submissions set snapshot=jsonb_set(snapshot,'{total_points}','999'::jsonb) where id=sid;
    result := public.flh_family_rewards_command(w,owner_id,null,'behavior_review',jsonb_build_object('submission_id',sid,'decision','approved'));
    perform pg_temp.consolidated_assert(result->>'error'='INVALID_INPUT' and (select status='pending' and total_points=0 from public.behavior_submissions where id=sid)
      and not exists(select 1 from public.gamification_events where source_type='family_behavior' and source_id=sid::text), 'malformed marked capture cannot mint money');

    -- Existing claim path spends only real wallet money, once, and never XP.
    insert into public.gamification_rewards(workspace_id,title,reward_type,required_reward_points,learner_scope) values(w,'QA consolidated claim','activity',5,'selected') returning id into reward_id;
    insert into public.reward_learner_scopes(workspace_id,reward_id,learner_id) values(w,reward_id,l);
    result := public.flh_family_rewards_command(w,null,l,'reward_request',jsonb_build_object('reward_id',reward_id,'idempotency_key','qa025-claim-request'));
    cid := (result->'claim'->>'id')::uuid;
    perform pg_temp.consolidated_assert(result->>'ok'='true', 'adjacent reward request still authorized');
    result := public.flh_family_rewards_command(w,owner_id,null,'reward_review',jsonb_build_object('claim_id',cid,'decision','approved'));
    second := public.flh_family_rewards_command(w,admin_id,null,'reward_review',jsonb_build_object('claim_id',cid,'decision','approved'));
    perform pg_temp.consolidated_assert(result->>'ok'='true' and second->>'already_reviewed'='true'
      and (select count(*)=1 and sum(reward_points_delta)=-5 and sum(xp_delta)=0 from public.gamification_events where source_type='reward_claim' and source_id=cid::text), 'claim approval retries spend once without XP');
    result := public.flh_family_rewards_command(w,owner_id,null,'reward_redeem',jsonb_build_object('claim_id',cid));
    second := public.flh_family_rewards_command(w,admin_id,null,'reward_redeem',jsonb_build_object('claim_id',cid));
    perform pg_temp.consolidated_assert(result->'claim'->>'status'='redeemed' and second->>'already_redeemed'='true'
      and (select xp=240 from public.learner_gamification_state where learner_id=l), 'redeem is idempotent and all family changes preserve academic XP');
    perform pg_temp.consolidated_assert((select coalesce(jsonb_object_agg(s.id::text,md5(to_jsonb(s)::text)),'{}') from public.behavior_submissions s where s.learner_id=l and original_history ? s.id::text)=original_history
      and (select coalesce(jsonb_object_agg(e.id::text,md5(to_jsonb(e)::text)),'{}') from public.gamification_events e where e.learner_id=l and original_ledger ? e.id::text)=original_ledger, 'pre-existing Testing history remains byte-for-byte unchanged');
    raise exception 'Successful rollback' using errcode='ZX025';
  exception when sqlstate 'ZX025' then null;
  end;
  perform pg_temp.consolidated_assert((select to_jsonb(r)=original_rule from public.behavior_rules r where id=greeting)
    and (select to_jsonb(s) from public.learner_gamification_state s where learner_id=l) is not distinct from original_state
    and not exists(select 1 from auth.users where id in (owner_id,admin_id,teacher_id,outsider_id))
    and not exists(select 1 from public.learners where id=second_test_learner), 'successful contract rolls back fixture actors, wallet, independent learner and canonical rule configuration');
  perform pg_temp.consolidated_assert((select coalesce(jsonb_object_agg(s.id::text,md5(to_jsonb(s)::text)),'{}') from public.behavior_submissions s where s.learner_id=l)=original_history
    and (select coalesce(jsonb_object_agg(e.id::text,md5(to_jsonb(e)::text)),'{}') from public.gamification_events e where e.learner_id=l)=original_ledger, 'rollback removes every added Testing submission and ledger event');
  raise notice 'Consolidated family rewards rollback contract passed';
end
$contract$;
