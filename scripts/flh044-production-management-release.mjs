import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateProductionLedger, readProductionLedgerWithPAT} from './flh044-production-migration-stage.mjs';

const REF = 'gkpoylfozvuwuwqeoduc';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.supabase.com/v1/projects/' + REF;
const TAG = '$flh044_source_verified$';

/** Validate baseline metadata and build the exact PostgreSQL guard independently of any mutations. */
export function buildLedgerGuard(manifest) {
  assert.equal(manifest.observedAppliedCount, 132);
  assert.match(manifest.observedAppliedSha256, /^[a-f0-9]{64}$/);
  const guard = [
    'BEGIN;',
    'SELECT pg_advisory_xact_lock(440442026);',
    'DO $flh044_guard
export function buildCanonicalTransaction(manifest, bytes) {
  assert.equal(manifest.projectRef, REF, 'Wrong Production ref');
  assert.equal(manifest.canonicalVersion, '20261105134103', 'Wrong canonical version');
  assert.equal(manifest.canonicalSource, 'supabase/migrations/20261105134103_visual_foundation_bridge_v1.sql', 'Wrong source path');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.canonicalSha256, 'Approved migration SQL hash drift');
  const sql = bytes.toString('utf8');
  assert.ok(!sql.includes(TAG), 'Reserved SQL delimiter in source');
  assert.ok(!/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im.test(sql), 'Migration must not control its own transaction');
  assert.equal(manifest.observedAppliedCount, 132);
  assert.match(manifest.observedAppliedSha256, /^[a-f0-9]{64}$/);
  const guard = buildLedgerGuard(manifest);
  // Persist the verified migration source as an ordinary, immutable ledger statement.
  const stamp = "INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20261105134103', 'visual_foundation_bridge_v1', ARRAY[" + TAG + sql + TAG + "]::text[]);";
  return guard + '\n' + sql + '\n' + stamp + '\nCOMMIT;\n';
}

/** Execute read and write calls through official Production-scoped Management API. */
async function api(token, suffix, {method = 'GET', body} = {}) {
  const response = await fetch(API + suffix, {
    method,
    headers: {Authorization: 'Bearer ' + token, Accept: 'application/json', ...(body ? {'Content-Type': 'application/json'} : {})},
    ...(body ? {body: JSON.stringify(body)} : {}),
    signal: AbortSignal.timeout(method === 'POST' ? 150000 : 30000),
  });
  assert.equal(response.status, method === 'POST' ? 201 : 200, 'Management API failed, HTTP ' + response.status);
  return null;
}

/** Use PAT only; never reset, reveal or request the legacy Production database password. */
async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  assert.ok(token, 'Missing Production PAT');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/release/flh044-production-ledger-baseline.json'), 'utf8'));
  validateProductionLedger(manifest, await readProductionLedgerWithPAT(token));
  const sql = buildCanonicalTransaction(manifest, fs.readFileSync(path.join(ROOT, manifest.canonicalSource)));
  // Do NOT retry an ambiguous POST. The explicit BEGIN/COMMIT and version stamp
  // are one operation; post-readback distinguishes success from unknown outcome.
  let ambiguousError;
  try {
    await api(token, '/database/query', {method: 'POST', body: {query: sql, read_only: false}});
  } catch (error) {
    // The database may have committed before a network timeout. Never resubmit the SQL.
    ambiguousError = error;
  }
  try {
    validateProductionLedger(manifest, await readProductionLedgerWithPAT(token), {after: true});
  } catch (readbackError) {
    throw new Error(ambiguousError
      ? 'Migration outcome unverified after an ambiguous POST; stop before Edge deployment, do not retry.'
      : 'Migration reported success but exact ledger readback failed; stop before Edge deployment.');
  }
  console.log(ambiguousError
    ? 'PASS: ambiguous response reconciled using exact applied ledger readback; no SQL retry.'
    : 'PASS: exact canonical migration applied with PAT, history preserved; no database password used.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error('FLH044 PAT-only Production migration stopped: ' + error.message);
    console.error('On ambiguous timeout, read the migration ledger before any recovery; never automatically retry.');
    process.exitCode = 1;
  });
}
,
    'BEGIN',
    ' IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 132 THEN',
    "   RAISE EXCEPTION 'FLH044_PRODUCTION_MIGRATION_COUNT_DRIFT';",
    ' END IF;',
    " IF (SELECT encode(extensions.digest(convert_to(coalesce(string_agg(version || E'\\t' || name || E'\\n', '' ORDER BY version), ''), 'UTF8'),'sha256'),'hex') FROM supabase_migrations.schema_migrations) <> '" + manifest.observedAppliedSha256 + "' THEN",
    "   RAISE EXCEPTION 'FLH044_PRODUCTION_MIGRATION_DIGEST_DRIFT';",
    ' END IF;',
    " IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261105134103') THEN",
    "   RAISE EXCEPTION 'FLH044_CANONICAL_VERSION_ALREADY_APPLIED';",
    ' END IF;',
    'END',
    '$flh044_guard$;',
  ].join('\n');
  return guard;
}

