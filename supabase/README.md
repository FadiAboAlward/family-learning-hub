# Supabase source control

This directory is the repository source for Family Learning Hub database and Edge Function changes.

## Migration provenance

The platform's first 28 migrations were created in the hosted Supabase project before this repository contained a `supabase/migrations` directory. Their verified pre-architecture state is now squashed into:

- `20260823213000_pre_program_architecture_baseline.sql`

The baseline preserves each original hosted migration version/name as a source marker, contains no real learner identities or learner progress, and stops immediately before `20260823213038_family_learning_hub_program_architecture.sql`.

Repository migration tracking starts with the architecture hardening work on 2026-08-23:

- `20260823213038_family_learning_hub_program_architecture.sql`
- `20260823213136_quiz_content_context_integrity.sql`
- `20260823213507_learner_auth_and_catalog_hardening.sql`
- `20260823214151_upgrade_learner_pin_hash_on_login.sql`

Those filenames match the hosted Supabase migration ledger.

Existing production migration history has not been changed or reconciled by the baseline work. Do not push the new historical baseline to Production until the separate production-ledger reconciliation is reviewed. From this point forward **every schema change must be both applied as a Supabase migration and committed here with the same migration identity**.

## Fresh reconstruction

The local database is intentionally seedless except for static catalog/configuration rows embedded in migrations. To prove Git can reconstruct the database from zero:

```sh
npx --yes supabase@2.117.0 db start
npx --yes supabase@2.117.0 db reset --local --no-seed
npx --yes supabase@2.117.0 db query --local --file tests/fresh-database-rebuild.sql
npx --yes supabase@2.117.0 db lint --local --schema public,private --level error --fail-on error
npx --yes supabase@2.117.0 stop --no-backup
```

The required `Static quality` QA job runs this same zero-state replay for every pull request. It never links to or modifies a hosted Supabase project.

## Edge Functions

Production Edge Functions should have matching source under `supabase/functions/<function-name>/index.ts`. The deployed function remains the runtime authority; the repository is the change-review and recovery authority.

## Safety rules

- Prefer additive/backward-compatible migrations.
- Do not edit historical applied migrations after they are established as repository history.
- Use a new migration for later corrections.
- Keep answer keys and server grading out of public/browser payloads.
- Service-only security tables/functions must not grant access to `anon` or ordinary `authenticated` clients.
- Test/sandbox data must be excluded from real learner metrics at the backend boundary, not only hidden in the UI.
