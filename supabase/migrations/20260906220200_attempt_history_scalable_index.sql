create index if not exists quiz_attempts_history_idx
on public.quiz_attempts (workspace_id, learner_id, submitted_at desc, id desc)
where status = 'submitted'
  and delivery_mode in ('learning','exam');
