import fs from 'node:fs';
import path from 'node:path';

function fail(message) {
  throw new Error(`Security contract failed: ${message}`);
}

const migrationPath = path.join('supabase', 'migrations', '20260907172000_harden_learner_content_assignments_rls.sql');
if (!fs.existsSync(migrationPath)) fail('hardening migration is missing');

const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase().replace(/\s+/g, ' ');
const requiredSql = [
  'alter table public.learner_content_assignments enable row level security',
  'revoke all privileges on table public.learner_content_assignments from anon, authenticated',
  'revoke execute on function public.validate_learner_content_assignment_resource() from public, anon, authenticated',
  'revoke execute on function public.sync_test_content_assignment() from public, anon, authenticated',
  'revoke execute on function public.sync_content_assignment_quiz_access() from public, anon, authenticated',
  'revoke execute on function public.sync_published_quiz_direct_access() from public, anon, authenticated',
];
for (const statement of requiredSql) {
  if (!sql.includes(statement)) fail(`missing required hardening statement: ${statement}`);
}

// The browser application must not query the protected table directly. It is
// deliberately exposed only through Edge Functions that perform authorization
// and then use the service role.
for (const entry of fs.readdirSync('.')) {
  if (!entry.endsWith('.js')) continue;
  const source = fs.readFileSync(entry, 'utf8');
  if (source.includes('learner_content_assignments')) {
    fail(`frontend file ${entry} references learner_content_assignments directly`);
  }
}

for (const functionPath of [
  path.join('supabase', 'functions', 'parent-program-api', 'index.ts'),
  path.join('supabase', 'functions', 'student-library-api', 'index.ts'),
]) {
  const source = fs.readFileSync(functionPath, 'utf8');
  if (!source.includes('SUPABASE_SERVICE_ROLE_KEY')) fail(`${functionPath} does not use the service role`);
  if (!source.includes('learner_content_assignments')) fail(`${functionPath} no longer contains the expected protected-table access path`);
}

console.log('Security contract QA passed');
