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

## Migration-ledger reconciliation

The Git ledger now carries the immutable union of the 49 migrations that were already in this repository and 26 historical identities that previously existed only in the Production migration ledger. The 26 added files are intentionally inert mirrors: their timestamp and historical name preserve provenance, while their only executable statement is SQL SELECT 1.

Supabase compares migration history by version/timestamp. The mirror filenames retain historical Production names for auditability, but names are not the synchronization key. The machine-readable classifications, Git equivalences, final-state owners, canonical migration checksum, and future repair allowlist live in migration-ledger-reconciliation.json.

Historical Production SQL must never be copied into or substituted for a mirror. Some historical statements were temporary or later superseded, some performed one-time Production data backfills, and some describe final-state drift that must be reconciled with a new forward-only migration. Replaying those statements would make fresh databases depend on Production history and could duplicate or reverse later canonical behavior.

The following 11 Git versions remain intentionally absent from the Production ledger until a separate, explicitly approved Production operation records them as applied without executing their SQL:

- 20260824090800
- 20260824124700
- 20260903140500
- 20260905112742
- 20260905143000
- 20260905153100
- 20260909055000
- 20260910023450
- 20260910023500
- 20260910023600
- 20260910080000

They are not repaired by this PR because migration repair with applied status is a Production write. Before that later operation, the 64-row Production ledger and schema/data fingerprints must be reverified, the exact 11-version allowlist must be reviewed, and the result must be read back explicitly. This PR neither repairs Production history nor deploys or runs a Production migration.

The known learner-content-assignment hardening, Exam save/submit RPC, paper-model uniqueness, and SBAIK ownership questions remain outside this ledger-only change. Where missing final state is confirmed, it must be introduced later under one new shared timestamp through a forward-only migration. Every future migration must use the same new timestamp in Git and Production from inception; do not create timestamp aliases and do not rewrite established migration files.

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
