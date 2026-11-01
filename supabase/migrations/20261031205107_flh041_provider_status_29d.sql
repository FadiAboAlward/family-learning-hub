-- FLH-041 v1.2 regression fix: the approved YouTube Data API status window is 29 days.
-- The original attach/refresh validators accepted only 7 days, rejecting every
-- server-authenticated 29-day provider response. Preserve all security,
-- context, revision and learner-data behavior; change only the interval cap.
-- Forward-only, drift-guarded and idempotent. No data rows are modified.
-- The original assignment table check also capped verification at seven days.
-- Change only that check; all other constraints, grants and data remain untouched.
do $flh041_constraint$
declare
  existing_check text;
  existing_validated boolean;
  -- Exact canonical pg_get_constraintdef captured from Production preflight.
  -- Fail closed on any added, removed or changed predicate, not just the interval.
  expected_old_check constant text := $expected_constraint$CHECK (((verification_state <> 'verified'::text) OR ((embeddable IS TRUE) AND (made_for_kids IS NOT NULL) AND (verified_at IS NOT NULL) AND (verification_expires_at > verified_at) AND (verification_expires_at <= (verified_at + '7 days'::interval)))))$expected_constraint$;
  expected_new_check constant text := replace(
    expected_old_check, '''7 days''::interval', '''29 days''::interval'
  );
begin
  select pg_get_constraintdef(c.oid), c.convalidated
    into existing_check, existing_validated
  from pg_constraint c
  where c.conrelid = 'public.learning_video_assignments'::regclass
    and c.conname = 'learning_video_assignments_check';
  if existing_validated is distinct from true then
    raise exception 'FLH-041 assignment check missing or not validated';
  end if;
  if existing_check = expected_new_check then
    null; -- Exact approved target: idempotent reapplication.
  elsif existing_check = expected_old_check then
    alter table public.learning_video_assignments
      drop constraint learning_video_assignments_check;
    alter table public.learning_video_assignments
      add constraint learning_video_assignments_check
      check (verification_state <> 'verified' or (
        embeddable is true and made_for_kids is not null and verified_at is not null
        and verification_expires_at > verified_at
        and verification_expires_at <= verified_at + interval '29 days'
      ));
    select pg_get_constraintdef(c.oid), c.convalidated
      into existing_check, existing_validated
    from pg_constraint c
    where c.conrelid = 'public.learning_video_assignments'::regclass
      and c.conname = 'learning_video_assignments_check';
    if existing_check is distinct from expected_new_check
       or existing_validated is distinct from true then
      raise exception 'FLH-041 replacement assignment check differs from approved predicate';
    end if;
  else
    raise exception 'FLH-041 assignment check drift: unexpected predicate';
  end if;
end
$flh041_constraint$;

do $flh041$
declare
  target regprocedure;
  original_definition text;
  previous_limit constant text := 'interval ''7 days''';
  approved_limit constant text := 'interval ''29 days''';
begin
  foreach target in array array[
    'public.flh_learning_video_attach(uuid,uuid,jsonb)'::regprocedure,
    'public.flh_learning_video_refresh(uuid,uuid,uuid,uuid,jsonb)'::regprocedure
  ]
  loop
    original_definition := pg_get_functiondef(target);
    if position(approved_limit in original_definition) > 0
       and position(previous_limit in original_definition) = 0 then
      continue; -- Safe reapplication after a successful prior migration.
    end if;
    if length(original_definition) - length(replace(original_definition,previous_limit,''))
       <> length(previous_limit) then
      raise exception 'FLH-041 unexpected provider validation function definition: %', target;
    end if;
    execute replace(original_definition,previous_limit,approved_limit);
    if position(approved_limit in pg_get_functiondef(target)) = 0 then
      raise exception 'FLH-041 provider interval verification failed: %',target;
    end if;
  end loop;
end
$flh041$;
