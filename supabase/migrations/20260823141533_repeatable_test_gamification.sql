create or replace function private.is_test_learner(p_learner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce((metadata->>'is_test')::boolean, false)
  from public.learners
  where id = p_learner_id
  limit 1;
$$;

create or replace function private.rewrite_test_gamification_source()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.event_type = 'quiz_completed'
     and new.source_type = 'quiz'
     and private.is_test_learner(new.learner_id) then
    new.source_id := coalesce(new.source_id, 'quiz') || ':test:' || gen_random_uuid()::text;
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object('is_test', true);
  end if;
  return new;
end;
$$;

drop trigger if exists gamification_events_test_source on public.gamification_events;
create trigger gamification_events_test_source
before insert on public.gamification_events
for each row execute function private.rewrite_test_gamification_source();
