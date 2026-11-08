import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildCanonicalTransaction} from '../scripts/flh044-production-management-release.mjs';
import {migrationDigest} from '../scripts/flh044-production-migration-stage.mjs';

// Runs only against the disposable GitHub Actions local Supabase database.
assert.equal(process.env.FLH_QA_DNS_DENY_EXPECTED, '1', 'Production network deny must be active');
const synthetic = Array.from({length: 132}, (_, i) => ({
  version: String(20260801000000 + i),
  name: 'synthetic_' + String(i).padStart(3, '0'),
}));
const baseline = JSON.parse(fs.readFileSync(new URL('../docs/release/flh044-production-ledger-baseline.json', import.meta.url), 'utf8'));
const bytes = fs.readFileSync(new URL('../supabase/migrations/20261105134103_visual_foundation_bridge_v1.sql', import.meta.url));
const manifest = {...baseline, observedAppliedCount: 132, observedAppliedSha256: migrationDigest(synthetic)};
const name = 'flh044_ci';
const full = buildCanonicalTransaction(manifest, bytes);
const guard = full.slice(0, full.indexOf(bytes.toString('utf8'))).replaceAll('supabase_migrations.schema_migrations', name + '.schema_migrations');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flh044-sql-'));
function query(label, sql, shouldPass) {
  const filename = path.join(tmp, label + '.sql');
  fs.writeFileSync(filename, sql);
  const result = spawnSync('npx', ['--yes', 'supabase@2.117.0', 'db', 'query', '--local', '--file', filename], {
    encoding: 'utf8', timeout: 45000, maxBuffer: 2 * 1024 * 1024,
  });
  assert.ok(!result.error, 'Could not invoke local Supabase CLI');
  if (shouldPass) {
    assert.equal(result.status, 0, label + ' failed against isolated PostgreSQL: ' + ((result.stderr || '') + '\n' + (result.stdout || '')).slice(0, 900));
  } else {
    assert.notEqual(result.status, 0, label + ' unexpectedly passed despite ledger drift');
    assert.match((result.stderr || '') + (result.stdout || ''), /FLH044_PRODUCTION_MIGRATION_DIGEST_DRIFT/);
  }
}
try {
  query('setup', [
    'CREATE SCHEMA IF NOT EXISTS ' + name + ';',
    'DROP TABLE IF EXISTS ' + name + '.schema_migrations;',
    'CREATE TABLE ' + name + '.schema_migrations (version text primary key, name text);',
    "INSERT INTO " + name + ".schema_migrations (version,name) SELECT (20260801000000 + n)::text, 'synthetic_' || lpad(n::text, 3, '0') FROM generate_series(0,131) n;",
  ].join('\n'), true);
  query('valid', guard + '\nROLLBACK;', true);
  // This mutation is isolated within a transaction and is rolled back by the failed SQL request.
  query('drift', "BEGIN;\nUPDATE " + name + ".schema_migrations SET name='tampered' WHERE version='20260801000000';\n" +
    guard.replace(/^BEGIN;/, '') + '\nROLLBACK;', false);
  console.log('PASS: real local PostgreSQL accepts the canonical digest guard, and rejects changed ledger rows.');
} finally {
  try { query('cleanup', 'DROP SCHEMA IF EXISTS ' + name + ' CASCADE;', true); }
  finally { fs.rmSync(tmp, {recursive: true, force: true}); }
}
