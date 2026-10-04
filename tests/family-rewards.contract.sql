-- FLH-FEAT-2026-010 v1.1 with FLH-FEAT-2026-017 prayer/adhkar compatibility.
-- A dedicated caught success code rolls back every fixture; assertion errors propagate.
-- Active authenticated learner activity targets the seeded dedicated test learner.
do $contract$
declare
  w uuid;
  l uuid;
  owner_id constant uuid := '96000000-0000-4000-8000-000000000001';
  teacher_id constant uuid := '96000000-0000-4000-8000-000000000002';
  outsider_id constant uuid := '96000000-0000-4000-8000-000000000003';
  other_w constant uuid := '96000000-0000-4000-8000-000000000004';
  other_l constant uuid := '96000000-0000-4000-8000-000000000005';
  admin_id constant uuid := '96000000-0000-4000-8000-000000000006';
  inactive_l constant uuid := '96000000-0000-4000-8000-000000000007';
  cascade_l constant uuid := '96000000-0000-4000-8000-000000000008';
  cascade_category uuid;
  cascade_rule uuid;
  cascade_reward uuid;
  cascade_claim uuid;
  category_id uuid;
  rule_id uuid;
  week_rule uuid;
  duplicate_rule uuid;
  moved_category uuid;
  original_report_category uuid;
  snapshot_report_sid uuid;
  duplicate_warning_sid uuid;
  blocked_rule uuid;
  reward_id uuid;
  other_reward uuid;
  sid uuid;
  cid uuid;
  eid bigint;
  result jsonb;
  second jsonb;
  page jsonb;
  points_before integer;
  xp_before integer;
  count_before integer;
  n integer;
  payload jsonb;
  v_fk_rejected boolean := false;
  v_badge_id uuid;
  v_badge_code text;
  v_old_approved uuid;
  v_matrix record;
  v_matrix_reward uuid;
  v_matrix_claim uuid;
  v_missing_badge text := 'qa-family-required-badge';
  v_occurred_at timestamptz := now()-interval '1 hour';
