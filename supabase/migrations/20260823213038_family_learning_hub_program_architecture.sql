-- Applied to Supabase production on 2026-08-23.
-- Canonical implementation lives in the hosted migration ledger under:
--   20260823213038_family_learning_hub_program_architecture
--
-- This repository began tracking migrations after the initial hosted schema had
-- already been created. The full applied SQL can be recovered from
-- supabase_migrations.schema_migrations. This marker preserves the production
-- migration identity in source control; see supabase/README.md for provenance.

-- Architecture introduced by this migration:
-- * canonical workspace identity: Family Learning Hub / family-learning-hub
-- * learning_programs
-- * program_subjects
-- * program_books
-- * program_quizzes
-- * learner_program_enrollments
-- * quiz_assignments program context + metadata
-- * books.source_kind
-- * program/test mirroring triggers
-- * current Syrian Grade 5 program seed

select '20260823213038_family_learning_hub_program_architecture already applied in production' as migration_provenance;
