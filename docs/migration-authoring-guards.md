# Migration authoring guards

For migrations authored after `20260925225500_harden_authenticated_authorization_and_session_privacy.sql`:

- Resolve the Family Learning workspace by the stable slug `family-learning-hub`; do not embed the Production workspace UUID in new migrations.
- Any backfill of `public.quizzes` based on a null curriculum must be scoped by `workspace_id` and an explicit stable catalog identifier such as `slug`, `code`, or `id`.
- Any `pg_constraint` existence check that uses `conname` must also qualify the target table through `conrelid`.

These guards apply only to newly authored migrations. Historical applied migrations stay immutable so fresh-database replay and the hosted migration ledger remain reproducible.
