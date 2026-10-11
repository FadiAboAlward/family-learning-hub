-- FLH-025 v1.1 Drive r2 / FLH-010 v1.7 Drive r3.
-- Runner-local fresh disposable database only; the success exception rolls back all fixtures.
do $contract$
declare
  w uuid; other_w constant uuid := '99000000-0000-4000-8000-000000000010';
  owner_id constant uuid := '99000000-0000-4000-8000-000000000011';
  admin_id constant uuid := '99000000-0000-4000-8000-000000000012';
  teacher_id constant uuid := '99000000-0000-4000-8000-000000000013';
  outsider_id constant uuid := '99000000-0000-4000-8000-000000000014';
  l1 constant uuid := '99000000-0000-4000-8000-000000000015';
  l2 constant uuid := '99000000-0000-4000-8000-000000000016';
  greeting constant uuid := 'a315e8af-9d9b-473b-95ac-c5425ad7de5b';
  unknown_event constant uuid := '99000000-0000-4000-8000-000000000099';
  ordinary uuid; category_id uuid; sid uuid; sid2 uuid; legacy_id uuid;
  e1 uuid; e2 uuid; e3 uuid; foreign_event uuid; midnight1 uuid; midnight2 uuid; identity uuid;
  result jsonb; second jsonb; page_json jsonb; original_rule jsonb; original_history jsonb; original_events bigint;
  old_claim_time timestamptz := '2020-01-09T00:00:00Z'; failed boolean;
