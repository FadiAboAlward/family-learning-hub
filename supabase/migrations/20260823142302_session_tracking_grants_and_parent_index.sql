create index if not exists learner_learning_sessions_started_idx
  on public.learner_learning_sessions (workspace_id, started_at desc);

comment on table public.learner_learning_sessions is 'Learner active learning visits. Sessions split after inactivity and exclude test learners from parent metrics at query time.';
