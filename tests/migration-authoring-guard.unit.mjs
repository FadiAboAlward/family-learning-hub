import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const migrationDirectory = path.join('supabase', 'migrations');
const baseline = '20260925225500_harden_authenticated_authorization_and_session_privacy.sql';
const forbiddenWorkspaceId = /55f9224c-8ba7-4cbc-9f88-713e6a6b41df/i;

const files = fs
  .readdirSync(migrationDirectory)
  .filter((file) => file.endsWith('.sql') && file > baseline)
  .sort();

assert.ok(
  files.includes('20260926202000_normalize_learner_independent_catalog.sql'),
  'catalog normalization migration must stay inside the guarded future-migration set',
);

for (const file of files) {
  const sql = fs.readFileSync(path.join(migrationDirectory, file), 'utf8');

  assert.doesNotMatch(
    sql,
    forbiddenWorkspaceId,
    `${file}: future migrations must resolve the Family Learning workspace by slug, not literal UUID`,
  );

  for (const match of sql.matchAll(/update\s+public\.quizzes\b[\s\S]*?;/gi)) {
    const statement = match[0];
    if (/curriculum_id\s+is\s+null/i.test(statement)) {
      assert.match(
        statement,
        /\bworkspace_id\b/i,
        `${file}: null-curriculum quiz backfills must be workspace-scoped`,
      );
      assert.match(
        statement,
        /\b(?:slug|code|id)\b/i,
        `${file}: null-curriculum quiz backfills must use an explicit catalog identifier`,
      );
    }
  }

  for (const match of sql.matchAll(/from\s+pg_constraint[\s\S]{0,800}?(?:then|;)/gi)) {
    const guard = match[0];
    if (/\bconname\b/i.test(guard)) {
      assert.match(
        guard,
        /\bconrelid\b/i,
        `${file}: pg_constraint guards using conname must also qualify the target relation with conrelid`,
      );
    }
  }
}

console.log('future migration authoring guards passed.');
