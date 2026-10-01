-- FLH-FEAT-2026-010 / SPEC_VERSION 1.0 / DRIVE_REVISION_ID 3.
-- Forward-only addition. No existing XP, reward balance, or academic award is rewritten.
-- Edge verifies parent JWT / learner HMAC; service_role alone executes commands.

create table if not exists public.behavior_categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  code text,
  title text not null check (length(btrim(title)) between 1 and 120),
  description text not null default '' check (length(description) <= 1000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id), unique (workspace_id, code)
);
create table if not exists public.behavior_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  category_id uuid not null,
  title text not null check (length(btrim(title)) between 1 and 120),
  description text not null default '' check (length(description) <= 1000),
  base_points integer not null default 0 check (base_points between 0 and 100000),
  initiative_bonus_points integer not null default 0 check (initiative_bonus_points between 0 and 100000),
  learner_scope text not null default 'all' check (learner_scope in ('all','selected')),
  cadence text not null default 'day' check (cadence in ('unlimited','day','week')),
  max_awards integer check (max_awards between 1 and 100000),
  self_report_allowed boolean not null default false,
  parent_approval_required boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (category_id, workspace_id) references public.behavior_categories(id, workspace_id) on delete restrict,
  check ((cadence = 'unlimited' and max_awards is null) or (cadence <> 'unlimited' and max_awards is not null))
);
create table if not exists public.behavior_rule_learners (
  workspace_id uuid not null,
  rule_id uuid not null,
  learner_id uuid not null,
  primary key (rule_id, learner_id),
  foreign key (rule_id, workspace_id) references public.behavior_rules(id, workspace_id) on delete cascade,
  foreign key (learner_id, workspace_id) references public.learners(id, workspace_id) on delete cascade
);
create table if not exists public.behavior_submissions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  learner_id uuid not null,
  rule_id uuid not null,
  initiative boolean not null default false,
  occurred_at timestamptz not null default now(),
  requested_at timestamptz not null default now(),
  requester_type text not null check (requester_type in ('parent','learner')),
  requester_id uuid references auth.users(id) on delete set null,
  reviewer_id uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  approved_at timestamptz,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reason text not null default '' check (length(reason) <= 1000),
  review_reason text not null default '' check (length(review_reason) <= 1000),
  base_points integer not null default 0 check (base_points >= 0),
  initiative_bonus_points integer not null default 0 check (initiative_bonus_points >= 0),
  total_points integer not null default 0 check (total_points = base_points + initiative_bonus_points),
  snapshot jsonb not null default '{}'::jsonb,
  idempotency_key text not null check (length(idempotency_key) between 8 and 200),
  unique (id, workspace_id), unique (workspace_id, learner_id, idempotency_key),
  foreign key (learner_id, workspace_id) references public.learners(id, workspace_id) on delete cascade,
  foreign key (rule_id, workspace_id) references public.behavior_rules(id, workspace_id) on delete restrict,
  check (status = 'approved' or total_points = 0)
);
create index if not exists behavior_submissions_cadence_idx on public.behavior_submissions(workspace_id, learner_id, rule_id, approved_at) where status = 'approved';
create index if not exists behavior_submissions_pending_idx on public.behavior_submissions(workspace_id, status, requested_at desc);
create table if not exists public.reward_learner_scopes (
  workspace_id uuid not null,
  reward_id uuid not null,
  learner_id uuid not null,
  primary key (reward_id, learner_id),
  foreign key (reward_id, workspace_id) references public.gamification_rewards(id, workspace_id) on delete cascade,
  foreign key (learner_id, workspace_id) references public.learners(id, workspace_id) on delete cascade
);
alter table public.gamification_rewards add column if not exists learner_scope text not null default 'all' check (learner_scope in ('all','selected'));
alter table public.reward_claims add column if not exists idempotency_key text;
create unique index if not exists reward_claims_request_idempotency_idx on public.reward_claims(workspace_id, learner_id, idempotency_key) where idempotency_key is not null;
create unique index if not exists gamification_events_family_source_idempotency_idx on public.gamification_events(workspace_id, learner_id, source_type, source_id) where source_type in ('family_behavior','reward_claim','manual_adjustment');
create unique index if not exists gamification_events_reversal_once_idx on public.gamification_events(workspace_id, learner_id, (metadata->>'reversal_event_id')) where source_type = 'manual_adjustment' and metadata->>'reversal_event_id' is not null;