/** Construct one atomic transaction containing exactly the approved migration. */
export function buildCanonicalTransaction(manifest, bytes) {
  assert.equal(manifest.projectRef, REF, 'Wrong Production ref');
  assert.equal(manifest.canonicalVersion, '20261105134103', 'Wrong canonical version');
  assert.equal(manifest.canonicalSource, 'supabase/migrations/20261105134103_visual_foundation_bridge_v1.sql', 'Wrong source path');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.canonicalSha256, 'Approved migration SQL hash drift');
  const sql = bytes.toString('utf8');
  assert.ok(!sql.includes(TAG), 'Reserved SQL delimiter in source');
  assert.ok(!/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im.test(sql), 'Migration must not control its own transaction');
  assert.equal(manifest.observedAppliedCount, 132);
  assert.match(manifest.observedAppliedSha256, /^[a-f0-9]{64}$/);
  const guard = buildLedgerGuard(manifest);
  // Persist the verified migration source as an ordinary, immutable ledger statement.
  const stamp = "INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20261105134103', 'visual_foundation_bridge_v1', ARRAY[" + TAG + sql + TAG + "]::text[]);";
  return guard + '\n' + sql + '\n' + stamp + '\nCOMMIT;\n';
}

/** Execute read and write calls through official Production-scoped Management API. */
async function api(token, suffix, {method = 'GET', body} = {}) {
  const response = await fetch(API + suffix, {
    method,
    headers: {Authorization: 'Bearer ' + token, Accept: 'application/json', ...(body ? {'Content-Type': 'application/json'} : {})},
    ...(body ? {body: JSON.stringify(body)} : {}),
    signal: AbortSignal.timeout(method === 'POST' ? 150000 : 30000),
  });
  assert.equal(response.status, method === 'POST' ? 201 : 200, 'Management API failed, HTTP ' + response.status);
  return null;
}

/** Use PAT only; never reset, reveal or request the legacy Production database password. */
async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  assert.ok(token, 'Missing Production PAT');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/release/flh044-production-ledger-baseline.json'), 'utf8'));
  validateProductionLedger(manifest, await readProductionLedgerWithPAT(token));
  const sql = buildCanonicalTransaction(manifest, fs.readFileSync(path.join(ROOT, manifest.canonicalSource)));
  // Do NOT retry an ambiguous POST. The explicit BEGIN/COMMIT and version stamp
  // are one operation; post-readback distinguishes success from unknown outcome.
  await api(token, '/database/query', {method: 'POST', body: {query: sql, read_only: false}});
  validateProductionLedger(manifest, await readProductionLedgerWithPAT(token), {after: true});
  console.log('PASS: exact canonical migration applied with PAT, history preserved; no database password used.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error('FLH044 PAT-only Production migration stopped: ' + error.message);
    console.error('On ambiguous timeout, read the migration ledger before any recovery; never automatically retry.');
    process.exitCode = 1;
  });
}
