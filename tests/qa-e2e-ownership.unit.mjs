import fs from 'node:fs';

const e2e = fs.readFileSync('tests/authenticated-e2e.mjs', 'utf8');
const workflow = fs.readFileSync('.github/workflows/qa-smoke.yml', 'utf8');
const required = [
  [e2e, "const prepared = await qaAuth('prepare')", 'E2E must prepare an owned QA run'],
  [e2e, 'prepared.run_id', 'E2E must require the server-issued run_id'],
  [e2e, "await qaAuth('cleanup', prepared.run_id)", 'E2E cleanup must use the matching run_id'],
  [e2e, 'finally {', 'E2E cleanup must run from finally'],
  [workflow, 'group: family-learning-hub-testing-learner', 'Browser smoke must serialize the shared Testing learner'],
  [workflow, 'cancel-in-progress: false', 'Testing serialization must queue rather than cancel an active owner'],
];
for (const [source, needle, message] of required) {
  if (!source.includes(needle)) throw new Error(`${message}: missing ${needle}`);
}
console.log('Testing QA E2E ownership guard passed.');
