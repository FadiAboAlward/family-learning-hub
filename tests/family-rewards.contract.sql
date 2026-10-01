-- FLH-FEAT-2026-010 v1.0 rev 3. One prepared-compatible DO statement.
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
  category_id uuid;
  rule_id uuid;
  week_rule uuid;
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
begin
  execute $assert_definition$create or replace function pg_temp.family_assert(p_ok boolean,p_message text) returns void
    language plpgsql as $assert_body$begin if p_ok is distinct from true then raise exception 'Family rewards contract: %',p_message; end if; end$assert_body$$assert_definition$;
  begin
  select id into strict w from public.workspaces where slug='family-learning-hub';
  select id into strict l from public.learners where workspace_id=w and slug='test' and is_active and coalesce((metadata->>'is_test')::boolean,false);
  insert into auth.users(id,email) values(owner_id,'qa-family-owner@example.invalid'),(teacher_id,'qa-family-teacher@example.invalid'),(outsider_id,'qa-family-outsider@example.invalid');
  insert into public.workspace_members(workspace_id,user_id,role) values(w,owner_id,'owner'),(w,teacher_id,'teacher');
  insert into public.workspaces(id,name,slug) values(other_w,'QA family other','qa-family-other');
  insert into public.workspace_members(workspace_id,user_id,role) values(other_w,outsider_id,'owner');
  insert into public.learners(id,workspace_id,display_name,slug,metadata) values(other_l,other_w,'QA isolated test','test','{"is_test":true}');
  insert into public.learner_gamification_state(workspace_id,learner_id,xp,reward_points,current_streak,longest_streak) values(w,l,240,20,2,3)
    on conflict(learner_id) do update set xp=240,reward_points=20,current_level=1,current_streak=2,longest_streak=3;
  select xp,reward_points into xp_before,points_before from public.learner_gamification_state where learner_id=l;
  select id,code into strict v_badge_id,v_badge_code from public.gamification_badges where workspace_id=w limit 1;
  update public.gamification_badges set is_active=false where id=v_badge_id;
  insert into public.learner_badges(workspace_id,learner_id,badge_id,award_reason) values(w,l,v_badge_id,'QA inactive earned badge') on conflict(learner_id,badge_id) do nothing;
  perform pg_temp.family_assert(not has_function_privilege('anon','public.flh_family_rewards_command(uuid,uuid,uuid,text,jsonb)','EXECUTE') and not has_function_privilege('authenticated','public.flh_family_rewards_command(uuid,uuid,uuid,text,jsonb)','EXECUTE'),'RPC must be service-role only');
  perform pg_temp.family_assert(not has_table_privilege('authenticated','public.gamification_events','UPDATE') and not has_table_privilege('authenticated','public.learner_gamification_state','UPDATE') and not has_table_privilege('authenticated','public.reward_claims','UPDATE'),'financial writes cannot bypass server commands');
  perform pg_temp.family_assert(not has_function_privilege('authenticated','public.flh_family_reward_eligibility(uuid,uuid,uuid)','EXECUTE'),'eligibility helper must not bypass learner isolation');
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
  result := public.flh_family_rewards_command(w,owner_id,l,'behavior_record',jsonb_build_object('rule_id',rule_id,'initiative',true,'reason','QA direct behavior','idempotency_key','qa-family-direct'));
  perform pg_temp.family_assert(result->>'ok'='true' and result->'submission'->>'status'='approved' and result->'submission'->>'base_points'='5' and result->'submission'->>'initiative_bonus_points'='3' and result->>'reward_points'='28','base and initiative award separately');
  sid := (result->'submission'->>'id')::uuid;
  second := public.flh_family_rewards_command(w,owner_id,l,'behavior_record',jsonb_build_object('rule_id',rule_id,'initiative',true,'idempotency_key','qa-family-direct'));
  perform pg_temp.family_assert(second->>'already_recorded'='true' and second->'submission'->>'id'=sid::text,'duplicate parent record idempotent');
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
  result := public.flh_family_rewards_command(w,null,l,'behavior_submit',jsonb_build_object('rule_id',week_rule,'initiative',true,'reason','QA self report','idempotency_key','qa-family-self'));
  perform pg_temp.family_assert(result->'submission'->>'status'='pending' and result->'submission'->>'total_points'='0','even false policy self report stays pending and zero'); sid := (result->'submission'->>'id')::uuid;
  second := public.flh_family_rewards_command(w,null,l,'behavior_submit',jsonb_build_object('rule_id',week_rule,'initiative',true,'idempotency_key','qa-family-self'));
  perform pg_temp.family_assert(second->'submission'->>'id'=sid::text,'duplicate self report one pending submission');
  result := public.flh_family_rewards_command(w,owner_id,null,'behavior_review',jsonb_build_object('submission_id',sid,'decision','approved','reason','QA confirmed'));
  perform pg_temp.family_assert(result->>'reward_points'='34' and result->'submission'->>'total_points'='6','parent review adds correct points');
  result := public.flh_family_rewards_command(w,owner_id,null,'behavior_review',jsonb_build_object('submission_id',sid,'decision','approved'));
  perform pg_temp.family_assert(result->>'already_reviewed'='true','repeated approval no double-award');
  result := public.flh_family_rewards_command(w,owner_id,null,'behavior_review',jsonb_build_object('submission_id',sid,'decision','rejected'));
  perform pg_temp.family_assert(result->>'error'='INVALID_TRANSITION','opposite stale behavior decision must not report success');
  result := public.flh_family_rewards_command(w,owner_id,l,'behavior_record',jsonb_build_object('rule_id',week_rule,'idempotency_key','qa-family-week-second'));
  perform pg_temp.family_assert(result->>'reward_points'='38','second weekly award');
  result := public.flh_family_rewards_command(w,owner_id,l,'behavior_record',jsonb_build_object('rule_id',week_rule,'idempotency_key','qa-family-week-third'));
  perform pg_temp.family_assert(result->>'error'='CADENCE_LIMIT','N weekly limit enforced');
  result := public.flh_family_rewards_command(w,owner_id,null,'rule_save',payload||jsonb_build_object('title','QA blocked','self_report_allowed',false,'cadence','unlimited'));
  blocked_rule := (result->'rule'->>'id')::uuid;
  result := public.flh_family_rewards_command(w,null,l,'behavior_submit',jsonb_build_object('rule_id',blocked_rule,'idempotency_key','qa-family-forbidden'));
  perform pg_temp.family_assert(result->>'error'='SELF_REPORT_FORBIDDEN','learner only self reports explicit rules');
  result := public.flh_family_rewards_command(w,null,other_l,'behavior_submit',jsonb_build_object('rule_id',week_rule,'idempotency_key','qa-family-cross'));
  perform pg_temp.family_assert(result->>'error'='LEARNER_NOT_FOUND','foreign learner blocked');

  payload := jsonb_build_object('title','QA family reward','reward_type','activity','required_reward_points',10,'required_level',1,'learner_scope','selected','learner_ids',jsonb_build_array(l),'max_redemptions_per_learner',1,'criteria',jsonb_build_object('min_xp',200,'current_streak',2));
  result := public.flh_family_rewards_command(w,owner_id,null,'reward_save',payload);
  perform pg_temp.family_assert(result->>'ok'='true','parent reward create'); reward_id := (result->'reward'->>'id')::uuid;
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
    perform pg_temp.family_assert((select reward_points from public.learner_gamification_state where learner_id=l)=38 and not exists(select 1 from public.gamification_events where source_type='reward_claim' and source_id=v_matrix_claim::text),'failed eligibility approval changes no points or spend event');
    result := public.flh_family_rewards_command(w,owner_id,null,'reward_review',jsonb_build_object('claim_id',v_matrix_claim,'decision','rejected'));
  end loop;
  result := public.flh_family_rewards_command(w,owner_id,null,'reward_save',payload||jsonb_build_object('title','QA inactive badge criterion','criteria',jsonb_build_object('required_badge_codes',jsonb_build_array(v_badge_code))));
  perform pg_temp.family_assert(result->>'ok'='true' and result->'reward'->'criteria'->'required_badge_codes'=jsonb_build_array(v_badge_code),'inactive badge criterion can be preserved when editing');
  second := public.flh_family_reward_eligibility(w,l,(result->'reward'->>'id')::uuid);
  perform pg_temp.family_assert(second->>'eligible'='true','earned inactive badge still satisfies configured criterion');
  second := public.flh_family_rewards_command(w,owner_id,null,'parent_catalog','{"test_only":true}');
  perform pg_temp.family_assert(exists(select 1 from jsonb_array_elements(second->'badges') x where x->>'code'=v_badge_code and x->>'is_active'='false'),'parent criterion selector retains inactive badges');
  result := public.flh_family_rewards_command(w,null,l,'reward_request',jsonb_build_object('reward_id',reward_id,'idempotency_key','qa-family-reward-request'));
  perform pg_temp.family_assert(result->'claim'->>'status'='pending' and result->'claim'->>'points_spent'='0','request pending no spend'); cid := (result->'claim'->>'id')::uuid;
  result := public.flh_family_rewards_command(w,null,l,'reward_request',jsonb_build_object('reward_id',reward_id,'idempotency_key','qa-family-reward-request'));
  perform pg_temp.family_assert(result->'claim'->>'id'=cid::text and result->>'already_requested'='true','reward request retry one claim');
  result := public.flh_family_rewards_command(w,owner_id,null,'reward_review',jsonb_build_object('claim_id',cid,'decision','approved'));
  perform pg_temp.family_assert(result->>'reward_points'='28' and result->'claim'->>'points_spent'='10','approval spends exactly once');
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
  perform pg_temp.family_assert(result->>'reward_points'='33','manual adjustment canonical balance'); eid := (result->'event'->>'id')::bigint;
  result := public.flh_family_rewards_command(w,owner_id,l,'points_adjust','{"delta":5,"reason":"QA administrative correction","idempotency_key":"qa-family-adjust"}');
  perform pg_temp.family_assert(result->>'already_adjusted'='true','adjustment retry one event');
  result := public.flh_family_rewards_command(w,owner_id,l,'points_adjust',jsonb_build_object('reversal_event_id',eid,'reason','QA compensate prior error','idempotency_key','qa-family-reversal'));
  perform pg_temp.family_assert(result->>'reward_points'='28' and result->'event'->>'reward_points_delta'='-5','reversal compensates without rewriting');
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
  result := public.flh_family_rewards_command(w,owner_id,null,'parent_catalog','{}');
  perform pg_temp.family_assert(not exists(select 1 from jsonb_array_elements(result->'learners') x where x->>'id'=l::text) and not exists(select 1 from jsonb_array_elements(result->'ledger') x where x->>'learner_id'=l::text),'normal parent summaries exclude test rewards');
  result := public.flh_family_rewards_command(w,owner_id,null,'parent_catalog','{"test_only":true}');
  perform pg_temp.family_assert(jsonb_array_length(result->'learners')=1 and result->'learners'->0->>'id'=l::text,'explicit QA catalog isolates test learner');
  perform pg_temp.family_assert(exists(select 1 from jsonb_array_elements(result->'claims') x where x->>'id'=v_old_approved::text and x->>'status'='approved'),'old approved undelivered reward remains actionable beyond200 terminal claims');
  reset role;
  perform pg_temp.family_assert((select xp from public.learner_gamification_state where learner_id=l)=xp_before,'every family path preserves XP');
  perform pg_temp.family_assert((select reward_points from public.learner_gamification_state where learner_id=l)=133,'canonical balance matches awards/spend/adjustments');
  perform pg_temp.family_assert((select count(*) from public.gamification_events where workspace_id=w and learner_id=l and source_type='family_behavior')=3,'exactly three approved behavior events');
  perform pg_temp.family_assert((select count(*) from public.gamification_events where workspace_id=w and learner_id=l and source_type='reward_claim')=1,'approval/redemption one spend event');
  perform pg_temp.family_assert(not exists(select 1 from public.gamification_events where workspace_id=w and learner_id=l and source_type in ('family_behavior','reward_claim','manual_adjustment') and xp_delta<>0),'family ledger never changes XP');
  begin update public.gamification_events set reason='silent rewrite' where id=eid; exception when check_violation then v_fk_rejected:=true; end;
  perform pg_temp.family_assert(v_fk_rejected,'family event immutable'); v_fk_rejected:=false;
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
  raise exception 'Family rewards contract passed; rollback disposable fixtures' using errcode='ZX001';
  exception when sqlstate 'ZX001' then null;
  end;
end $contract$;