begin
  execute $def$create or replace function pg_temp.return_assert(ok boolean,msg text) returns void
    language plpgsql as $body$begin if ok is distinct from true then raise exception 'Return event contract: %',msg; end if; end$body$$def$;
  execute $def$create or replace function pg_temp.return_create(wid uuid,actor uuid,instant text,request_key text) returns uuid
    language plpgsql as $body$declare response jsonb; begin
      response:=public.flh_family_rewards_command(wid,actor,null,'return_event_create',jsonb_build_object('occurred_at',instant,'idempotency_key',request_key));
      if response->>'ok' is distinct from 'true' then raise exception 'Return fixture create: %',response->>'error'; end if;
      return(response->'return_event'->>'id')::uuid;
    end$body$$def$;
  select id into strict w from public.workspaces where slug='family-learning-hub';
  select to_jsonb(r) into strict original_rule from public.behavior_rules r where r.id=greeting and r.workspace_id=w;
  select count(*) into original_events from public.family_return_events;
  select coalesce(jsonb_object_agg(s.id::text,md5(to_jsonb(s)::text)),'{}') into original_history from public.behavior_submissions s where s.workspace_id=w;
  begin
    perform pg_temp.return_assert(not has_table_privilege('authenticated','public.family_return_events','INSERT')
      and not has_table_privilege('authenticated','public.family_return_events','UPDATE')
      and not has_table_privilege('authenticated','public.family_return_events','SELECT')
      and not has_table_privilege('anon','public.family_return_events','SELECT')
      and has_table_privilege('service_role','public.family_return_events','SELECT')
      and has_table_privilege('service_role','public.family_return_events','INSERT')
      and has_table_privilege('service_role','public.family_return_events','UPDATE')
      and has_table_privilege('service_role','public.family_return_events','DELETE')
      and not has_table_privilege('service_role','public.family_return_events','TRUNCATE')
      and not has_table_privilege('service_role','public.family_return_events','REFERENCES')
      and not has_table_privilege('service_role','public.family_return_events','TRIGGER')
      and(select relrowsecurity from pg_class where oid='public.family_return_events'::regclass)
      and not has_function_privilege('authenticated','public.flh_family_rewards_command(uuid,uuid,uuid,text,jsonb)','EXECUTE')
      and has_function_privilege('service_role','public.flh_family_rewards_command(uuid,uuid,uuid,text,jsonb)','EXECUTE'),'service-only mutation grants');
    insert into auth.users(id,email) values(owner_id,'qa-return-owner@example.invalid'),(admin_id,'qa-return-admin@example.invalid'),(teacher_id,'qa-return-teacher@example.invalid'),(outsider_id,'qa-return-outsider@example.invalid');
    insert into public.workspaces(id,name,slug) values(other_w,'QA return foreign workspace','qa-return-foreign');
    insert into public.workspace_members(workspace_id,user_id,role) values(w,owner_id,'owner'),(w,admin_id,'admin'),(w,teacher_id,'teacher'),(other_w,owner_id,'owner');
    insert into public.learners(id,workspace_id,display_name,slug,metadata) values
      (l1,w,'QA return Testing one','qa-return-one','{"is_test":true,"exclude_from_parent_metrics":true}'),
      (l2,w,'QA return Testing two','qa-return-two','{"is_test":true,"exclude_from_parent_metrics":true}');
    insert into public.learner_gamification_state(workspace_id,learner_id,xp,reward_points) values(w,l1,100,20),(w,l2,200,0);
    update public.behavior_rules set learner_scope='selected',is_active=true,self_report_allowed=true where id=greeting and workspace_id=w;
    insert into public.behavior_rule_learners(workspace_id,rule_id,learner_id) values(w,greeting,l1),(w,greeting,l2);
    insert into public.behavior_categories(workspace_id,title) values(w,'QA return adjacent') returning id into category_id;
    insert into public.behavior_rules(workspace_id,category_id,title,base_points,learner_scope,cadence,max_awards,self_report_allowed) values(w,category_id,'QA return ordinary',5,'selected','unlimited',null,true) returning id into ordinary;
    insert into public.behavior_rule_learners(workspace_id,rule_id,learner_id) values(w,ordinary,l1);
    foreach identity in array array[teacher_id,outsider_id] loop
      result:=public.flh_family_rewards_command(w,identity,null,'return_event_create',jsonb_build_object('occurred_at','2020-01-10T07:00:00Z','idempotency_key','qa-forbidden-'||identity));
      perform pg_temp.return_assert(result->>'error'='PARENT_MANAGE_FORBIDDEN','teacher/outsider create denied');
    end loop;
    result:=public.flh_family_rewards_command(w,null,l1,'return_event_create',jsonb_build_object('occurred_at','2020-01-10T07:00:00Z','idempotency_key','qa-child-create'));
    perform pg_temp.return_assert(result->>'error'='PARENT_MANAGE_FORBIDDEN','child create denied');
    result:=public.flh_family_rewards_command(w,owner_id,null,'return_event_create',jsonb_build_object('occurred_at','infinity','idempotency_key','qa-infinity'));
    perform pg_temp.return_assert(result->>'error'='INVALID_OCCURRED_AT','non-finite instant rejected');
    result:=public.flh_family_rewards_command(w,owner_id,null,'return_event_create',jsonb_build_object('occurred_at',clock_timestamp()+interval '1 day','idempotency_key','qa-future'));
    perform pg_temp.return_assert(result->>'error'='INVALID_OCCURRED_AT','future instant rejected');
    result:=public.flh_family_rewards_command(w,owner_id,null,'return_event_create',jsonb_build_object('occurred_at','bad-time','idempotency_key','qa-malformed'));
    perform pg_temp.return_assert(result->>'error'='INVALID_OCCURRED_AT','malformed instant rejected');
    result:=public.flh_family_rewards_command(w,owner_id,null,'return_event_create',jsonb_build_object('occurred_at','2020-01-10T07:00:00Z','idempotency_key','short'));
    perform pg_temp.return_assert(result->>'error'='IDEMPOTENCY_KEY_REQUIRED','existing key bounds preserved');
    execute 'set local role service_role';
    result:=public.flh_family_rewards_command(w,owner_id,null,'return_event_create',jsonb_build_object('occurred_at','2020-01-10T10:00:00+03:00','idempotency_key','qa-return-one','id',unknown_event,'created_by',outsider_id,'total_points',999));
    execute 'reset role';
    e1:=(result->'return_event'->>'id')::uuid;
    perform pg_temp.return_assert(result->>'ok'='true' and e1<>unknown_event and not(result->'return_event'?'created_by')
      and(select created_by=owner_id from public.family_return_events where id=e1)
      and(select reward_points=20 and xp=100 from public.learner_gamification_state where learner_id=l1)
      and not exists(select 1 from public.gamification_events where learner_id=l1),'server event identity; registration grants zero');
    second:=public.flh_family_rewards_command(w,owner_id,null,'return_event_create',jsonb_build_object('occurred_at','2020-01-10T07:00:00Z','idempotency_key','qa-return-one'));
    perform pg_temp.return_assert(second->>'already_created'='true' and second->'return_event'->>'id'=e1::text,'normalized datetime retry reuses identity');
    second:=public.flh_family_rewards_command(w,admin_id,null,'return_event_create',jsonb_build_object('occurred_at','2020-01-10T07:00:00Z','idempotency_key','qa-return-one'));
    perform pg_temp.return_assert(second->>'error'='IDEMPOTENCY_CONFLICT','creator change conflicts safely');
    second:=public.flh_family_rewards_command(w,owner_id,null,'return_event_create',jsonb_build_object('occurred_at','2020-01-10T07:00:01Z','idempotency_key','qa-return-one'));
    perform pg_temp.return_assert(second->>'error'='IDEMPOTENCY_CONFLICT','time change conflicts safely');
    execute 'set local role service_role';
    e2:=pg_temp.return_create(w,admin_id,'2020-01-10T07:00:01Z','qa-return-two');
    execute 'reset role';
    e3:=pg_temp.return_create(w,owner_id,'2020-01-10T07:00:02Z','qa-return-three');
    foreign_event:=pg_temp.return_create(other_w,owner_id,'2020-01-10T07:00:00Z','qa-return-foreign');
    result:=public.flh_family_rewards_command(w,null,l1,'behavior_submit',jsonb_build_object('rule_id',greeting,'occurred_at',old_claim_time,'idempotency_key','qa-return-claim'));
    sid:=(result->'submission'->>'id')::uuid;
    perform pg_temp.return_assert(result->'submission'->>'status'='pending' and(result->'submission'->>'total_points')::integer=0 and not(result->'submission'->'snapshot'?'return_event_id'),'child common path remains unbound and pending');
    foreach identity in array array[unknown_event,foreign_event] loop
      result:=public.flh_family_rewards_command(w,owner_id,null,'behavior_review',jsonb_build_object('submission_id',sid,'decision','approved','return_event_id',identity));
      perform pg_temp.return_assert(result->>'error'='RETURN_EVENT_NOT_FOUND','unknown/cross-workspace event grants zero');
    end loop;
    result:=public.flh_family_rewards_command(w,owner_id,null,'behavior_review',jsonb_build_object('submission_id',sid,'decision','approved'));
    perform pg_temp.return_assert(result->>'error'='RETURN_EVENT_REQUIRED','unbound pending requires explicit verification');
    result:=public.flh_family_rewards_command(w,owner_id,l1,'behavior_record',jsonb_build_object('rule_id',greeting,'idempotency_key','qa-direct-missing'));
    perform pg_temp.return_assert(result->>'error'='RETURN_EVENT_REQUIRED' and not exists(select 1 from public.behavior_submissions where learner_id=l1 and idempotency_key='qa-direct-missing'),'direct record cannot bypass mapping or leave residue');
    result:=public.flh_family_rewards_command(w,owner_id,l1,'behavior_record',jsonb_build_object('rule_id',ordinary,'return_event_id',e1,'idempotency_key','qa-unrelated'));
    perform pg_temp.return_assert(result->>'error'='INVALID_RETURN_EVENT','unrelated rule binding denied');
    result:=public.flh_family_rewards_command(w,null,l1,'behavior_submit',jsonb_build_object('rule_id',greeting,'return_event_id',e1,'idempotency_key','qa-child-bind'));
    perform pg_temp.return_assert(result->>'error'='INVALID_RETURN_EVENT','raw child command cannot bind');
    execute 'set constraints behavior_submissions_return_event_workspace_fkey immediate';
    failed:=false;
    begin update public.behavior_submissions set return_event_id=foreign_event where id=sid; exception when foreign_key_violation then failed:=true; end;
    perform pg_temp.return_assert(failed and(select status='pending' and return_event_id is null and total_points=0 from public.behavior_submissions where id=sid),'same-workspace FK and failed mapping preserve pending');
    execute 'set local role service_role';
    result:=public.flh_family_rewards_command(w,owner_id,null,'behavior_review',jsonb_build_object('submission_id',sid,'decision','approved','return_event_id',e1));
    execute 'reset role';
    perform pg_temp.return_assert(result->>'ok'='true' and(result->'submission'->>'total_points')::integer=2 and(result->'submission'->>'occurred_at')::timestamptz=old_claim_time
      and result->'submission'->'snapshot'->>'verified_event_day'='2020-01-10'
      and(select count(*)=1 and sum(reward_points_delta)=2 and sum(xp_delta)=0 from public.gamification_events where source_type='family_behavior' and source_id=sid::text and metadata->>'return_event_id'=e1::text),'actual grant preserves claim time and immutable canonical ledger provenance');
    second:=public.flh_family_rewards_command(w,admin_id,null,'behavior_review',jsonb_build_object('submission_id',sid,'decision','approved','return_event_id',e1));
    perform pg_temp.return_assert(second->>'already_reviewed'='true','same final decision idempotent');
    second:=public.flh_family_rewards_command(w,admin_id,null,'behavior_review',jsonb_build_object('submission_id',sid,'decision','approved','return_event_id',e2));
    perform pg_temp.return_assert(second->>'error'='RETURN_EVENT_IMMUTABLE','final mapping cannot change');
    result:=public.flh_family_rewards_command(w,null,l1,'behavior_submit',jsonb_build_object('rule_id',greeting,'occurred_at','2020-01-11T08:00:00Z','idempotency_key','qa-return-other-clock'));
    sid2:=(result->'submission'->>'id')::uuid;
    result:=public.flh_family_rewards_command(w,admin_id,null,'behavior_review',jsonb_build_object('submission_id',sid2,'decision','approved','return_event_id',e1));
    perform pg_temp.return_assert(result->>'error'='DUPLICATE_OCCURRENCE','different claim clocks/keys/parents cannot repeat selected occasion');
    result:=public.flh_family_rewards_command(w,admin_id,l1,'behavior_record',jsonb_build_object('rule_id',greeting,'occurred_at',old_claim_time,'return_event_id',e2,'idempotency_key','qa-return-close'));
    perform pg_temp.return_assert(result->>'ok'='true','genuine close return with same claim clock remains eligible');
    result:=public.flh_family_rewards_command(w,owner_id,null,'behavior_review',jsonb_build_object('submission_id',sid2,'decision','approved','return_event_id',e3));
    perform pg_temp.return_assert(result->>'error'='CADENCE_LIMIT' and(select status='pending' and total_points=0 from public.behavior_submissions where id=sid2)
      and(select reward_points=24 and xp=100 from public.learner_gamification_state where learner_id=l1),'verified day caps both parents; changed claim day cannot move bucket');
    result:=public.flh_family_rewards_command(w,owner_id,l2,'behavior_record',jsonb_build_object('rule_id',greeting,'return_event_id',e1,'idempotency_key','qa-return-sibling'));
    perform pg_temp.return_assert(result->>'ok'='true' and(select reward_points=2 and xp=200 from public.learner_gamification_state where learner_id=l2),'another Testing learner can earn same shared family occasion');
    execute 'set local role service_role';
    result:=public.flh_family_rewards_command(w,owner_id,null,'parent_catalog',jsonb_build_object('test_only',true,'return_event_day','2020-01-10','return_event_page_size',1));
    second:=public.flh_family_rewards_command(w,owner_id,null,'parent_catalog',jsonb_build_object('test_only',true,'return_event_day','2020-01-10','return_event_page_size',1,'return_event_before_at',result->'return_event_next_cursor'->>'occurred_at','return_event_before_id',result->'return_event_next_cursor'->>'id'));
    perform pg_temp.return_assert(jsonb_array_length(result->'return_events')=1 and jsonb_array_length(second->'return_events')=1
      and second->'return_events'->0->>'id'<>result->'return_events'->0->>'id'
      and not(result->'return_events'->0 ?| array['created_by','request_payload','idempotency_key']),'service-only bounded safe day/cursor list');
    result:=public.flh_family_rewards_command(w,admin_id,null,'parent_catalog',jsonb_build_object('test_only',true,'return_event_day','2020-01-10'));
    perform pg_temp.return_assert(jsonb_array_length(result->'return_events')=3
      and not exists(select 1 from jsonb_array_elements(result->'return_events') e where e ?| array['created_by','request_payload','idempotency_key'] or e->>'id'=foreign_event::text),'admin safe catalog remains same-workspace and excludes private provenance');
    foreach identity in array array[teacher_id,outsider_id] loop
      result:=public.flh_family_rewards_command(w,identity,null,'parent_catalog',jsonb_build_object('return_event_day','2020-01-10'));
      perform pg_temp.return_assert(result->>'error'='PARENT_MANAGE_FORBIDDEN','service carrier retains teacher/foreign-parent catalog denial');
    end loop;
    result:=public.flh_family_rewards_command(w,null,l1,'student_catalog',jsonb_build_object('return_event_day','2020-01-10'));
    perform pg_temp.return_assert(result->'return_events'='[]'::jsonb,'learner catalog exposes no parent occasion list');
    result:=public.flh_family_rewards_command(w,owner_id,null,'parent_catalog',jsonb_build_object('return_event_day','2020-01-10','return_event_page_size',1));
    page_json:=public.flh_family_rewards_command(w,owner_id,null,'return_events_list',jsonb_build_object('return_event_day','2020-01-10','return_event_page_size',1));
    perform pg_temp.return_assert(page_json->'return_events'=result->'return_events'
      and page_json->'return_event_next_cursor'=result->'return_event_next_cursor'
      and (select array_agg(k order by k) from jsonb_object_keys(page_json) k)=array['ok','return_event_day','return_event_next_cursor','return_events'],'page-only carrier matches initial catalog page and omits all dashboard aggregates');
    second:=public.flh_family_rewards_command(w,owner_id,null,'return_events_list',jsonb_build_object('return_event_day','2020-01-10','return_event_page_size',1,
      'return_event_before_at',page_json->'return_event_next_cursor'->>'occurred_at','return_event_before_id',page_json->'return_event_next_cursor'->>'id'));
    perform pg_temp.return_assert(jsonb_array_length(second->'return_events')=1 and second->'return_events'->0->>'id'<>page_json->'return_events'->0->>'id','page-only keyset request advances without replaying the first page');
    result:=public.flh_family_rewards_command(w,admin_id,null,'return_events_list',jsonb_build_object('return_event_day','2020-01-10'));
    perform pg_temp.return_assert(jsonb_array_length(result->'return_events')=3
      and not exists(select 1 from jsonb_array_elements(result->'return_events') e where e ?| array['created_by','request_payload','idempotency_key'] or e->>'id'=foreign_event::text),'admin page-only carrier retains safe same-workspace context');
    foreach identity in array array[teacher_id,outsider_id] loop
      result:=public.flh_family_rewards_command(w,identity,null,'return_events_list',jsonb_build_object('return_event_day','2020-01-10'));
      perform pg_temp.return_assert(result->>'error'='PARENT_MANAGE_FORBIDDEN','page-only reads deny teacher/foreign identities');
    end loop;
    result:=public.flh_family_rewards_command(other_w,admin_id,null,'return_events_list',jsonb_build_object('return_event_day','2020-01-10'));
    perform pg_temp.return_assert(result->>'error'='PARENT_MANAGE_FORBIDDEN','membership in another workspace cannot read the foreign event page');
    result:=public.flh_family_rewards_command(w,null,l1,'return_events_list',jsonb_build_object('return_event_day','2020-01-10'));
    perform pg_temp.return_assert(result->>'error'='PARENT_MANAGE_FORBIDDEN','learner cannot access the parent page-only action');
    result:=public.flh_family_rewards_command(w,owner_id,null,'return_events_list',jsonb_build_object('return_event_day','not-a-day'));
    perform pg_temp.return_assert(result->>'error'='INVALID_INPUT','page-only action rejects malformed dates');
    result:=public.flh_family_rewards_command(w,owner_id,null,'return_events_list',jsonb_build_object('return_event_day','2020-01-10','return_event_before_at','2020-01-10T07:00:00Z'));
    perform pg_temp.return_assert(result->>'error'='INVALID_INPUT','page-only action requires a complete cursor pair');
    perform pg_temp.return_assert((select reward_points=24 and xp=100 from public.learner_gamification_state where learner_id=l1)
      and(select reward_points=2 and xp=200 from public.learner_gamification_state where learner_id=l2)
      and(select count(*)=original_events+4 from public.family_return_events),'successful and denied page-only reads grant no points and create no occasions');
    execute 'reset role';
    -- RLS cannot turn a missing table grant into zero visible rows. Direct
    -- owner/admin/teacher/foreign-parent/learner reads must fail with 42501.
    foreach identity in array array[owner_id,admin_id,teacher_id,outsider_id,l1] loop
      perform set_config('request.jwt.claim.sub',identity::text,true);execute 'set local role authenticated';
      failed:=false;
      begin perform id from public.family_return_events;exception when insufficient_privilege then failed:=(sqlstate='42501');end;
      execute 'reset role';
      perform pg_temp.return_assert(failed,'direct authenticated register SELECT is permission denied for every identity');
    end loop;
    execute 'set local role anon';failed:=false;
    begin perform id from public.family_return_events;exception when insufficient_privilege then failed:=(sqlstate='42501');end;
    execute 'reset role';
    perform pg_temp.return_assert(failed,'direct anonymous register SELECT is permission denied');
    execute 'set local role service_role';
    failed:=false;begin update public.family_return_events set occurred_at=occurred_at+interval '1 day' where id=e1;exception when check_violation then failed:=true;end;
    perform pg_temp.return_assert(failed,'service role cannot rewrite used verified event time');
    failed:=false;begin update public.behavior_submissions set return_event_id=e3 where id=sid;exception when check_violation then failed:=true;end;
    perform pg_temp.return_assert(failed,'completed award binding immutable');
    failed:=false;begin delete from public.family_return_events where id=e1;exception when check_violation then failed:=true;end;
    perform pg_temp.return_assert(failed,'service role CRUD grant cannot bypass used-event delete guard');
    execute 'reset role';
    -- Synthetic cutover history represents an existing award, never a fabricated event backfill.
    insert into public.behavior_submissions(workspace_id,learner_id,rule_id,occurred_at,requester_type,status,approved_at,base_points,total_points,idempotency_key)
      values(w,l1,greeting,'2020-01-12T10:00:00+03:00','parent','approved','2020-01-12T10:00:00+03:00',2,2,'qa-return-legacy') returning id into legacy_id;
    identity:=pg_temp.return_create(w,owner_id,'2020-01-12T15:00:00+03:00','qa-return-legacy-slot');
    result:=public.flh_family_rewards_command(w,owner_id,l1,'behavior_record',jsonb_build_object('rule_id',greeting,'return_event_id',identity,'idempotency_key','qa-return-legacy-new'));
    perform pg_temp.return_assert(result->>'ok'='true','one remaining cutover day slot available');
    identity:=pg_temp.return_create(w,owner_id,'2020-01-12T18:00:00+03:00','qa-return-legacy-third');
    result:=public.flh_family_rewards_command(w,admin_id,l1,'behavior_record',jsonb_build_object('rule_id',greeting,'return_event_id',identity,'idempotency_key','qa-return-legacy-capped'));
    perform pg_temp.return_assert(result->>'error'='CADENCE_LIMIT' and(select return_event_id is null and total_points=2 and occurred_at='2020-01-12T07:00:00Z'::timestamptz from public.behavior_submissions where id=legacy_id),'NULL-event history remains untouched and countable');
    midnight1:=pg_temp.return_create(w,owner_id,'2020-01-20T23:59:59+03:00','qa-return-midnight-one');
    midnight2:=pg_temp.return_create(w,admin_id,'2020-01-21T00:00:00+03:00','qa-return-midnight-two');
    result:=public.flh_family_rewards_command(w,owner_id,l1,'behavior_record',jsonb_build_object('rule_id',greeting,'occurred_at',old_claim_time,'return_event_id',midnight1,'idempotency_key','qa-midnight-grant-one'));
    second:=public.flh_family_rewards_command(w,admin_id,l1,'behavior_record',jsonb_build_object('rule_id',greeting,'occurred_at',old_claim_time,'return_event_id',midnight2,'idempotency_key','qa-midnight-grant-two'));
    perform pg_temp.return_assert(result->>'ok'='true' and second->>'ok'='true' and result->'submission'->'snapshot'->>'verified_event_day'='2020-01-20'
      and second->'submission'->'snapshot'->>'verified_event_day'='2020-01-21'
      and(select(a.occurred_at at time zone 'UTC')::date=(b.occurred_at at time zone 'UTC')::date from public.family_return_events a,public.family_return_events b where a.id=midnight1 and b.id=midnight2),'late review uses Istanbul rollover within same UTC date');
    result:=public.flh_family_rewards_command(w,owner_id,null,'behavior_review',jsonb_build_object('submission_id',sid2,'decision','rejected'));
    perform pg_temp.return_assert(result->>'ok'='true' and(result->'submission'->>'total_points')::integer=0,'normal rejection needs no event');
    perform pg_temp.return_assert((select coalesce(jsonb_object_agg(s.id::text,md5(to_jsonb(s)::text)),'{}') from public.behavior_submissions s where original_history?s.id::text)=original_history,'pre-existing history unchanged');
    delete from public.workspaces where id=other_w;
    perform pg_temp.return_assert(not exists(select 1 from public.family_return_events where id=foreign_event),'workspace erasure cascade retained');
    delete from public.learners where id=l2 and workspace_id=w;
    perform pg_temp.return_assert(not exists(select 1 from public.gamification_events where learner_id=l2),'learner ledger erasure retained');
    raise exception 'Successful return contract rollback' using errcode='ZX017';
  exception when sqlstate 'ZX017' then null;
  end;
  perform pg_temp.return_assert((select count(*) from public.family_return_events)=original_events
    and(select to_jsonb(r) from public.behavior_rules r where r.id=greeting)=original_rule
    and not exists(select 1 from public.learners where id in(l1,l2))
    and not exists(select 1 from auth.users where id in(owner_id,admin_id,teacher_id,outsider_id))
    and not exists(select 1 from public.workspaces where id=other_w),'rollback removes all event/actor/financial fixtures');
  perform pg_temp.return_assert((select coalesce(jsonb_object_agg(s.id::text,md5(to_jsonb(s)::text)),'{}') from public.behavior_submissions s where s.workspace_id=w)=original_history,'rollback restores exact history');
  raise notice 'Parent canonical return event contract passed; all fixtures rolled back';
end $contract$;
