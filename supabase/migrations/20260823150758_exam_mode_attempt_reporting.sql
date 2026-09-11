create index if not exists quiz_attempts_delivery_mode_idx on public.quiz_attempts (workspace_id, learner_id, delivery_mode, submitted_at desc);
