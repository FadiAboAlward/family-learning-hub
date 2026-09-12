-- Historical Production migration mirror.
-- Identity: 20260910081009_backfill_existing_paper_attempt_runtime_hash
-- Classification: Production-only data/backfill migration.
-- Equivalent Git identity: none; this was a one-time backfill of existing Production rows.
-- Final state: historical application data must not be fabricated or replayed on a fresh database.
-- This file records Production migration identity only. Historical Production SQL must not be replayed.
select 1;