-- Default categories are editable; no behavior, values, or rules are imposed.
insert into public.behavior_categories(workspace_id, code, title)
select w.id, d.code, d.title from public.workspaces w cross join (values
 ('learning','التعلّم'), ('personal-responsibility','المسؤولية الشخصية'),
 ('initiative','المبادرة والاستقلالية'), ('household','المساهمة في المنزل'),
 ('habits-values','العادات والقيم'), ('health','الصحة والعناية بالنفس'), ('custom','مخصص')
) d(code,title) on conflict (workspace_id, code) do nothing;

do $rls$
declare t text;
begin
  foreach t in array array['behavior_categories','behavior_rules','behavior_rule_learners','behavior_submissions','reward_learner_scopes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || '_parent_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.workspace_role(workspace_id, (select auth.uid())) in (''owner'',''admin''))', t || '_parent_read', t);
  end loop;
end $rls$;
-- Financial state/history and claim transitions now have one server command boundary.
-- Existing academic service-role RPCs keep their write permissions.
revoke insert, update, delete on public.learner_gamification_state, public.gamification_events, public.reward_claims from authenticated;
revoke insert, update, delete on public.gamification_rewards from authenticated;

create or replace function public.flh_family_ledger_guard()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op in ('UPDATE','DELETE') and old.source_type in ('family_behavior','reward_claim','manual_adjustment') then
    raise exception 'FAMILY_LEDGER_IMMUTABLE' using errcode = '23514';
  end if;
  if tg_op <> 'DELETE' and new.source_type in ('family_behavior','reward_claim','manual_adjustment') and new.xp_delta <> 0 then
    raise exception 'FAMILY_XP_FORBIDDEN' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists gamification_events_family_guard on public.gamification_events;
create trigger gamification_events_family_guard before insert or update or delete on public.gamification_events for each row execute function public.flh_family_ledger_guard();
revoke all on function public.flh_family_ledger_guard() from public, anon, authenticated;
grant execute on function public.flh_family_ledger_guard() to service_role;

