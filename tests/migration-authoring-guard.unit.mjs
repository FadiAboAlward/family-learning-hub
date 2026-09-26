import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const migrationDirectory = path.join('supabase', 'migrations');
const baseline = '20260925225500_harden_authenticated_authorization_and_session_privacy.sql';
const forbiddenWorkspaceId = /55f9224c-8ba7-4cbc-9f88-713e6a6b41df/i;

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ');
}

function assertSafeFutureMigration(sql, label) {
  const clean = stripSqlComments(sql);

  assert.doesNotMatch(
    clean,
    forbiddenWorkspaceId,
    `${label}: future migrations must resolve the Family Learning workspace by slug, not literal UUID`,
  );

  for (const match of clean.matchAll(/update\s+public\.quizzes\b[\s\S]*?;/gi)) {
    const statement = match[0];
    if (!/curriculum_id\s+is\s+null/i.test(statement)) continue;

    const whereMatch = statement.match(/\bwhere\b([\s\S]*);\s*$/i);
    assert.ok(
      whereMatch,
      `${label}: null-curriculum quiz backfills must have an explicit WHERE predicate`,
    );

    const predicate = whereMatch[1];
    assert.match(
      predicate,
      /(?:^|[\s(])(?:[a-z_][a-z0-9_]*\.)?workspace_id\s*(?:=|\bin\s*\()/i,
      `${label}: null-curriculum quiz backfills must scope workspace_id in the WHERE predicate`,
    );
    assert.match(
      predicate,
      /(?:^|[\s(])(?:[a-z_][a-z0-9_]*\.)?(?:slug|code|id)\s*(?:=|\bin\s*\()/i,
      `${label}: null-curriculum quiz backfills must use an explicit catalog identifier in the WHERE predicate`,
    );
  }

  for (const match of clean.matchAll(/from\s+pg_constraint\b[\s\S]{0,1600}?(?:\)\s*then|\bthen\b|;)/gi)) {
    const lookup = match[0];
    if (!/\bconname\b/i.test(lookup)) continue;

    const whereMatch = lookup.match(/\bwhere\b([\s\S]*?)(?:\)\s*then|\bthen\b|;)\s*$/i);
    assert.ok(
      whereMatch,
      `${label}: pg_constraint conname guards must use a WHERE predicate`,
    );

    const predicate = whereMatch[1];
    assert.match(
      predicate,
      /\bconrelid\s*=\s*(?:'[^']+'\s*::\s*regclass|to_regclass\s*\()/i,
      `${label}: pg_constraint conname guards must qualify the target relation with conrelid in the lookup predicate`,
    );
  }
}

assert.throws(
  () => assertSafeFutureMigration(
    "update public.quizzes set workspace_id=v_workspace where curriculum_id is null and slug='x';",
    'negative-unscoped-workspace',
  ),
  /workspace_id in the WHERE predicate/,
);

assert.throws(
  () => assertSafeFutureMigration(
    "update public.quizzes set curriculum_id=v_curriculum where curriculum_id is null and workspace_id=v_workspace;",
    'negative-missing-catalog-id',
  ),
  /explicit catalog identifier in the WHERE predicate/,
);

assert.throws(
  () => assertSafeFutureMigration(
    "if not exists (select 1 from pg_constraint where conname='x' and 1=1 /* conrelid = target */) then null; end if;",
    'negative-unqualified-constraint',
  ),
  /qualify the target relation with conrelid/,
);

assert.throws(
  () => assertSafeFutureMigration(
    "if not exists (select 1 from pg_constraint where conname='x' and conrelid is not null) then null; end if;",
    'negative-nontarget-conrelid',
  ),
  /qualify the target relation with conrelid/,
);

assert.doesNotThrow(
  () => assertSafeFutureMigration(
    "update public.quizzes set curriculum_id=v_curriculum where curriculum_id is null and workspace_id=v_workspace and slug='x'; if not exists (select 1 from pg_constraint where conname='x' and conrelid='public.quizzes'::regclass) then null; end if;",
    'positive-guard-fixture',
  ),
);

const files = fs
  .readdirSync(migrationDirectory)
  .filter((file) => file.endsWith('.sql') && file > baseline)
  .sort();

assert.ok(
  files.includes('20260926202000_normalize_learner_independent_catalog.sql'),
  'catalog normalization migration must stay inside the guarded future-migration set',
);

for (const file of files) {
  assertSafeFutureMigration(
    fs.readFileSync(path.join(migrationDirectory, file), 'utf8'),
    file,
  );
}

console.log('future migration authoring guards passed.');
