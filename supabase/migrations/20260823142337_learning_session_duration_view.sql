create or replace view public.learner_learning_session_report as
select
  s.id,
  s.workspace_id,
  s.learner_id,
  s.entry_type,
  s.started_at,
  s.last_activity_at,
  s.ended_at,
  greatest(0, extract(epoch from (coalesce(s.ended_at,s.last_activity_at)-s.started_at))::int) as effective_duration_seconds,
  s.end_reason,
  s.metadata
from public.learner_learning_sessions s;
