import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const PROJECT_REF = 'gkpoylfozvuwuwqeoduc';
const CANONICAL_VERSION = '20261105134103';
const CANONICAL_NAME = 'visual_foundation_bridge_v1';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function validateProductionLedger(baseline, remote, {after = false} = {}) {
  assert.equal(baseline.projectRef, PROJECT_REF, 'Wrong Production project');
  assert.equal(baseline.canonicalVersion, CANONICAL_VERSION, 'Wrong canonical migration');
  assert.ok(Array.isArray(baseline.applied) && baseline.applied.length === 132, 'Baseline ledger count');
  assert.ok(Array.isArray(remote), 'Expected Supabase migration history array');
  const normalized = remote.map(({version, name}) => ({version, name}));
  const expected = after
    ? [...baseline.applied, {version: CANONICAL_VERSION, name: CANONICAL_NAME}]
    : baseline.applied;
  assert.deepEqual(normalized, expected, 'Production migration history drift; abort before writes');
  assert.equal(new Set(normalized.map(x => x.version)).size, normalized.length, 'Duplicate remote version');
  for (const {version, name} of normalized) {
    assert.match(version, /^\d{14}$/, 'Unexpected migration version');
    assert.match(name, /^[a-zA-Z0-9_]+$/, 'Unexpected migration name');
  }
  return normalized;
}

export function stageOnlyCanonical(baseline, {root = ROOT, temp = os.tmpdir()} = {}) {
  const stage = fs.mkdtempSync(path.join(temp, 'flh044-prod-'));
  const directory = path.join(stage, 'supabase', 'migrations');
  fs.mkdirSync(directory, {recursive: true});
  fs.copyFileSync(path.join(root, 'supabase', 'config.toml'), path.join(stage, 'supabase', 'config.toml'));
  for (const {version, name} of baseline.applied) {
    // Already-applied Production versions are temporary inert local mirrors.
    // They are NEVER recorded or executed as new migrations.
    fs.writeFileSync(path.join(directory, version + '_' + name + '.sql'), 'select 1;\n');
  }
  const canonical = path.join(root, baseline.canonicalSource);
  assert.equal(path.basename(canonical), CANONICAL_VERSION + '_' + CANONICAL_NAME + '.sql', 'Canonical filename drift');
  fs.copyFileSync(canonical, path.join(directory, path.basename(canonical)));
  assert.equal(fs.readdirSync(directory).length, baseline.applied.length + 1, 'Unexpected staged migration');
  return stage;
}

async function main() {
  const mode = process.argv[2];
  assert.ok(['stage', 'verify-applied'].includes(mode), 'Expected stage or verify-applied');
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  assert.ok(token && token.trim(), 'Missing encrypted Production token');
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/release/flh044-production-ledger-baseline.json'), 'utf8'));
  const response = await fetch('https://api.supabase.com/v1/projects/' + PROJECT_REF + '/database/migrations', {
    headers: {Authorization: 'Bearer ' + token, Accept: 'application/json'},
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 200, 'Production PAT lacks migration-read access');
  const remote = await response.json();
  validateProductionLedger(baseline, remote, {after: mode === 'verify-applied'});
  if (mode === 'stage') {
    const stage = stageOnlyCanonical(baseline);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'stage_dir=' + stage + '\n');
    console.log('PASS: exact Production migration baseline, 132 previously applied, one canonical pending.');
  } else {
    console.log('PASS: canonical 20261105134103 applied; no extra migration history.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error('FLH044 release history gate failed: ' + error.message);
    process.exitCode = 1;
  });
}
