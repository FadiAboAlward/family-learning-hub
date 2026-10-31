-- FLH-041 v1.2 regression fix: the approved YouTube Data API status window is 29 days.
-- The original attach/refresh validators accepted only 7 days, rejecting every
-- server-authenticated 29-day provider response. Preserve all security,
-- context, revision and learner-data behavior; change only the interval cap.
-- Forward-only, drift-guarded and idempotent. No data rows are modified.
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
