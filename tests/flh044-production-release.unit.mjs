import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {migrationDigest, validateProductionLedger, stageOnlyCanonical} from '../scripts/flh044-production-migration-stage.mjs';
import {verifyDeployedFunctions} from '../scripts/flh044-production-edge-verify.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/release/flh044-production-ledger-baseline.json'), 'utf8'));
assert.equal(baseline.schemaVersion, 2);
assert.equal(baseline.observedAppliedCount, 132);
assert.equal(baseline.observedAppliedSha256.length, 64);
assert.ok(!JSON.stringify(baseline).includes('register_'), 'Do not track Production learner-specific migration names');

const canonicalFile = path.join(ROOT, baseline.canonicalSource);
assert.equal(createHash('sha256').update(fs.readFileSync(canonicalFile)).digest('hex'), baseline.canonicalSha256, 'Approved source SQL hash differs from pinned spec');
const synthetic = Array.from({length: 132}, (_, i) => ({
  version: String(20260801000000 + i),
  name: 'synthetic_' + String(i).padStart(3, '0'),
}));
const fake = {...baseline, observedLatestVersion: synthetic.at(-1).version, observedAppliedSha256: migrationDigest(synthetic)};
assert.equal(validateProductionLedger(fake, structuredClone(synthetic)).length, 132);
assert.throws(() => validateProductionLedger(fake, synthetic.slice(1)), /count drift/);
assert.throws(() => validateProductionLedger(fake, [...synthetic, {version: '20261031205107', name: 'unknown'}]), /count drift/);
assert.throws(() => validateProductionLedger(fake, [...synthetic.slice(0, -1), {...synthetic.at(-1), name: 'changed'}]), /history drift/);
assert.throws(() => validateProductionLedger(fake, [...synthetic, {version: '20261105134103', name: 'visual_foundation_bridge_v1'}]), /count drift/);
assert.equal(validateProductionLedger(fake, [...synthetic, {version: '20261105134103', name: 'visual_foundation_bridge_v1'}], {after: true}).length, 132);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'flh044-unit-'));
try {
  const stage = stageOnlyCanonical(fake, synthetic, {root: ROOT, temp});
  const entries = fs.readdirSync(path.join(stage, 'supabase', 'migrations'));
  assert.equal(entries.length, 133);
  assert.ok(entries.includes('20261105134103_visual_foundation_bridge_v1.sql'));
  assert.equal(fs.readFileSync(path.join(stage, 'supabase', 'migrations', synthetic[0].version + '_' + synthetic[0].name + '.sql'), 'utf8'), 'select 1;\n');
  assert.deepEqual(fs.readFileSync(path.join(stage, 'supabase', 'migrations', '20261105134103_visual_foundation_bridge_v1.sql')), fs.readFileSync(canonicalFile));
  const tampered = path.join(temp, 'tampered');
  fs.mkdirSync(path.join(tampered, 'supabase', 'migrations'), {recursive: true});
  fs.copyFileSync(path.join(ROOT, 'supabase', 'config.toml'), path.join(tampered, 'supabase', 'config.toml'));
  fs.writeFileSync(path.join(tampered, baseline.canonicalSource), fs.readFileSync(canonicalFile, 'utf8') + '\n-- unauthorized SQL edit\n');
  assert.throws(() => stageOnlyCanonical(fake, synthetic, {root: tampered, temp}), /canonical SQL bytes drift/);
} finally {
  fs.rmSync(temp, {recursive: true, force: true});
}

const versions = [
  {slug: 'assessment-mcp', status: 'ACTIVE', verify_jwt: false, version: 8},
  {slug: 'learning-api', status: 'ACTIVE', verify_jwt: false, version: 24},
  {slug: 'exam-v2-api', status: 'ACTIVE', verify_jwt: false, version: 14},
  {slug: 'attempt-history-api', status: 'ACTIVE', verify_jwt: false, version: 8},
  {slug: 'family-api', status: 'ACTIVE', verify_jwt: false, version: 19},
  {slug: 'student-library-api', status: 'ACTIVE', verify_jwt: false, version: 10},
];
assert.equal(verifyDeployedFunctions(versions).length, 6);
assert.throws(() => verifyDeployedFunctions(versions.slice(1)), /Missing/);
assert.throws(() => verifyDeployedFunctions(versions.map(f => f.slug === 'assessment-mcp' ? {...f, verify_jwt: true} : f)), /JWT gateway/);
assert.throws(() => verifyDeployedFunctions(versions.map(f => f.slug === 'family-api' ? {...f, version: 18} : f)), /not redeployed/);
assert.throws(() => verifyDeployedFunctions(versions.map(f => f.slug === 'learning-api' ? {...f, status: 'INACTIVE'} : f)), /not active/);

const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/flh044-production-release.yml'), 'utf8');
const triggers = workflow.match(/^on:\n([\s\S]*?)\npermissions:/m)?.[1];
assert.ok(triggers);
assert.match(triggers, /^  workflow_dispatch:/m);
assert.doesNotMatch(triggers, /^  (pull_request|push|schedule|workflow_run):/m);
assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
assert.match(workflow, /test "\$\{GITHUB_SHA\}" = "\$\{EXPECTED_SHA\}"/);
assert.match(workflow, /test "\$\(git rev-parse FETCH_HEAD\)" = "\$\{EXPECTED_SHA\}"/);
assert.match(workflow, /if: inputs\.phase == 'deploy'/);
assert.match(workflow, /if: inputs\.phase == 'resume-edge'/);
assert.match(workflow, /if: inputs\.phase == 'deploy' \|\| inputs\.phase == 'resume-edge'/);
assert.match(workflow, /node scripts\/flh044-production-migration-stage\.mjs verify-applied/);
assert.match(workflow, /uses: supabase\/setup-cli@[0-9a-f]{40}/);
assert.doesNotMatch(workflow, /--use-api/);
assert.match(workflow, /FLH044_PROD_DB_PASSWORD/);
assert.match(workflow, /FLH044_PROD_SUPABASE_ACCESS_TOKEN/);
console.log('PASS: anonymized ledger digest, canonical SQL hash, fail-closed release gates, and six Edge policies');