begin
  execute $assert_definition$create or replace function pg_temp.family_assert(p_ok boolean,p_message text) returns void
    language plpgsql as $assert_body$begin if p_ok is distinct from true then raise exception 'Family rewards contract: %',p_message; end if; end$assert_body$$assert_definition$;
  begin
  select id into strict w from public.workspaces where slug='family-learning-hub';
  select id into strict l from public.learners where workspace_id=w and slug='test' and is_active and coalesce((metadata->>'is_test')::boolean,false);
  insert into auth.users(id,email) values(owner_id,'qa-family-owner@example.invalid'),(teacher_id,'qa-family-teacher@example.invalid'),(outsider_id,'qa-family-outsider@example.invalid'),(admin_id,'qa-family-admin@example.invalid');
  insert into public.workspace_members(workspace_id,user_id,role) values(w,owner_id,'owner'),(w,teacher_id,'teacher'),(w,admin_id,'admin');
  insert into public.workspaces(id,name,slug) values(other_w,'QA family other','qa-family-other');
  insert into public.workspace_members(workspace_id,user_id,role) values(other_w,outsider_id,'owner');
  insert into public.learners(id,workspace_id,display_name,slug,metadata) values(other_l,other_w,'QA isolated test','test','{"is_test":true}');
  insert into public.learners(id,workspace_id,display_name,slug,is_active,metadata) values(inactive_l,w,'QA unassigned inactive','qa-inactive',false,'{"is_test":true}');
  insert into public.learner_gamification_state(workspace_id,learner_id,xp,reward_points,current_streak,longest_streak) values(w,l,240,20,2,3)
    on conflict(learner_id) do update set xp=240,reward_points=20,current_level=1,current_streak=2,longest_streak=3;
  select xp,reward_points into xp_before,points_before from public.learner_gamification_state where learner_id=l;
  select id,code into strict v_badge_id,v_badge_code from public.gamification_badges where workspace_id=w limit 1;
  update public.gamification_badges set is_active=false where id=v_badge_id;
  insert into public.learner_badges(workspace_id,learner_id,badge_id,award_reason) values(w,l,v_badge_id,'QA inactive earned badge') on conflict(learner_id,badge_id) do nothing;
  perform pg_temp.family_assert(not has_function_privilege('anon','public.flh_family_rewards_command(uuid,uuid,uuid,text,jsonb)','EXECUTE') and not has_function_privilege('authenticated','public.flh_family_rewards_command(uuid,uuid,uuid,text,jsonb)','EXECUTE'),'RPC must be service-role only');
  perform pg_temp.family_assert(not has_table_privilege('authenticated','public.gamification_events','UPDATE') and not has_table_privilege('authenticated','public.gamification_events','DELETE') and not has_table_privilege('authenticated','public.learner_gamification_state','UPDATE') and not has_table_privilege('authenticated','public.reward_claims','UPDATE'),'financial writes cannot bypass server commands');
  perform pg_temp.family_assert(not has_function_privilege('authenticated','public.flh_family_reward_eligibility(uuid,uuid,uuid)','EXECUTE'),'eligibility helper must not bypass learner isolation');
  perform pg_temp.family_assert(not has_function_privilege('authenticated','public.flh_family_reward_criteria_valid(jsonb)','EXECUTE'),'criteria helper remains service-role only');
  perform pg_temp.family_assert((select not prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='public.flh_family_rewards_command(uuid,uuid,uuid,text,jsonb)'::regprocedure),'RPC uses invoker and empty search_path');

  set local role service_role;
  result := public.flh_family_rewards_command(w,teacher_id,null,'category_save','{"title":"Denied"}');
  perform pg_temp.family_assert(result->>'error'='PARENT_MANAGE_FORBIDDEN','teacher cannot manage family points');
  result := public.flh_family_rewards_command(w,outsider_id,null,'parent_catalog','{}');
  perform pg_temp.family_assert(result->>'error'='PARENT_MANAGE_FORBIDDEN','other-workspace owner cannot read');
  result := public.flh_family_rewards_command(w,null,l,'points_adjust','{"delta":99,"reason":"spoof","idempotency_key":"spoof-adjust"}');
  perform pg_temp.family_assert(result->>'error'='PARENT_MANAGE_FORBIDDEN','learner cannot adjust points');
  result := public.flh_family_rewards_command(w,null,null,'student_ledger','{}');
  perform pg_temp.family_assert(result->>'error'='LEARNER_NOT_FOUND','missing learner cannot read all ledger');
  result := public.flh_family_rewards_command(w,owner_id,null,'category_save','{"title":"QA responsibility"}');
  perform pg_temp.family_assert(result->>'ok'='true','parent category create');
  category_id := (result->'category'->>'id')::uuid;
  payload := jsonb_build_object('category_id',category_id,'title','QA tidy room','base_points',5,'initiative_bonus_points',3,'learner_scope','selected','learner_ids',jsonb_build_array(l),'cadence','day','max_awards',1,'self_report_allowed',true);
  result := public.flh_family_rewards_command(w,owner_id,null,'rule_save',payload);
  perform pg_temp.family_assert(result->>'ok'='true','parent rule create'); rule_id := (result->'rule'->>'id')::uuid;
  result := public.flh_family_rewards_command(w,owner_id,null,'rule_save',payload||jsonb_build_object('learner_ids',jsonb_build_array(other_l)));
  perform pg_temp.family_assert(result->>'error'='INVALID_SCOPE','scope cannot cross workspace');
  result := public.flh_family_rewards_command(w,owner_id,l,'behavior_record',jsonb_build_object('rule_id',rule_id,'adhkar_completed',true,'reason','QA invalid adhkar','idempotency_key','qa-family-adhkar-blocked'));
  perform pg_temp.family_assert(result->>'error'='INVALID_INPUT' and (select reward_points from public.learner_gamification_state where learner_id=l)=20,'adhkar cannot be claimed on a rule with no configured adhkar bonus');
  update public.behavior_rules set adhkar_bonus_points=2 where id=rule_id and workspace_id=w;
  result := public.flh_family_rewards_command(w,owner_id,l,'behavior_record',jsonb_build_object('rule_id',rule_id,'initiative',true,'adhkar_completed',true,'reason','QA direct behavior','idempotency_key','qa-family-direct'));
  perform pg_temp.family_assert(result->>'ok'='true' and result->'submission'->>'status'='approved' and result->'submission'->>'base_points'='5' and result->'submission'->>'initiative_bonus_points'='3' and result->'submission'->>'adhkar_bonus_points'='2' and result->'submission'->>'total_points'='10' and result->'submission'->'snapshot'->>'adhkar_completed'='true' and result->>'reward_points'='30','base, initiative and linked adhkar award separately in one event');
  sid := (result->'submission'->>'id')::uuid;
  second := public.flh_family_rewards_command(w,owner_id,l,'behavior_record',jsonb_build_object('rule_id',rule_id,'initiative',true,'adhkar_completed',true,'reason','QA direct behavior','idempotency_key','qa-family-direct'));
  perform pg_temp.family_assert(second->>'already_recorded'='true' and second->'submission'->>'id'=sid::text,'duplicate parent prayer record is idempotent');
  result := public.flh_family_rewards_command(w,owner_id,l,'behavior_record',jsonb_build_object('rule_id',rule_id,'initiative',true,'adhkar_completed',false,'reason','QA direct behavior','idempotency_key','qa-family-direct'));
  perform pg_temp.family_assert(result->>'error'='IDEMPOTENCY_CONFLICT','same prayer key cannot silently change the adhkar selection');
  result := public.flh_family_rewards_command(w,owner_id,l,'behavior_record',jsonb_build_object('rule_id',rule_id,'initiative',true,'adhkar_completed',true,'reason','Changed reason','idempotency_key','qa-family-direct'));
  perform pg_temp.family_assert(result->>'error'='IDEMPOTENCY_CONFLICT','parent key cannot discard a changed reason');
  result := public.flh_family_rewards_command(w,owner_id,l,'behavior_record',jsonb_build_object('rule_id',rule_id,'initiative',true,'adhkar_completed',true,'reason','QA direct behavior','occurred_at',v_occurred_at,'idempotency_key','qa-family-direct'));
  perform pg_temp.family_assert(result->>'error'='IDEMPOTENCY_CONFLICT','parent key cannot add an explicit occurrence time to an omitted-time request');
  result := public.flh_family_rewards_command(w,admin_id,l,'behavior_record',jsonb_build_object('rule_id',rule_id,'initiative',true,'adhkar_completed',true,'reason','QA direct behavior','idempotency_key','qa-family-direct'));
  perform pg_temp.family_assert(result->>'error'='IDEMPOTENCY_CONFLICT','parent request key is bound to the original verified actor');
  perform pg_temp.family_assert((select reward_points from public.learner_gamification_state where learner_id=l)=30 and (select reason from public.behavior_submissions where id=sid)='QA direct behavior','conflicting parent reuse changes no balance or audit reason');
  result := public.flh_family_rewards_command(w,owner_id,l,'behavior_record',jsonb_build_object('rule_id',rule_id,'occurred_at',now()-interval '1 day','idempotency_key','qa-family-farm'));
  perform pg_temp.family_assert(result->>'error'='CADENCE_LIMIT','past occurred_at cannot farm daily award');
  result := public.flh_family_rewards_command(w,null,l,'behavior_submit',jsonb_build_object('rule_id',rule_id,'idempotency_key','qa-family-daily-pending'));
  sid := (result->'submission'->>'id')::uuid;
  result := public.flh_family_rewards_command(w,owner_id,null,'behavior_review',jsonb_build_object('submission_id',sid,'decision','approved'));
  perform pg_temp.family_assert(result->>'error'='CADENCE_LIMIT','learner pending approval enforces daily limit');
  result := public.flh_family_rewards_command(w,owner_id,null,'behavior_review',jsonb_build_object('submission_id',sid,'decision','rejected','reason','QA rejected'));
  perform pg_temp.family_assert(result->'submission'->>'status'='rejected','parent rejects pending behavior');
  result := public.flh_family_rewards_command(w,owner_id,null,'behavior_review',jsonb_build_object('submission_id',sid,'decision','approved'));
  perform pg_temp.family_assert(result->>'error'='INVALID_TRANSITION','cannot approve already rejected behavior');

  result := public.flh_family_rewards_command(w,owner_id,null,'rule_save',payload||jsonb_build_object('title','QA weekly','base_points',4,'initiative_bonus_points',2,'cadence','week','max_awards',2,'parent_approval_required',false));
  week_rule := (result->'rule'->>'id')::uuid;
  result := public.flh_family_rewards_command(w,owner_id,null,'rule_save',payload||jsonb_build_object('title','QA duplicate occurrence','base_points',2,'initiative_bonus_points',0,'cadence','unlimited','max_awards',null,'parent_approval_required',true));
  duplicate_rule := (result->'rule'->>'id')::uuid;
  result := public.flh_family_rewards_command(w,null,l,'behavior_submit',jsonb_build_object('rule_id',duplicate_rule,'occurred_at',v_occurred_at-interval '10 minutes','reason','QA duplicate pending','idempotency_key','qa-duplicate-pending-a'));
  sid := (result->'submission'->>'id')::uuid;
  second := public.flh_family_rewards_command(w,null,l,'behavior_submit',jsonb_build_object('rule_id',duplicate_rule,'occurred_at',v_occurred_at-interval '10 minutes','reason','QA duplicate pending retry','idempotency_key','qa-duplicate-pending-b'));
  perform pg_temp.family_assert(second->>'duplicate_pending'='true' and second->'submission'->>'id'=sid::text,'exact pending occurrence with a new request key reuses the existing pending submission');
  perform pg_temp.family_assert((select count(*) from public.behavior_submissions s where s.workspace_id=w and s.learner_id=l and s.rule_id=duplicate_rule and s.status='pending' and s.occurred_at=v_occurred_at-interval '10 minutes')=1,'exact pending duplicate creates one row only');
  result := public.flh_family_rewards_command(w,owner_id,null,'behavior_review',jsonb_build_object('submission_id',sid,'decision','rejected','reason','QA duplicate pending cleanup'));
  perform pg_temp.family_assert(result->'submission'->>'status'='rejected','duplicate pending fixture can be rejected without points');

  insert into public.behavior_submissions(workspace_id,learner_id,rule_id,initiative,occurred_at,requester_type,reason,idempotency_key,status,requested_at,approved_at,base_points,initiative_bonus_points,total_points,request_payload)
  values(w,l,duplicate_rule,false,v_occurred_at-interval '20 minutes','learner','QA legacy approved duplicate','qa-legacy-approved-duplicate','approved',now()-interval '20 minutes',now()-interval '19 minutes',2,0,2,'{}'::jsonb);
  select reward_points into points_before from public.learner_gamification_state where learner_id=l;
  result := public.flh_family_rewards_command(w,owner_id,l,'behavior_record',jsonb_build_object('rule_id',duplicate_rule,'occurred_at',v_occurred_at-interval '20 minutes','reason','QA duplicate direct','idempotency_key','qa-duplicate-direct'));
  perform pg_temp.family_assert(result->>'error'='DUPLICATE_OCCURRENCE','direct parent record cannot award an already approved exact occurrence');
  perform pg_temp.family_assert((select reward_points from public.learner_gamification_state where learner_id=l)=points_before and not exists(select 1 from public.behavior_submissions s where s.workspace_id=w and s.learner_id=l and s.idempotency_key='qa-duplicate-direct'),'blocked direct duplicate leaves neither points nor a pending submission');
  result := public.flh_family_rewards_command(w,null,l,'behavior_submit',jsonb_build_object('rule_id',duplicate_rule,'occurred_at',v_occurred_at-interval '20 minutes','reason','QA legacy pending duplicate','idempotency_key','qa-legacy-pending-duplicate'));
  sid := (result->'submission'->>'id')::uuid;
  select reward_points into points_before from public.learner_gamification_state where learner_id=l;
  result := public.flh_family_rewards_command(w,owner_id,null,'behavior_review',jsonb_build_object('submission_id',sid,'decision','approved'));
  perform pg_temp.family_assert(result->>'error'='DUPLICATE_OCCURRENCE','approval blocks a second award for an already approved exact occurrence');
  perform pg_temp.family_assert((select reward_points from public.learner_gamification_state where learner_id=l)=points_before and not exists(select 1 from public.gamification_events where workspace_id=w and source_type='family_behavior' and source_id=sid::text),'duplicate approval changes neither balance nor ledger');
  result := public.flh_family_rewards_command(w,owner_id,null,'behavior_review',jsonb_build_object('submission_id',sid,'decision','rejected','reason','QA duplicate approval cleanup'));
  perform pg_temp.family_assert(result->'submission'->>'status'='rejected','blocked duplicate remains reviewable for rejection');
  result := public.flh_family_rewards_command(w,null,l,'behavior_submit',jsonb_build_object('rule_id',week_rule,'initiative',true,'reason','QA self report','occurred_at',v_occurred_at,'idempotency_key','qa-family-self'));
  perform pg_temp.family_assert(result->'submission'->>'status'='pending' and result->'submission'->>'total_points'='0','even false policy self report stays pending and zero'); sid := (result->'submission'->>'id')::uuid;
  second := public.flh_family_rewards_command(w,null,l,'behavior_submit',jsonb_build_object('rule_id',week_rule,'initiative',true,'reason','QA self report','occurred_at',to_char((v_occurred_at at time zone 'UTC')+interval '3 hours','YYYY-MM-DD"T"HH24:MI:SS.US')||'+03:00','idempotency_key','qa-family-self'));
  perform pg_temp.family_assert(second->'submission'->>'id'=sid::text,'duplicate self report one pending submission');
  result := public.flh_family_rewards_command(w,null,l,'behavior_submit',jsonb_build_object('rule_id',week_rule,'initiative',true,'reason','Changed self-report reason','occurred_at',v_occurred_at,'idempotency_key','qa-family-self'));
  perform pg_temp.family_assert(result->>'error'='IDEMPOTENCY_CONFLICT','learner key cannot discard changed reason');
  result := public.flh_family_rewards_command(w,null,l,'behavior_submit',jsonb_build_object('rule_id',week_rule,'initiative',true,'reason','QA self report','occurred_at',v_occurred_at-interval '1 minute','idempotency_key','qa-family-self'));
  perform pg_temp.family_assert(result->>'error'='IDEMPOTENCY_CONFLICT','learner key cannot discard changed occurrence time');
  result := public.flh_family_rewards_command(w,null,l,'behavior_submit',jsonb_build_object('rule_id',week_rule,'initiative',true,'reason','QA self report','idempotency_key','qa-family-self'));
  perform pg_temp.family_assert(result->>'error'='IDEMPOTENCY_CONFLICT','learner cannot omit originally explicit occurrence time on retry');
  perform pg_temp.family_assert((select reward_points from public.learner_gamification_state where learner_id=l)=30 and (select occurred_at=v_occurred_at and reason='QA self report' and status='pending' from public.behavior_submissions where id=sid),'conflicting self-report reuse changes no balance or audit fields');
  result := public.flh_family_rewards_command(w,owner_id,null,'behavior_review',jsonb_build_object('submission_id',sid,'decision','approved','reason','QA confirmed'));
  perform pg_temp.family_assert(result->>'reward_points'='36' and result->'submission'->>'total_points'='6','parent review adds correct points');
  result := public.flh_family_rewards_command(w,owner_id,null,'behavior_review',jsonb_build_object('submission_id',sid,'decision','approved'));
  perform pg_temp.family_assert(result->>'already_reviewed'='true','repeated approval no double-award');
  result := public.flh_family_rewards_command(w,owner_id,null,'behavior_review',jsonb_build_object('submission_id',sid,'decision','rejected'));
  perform pg_temp.family_assert(result->>'error'='INVALID_TRANSITION','opposite stale behavior decision must not report success');
  result := public.flh_family_rewards_command(w,owner_id,l,'behavior_record',jsonb_build_object('rule_id',week_rule,'idempotency_key','qa-family-week-second'));
  perform pg_temp.family_assert(result->>'reward_points'='40','second weekly award');
  result := public.flh_family_rewards_command(w,owner_id,l,'behavior_record',jsonb_build_object('rule_id',week_rule,'idempotency_key','qa-family-week-third'));
  perform pg_temp.family_assert(result->>'error'='CADENCE_LIMIT','N weekly limit enforced');
  result := public.flh_family_rewards_command(w,owner_id,null,'rule_save',payload||jsonb_build_object('title','QA blocked','self_report_allowed',false,'cadence','unlimited'));
  blocked_rule := (result->'rule'->>'id')::uuid;
  result := public.flh_family_rewards_command(w,null,l,'behavior_submit',jsonb_build_object('rule_id',blocked_rule,'idempotency_key','qa-family-forbidden'));
  perform pg_temp.family_assert(result->>'error'='SELF_REPORT_FORBIDDEN','learner only self reports explicit rules');
  result := public.flh_family_rewards_command(w,null,other_l,'behavior_submit',jsonb_build_object('rule_id',week_rule,'idempotency_key','qa-family-cross'));
  perform pg_temp.family_assert(result->>'error'='LEARNER_NOT_FOUND','foreign learner blocked');

  insert into public.behavior_submissions(workspace_id,learner_id,rule_id,initiative,occurred_at,requester_type,reason,idempotency_key,status,requested_at,approved_at,base_points,initiative_bonus_points,total_points)
  select w,l,duplicate_rule,false,now()-(g||' minutes')::interval,'parent','QA report history','qa-report-'||g,'approved',now()-(g||' minutes')::interval,now()-(g||' minutes')::interval,2,0,2
  from generate_series(1,9) g;
  result := public.flh_family_rewards_command(w,null,l,'student_report',jsonb_build_object('period','last7','category_id',category_id,'rule_id',duplicate_rule));
  perform pg_temp.family_assert(result->>'ok'='true' and jsonb_array_length(result->'rows')=7 and result->'summary'->>'approved_count'='7' and result->'summary'->>'pending_count'='0' and result->'summary'->>'total_points'='14','student Last 7 report is complete for its exact filtered window');
  result := public.flh_family_rewards_command(w,owner_id,l,'parent_report',jsonb_build_object('period','last30','category_id',category_id,'rule_id',duplicate_rule));
  perform pg_temp.family_assert(result->>'ok'='true' and jsonb_array_length(result->'rows')=12 and result->'summary'->>'approved_count'='10' and result->'summary'->>'pending_count'='0' and result->'summary'->>'total_points'='20','parent Last 30 days report is not capped by dashboard history and aggregates the full filtered period');
  perform pg_temp.family_assert(not exists(select 1 from jsonb_array_elements(result->'rows') x where x->>'learner_id'<>l::text or x->>'rule_id'<>duplicate_rule::text),'report rows remain learner and rule scoped');

  original_report_category := category_id;
  insert into public.behavior_submissions(
    workspace_id,learner_id,rule_id,initiative,occurred_at,requester_type,reason,idempotency_key,status,
    requested_at,approved_at,base_points,initiative_bonus_points,total_points,snapshot
  )
  values(
    w,l,duplicate_rule,false,now()-interval '2 minutes','parent','QA snapshotted category history','qa-report-snapshot-category','approved',
    now()-interval '2 minutes',now()-interval '2 minutes',2,0,2,
    jsonb_build_object(
      'category_id',original_report_category,
      'category_title',(select title from public.behavior_categories where id=original_report_category and workspace_id=w),
      'rule_id',duplicate_rule,
      'rule_title','QA duplicate occurrence',
      'status','approved'
    )
  )
  returning id into snapshot_report_sid;
  result := public.flh_family_rewards_command(w,owner_id,null,'category_save',jsonb_build_object('title','QA moved category','description','moved for report history test','is_active',true));
  moved_category := (result->'category'->>'id')::uuid;
  update public.behavior_rules set category_id=moved_category where id=duplicate_rule and workspace_id=w;

  result := public.flh_family_rewards_command(w,owner_id,l,'parent_report',jsonb_build_object('period','last30','category_id',original_report_category));
  perform pg_temp.family_assert(
    exists(
      select 1
      from jsonb_array_elements(result->'rows') x
      where x->>'id'=snapshot_report_sid::text
        and x->>'category_id'=original_report_category::text
        and x->>'category_title'=(select title from public.behavior_categories where id=original_report_category and workspace_id=w)
    ),
    'approved report history stays under its snapshotted category after the rule moves'
  );
  result := public.flh_family_rewards_command(w,owner_id,l,'parent_report',jsonb_build_object('period','last30','category_id',moved_category));
  perform pg_temp.family_assert(
    not exists(select 1 from jsonb_array_elements(result->'rows') x where x->>'id'=snapshot_report_sid::text),
    'moved rule current category does not relabel snapshotted approved history'
  );
  update public.behavior_rules set category_id=original_report_category where id=duplicate_rule and workspace_id=w;

  result := public.flh_family_rewards_command(w,owner_id,null,'parent_report','{"period":"last7"}');
  perform pg_temp.family_assert(result->>'error'='LEARNER_NOT_FOUND','parent report cannot read across learners without an explicit scoped learner');

  insert into public.behavior_submissions(
    workspace_id,learner_id,rule_id,initiative,occurred_at,requester_type,reason,idempotency_key,status,
    requested_at,approved_at,base_points,initiative_bonus_points,total_points,snapshot
  )
  select
    w,l,duplicate_rule,false,v_occurred_at-(g||' minutes')::interval,'parent','QA duplicate-warning approved history',
    'qa-warning-approved-'||g,'approved',v_occurred_at-(g||' minutes')::interval,v_occurred_at-(g||' minutes')::interval,
    2,0,2,jsonb_build_object('category_id',category_id,'rule_id',duplicate_rule,'status','approved')
  from generate_series(1,205) g;
  insert into public.behavior_submissions(
    workspace_id,learner_id,rule_id,initiative,occurred_at,requester_type,reason,idempotency_key,status,requested_at
  )
  values(
    w,l,duplicate_rule,false,v_occurred_at-interval '205 minutes','learner','QA duplicate-warning pending',
    'qa-warning-pending','pending',v_occurred_at
  )
  returning id into duplicate_warning_sid;
  result := public.flh_family_rewards_command(w,owner_id,null,'parent_catalog','{"test_only":true}');
  perform pg_temp.family_assert(
    exists(
      select 1
      from jsonb_array_elements(result->'submissions') x
      where x->>'id'=duplicate_warning_sid::text
        and x->>'status'='pending'
        and x->>'possible_duplicate'='true'
    ),
    'pending duplicate warning checks complete approved history beyond the dashboard 200-row display cap'
  );
  delete from public.behavior_submissions
  where workspace_id=w and learner_id=l and idempotency_key like 'qa-warning-%';

  payload := jsonb_build_object('title','QA family reward','reward_type','activity','required_reward_points',10,'required_level',1,'learner_scope','selected','learner_ids',jsonb_build_array(l),'max_redemptions_per_learner',1,'criteria',jsonb_build_object('min_xp',200,'current_streak',2));
  result := public.flh_family_rewards_command(w,owner_id,null,'reward_save',payload);
  perform pg_temp.family_assert(result->>'ok'='true','parent reward create'); reward_id := (result->'reward'->>'id')::uuid;
  for v_matrix in select * from (values
    ('negative points','{"required_reward_points":-1}'::jsonb),
    ('zero level','{"required_level":0}'::jsonb),
    ('zero redemption limit','{"max_redemptions_per_learner":0}'::jsonb),
    ('reversed dates','{"available_from":"2030-01-02T00:00:00Z","available_until":"2030-01-01T00:00:00Z"}'::jsonb)
  ) invalid_reward_case(code,restriction) loop
    result := public.flh_family_rewards_command(w,owner_id,null,'reward_save',payload||jsonb_build_object('id',reward_id)||v_matrix.restriction);
    perform pg_temp.family_assert(result->>'error'='INVALID_INPUT','database constraint rejects reward '||v_matrix.code);
    perform pg_temp.family_assert((select required_reward_points=10 and required_level=1 and max_redemptions_per_learner=1 and available_from is null and available_until is null from public.gamification_rewards where id=reward_id),'failed reward validation persists no edit');
  end loop;
  result := public.flh_family_rewards_command(w,owner_id,null,'reward_save',payload||'{"criteria":{"unknown":1}}');
  perform pg_temp.family_assert(result->>'error'='INVALID_CRITERIA','unknown reward criteria cannot silently pass');
  result := public.flh_family_rewards_command(w,owner_id,null,'reward_save',payload||'{"criteria":{"min_xp":2147483648}}');
  perform pg_temp.family_assert(result->>'error'='INVALID_CRITERIA','oversized eligibility integer is rejected before persistence');
  second := public.flh_family_rewards_command(w,null,l,'student_catalog','{}');
  perform pg_temp.family_assert(second->>'ok'='true','rejected oversized criterion cannot brick learner dashboard');
  insert into public.gamification_badges(workspace_id,code,title) values(w,v_missing_badge,'QA required unearned badge');
  for v_matrix in select * from (values
    ('level','{"required_level":2}'::jsonb,'LEVEL_REQUIRED'),
    ('xp','{"criteria":{"min_xp":241}}'::jsonb,'XP_REQUIRED'),
    ('current-streak','{"criteria":{"current_streak":3}}'::jsonb,'STREAK_REQUIRED'),
    ('longest-streak','{"criteria":{"longest_streak":4}}'::jsonb,'STREAK_REQUIRED'),
    ('badge',jsonb_build_object('criteria',jsonb_build_object('required_badge_codes',jsonb_build_array(v_missing_badge))),'BADGE_REQUIRED'),
    ('selected-scope','{}'::jsonb,'REWARD_SCOPE_FORBIDDEN')
  ) eligibility_case(code,restriction,expected_error) loop
    result := public.flh_family_rewards_command(w,owner_id,null,'reward_save',payload||jsonb_build_object('title','QA eligibility '||v_matrix.code));
    v_matrix_reward := (result->'reward'->>'id')::uuid;
    result := public.flh_family_rewards_command(w,owner_id,null,'reward_save',payload||jsonb_build_object('id',v_matrix_reward,'title','QA eligibility '||v_matrix.code)||v_matrix.restriction);
    if v_matrix.code='selected-scope' then delete from public.reward_learner_scopes scopes where scopes.reward_id=v_matrix_reward and scopes.workspace_id=w; end if;
    result := public.flh_family_rewards_command(w,null,l,'reward_request',jsonb_build_object('reward_id',v_matrix_reward,'idempotency_key','qa-matrix-blocked-'||v_matrix.code));
    perform pg_temp.family_assert(result->>'error'=v_matrix.expected_error,'request enforces '||v_matrix.code);
    perform pg_temp.family_assert(not exists(select 1 from public.reward_claims claims where claims.reward_id=v_matrix_reward),'ineligible request persists no claim');
    result := public.flh_family_rewards_command(w,owner_id,null,'reward_save',payload||jsonb_build_object('id',v_matrix_reward,'title','QA eligibility '||v_matrix.code));
    result := public.flh_family_rewards_command(w,null,l,'reward_request',jsonb_build_object('reward_id',v_matrix_reward,'idempotency_key','qa-matrix-pending-'||v_matrix.code));
    perform pg_temp.family_assert(result->'claim'->>'status'='pending','valid request precedes changed criterion');
    v_matrix_claim := (result->'claim'->>'id')::uuid;
    result := public.flh_family_rewards_command(w,owner_id,null,'reward_save',payload||jsonb_build_object('id',v_matrix_reward,'title','QA eligibility '||v_matrix.code)||v_matrix.restriction);
    if v_matrix.code='selected-scope' then delete from public.reward_learner_scopes scopes where scopes.reward_id=v_matrix_reward and scopes.workspace_id=w; end if;
    result := public.flh_family_rewards_command(w,owner_id,null,'reward_review',jsonb_build_object('claim_id',v_matrix_claim,'decision','approved'));
    perform pg_temp.family_assert(result->>'error'=v_matrix.expected_error,'approval revalidates '||v_matrix.code);
    perform pg_temp.family_assert((select reward_points from public.learner_gamification_state where learner_id=l)=40 and not exists(select 1 from public.gamification_events where source_type='reward_claim' and source_id=v_matrix_claim::text),'failed eligibility approval changes no points or spend event');
    result := public.flh_family_rewards_command(w,owner_id,null,'reward_review',jsonb_build_object('claim_id',v_matrix_claim,'decision','rejected'));
  end loop;
  -- Older stored rows bypassed today's save boundary; malformed criteria must not grant or brick reads.
  for v_matrix in select * from (values
    ('unsupported','{"legacy_unrecognized_gate":1}'::jsonb),
    ('badge-array','{"required_badge_codes":"bad-shape"}'::jsonb),
    ('badge-element','{"required_badge_codes":[123]}'::jsonb),
    ('overflow','{"min_xp":2147483648}'::jsonb),
    ('numeric-text','{"current_streak":"bad-number"}'::jsonb),
    ('non-object','[]'::jsonb)
  ) legacy_criterion(code,criteria) loop
    insert into public.gamification_rewards(workspace_id,title,reward_type,required_reward_points,required_level,learner_scope,criteria)
      values(w,'QA legacy '||v_matrix.code,'custom',1,1,'selected',v_matrix.criteria) returning id into v_matrix_reward;
    insert into public.reward_learner_scopes(workspace_id,reward_id,learner_id) values(w,v_matrix_reward,l);
    second := public.flh_family_rewards_command(w,null,l,'student_catalog','{}');
    perform pg_temp.family_assert(second->>'ok'='true' and exists(select 1 from jsonb_array_elements(second->'rewards') x where x->>'id'=v_matrix_reward::text and x->>'eligible'='false' and x->'ineligibility_reasons'='["INVALID_CRITERIA"]'::jsonb),'legacy '||v_matrix.code||' remains readable and fails closed');
    result := public.flh_family_rewards_command(w,null,l,'reward_request',jsonb_build_object('reward_id',v_matrix_reward,'idempotency_key','qa-legacy-'||v_matrix.code));
    perform pg_temp.family_assert(result->>'error'='INVALID_CRITERIA' and not exists(select 1 from public.reward_claims claims where claims.reward_id=v_matrix_reward),'legacy invalid criteria cannot create claim');
    insert into public.reward_claims(workspace_id,learner_id,reward_id) values(w,l,v_matrix_reward) returning id into v_matrix_claim;
    result := public.flh_family_rewards_command(w,owner_id,null,'reward_review',jsonb_build_object('claim_id',v_matrix_claim,'decision','approved'));
    perform pg_temp.family_assert(result->>'error'='INVALID_CRITERIA' and (select status='pending' and points_spent=0 from public.reward_claims where id=v_matrix_claim),'legacy invalid criteria cannot approve existing pending claim');
    perform pg_temp.family_assert((select reward_points from public.learner_gamification_state where learner_id=l)=40 and not exists(select 1 from public.gamification_events where source_type='reward_claim' and source_id=v_matrix_claim::text) and (select criteria from public.gamification_rewards where id=v_matrix_reward)=v_matrix.criteria,'legacy invalid criteria writes no points, spend, or history correction');
  end loop;
  result := public.flh_family_rewards_command(w,owner_id,null,'reward_save',payload||jsonb_build_object('title','QA inactive badge criterion','criteria',jsonb_build_object('required_badge_codes',jsonb_build_array(v_badge_code))));
  perform pg_temp.family_assert(result->>'ok'='true' and result->'reward'->'criteria'->'required_badge_codes'=jsonb_build_array(v_badge_code),'inactive badge criterion can be preserved when editing');
  second := public.flh_family_reward_eligibility(w,l,(result->'reward'->>'id')::uuid);
  perform pg_temp.family_assert(second->>'eligible'='true','earned inactive badge still satisfies configured criterion');
  second := public.flh_family_rewards_command(w,owner_id,null,'parent_catalog','{"test_only":true}');
  perform pg_temp.family_assert(exists(select 1 from jsonb_array_elements(second->'badges') x where x->>'code'=v_badge_code and x->>'is_active'='false'),'parent criterion selector retains inactive badges');
  result := public.flh_family_rewards_command(w,null,l,'reward_request',jsonb_build_object('reward_id',reward_id,'note','QA reward request note','idempotency_key','qa-family-reward-request'));
  perform pg_temp.family_assert(result->'claim'->>'status'='pending' and result->'claim'->>'points_spent'='0','request pending no spend'); cid := (result->'claim'->>'id')::uuid;
  result := public.flh_family_rewards_command(w,null,l,'reward_request',jsonb_build_object('reward_id',reward_id,'note','QA reward request note','idempotency_key','qa-family-reward-request'));
  perform pg_temp.family_assert(result->'claim'->>'id'=cid::text and result->>'already_requested'='true','reward request retry one claim');
  result := public.flh_family_rewards_command(w,null,l,'reward_request',jsonb_build_object('reward_id',reward_id,'note','Changed request note','idempotency_key','qa-family-reward-request'));
  perform pg_temp.family_assert(result->>'error'='IDEMPOTENCY_CONFLICT','reward request key cannot discard changed note');
  result := public.flh_family_rewards_command(w,owner_id,null,'reward_review',jsonb_build_object('claim_id',cid,'decision','approved'));
  perform pg_temp.family_assert(result->>'reward_points'='30' and result->'claim'->>'points_spent'='10','approval spends exactly once');
  result := public.flh_family_rewards_command(w,null,l,'reward_request',jsonb_build_object('reward_id',reward_id,'note','QA reward request note','idempotency_key','qa-family-reward-request'));
  perform pg_temp.family_assert(result->>'already_requested'='true' and result->'claim'->'metadata'->>'request_note'='QA reward request note','original request note remains retryable after review replaces display note');
  result := public.flh_family_rewards_command(w,owner_id,null,'reward_review',jsonb_build_object('claim_id',cid,'decision','approved'));
  perform pg_temp.family_assert(result->>'already_reviewed'='true','duplicate reward approval idempotent');
  result := public.flh_family_rewards_command(w,owner_id,null,'reward_review',jsonb_build_object('claim_id',cid,'decision','rejected'));
  perform pg_temp.family_assert(result->>'error'='INVALID_TRANSITION','opposite stale reward decision must not report success after spend');
  result := public.flh_family_rewards_command(w,owner_id,null,'reward_redeem',jsonb_build_object('claim_id',cid));
  perform pg_temp.family_assert(result->'claim'->>'status'='redeemed','approved delivery redeemed');
  result := public.flh_family_rewards_command(w,owner_id,null,'reward_redeem',jsonb_build_object('claim_id',cid));
  perform pg_temp.family_assert(result->>'already_redeemed'='true','redeem retry idempotent');
  result := public.flh_family_rewards_command(w,owner_id,null,'reward_review',jsonb_build_object('claim_id',cid,'decision','approved'));
  perform pg_temp.family_assert(result->>'already_reviewed'='true','approval retry after redeemed is idempotent');
  result := public.flh_family_rewards_command(w,owner_id,null,'reward_review',jsonb_build_object('claim_id',cid,'decision','rejected'));
  perform pg_temp.family_assert(result->>'error'='INVALID_TRANSITION','cannot reject delivered reward');
  result := public.flh_family_rewards_command(w,null,l,'reward_request',jsonb_build_object('reward_id',reward_id,'idempotency_key','qa-family-redemption-limit'));
  perform pg_temp.family_assert(result->>'error'='REDEMPTION_LIMIT','redemption limit counts approved and redeemed');
  result := public.flh_family_rewards_command(w,owner_id,null,'reward_save',payload||jsonb_build_object('title','QA rejected reward','max_redemptions_per_learner',null)); other_reward := (result->'reward'->>'id')::uuid;
  result := public.flh_family_rewards_command(w,null,l,'reward_request',jsonb_build_object('reward_id',other_reward,'idempotency_key','qa-family-rejected-reward')); cid := (result->'claim'->>'id')::uuid;
  result := public.flh_family_rewards_command(w,owner_id,null,'reward_review',jsonb_build_object('claim_id',cid,'decision','rejected','reason','QA reject'));
  perform pg_temp.family_assert(result->'claim'->>'status'='rejected' and result->'claim'->>'points_spent'='0','rejection spends zero');
  result := public.flh_family_rewards_command(w,owner_id,null,'reward_review',jsonb_build_object('claim_id',cid,'decision','approved'));
  perform pg_temp.family_assert(result->>'error'='INVALID_TRANSITION','cannot approve rejected reward');
  result := public.flh_family_rewards_command(w,owner_id,null,'reward_redeem',jsonb_build_object('claim_id',cid));
  perform pg_temp.family_assert(result->>'error'='CLAIM_NOT_APPROVED','cannot redeem rejected claim');
  -- A pending claim must revalidate the edited price and current balance at approval.
  result := public.flh_family_rewards_command(w,null,l,'reward_request',jsonb_build_object('reward_id',other_reward,'idempotency_key','qa-family-revalidate')); cid := (result->'claim'->>'id')::uuid;
  result := public.flh_family_rewards_command(w,owner_id,null,'reward_save',payload||jsonb_build_object('id',other_reward,'required_reward_points',100));
  result := public.flh_family_rewards_command(w,owner_id,null,'reward_review',jsonb_build_object('claim_id',cid,'decision','approved'));
  perform pg_temp.family_assert(result->>'error'='INSUFFICIENT_POINTS','approval revalidates changed price/balance');

  result := public.flh_family_rewards_command(w,owner_id,l,'points_adjust','{"delta":5,"reason":"QA administrative correction","idempotency_key":"qa-family-adjust"}');
  perform pg_temp.family_assert(result->>'reward_points'='35','manual adjustment canonical balance'); eid := (result->'event'->>'id')::bigint;
  result := public.flh_family_rewards_command(w,owner_id,l,'points_adjust','{"delta":5,"reason":"QA administrative correction","idempotency_key":"qa-family-adjust"}');
  perform pg_temp.family_assert(result->>'already_adjusted'='true','adjustment retry one event');
  result := public.flh_family_rewards_command(w,owner_id,l,'points_adjust','{"delta":5,"reason":"Changed administrative reason","idempotency_key":"qa-family-adjust"}');
  perform pg_temp.family_assert(result->>'error'='IDEMPOTENCY_CONFLICT','manual adjustment key cannot discard changed reason');
  result := public.flh_family_rewards_command(w,admin_id,l,'points_adjust','{"delta":5,"reason":"QA administrative correction","idempotency_key":"qa-family-adjust"}');
  perform pg_temp.family_assert(result->>'error'='IDEMPOTENCY_CONFLICT','adjustment key is bound to original verified actor');
  perform pg_temp.family_assert((select reward_points from public.learner_gamification_state where learner_id=l)=35,'conflicting adjustment reuse changes no balance');
  result := public.flh_family_rewards_command(w,owner_id,l,'points_adjust',jsonb_build_object('reversal_event_id',eid,'reason','QA compensate prior error','idempotency_key','qa-family-reversal'));
  perform pg_temp.family_assert(result->>'reward_points'='30' and result->'event'->>'reward_points_delta'='-5','reversal compensates without rewriting');
  result := public.flh_family_rewards_command(w,owner_id,l,'points_adjust',jsonb_build_object('reversal_event_id',eid,'reason','QA repeated reversal','idempotency_key','qa-family-reversal-again'));
  perform pg_temp.family_assert(result->>'error'='ALREADY_REVERSED','one event cannot reverse twice');
  result := public.flh_family_rewards_command(w,owner_id,l,'points_adjust','{"delta":-1000,"reason":"QA no overdraft","idempotency_key":"qa-family-overdraw"}');
  perform pg_temp.family_assert(result->>'error'='INSUFFICIENT_POINTS','negative adjustment cannot overdraw');
  result := public.flh_family_rewards_command(w,owner_id,l,'points_adjust','{"delta":1,"reason":"","idempotency_key":"qa-family-no-reason"}');
  perform pg_temp.family_assert(result->>'error'='ADJUSTMENT_REASON_REQUIRED','adjustment reason mandatory');
  for n in 1..105 loop
    result := public.flh_family_rewards_command(w,owner_id,l,'points_adjust',jsonb_build_object('delta',1,'reason','QA pagination','idempotency_key','qa-family-page-'||n));
    perform pg_temp.family_assert(result->>'ok'='true','pagination fixture award');
  end loop;
  insert into public.reward_claims(workspace_id,learner_id,reward_id,status,requested_at,reviewed_at,reviewed_by,points_spent,metadata)
  values(w,l,other_reward,'approved',now()-interval '2 days',now()-interval '1 day',owner_id,0,'{"reward_title":"QA old undelivered reward"}') returning id into v_old_approved;
  insert into public.reward_claims(workspace_id,learner_id,reward_id,status,requested_at,reviewed_at,reviewed_by)
  select w,l,other_reward,'rejected',now(),now(),owner_id from generate_series(1,205);
  result := public.flh_family_rewards_command(w,null,l,'student_catalog','{}');
  perform pg_temp.family_assert(jsonb_array_length(result->'learners')=1 and result->'learners'->0->>'id'=l::text and jsonb_array_length(result->'ledger')=100,'learner sees own recent history only');
  perform pg_temp.family_assert((select sum((x->>'points')::integer) from jsonb_array_elements(result->'breakdown') x)=(select sum(reward_points_delta) from public.gamification_events where workspace_id=w and learner_id=l),'breakdown includes full history beyond latest100');
  page := public.flh_family_rewards_command(w,null,l,'student_ledger','{"page_size":50,"source_type":"manual_adjustment"}');
  perform pg_temp.family_assert(jsonb_array_length(page->'ledger')=50 and page->>'next_cursor' is not null,'paginated ledger first page');
  second := public.flh_family_rewards_command(w,null,l,'student_ledger',jsonb_build_object('page_size',50,'source_type','manual_adjustment','before_id',page->>'next_cursor'));
  perform pg_temp.family_assert((second->'ledger'->0->>'id')::bigint<(page->'ledger'->49->>'id')::bigint,'history cursor pages do not overlap');
  -- One academic filter includes every supported historical academic source, including null.
  insert into public.gamification_events(workspace_id,learner_id,event_type,xp_delta,reward_points_delta,source_type,source_id,reason)
  select w,l,'other',0,0,x.source_type,'qa-family-academic-'||x.ordinality,'QA historical academic source'
    from unnest(array[null,'','academic','quiz','quiz_attempt','learning','exam']::text[]) with ordinality x(source_type,ordinality);
  page := public.flh_family_rewards_command(w,null,l,'student_ledger','{"source_type":"academic","page_size":100}');
  perform pg_temp.family_assert((select count(*) from jsonb_array_elements(page->'ledger') x where x->>'source_id' like 'qa-family-academic-%')=7,'academic filter includes null and all historical academic sources');
  perform pg_temp.family_assert(not exists(select 1 from jsonb_array_elements(page->'ledger') x where coalesce(nullif(x->>'source_type',''),'academic') not in ('academic','quiz','quiz_attempt','learning','exam')),'academic filter excludes family awards/spends/adjustments');
  result := public.flh_family_rewards_command(w,null,l,'student_catalog','{}');
  perform pg_temp.family_assert(exists(select 1 from jsonb_array_elements(result->'breakdown') x where x->>'source_type'='academic' and x->>'category_title'='التعلّم') and not exists(select 1 from jsonb_array_elements(result->'breakdown') x where x->>'source_type' in ('quiz','quiz_attempt','learning','exam')),'academic breakdown is one correctly named source group');
  perform pg_temp.family_assert(not exists(select 1 from jsonb_array_elements(result->'breakdown') x where x->>'source_type'='manual_adjustment' and x->>'category_title'<>'تعديل موثّق'),'manual adjustments keep their explicit category label');
  result := public.flh_family_rewards_command(w,owner_id,null,'parent_catalog','{}');
  perform pg_temp.family_assert(not exists(select 1 from jsonb_array_elements(result->'learners') x where x->>'id'=l::text) and not exists(select 1 from jsonb_array_elements(result->'ledger') x where x->>'learner_id'=l::text),'normal parent summaries exclude test rewards');
  result := public.flh_family_rewards_command(w,owner_id,null,'parent_catalog','{"test_only":true}');
  perform pg_temp.family_assert(jsonb_array_length(result->'learners')=1 and result->'learners'->0->>'id'=l::text,'explicit QA catalog isolates test learner');
  perform pg_temp.family_assert(exists(select 1 from jsonb_array_elements(result->'claims') x where x->>'id'=v_old_approved::text and x->>'status'='approved'),'old approved undelivered reward remains actionable beyond200 terminal claims');
  reset role;
  perform pg_temp.family_assert((select xp from public.learner_gamification_state where learner_id=l)=xp_before,'every family path preserves XP');
  perform pg_temp.family_assert((select reward_points from public.learner_gamification_state where learner_id=l)=135,'canonical balance matches awards/spend/adjustments');
  perform pg_temp.family_assert((select count(*) from public.gamification_events where workspace_id=w and learner_id=l and source_type='family_behavior')=3,'exactly three approved behavior events');
  perform pg_temp.family_assert((select count(*) from public.gamification_events where workspace_id=w and learner_id=l and source_type='reward_claim')=1,'approval/redemption one spend event');
  perform pg_temp.family_assert(not exists(select 1 from public.gamification_events where workspace_id=w and learner_id=l and source_type in ('family_behavior','reward_claim','manual_adjustment') and xp_delta<>0),'family ledger never changes XP');
  -- Deactivation preserves existing selected scopes for editing and disabling, never new assignment.
  update public.learners set is_active=false where id=l;
  payload := jsonb_build_object('id',rule_id,'category_id',category_id,'title','QA inactive learner rule','learner_scope','selected','learner_ids',jsonb_build_array(l),'cadence','day','max_awards',1,'is_active',false);
  result := public.flh_family_rewards_command(w,owner_id,null,'rule_save',payload);
  perform pg_temp.family_assert(result->>'ok'='true' and result->'rule'->>'is_active'='false' and (select count(*) from public.behavior_rule_learners scopes where scopes.rule_id=(payload->>'id')::uuid and scopes.learner_id=l)=1,'existing inactive rule scope can be retained and disabled');
  result := public.flh_family_rewards_command(w,owner_id,null,'rule_save',payload-'id');
  perform pg_temp.family_assert(result->>'error'='INVALID_SCOPE','new rule cannot assign inactive learner');
  result := public.flh_family_rewards_command(w,owner_id,null,'rule_save',payload||jsonb_build_object('learner_ids',jsonb_build_array(l,inactive_l)));
  perform pg_temp.family_assert(result->>'error'='INVALID_SCOPE','existing rule cannot add newly assigned same-workspace inactive learner');
  result := public.flh_family_rewards_command(w,owner_id,null,'rule_save',payload||jsonb_build_object('learner_ids',jsonb_build_array(other_l)));
  perform pg_temp.family_assert(result->>'error'='INVALID_SCOPE','retained rule scope does not authorize foreign learner');
  result := public.flh_family_rewards_command(w,owner_id,null,'rule_save',payload||'{"learner_ids":[]}');
  perform pg_temp.family_assert(result->>'error'='INVALID_SCOPE','selected inactive rule cannot silently lose all assignments');
  payload := jsonb_build_object('id',reward_id,'title','QA inactive learner reward','learner_scope','selected','learner_ids',jsonb_build_array(l),'required_reward_points',10,'required_level',1,'is_active',false,'criteria','{}'::jsonb);
  result := public.flh_family_rewards_command(w,owner_id,null,'reward_save',payload);
  perform pg_temp.family_assert(result->>'ok'='true' and result->'reward'->>'is_active'='false' and (select count(*) from public.reward_learner_scopes scopes where scopes.reward_id=(payload->>'id')::uuid and scopes.learner_id=l)=1,'existing inactive reward scope can be retained and disabled');
  result := public.flh_family_rewards_command(w,owner_id,null,'reward_save',payload-'id');
  perform pg_temp.family_assert(result->>'error'='INVALID_SCOPE','new reward cannot assign inactive learner');
  result := public.flh_family_rewards_command(w,owner_id,null,'reward_save',payload||jsonb_build_object('learner_ids',jsonb_build_array(l,inactive_l)));
  perform pg_temp.family_assert(result->>'error'='INVALID_SCOPE','existing reward cannot add newly assigned same-workspace inactive learner');
  result := public.flh_family_rewards_command(w,owner_id,null,'reward_save',payload||jsonb_build_object('learner_ids',jsonb_build_array(other_l)));
  perform pg_temp.family_assert(result->>'error'='INVALID_SCOPE','retained reward scope does not authorize foreign learner');
  result := public.flh_family_rewards_command(w,owner_id,null,'reward_save',payload||'{"learner_ids":[]}');
  perform pg_temp.family_assert(result->>'error'='INVALID_SCOPE','selected inactive reward cannot silently lose all assignments');
  result := public.flh_family_rewards_command(w,owner_id,null,'parent_catalog','{"test_only":true}');
  perform pg_temp.family_assert(jsonb_array_length(result->'learners')=0 and jsonb_array_length(result->'inactive_scope_learners')=1 and result->'inactive_scope_learners'->0->>'id'=l::text,'parent edit catalog names retained inactive test scope');
  result := public.flh_family_rewards_command(w,owner_id,null,'parent_catalog','{}');
  perform pg_temp.family_assert(jsonb_array_length(result->'inactive_scope_learners')=0,'normal parent inactive scope list excludes test learner');
  update public.learners set is_active=true where id=l;
  result := public.flh_family_rewards_command(w,null,l,'student_catalog','{}');
  perform pg_temp.family_assert(result->'inactive_scope_learners'='[]'::jsonb,'student catalog does not expose inactive scope learner names');
  begin update public.gamification_events set reason='silent rewrite' where id=eid; exception when check_violation then v_fk_rejected:=true; end;
  perform pg_temp.family_assert(v_fk_rejected,'family event immutable'); v_fk_rejected:=false;
  begin delete from public.gamification_events where id=eid; exception when check_violation then v_fk_rejected:=true; end;
  perform pg_temp.family_assert(v_fk_rejected and exists(select 1 from public.gamification_events where id=eid),'direct family event deletion remains forbidden'); v_fk_rejected:=false;
  -- Unrelated nested triggers cannot use depth alone to erase a surviving learner's ledger.
  create temporary table family_nested_delete_probe(event_id bigint) on commit drop;
  execute $nested_definition$create or replace function pg_temp.family_nested_delete_probe() returns trigger
    language plpgsql security invoker set search_path='' as $nested_body$begin
      delete from public.gamification_events where id=new.event_id; return new;
    end$nested_body$$nested_definition$;
  create trigger family_nested_delete_probe after insert on family_nested_delete_probe
    for each row execute function pg_temp.family_nested_delete_probe();
  begin insert into family_nested_delete_probe(event_id) values(eid); exception when check_violation then v_fk_rejected:=true; end;
  perform pg_temp.family_assert(v_fk_rejected and exists(select 1 from public.gamification_events where id=eid),'nested direct deletion with existing parents remains forbidden'); v_fk_rejected:=false;
  begin
    insert into public.gamification_events(workspace_id,learner_id,event_type,xp_delta,reward_points_delta,source_type,source_id,reason)
    values(w,l,'other',1,1,'family_behavior','qa-family-illegal-xp','QA reject non-academic XP');
  exception when check_violation then v_fk_rejected:=true; end;
  perform pg_temp.family_assert(v_fk_rejected,'database rejects non-academic XP even for privileged raw insert'); v_fk_rejected:=false;
  begin insert into public.behavior_rule_learners(workspace_id,rule_id,learner_id) values(other_w,rule_id,other_l); exception when foreign_key_violation then v_fk_rejected:=true; end;
  perform pg_temp.family_assert(v_fk_rejected,'composite rule/learner links preserve workspace');
  perform set_config('request.jwt.claim.sub',teacher_id::text,true);
  set local role authenticated;
  perform pg_temp.family_assert(not exists(select 1 from public.behavior_categories where id=category_id),'teacher direct RLS cannot see family management rows');
  reset role;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  set local role authenticated;
  perform pg_temp.family_assert(exists(select 1 from public.behavior_categories where id=category_id) and not exists(select 1 from public.behavior_categories where workspace_id=other_w),'owner RLS is workspace scoped');
  reset role;
  -- Only disposable, explicitly marked test fixtures exercise the existing parent-delete lifecycle.
  insert into public.learners(id,workspace_id,display_name,slug,metadata) values(cascade_l,other_w,'QA cascade test learner','qa-cascade-test','{"is_test":true}');
  insert into public.gamification_events(workspace_id,learner_id,event_type,xp_delta,reward_points_delta,source_type,source_id,reason)
    select other_w,cascade_l,'other',0,1,source_type,'qa-learner-cascade-'||source_type,'QA cascade boundary'
    from (values('family_behavior'),('reward_claim'),('manual_adjustment')) sources(source_type);
  perform set_config('request.jwt.claim.sub',outsider_id::text,true);
  set local role authenticated;
  delete from public.learners where id=cascade_l and workspace_id=other_w;
  reset role;
  perform pg_temp.family_assert(not exists(select 1 from public.learners where id=cascade_l) and not exists(select 1 from public.gamification_events where learner_id=cascade_l),'existing owner-authorized learner deletion cascades all family ledger source types');
  perform pg_temp.family_assert(exists(select 1 from public.learners where id=other_l),'learner cascade preserves other test learners');
  set local role service_role;
  result := public.flh_family_rewards_command(other_w,outsider_id,null,'category_save','{"title":"QA cascade category"}');
  perform pg_temp.family_assert(result->>'ok'='true','workspace cascade fixture creates an actual category');
  cascade_category := (result->'category'->>'id')::uuid;
  result := public.flh_family_rewards_command(other_w,outsider_id,null,'rule_save',jsonb_build_object('title','QA cascade rule','category_id',cascade_category,'base_points',2,'learner_scope','selected','learner_ids',jsonb_build_array(other_l),'cadence','unlimited'));
  perform pg_temp.family_assert(result->>'ok'='true','workspace cascade fixture creates an actual scoped rule');
  cascade_rule := (result->'rule'->>'id')::uuid;
  result := public.flh_family_rewards_command(other_w,outsider_id,other_l,'behavior_record',jsonb_build_object('rule_id',cascade_rule,'reason','QA workspace cascade award','idempotency_key','qa-cascade-behavior'));
  perform pg_temp.family_assert(result->>'ok'='true','workspace cascade fixture creates an approved submission and event');
  result := public.flh_family_rewards_command(other_w,outsider_id,null,'reward_save',jsonb_build_object('title','QA cascade reward','reward_type','activity','required_reward_points',1,'learner_scope','selected','learner_ids',jsonb_build_array(other_l)));
  perform pg_temp.family_assert(result->>'ok'='true','workspace cascade fixture creates an actual scoped reward');
  cascade_reward := (result->'reward'->>'id')::uuid;
  result := public.flh_family_rewards_command(other_w,null,other_l,'reward_request',jsonb_build_object('reward_id',cascade_reward,'idempotency_key','qa-cascade-claim'));
  perform pg_temp.family_assert(result->>'ok'='true','workspace cascade fixture creates an actual reward claim');
  cascade_claim := (result->'claim'->>'id')::uuid;
  result := public.flh_family_rewards_command(other_w,outsider_id,null,'reward_review',jsonb_build_object('claim_id',cascade_claim,'decision','approved'));
  perform pg_temp.family_assert(result->>'ok'='true','workspace cascade fixture approves its claim and spends once');
  reset role;
  insert into public.gamification_events(workspace_id,learner_id,event_type,xp_delta,reward_points_delta,source_type,source_id,reason)
    select other_w,other_l,'other',0,1,source_type,'qa-workspace-cascade-'||source_type,'QA workspace cascade boundary'
    from (values('family_behavior'),('reward_claim'),('manual_adjustment')) sources(source_type);
  select count(*) into count_before from public.gamification_events where workspace_id=other_w;
  set local role authenticated;
  delete from public.workspaces where id=other_w;
  reset role;
  perform pg_temp.family_assert(exists(select 1 from public.workspaces where id=other_w) and (select count(*) from public.gamification_events where workspace_id=other_w)=count_before,'existing RLS still denies authenticated workspace deletion');
  set local role service_role;
  delete from public.workspaces where id=other_w;
  reset role;
  perform pg_temp.family_assert(not exists(select 1 from public.workspaces where id=other_w) and not exists(select 1 from public.learners where workspace_id=other_w) and not exists(select 1 from public.gamification_events where workspace_id=other_w),'existing privileged workspace deletion cascades all family ledger source types');
  perform pg_temp.family_assert(not exists(select 1 from public.behavior_categories where workspace_id=other_w) and not exists(select 1 from public.behavior_rules where workspace_id=other_w) and not exists(select 1 from public.behavior_rule_learners where workspace_id=other_w) and not exists(select 1 from public.behavior_submissions where workspace_id=other_w) and not exists(select 1 from public.gamification_rewards where workspace_id=other_w) and not exists(select 1 from public.reward_learner_scopes where workspace_id=other_w) and not exists(select 1 from public.reward_claims where workspace_id=other_w),'workspace cascade removes the complete scoped family behavior/reward fixture');
  raise exception 'Family rewards contract passed; rollback disposable fixtures' using errcode='ZX001';
  exception when sqlstate 'ZX001' then null;
  end;
end $contract$;
