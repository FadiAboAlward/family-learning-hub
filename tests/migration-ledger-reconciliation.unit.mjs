import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const migrationDirectory = path.join('supabase', 'migrations');
const manifestPath = path.join('supabase', 'migration-ledger-reconciliation.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const expectedMirrorVersions = '20260824091050,20260824094908,20260824215948,20260824220240,20260825224312,20260825224459,20260826232234,20260831164849,20260901135239,20260901150812,20260901172235,20260903111122,20260905121716,20260905123909,20260906091730,20260906092026,20260907173550,20260909082415,20260909235701,20260910080702,20260910080825,20260910081009,20260910081650,20260910082736,20260910082942,20260910091945'.split(',');
const expectedRepairVersions = '20260824090800,20260824124700,20260903140500,20260905112742,20260905143000,20260905153100,20260909055000,20260910023450,20260910023500,20260910023600,20260910080000'.split(',');
const expectedFutureProductionRepairs = [
  ['20260824090800', '20260824090800_stable_public_question_codes', ['20260824091050_stable_public_question_codes']],
  ['20260824124700', '20260824124700_question_interaction_state_for_mobile_ux', ['20260824094908_question_interaction_state_for_mobile_ux']],
  ['20260903140500', '20260903140500_tr_g4_division_time_interactive_practice', ['20260903111122_tr_g4_division_time_interactive_practice']],
  ['20260905112742', '20260905112742_validate_exam_pool_delivery_role', ['20260905112741_exam_pool_for_independent_exam_questions']],
  ['20260905143000', '20260905143000_allow_8_to_10_digit_learner_pins', ['20260905121716_allow_8_to_10_digit_learner_pins']],
  ['20260905153100', '20260905153100_reconcile_g7_exam_start_rpc', ['20260905123909_reconcile_g7_exam_start_rpc']],
  ['20260909055000', '20260909055000_harden_testing_qa_concurrency', ['20260909082415_harden_testing_qa_concurrency']],
  ['20260910023450', '20260910023450_jsonb_object_length_compat', ['20260910080702_paper_exam_jsonb_object_length_compat_reconcile']],
  ['20260910023500', '20260910023500_paper_exam_ingestion_gate', ['20260910080825_reconcile_final_paper_exam_ingestion_gate']],
  ['20260910023600', '20260910023600_register_mohammad_integer_paper_exam', ['20260910081650_reconcile_mohammad_paper_model_metadata_and_concepts']],
  ['20260910080000', '20260910080000_record_exam_concept_mastery', ['20260910091945_record_exam_concept_mastery']],
].map(([version, identity, productionEquivalentIdentities]) => ({ version, identity, productionEquivalentIdentities }));
const allowedClassifications = new Set([
  'historical_equivalent',
  'production_only_data_backfill',
  'production_only_temporary',
  'actual_state_requires_forward_migration',
  'other_ambiguous',
]);

const migrationFiles = fs.readdirSync(migrationDirectory).filter((file) => file.endsWith('.sql')).sort();

assert.equal(manifest.schemaVersion, 1, 'reconciliation manifest schema version must be explicit');
assert.equal(manifest.baseline.baseCommit, '658eff4caad1c7d09df5511633abd15f1dbb0cb5');
assert.deepEqual(
  [
    manifest.baseline.canonicalMigrationCount,
    manifest.baseline.productionLedgerCount,
    manifest.baseline.sharedVersionCount,
    manifest.baseline.historicalMirrorCount,
    manifest.baseline.futureProductionRepairCount,
    manifest.baseline.reconciledMigrationCount,
  ],
  [49, 64, 38, 26, 11, 75],
  'the reviewed migration-count reconciliation must remain explicit',
);
assert.equal(migrationFiles.length, 75, 'post-reconciliation Git history must contain exactly 75 migration identities');

const versions = migrationFiles.map((file) => {
  const match = file.match(/^(\d{14})_.+\.sql$/);
  assert.ok(match, 'migration filename must use a 14-digit version: ' + file);
  return match[1];
});
assert.equal(new Set(versions).size, versions.length, 'migration timestamps must be unique');

const manifestMirrorVersions = manifest.historicalMirrors.map((item) => item.version).sort();
assert.deepEqual(manifestMirrorVersions, [...expectedMirrorVersions].sort(), 'manifest must contain the 26 reviewed Production mirror versions');
const mirrorFiles = manifest.historicalMirrors.map((item) => item.version + '_' + item.name + '.sql').sort();

for (const mirror of manifest.historicalMirrors) {
  const identity = mirror.version + '_' + mirror.name;
  const file = identity + '.sql';
  assert.ok(migrationFiles.includes(file), 'historical mirror is missing: ' + file);

  const sql = fs.readFileSync(path.join(migrationDirectory, file), 'utf8');
  const executableSql = sql.replace(/--[^\r\n]*/g, '').trim().toLowerCase();
  assert.equal(executableSql, 'select 1;', identity + ' must contain only inert executable SQL');
  assert.ok(allowedClassifications.has(mirror.classification), identity + ' has an unknown classification');
  assert.match(sql, /records Production migration identity only/i, identity + ' must document its identity-only purpose');
  assert.match(sql, /Historical Production SQL must not be replayed/i, identity + ' must prohibit historical SQL replay');
  assert.match(sql, new RegExp('Identity: ' + identity + '\\b'), identity + ' must document its exact Production identity');
  assert.match(sql, /Classification:/, identity + ' must document its classification');
  assert.match(sql, /Equivalent Git identity:/, identity + ' must document Git equivalence or its absence');
  assert.match(sql, /Final state:/, identity + ' must document final-state ownership');

  if (mirror.equivalentGitIdentity) {
    assert.ok(
      manifest.canonicalMigrationFiles.includes(mirror.equivalentGitIdentity + '.sql'),
      identity + ' points outside the pinned canonical Git migrations',
    );
  }
  if (mirror.finalStateRequiresFutureForwardMigration) {
    assert.match(mirror.finalStateOwner, /^future_forward_migration_/, identity + ' must name its future forward owner');
  }
}

const markedMirrorFiles = migrationFiles
  .filter((file) => fs.readFileSync(path.join(migrationDirectory, file), 'utf8').includes('Historical Production migration mirror.'))
  .sort();
assert.deepEqual(markedMirrorFiles, mirrorFiles, 'mirror files and the manifest allowlist must change together');

const canonicalFiles = migrationFiles.filter((file) => !mirrorFiles.includes(file));
assert.deepEqual(canonicalFiles, manifest.canonicalMigrationFiles, 'the 49 canonical migrations must not be removed or renamed');
assert.equal(canonicalFiles.length, 49);

const canonicalHash = crypto.createHash('sha256');
for (const file of canonicalFiles) {
  canonicalHash.update(file);
  canonicalHash.update('\0');
  canonicalHash.update(fs.readFileSync(path.join(migrationDirectory, file), 'utf8').replace(/\r\n/g, '\n'));
  canonicalHash.update('\0');
}
assert.equal(
  canonicalHash.digest('hex'),
  manifest.canonicalMigrationTreeSha256,
  'an existing canonical migration changed without an explicit manifest update',
);

const repairVersions = manifest.futureProductionRepairs.map((item) => item.version).sort();
assert.deepEqual(repairVersions, [...expectedRepairVersions].sort(), 'manifest must retain exactly the 11 reviewed future repair versions');
assert.equal(new Set(repairVersions).size, repairVersions.length, 'future repair versions must be unique');
assert.deepEqual(
  manifest.futureProductionRepairs,
  expectedFutureProductionRepairs,
  'future repair ordering and Git-to-Production identity mappings must remain exact',
);
for (const repair of manifest.futureProductionRepairs) {
  assert.ok(
    manifest.canonicalMigrationFiles.includes(repair.identity + '.sql'),
    repair.version + ' must refer to a pinned canonical Git migration',
  );
  assert.ok(repair.productionEquivalentIdentities.length > 0, repair.version + ' must document Production equivalence');
}

const reconciledVersions = new Set([
  ...manifest.historicalMirrors.map((item) => item.version),
  ...manifest.canonicalMigrationFiles.map((file) => file.slice(0, 14)),
]);
assert.equal(reconciledVersions.size, 75, 'the manifest union must contain exactly 75 identities');

console.log('migration ledger counts, immutable canonical history, inert mirrors, and future repair allowlist passed.');
