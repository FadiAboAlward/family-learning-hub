# Supabase source control

This directory is the repository source for Family Learning Hub database and Edge Function changes.

## Migration provenance

The platform's first 28 migrations were created in the hosted Supabase project before this repository contained a `supabase/migrations` directory. They remain recorded in `supabase_migrations.schema_migrations` in production.

Repository migration tracking starts with the architecture hardening work on 2026-08-23:

- `20260823213038_family_learning_hub_program_architecture.sql`
- `20260823213136_quiz_content_context_integrity.sql`
- `20260823213507_learner_auth_and_catalog_hardening.sql`
- `20260823214151_upgrade_learner_pin_hash_on_login.sql`

Those filenames match the hosted Supabase migration ledger.

The earlier hosted-only migration gap is historical technical debt; it must not be repeated. From this point forward **every schema change must be both applied as a Supabase migration and committed here with the same migration identity**.

## Edge Functions

Production Edge Functions should have matching source under `supabase/functions/<function-name>/index.ts`. The deployed function remains the runtime authority; the repository is the change-review and recovery authority.

## Safety rules

- Prefer additive/backward-compatible migrations.
- Do not edit historical applied migrations after they are established as repository history.
- Use a new migration for later corrections.
- Keep answer keys and server grading out of public/browser payloads.
- Service-only security tables/functions must not grant access to `anon` or ordinary `authenticated` clients.
- Test/sandbox data must be excluded from real learner metrics at the backend boundary, not only hidden in the UI.
