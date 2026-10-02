-- FLH-FEAT-2026-012 / SPEC_VERSION 1.1 / Production activation maintenance.
-- Keep YouTube provider status metadata within the documented 29-day retention window.
-- pg_cron schedules in UTC by default; 01:17 UTC avoids existing top-of-hour jobs.

create extension if not exists pg_cron;

select cron.schedule(
  'flh_optional_learning_video_daily_prune',
  '17 1 * * *',
  $$select public.flh_learning_video_prune_status(id) from public.workspaces;$$
);
