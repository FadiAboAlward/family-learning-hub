import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';

const workflow = fs.readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const trigger = workflow.match(/^on:\n([\s\S]*?)\npermissions:/m)?.[1];
assert.ok(trigger);
assert.deepEqual([...trigger.matchAll(/^  ([a-z_]+):/gm)].map(match => match[1]), ['workflow_dispatch']);
assert.match(trigger, /expected_sha:\n[\s\S]*?required: true\n\s+type: string/);
assert.match(workflow, /^    if: github.event_name == 'workflow_dispatch' && github.ref == 'refs\/heads\/main'$/m);
assert.match(workflow, /uses: actions\/checkout@v6\n\s+with:\n\s+ref: \$\{\{ github.sha \}\}/);
assert.match(workflow, /persist-credentials: false/);
assert.match(workflow, /EXPECTED_SHA: \$\{\{ inputs.expected_sha \}\}/);
assert.match(workflow, /contents: read\n  pull-requests: read\n  pages: write\n  id-token: write/);
assert.match(workflow, /group: pages\n  cancel-in-progress: false/);
assert.match(workflow, /name: github-pages/);
for (const action of ['configure-pages@v5', 'upload-pages-artifact@v4', 'deploy-pages@v4']) {
  assert.ok(workflow.includes(`uses: actions/${action}`));
}
assert.match(workflow, /path: \$\{\{ steps.site.outputs.site_dir \}\}/);
assert.doesNotMatch(workflow, /curl|tarball|open-prs|GH_TOKEN|api.github.com/);

// Execute the real workflow step: changing its packaging behavior changes these tests.
const build = workflow.match(/      - name: Build approved main site\n[\s\S]*?        run: \|\n((?:          [^\n]*\n|\n)+)/)?.[1];
assert.ok(build, 'Production build step must be executable by the artifact regression');
const script = build.replace(/^          /gm, '');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flh-pages-contract-'));
const repo = path.join(root, 'repo');
const runtime = path.join(root, 'runtime');
fs.mkdirSync(repo);
fs.mkdirSync(runtime);
const git = (...args) => execFileSync('git', args, {cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
const write = (file, content) => {
  fs.mkdirSync(path.dirname(path.join(repo, file)), {recursive: true});
  fs.writeFileSync(path.join(repo, file), content);
};
let cases = 0;
try {
  git('init', '-b', 'main');
  git('config', 'user.name', 'Pages regression');
  git('config', 'user.email', 'pages@example.invalid');
  write('index.html', '<h1>approved main</h1>');
  write('app.js', 'approved main runtime');
  git('add', '.');
  git('commit', '-m', 'approved main');
  const approved = git('rev-parse', 'HEAD');
  // A local origin is sufficient to exercise the current-main drift check without network.
  git('remote', 'add', 'origin', repo);
  git('switch', '-c', 'unrelated-pr');
  write('unrelated-pr.html', 'must never be deployed');
  git('add', '.');
  git('commit', '-m', 'unrelated PR');
  const other = git('rev-parse', 'HEAD');
  git('switch', 'main');
  write('index.html', 'dirty working tree');
  write('untracked.html', 'must never be deployed');
  write('pr-preview/pr-999/index.html', 'local stale preview');

  const run = (overrides = {}, success = false) => {
    const output = path.join(root, `output-${++cases}`);
    const result = spawnSync(process.env.FLH_QA_BASH || 'bash', ['-c', script], {
      cwd: repo, encoding: 'utf8',
      env: {...process.env, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
        EXPECTED_SHA: approved, GITHUB_SHA: approved, RUNNER_TEMP: '../runtime', GITHUB_OUTPUT: `../output-${cases}`, ...overrides}
    });
    assert.ifError(result.error);
    if (success) {
      assert.equal(result.status, 0, result.stderr);
      const site = path.resolve(repo, fs.readFileSync(output, 'utf8').trim().replace(/^site_dir=/, ''));
      assert.equal(fs.readFileSync(path.join(site, 'index.html'), 'utf8'), '<h1>approved main</h1>');
      assert.equal(fs.readFileSync(path.join(site, 'app.js'), 'utf8'), 'approved main runtime');
      assert.deepEqual(fs.readdirSync(site).sort(), ['.nojekyll', 'app.js', 'index.html']);
    } else {
      assert.notEqual(result.status, 0, 'Invalid release context must fail closed');
      assert.equal(fs.existsSync(output), false, 'Failure must not expose an artifact for upload');
    }
  };
  run({}, true);
  run({GITHUB_EVENT_NAME: 'push'});
  run({GITHUB_REF: 'refs/heads/unrelated-pr'});
  run({EXPECTED_SHA: ''});
  run({EXPECTED_SHA: '$(touch injected)'});
  assert.equal(fs.existsSync(path.join(repo, 'injected')), false);
  run({EXPECTED_SHA: other});
  run({GITHUB_SHA: other});
  git('checkout', '--detach', other);
  run(); // Checked-out commit differs even if event and input agree.
  git('checkout', '--detach', approved);
  git('branch', '-f', 'main', other);
  run(); // main moved after dispatch.
  git('branch', '-f', 'main', approved);
  git('checkout', 'main');
  git('add', 'pr-preview');
  git('commit', '-m', 'accidental tracked preview');
  const contaminated = git('rev-parse', 'HEAD');
  run({EXPECTED_SHA: contaminated, GITHUB_SHA: contaminated});
  console.log(`PASS Pages workflow contract and ${cases} real Git artifact/negative cases`);
} finally {
  // Only remove the uniquely created disposable fixture, never a checkout or caller path.
  assert.equal(path.dirname(root), os.tmpdir());
  assert.ok(path.basename(root).startsWith('flh-pages-contract-'));
  fs.rmSync(root, {recursive: true, force: true});
}
