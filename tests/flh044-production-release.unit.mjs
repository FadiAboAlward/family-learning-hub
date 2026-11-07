import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateProductionLedger, stageOnlyCanonical} from '../scripts/flh044-production-migration-stage.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/release/flh044-production-ledger-baseline.json'), 'utf8'));
const original = structuredClone(baseline.applied);
assert.equal(original.length, 132);
assert.deepEqual(validateProductionLedger(baseline, original), original);
assert.throws(() => validateProductionLedger(baseline, original.slice(1)), /drift/);
assert.throws(() => validateProductionLedger(baseline, [...original, {version: '20261031205108', name: 'unexpected'}]), /drift/);
assert.throws(() => validateProductionLedger(baseline, [...original.slice(0, -1), {...original.at(-1), name: 'changed'}]), /drift/);
assert.throws(() => validateProductionLedger(baseline, [...original, {version: '20261105134103', name: 'visual_foundation_bridge_v1'}]), /drift/);
assert.equal(validateProductionLedger(baseline, [...original, {version: '20261105134103', name: 'visual_foundation_bridge_v1'}], {after: true}).length, 133);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flh044-test-'));
try {
  const stage = stageOnlyCanonical(baseline, {root: ROOT, temp: tmp});
  const entries = fs.readdirSync(path.join(stage, 'supabase', 'migrations'));
  assert.equal(entries.length, 133);
  assert.ok(entries.includes('20261105134103_visual_foundation_bridge_v1.sql'));
  assert.equal(fs.readFileSync(path.join(stage, 'supabase', 'migrations', baseline.applied[0].version + '_' + baseline.applied[0].name + '.sql'), 'utf8'), 'select 1;\n');
  assert.deepEqual(
    fs.readFileSync(path.join(stage, 'supabase', 'migrations', '20261105134103_visual_foundation_bridge_v1.sql')),
    fs.readFileSync(path.join(ROOT, baseline.canonicalSource))
  );
  assert.ok(!entries.some(name => name.includes('20261106084301')), 'Testing ledger must never enter Production staging');
} finally {
  fs.rmSync(tmp, {recursive: true, force: true});
}
console.log('PASS: exact Production migration guard and canonical-only transient staging');