-- The eligibility calculation is shared by request, approval, and catalog reads.
create or replace function public.flh_family_reward_eligibility(p_workspace_id uuid, p_learner_id uuid, p_reward_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  r public.gamification_rewards%rowtype;
  s public.learner_gamification_state%rowtype;
  l public.learners%rowtype;
  reasons jsonb := '[]'::jsonb;
  v_count integer;
  v_badge text;
  v_check_time timestamptz := clock_timestamp();
begin
  select * into l from public.learners where id = p_learner_id and workspace_id = p_workspace_id and is_active;
  if not found then return jsonb_build_object('eligible',false,'ineligibility_reasons',jsonb_build_array('LEARNER_NOT_FOUND')); end if;
  select * into r from public.gamification_rewards where id = p_reward_id and workspace_id = p_workspace_id;
  if not found then return jsonb_build_object('eligible',false,'ineligibility_reasons',jsonb_build_array('REWARD_NOT_FOUND')); end if;
  select * into s from public.learner_gamification_state where learner_id = p_learner_id and workspace_id = p_workspace_id;
  if not r.is_active then reasons := reasons || '"REWARD_INACTIVE"'::jsonb; end if;
  if (r.available_from is not null and v_check_time < r.available_from) or (r.available_until is not null and v_check_time > r.available_until) then reasons := reasons || '"REWARD_UNAVAILABLE"'::jsonb; end if;
  if (r.learner_scope = 'all' and coalesce((l.metadata->>'is_test')::boolean,false)) or (r.learner_scope = 'selected' and not exists(select 1 from public.reward_learner_scopes where workspace_id = p_workspace_id and reward_id = r.id and learner_id = l.id)) then reasons := reasons || '"REWARD_SCOPE_FORBIDDEN"'::jsonb; end if;
  if coalesce(s.reward_points,0) < coalesce(r.required_reward_points,0) then reasons := reasons || '"INSUFFICIENT_POINTS"'::jsonb; end if;
  if coalesce(s.current_level,1) < coalesce(r.required_level,1) then reasons := reasons || '"LEVEL_REQUIRED"'::jsonb; end if;
  if coalesce(s.xp,0) < coalesce((r.criteria->>'min_xp')::integer,0) then reasons := reasons || '"XP_REQUIRED"'::jsonb; end if;
  if coalesce(s.current_streak,0) < coalesce((r.criteria->>'current_streak')::integer,0) or coalesce(s.longest_streak,0) < coalesce((r.criteria->>'longest_streak')::integer,0) then reasons := reasons || '"STREAK_REQUIRED"'::jsonb; end if;
  for v_badge in select jsonb_array_elements_text(coalesce(r.criteria->'required_badge_codes','[]'::jsonb)) loop
    if not exists(select 1 from public.learner_badges lb join public.gamification_badges b on b.id = lb.badge_id and b.workspace_id = lb.workspace_id where lb.workspace_id = p_workspace_id and lb.learner_id = p_learner_id and b.code = v_badge) then reasons := reasons || '"BADGE_REQUIRED"'::jsonb; exit; end if;
  end loop;
  select count(*) into v_count from public.reward_claims where workspace_id = p_workspace_id and learner_id = p_learner_id and reward_id = p_reward_id and status in ('approved','redeemed');
  if r.max_redemptions_per_learner is not null and v_count >= r.max_redemptions_per_learner then reasons := reasons || '"REDEMPTION_LIMIT"'::jsonb; end if;
  return jsonb_build_object('eligible',jsonb_array_length(reasons)=0,'ineligibility_reasons',reasons,'progress',jsonb_build_object('points',coalesce(s.reward_points,0),'required_points',coalesce(r.required_reward_points,0),'level',coalesce(s.current_level,1),'required_level',coalesce(r.required_level,1),'redemptions',v_count));
end $$;
revoke all on function public.flh_family_reward_eligibility(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.flh_family_reward_eligibility(uuid,uuid,uuid) to service_role;

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
begin
  if p_workspace_id is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' then return jsonb_build_object('error','INVALID_INPUT'); end if;
  if v_parent then
    if not exists(select 1 from public.workspace_members where workspace_id = p_workspace_id and user_id = p_actor_id and role in ('owner','admin')) then return jsonb_build_object('error','PARENT_MANAGE_FORBIDDEN'); end if;
  elsif p_action not in ('student_catalog','student_ledger','behavior_submit','reward_request') then return jsonb_build_object('error','PARENT_MANAGE_FORBIDDEN');
  end if;

  if not v_parent and p_learner_id is null then return jsonb_build_object('error','LEARNER_NOT_FOUND'); end if;
  if p_learner_id is not null then
    select * into v_learner from public.learners where workspace_id = p_workspace_id and id = p_learner_id and is_active;
    if not found then return jsonb_build_object('error','LEARNER_NOT_FOUND'); end if;
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
        and (nullif(p_payload->>'source_type','') is null or coalesce(e.source_type,'academic')=p_payload->>'source_type')
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
      'states',(select coalesce(jsonb_agg(jsonb_build_object('learner_id',l.id,'xp',coalesce(s.xp,0),'reward_points',coalesce(s.reward_points,0),'current_level',coalesce(s.current_level,1),'current_streak',coalesce(s.current_streak,0),'longest_streak',coalesce(s.longest_streak,0))),'[]'::jsonb) from public.learners l left join public.learner_gamification_state s on s.learner_id=l.id and s.workspace_id=l.workspace_id where l.id=any(v_ids) and l.workspace_id=p_workspace_id),
      'categories',(select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at),'[]'::jsonb) from public.behavior_categories c where c.workspace_id=p_workspace_id and (v_parent or c.is_active)),
      'badges',case when v_parent then (select coalesce(jsonb_agg(jsonb_build_object('code',code,'title',title,'is_active',is_active) order by title),'[]'::jsonb) from public.gamification_badges where workspace_id=p_workspace_id) else '[]'::jsonb end,
      'rules',(select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object('category_title',c.title,'learner_ids',(select coalesce(jsonb_agg(rl.learner_id),'[]'::jsonb) from public.behavior_rule_learners rl where rl.rule_id=r.id and rl.workspace_id=p_workspace_id and (v_parent or rl.learner_id=p_learner_id))) order by r.created_at),'[]'::jsonb) from public.behavior_rules r join public.behavior_categories c on c.id=r.category_id and c.workspace_id=r.workspace_id where r.workspace_id=p_workspace_id and (v_parent or (r.is_active and c.is_active and r.self_report_allowed and ((r.learner_scope='all' and not coalesce((v_learner.metadata->>'is_test')::boolean,false)) or exists(select 1 from public.behavior_rule_learners rl where rl.rule_id=r.id and rl.workspace_id=p_workspace_id and rl.learner_id=p_learner_id))))),
      'rewards',(select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object('learner_ids',(select coalesce(jsonb_agg(rl.learner_id),'[]'::jsonb) from public.reward_learner_scopes rl where rl.reward_id=r.id and rl.workspace_id=p_workspace_id and (v_parent or rl.learner_id=p_learner_id))) || case when p_action='student_catalog' then public.flh_family_reward_eligibility(p_workspace_id,p_learner_id,r.id) else '{}'::jsonb end order by r.created_at),'[]'::jsonb) from public.gamification_rewards r where r.workspace_id=p_workspace_id and (v_parent or (r.is_active and ((r.learner_scope='all' and not coalesce((v_learner.metadata->>'is_test')::boolean,false)) or exists(select 1 from public.reward_learner_scopes rl where rl.reward_id=r.id and rl.workspace_id=p_workspace_id and rl.learner_id=p_learner_id))))),
      'submissions',(select coalesce(jsonb_agg(to_jsonb(x) order by x.requested_at desc),'[]'::jsonb) from (select s.*, coalesce(s.snapshot->>'rule_title',r.title) as rule_title, coalesce(s.snapshot->>'category_title',c.title) as category_title from public.behavior_submissions s join public.behavior_rules r on r.id=s.rule_id and r.workspace_id=s.workspace_id join public.behavior_categories c on c.id=r.category_id and c.workspace_id=r.workspace_id where s.workspace_id=p_workspace_id and s.learner_id=any(v_ids) and (s.status='pending' or s.id in(select id from public.behavior_submissions where workspace_id=p_workspace_id and learner_id=any(v_ids) order by requested_at desc limit 200)) order by s.requested_at desc) x),
      'claims',(select coalesce(jsonb_agg(to_jsonb(x) order by x.requested_at desc),'[]'::jsonb) from (select c.*,coalesce(c.metadata->>'reward_title',r.title) as reward_title from public.reward_claims c join public.gamification_rewards r on r.id=c.reward_id and r.workspace_id=c.workspace_id where c.workspace_id=p_workspace_id and c.learner_id=any(v_ids) and (c.status='pending' or c.id in(select id from public.reward_claims where workspace_id=p_workspace_id and learner_id=any(v_ids) order by requested_at desc limit 200)) order by c.requested_at desc) x),
      'ledger',(select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc,e.id desc),'[]'::jsonb) from (select * from public.gamification_events where workspace_id=p_workspace_id and learner_id=any(v_ids) order by created_at desc,id desc limit 100) e),
      'breakdown',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (select learner_id, metadata->>'category_id' as category_id, coalesce(metadata->>'category_title',case when source_type='quiz' then 'التعلّم' when source_type='reward_claim' then 'الجوائز' else 'تعديل موثّق' end) as category_title,coalesce(source_type,'academic') as source_type,sum(reward_points_delta) as points from public.gamification_events where workspace_id=p_workspace_id and learner_id=any(v_ids) group by learner_id,metadata->>'category_id',coalesce(metadata->>'category_title',case when source_type='quiz' then 'التعلّم' when source_type='reward_claim' then 'الجوائز' else 'تعديل موثّق' end),coalesce(source_type,'academic')) x)
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
    if (v_scope='selected' and cardinality(v_scope_ids)=0) or exists(select 1 from unnest(v_scope_ids) scope_learner(learner_id) where not exists(select 1 from public.learners l where l.id=scope_learner.learner_id and l.workspace_id=p_workspace_id and l.is_active)) then return jsonb_build_object('error','INVALID_SCOPE'); end if;
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
    if jsonb_typeof(v_criteria)<>'object' or exists(select 1 from jsonb_object_keys(v_criteria) k where k not in ('current_streak','longest_streak','min_xp','required_badge_codes')) then return jsonb_build_object('error','INVALID_CRITERIA'); end if;
    if exists(select 1 from jsonb_each(v_criteria) kv where kv.key in ('current_streak','longest_streak','min_xp') and (jsonb_typeof(kv.value)<>'number' or kv.value::text !~ '^[0-9]+$')) then return jsonb_build_object('error','INVALID_CRITERIA'); end if;
    if v_criteria ? 'required_badge_codes' then
      if jsonb_typeof(v_criteria->'required_badge_codes')<>'array' then return jsonb_build_object('error','INVALID_CRITERIA'); end if;
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
      select * into v_submission from public.behavior_submissions where workspace_id=p_workspace_id and learner_id=p_learner_id and idempotency_key=v_key;
      if found then
        if v_submission.rule_id<>v_rule.id or v_submission.requester_type<>(case when p_action='behavior_submit' then 'learner' else 'parent' end) or v_submission.initiative<>coalesce((p_payload->>'initiative')::boolean,false) then return jsonb_build_object('error','IDEMPOTENCY_CONFLICT'); end if;
        return jsonb_build_object('ok',true,'submission',to_jsonb(v_submission),'already_recorded',true);
      end if;
    end if;
    select * into v_category from public.behavior_categories where id=v_rule.category_id and workspace_id=p_workspace_id;
    if not v_rule.is_active or not v_category.is_active then return jsonb_build_object('error','RULE_INACTIVE'); end if;
    if (v_rule.learner_scope='all' and coalesce((v_learner.metadata->>'is_test')::boolean,false)) or (v_rule.learner_scope='selected' and not exists(select 1 from public.behavior_rule_learners where rule_id=v_rule.id and workspace_id=p_workspace_id and learner_id=p_learner_id)) then return jsonb_build_object('error','RULE_SCOPE_FORBIDDEN'); end if;
    if p_action='behavior_submit' and not v_rule.self_report_allowed then return jsonb_build_object('error','SELF_REPORT_FORBIDDEN'); end if;
    if p_action<>'behavior_review' then
      if coalesce(nullif(p_payload->>'occurred_at','')::timestamptz,v_now)>v_now then return jsonb_build_object('error','INVALID_OCCURRED_AT'); end if;
      insert into public.behavior_submissions(workspace_id,learner_id,rule_id,initiative,occurred_at,requester_type,requester_id,reason,idempotency_key,requested_at)
      values(p_workspace_id,p_learner_id,v_rule.id,coalesce((p_payload->>'initiative')::boolean,false),coalesce(nullif(p_payload->>'occurred_at','')::timestamptz,v_now),case when p_action='behavior_submit' then 'learner' else 'parent' end,case when p_action='behavior_submit' then null else p_actor_id end,coalesce(p_payload->>'reason',''),v_key,v_now) returning * into v_submission;
      -- AC06 always requires parent review, regardless of configurable policy flag.
      if p_action='behavior_submit' then return jsonb_build_object('ok',true,'submission',to_jsonb(v_submission)); end if;
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
    v_snapshot := jsonb_build_object('category_id',v_category.id,'category_title',v_category.title,'rule_id',v_rule.id,'rule_title',v_rule.title,'base_points',v_points,'initiative_bonus_points',v_bonus,'total_points',v_points+v_bonus,'requester_type',v_submission.requester_type,'requester_id',v_submission.requester_id,'requester_learner_id',case when v_submission.requester_type='learner' then p_learner_id else null end,'requester',jsonb_build_object('type',v_submission.requester_type,'id',case when v_submission.requester_type='learner' then p_learner_id else v_submission.requester_id end),'reviewer',p_actor_id,'reviewer_id',p_actor_id,'occurred_at',v_submission.occurred_at,'approved_at',v_now,'status','approved','is_test',coalesce((v_learner.metadata->>'is_test')::boolean,false));
    insert into public.learner_gamification_state(workspace_id,learner_id,reward_points) values(p_workspace_id,p_learner_id,v_points+v_bonus) on conflict(learner_id) do update set reward_points=learner_gamification_state.reward_points+excluded.reward_points returning reward_points into v_balance;
    insert into public.gamification_events(workspace_id,learner_id,event_type,xp_delta,reward_points_delta,source_type,source_id,reason,metadata,created_at) values(p_workspace_id,p_learner_id,'other',0,v_points+v_bonus,'family_behavior',v_submission.id::text,coalesce(nullif(v_submission.reason,''),v_rule.title),v_snapshot,v_now);
    update public.behavior_submissions set status='approved',reviewer_id=p_actor_id,reviewed_at=v_now,approved_at=v_now,review_reason=coalesce(p_payload->>'reason',''),base_points=v_points,initiative_bonus_points=v_bonus,total_points=v_points+v_bonus,snapshot=v_snapshot where id=v_submission.id returning * into v_submission;
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
      select * into v_claim from public.reward_claims where workspace_id=p_workspace_id and learner_id=p_learner_id and idempotency_key=v_key;
      if found then
        if v_claim.reward_id<>v_reward.id then return jsonb_build_object('error','IDEMPOTENCY_CONFLICT'); end if;
        return jsonb_build_object('ok',true,'claim',to_jsonb(v_claim),'already_requested',true);
      end if;
    end if;
    v_eligibility := public.flh_family_reward_eligibility(p_workspace_id,p_learner_id,v_reward.id);
    if not (v_eligibility->>'eligible')::boolean then return jsonb_build_object('error',v_eligibility->'ineligibility_reasons'->>0,'ineligibility_reasons',v_eligibility->'ineligibility_reasons'); end if;
    if p_action='reward_request' then
      if exists(select 1 from public.reward_claims where workspace_id=p_workspace_id and learner_id=p_learner_id and reward_id=v_reward.id and status='pending') then return jsonb_build_object('error','CLAIM_ALREADY_PENDING'); end if;
      insert into public.reward_claims(workspace_id,learner_id,reward_id,idempotency_key,metadata,requested_at) values(p_workspace_id,p_learner_id,v_reward.id,v_key,jsonb_build_object('requester_learner_id',p_learner_id,'reward_title',v_reward.title,'requested_points',coalesce(v_reward.required_reward_points,0),'is_test',coalesce((v_learner.metadata->>'is_test')::boolean,false)),v_now) returning * into v_claim;
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
    select * into v_event from public.gamification_events where workspace_id=p_workspace_id and learner_id=p_learner_id and source_type='manual_adjustment' and source_id=v_key;
    if found then
      if v_event.reason<>v_reason or (p_payload ? 'reversal_event_id' and (v_event.metadata->>'reversal_event_id' is distinct from p_payload->>'reversal_event_id')) or (not (p_payload ? 'reversal_event_id') and (v_event.reward_points_delta is distinct from (p_payload->>'delta')::integer)) then return jsonb_build_object('error','IDEMPOTENCY_CONFLICT'); end if;
      return jsonb_build_object('ok',true,'event',to_jsonb(v_event),'already_adjusted',true);
    end if;
    v_snapshot := jsonb_build_object('actor_id',p_actor_id,'status','approved','is_test',coalesce((v_learner.metadata->>'is_test')::boolean,false));
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
comment on function public.flh_family_rewards_command(uuid,uuid,uuid,text,jsonb) is 'FLH-FEAT-2026-010 rev 3. Service-only atomic family behavior/reward commands; Edge supplies verified identity. Daily/weekly cadence uses approval time in UTC.';
