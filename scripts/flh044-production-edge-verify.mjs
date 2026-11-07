import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const BEFORE = Object.freeze({
  'assessment-mcp': 7,
  'learning-api': 23,
  'exam-v2-api': 13,
  'attempt-history-api': 7,
  'family-api': 18,
  'student-library-api': 9,
});

export function verifyDeployedFunctions(functions, before = BEFORE) {
  assert.ok(Array.isArray(functions), 'Expected function list from Management API');
  for (const [slug, oldVersion] of Object.entries(before)) {
    const fn = functions.find(x => x.slug === slug);
    assert.ok(fn, 'Missing Production Edge function ' + slug);
    assert.equal(fn.status, 'ACTIVE', slug + ' not active');
    assert.equal(fn.verify_jwt, false, slug + ' unexpectedly requires JWT gateway');
    assert.ok(Number(fn.version) > oldVersion, slug + ' not redeployed from approved source');
  }
  return Object.keys(before);
}

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  assert.ok(token, 'Production PAT is missing');
  const response = await fetch('https://api.supabase.com/v1/projects/gkpoylfozvuwuwqeoduc/functions', {
    headers: {Authorization: 'Bearer ' + token, Accept: 'application/json'},
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 200, 'Unable to verify deployed Production functions');
  const names = verifyDeployedFunctions(await response.json());
  console.log('PASS: new versions active, verify_jwt=false: ' + names.join(', '));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error('FLH044 Production function verification failed: ' + error.message);
    process.exitCode = 1;
  });
}
