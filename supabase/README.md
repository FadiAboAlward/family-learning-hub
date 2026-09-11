# Supabase source control

This directory is the repository source for Family Learning Hub database and Edge Function changes.

## Migration provenance

The platform's first 28 migrations were created in the hosted Supabase project before this repository contained a `supabase/migrations` directory. Their verified pre-architecture state is restored as 28 separate files in `supabase/migrations`, using the same version numbers and names already recorded in the Production migration ledger. They begin with `20260823110617_001_core_learning_schema.sql`, end with `20260823150830_exam_mode_defaults_setting.sql`, contain no real learner rows or learner progress, and stop immediately before `20260823213038_family_learning_hub_program_architecture.sql`.

The removed squashed baseline `20260823213000_pre_program_architecture_baseline.sql` and redundant bootstrap `20260823212000_enable_pgcrypto.sql` are intentionally absent because neither version exists in the Production ledger. The historical `20260823110617_001_core_learning_schema.sql` migration already creates `pgcrypto` in the `extensions` schema.

Repository migration tracking starts with the architecture hardening work on 2026-08-23:

- `20260823213038_family_learning_hub_program_architecture.sql`
- `20260823213136_quiz_content_context_integrity.sql`
- `20260823213507_learner_auth_and_catalog_hardening.sql`
- `20260823214151_upgrade_learner_pin_hash_on_login.sql`

Those filenames match the hosted Supabase migration ledger.

Production migration history has not been changed or repaired by this work. The restored 28 migration identities already match the corresponding Production ledger entries; any later Production-versus-repository migration drift remains explicitly out of scope for issue #37 and requires separate review. From this point forward **every schema change must be both applied as a Supabase migration and committed here with the same migration identity**.

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
