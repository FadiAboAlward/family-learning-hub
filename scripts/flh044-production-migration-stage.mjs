import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const PROJECT_REF = 'gkpoylfozvuwuwqeoduc';
const CANONICAL_VERSION = '20261105134103';
const CANONICAL_NAME = 'visual_foundation_bridge_v1';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Compute a non-reversible, stable digest of version/name identities without logging them. */
export function migrationDigest(rows) {
  const payload = rows.map(({version, name}) => version + '\t' + name + '\n').join('');
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

/** Fail closed on unexpected ledger drift or misidentified Production migration. */
export function validateProductionLedger(baseline, remote, {after = false} = {}) {
  assert.equal(baseline.projectRef, PROJECT_REF, 'Wrong Production project');
  assert.equal(baseline.canonicalVersion, CANONICAL_VERSION, 'Wrong canonical migration');
  assert.equal(baseline.schemaVersion, 2, 'Expected anonymized baseline');
  assert.ok(Array.isArray(remote), 'Expected Supabase migration history array');
  const sorted = remote.map(({version, name}) => ({version, name})).sort((a, b) => a.version.localeCompare(b.version));
  assert.equal(new Set(sorted.map(x => x.version)).size, sorted.length, 'Duplicate remote version');
  for (const {version, name} of sorted) {
    assert.match(version, /^\d{14}$/, 'Unexpected migration version');
    assert.match(name, /^[a-zA-Z0-9_]+$/, 'Unexpected migration name');
  }
  if (after) {
    assert.equal(sorted.length, baseline.observedAppliedCount + 1, 'Post-release row count drift');
    const last = sorted.pop();
    assert.deepEqual(last, {version: CANONICAL_VERSION, name: CANONICAL_NAME}, 'Wrong canonical migration recorded');
  } else {
    assert.equal(sorted.length, baseline.observedAppliedCount, 'Pre-release row count drift');
  }
  assert.equal(sorted.at(-1)?.version, baseline.observedLatestVersion, 'Baseline latest version drift');
  assert.equal(migrationDigest(sorted), baseline.observedAppliedSha256, 'Production migration history drift; abort');
  return sorted;
}

/** Stage a one-off CLI migration set containing inert applied mirrors and one pinned canonical SQL. */
export function stageOnlyCanonical(baseline, alreadyApplied, {root = ROOT, temp = os.tmpdir()} = {}) {
  assert.equal(validateProductionLedger(baseline, alreadyApplied).length, baseline.observedAppliedCount);
  const source = path.join(root, baseline.canonicalSource);
  assert.equal(path.basename(source), CANONICAL_VERSION + '_' + CANONICAL_NAME + '.sql', 'Canonical filename drift');
  const contents = fs.readFileSync(source);
  assert.equal(createHash('sha256').update(contents).digest('hex'), baseline.canonicalSha256, 'Approved canonical SQL bytes drift');
  const stage = fs.mkdtempSync(path.join(temp, 'flh044-prod-'));
  const directory = path.join(stage, 'supabase', 'migrations');
  fs.mkdirSync(directory, {recursive: true});
  fs.copyFileSync(path.join(root, 'supabase', 'config.toml'), path.join(stage, 'supabase', 'config.toml'));
  for (const {version, name} of alreadyApplied) {
    // Transient inert files shadow Production history, and are never applied.
    fs.writeFileSync(path.join(directory, version + '_' + name + '.sql'), 'select 1;\n');
  }
  fs.copyFileSync(source, path.join(directory, path.basename(source)));
  assert.equal(fs.readdirSync(directory).length, baseline.observedAppliedCount + 1, 'Unexpected staged SQL');
  return stage;
}

/** Read Production migration history by supported PAT-authenticated SQL query, never partner-only migration GET. */
export async function readProductionLedgerWithPAT(token) {
  assert.ok(token, 'Missing encrypted Production PAT');
  const response = await fetch('https://api.supabase.com/v1/projects/' + PROJECT_REF + '/database/query', {
    method: 'POST',
    headers: {Authorization: 'Bearer ' + token, Accept: 'application/json', 'Content-Type': 'application/json'},
    body: JSON.stringify({query: 'SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version', read_only: true}),
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 201, 'Production PAT lacks read-only database query permission, HTTP ' + response.status);
  const result = await response.json();
  assert.ok(Array.isArray(result), 'Unexpected Production migration query response');
  assert.ok(result.every(row => typeof row.version === 'string' && typeof row.name === 'string'), 'Unexpected Production migration row shape');
  return result;
}

/** Authenticate to the Production Management API only and prepare a verifiable release workspace. */
async function main() {
  const mode = process.argv[2];
  assert.ok(['stage', 'verify-applied'].includes(mode), 'Expected stage or verify-applied');
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  assert.ok(token, 'Missing encrypted Production token');
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/release/flh044-production-ledger-baseline.json'), 'utf8'));
  const remote = await readProductionLedgerWithPAT(token);
  const validated = validateProductionLedger(baseline, remote, {after: mode === 'verify-applied'});
  if (mode === 'stage') {
    const stage = stageOnlyCanonical(baseline, validated);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'stage_dir=' + stage + '\n');
    console.log('PASS: 132 applied Production migration identities match pinned digest; one canonical pending.');
  } else {
    console.log('PASS: canonical 20261105134103 applied; no extra migration identities.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error('FLH044 Production migration guard failed: ' + error.message);
    process.exitCode = 1;
  });
}
