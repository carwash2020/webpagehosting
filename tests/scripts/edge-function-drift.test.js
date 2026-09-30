// scripts/check-edge-function-drift.js and its workflow (2026-09-30).
// Merging didn't deploy edge functions and nothing noticed the live copy
// drifting from edge-functions/ (three incidents). The workflow downloads
// live source with the Supabase CLI; this script does the comparing.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const { compare, report, normalize } = require(repo('scripts', 'check-edge-function-drift.js'));
const WORKFLOW = fs.readFileSync(repo('.github', 'workflows', 'edge-function-drift.yml'), 'utf8');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'th-drift-'));
  const repoDir = path.join(root, 'edge-functions');
  const liveDir = path.join(root, 'live');
  fs.mkdirSync(repoDir);
  const put = (slug, src) => { fs.mkdirSync(path.join(liveDir, slug), { recursive: true }); fs.writeFileSync(path.join(liveDir, slug, 'index.ts'), src); };
  fs.writeFileSync(path.join(repoDir, 'send-push-index.ts'), 'push();\n');
  fs.writeFileSync(path.join(repoDir, 'stripe-webhook-index.ts'), 'hook(v2);\n');
  fs.writeFileSync(path.join(repoDir, 'new-thing-index.ts'), 'never deployed\n');
  fs.writeFileSync(path.join(repoDir, 'uptime-alert-index.ts'), 'alert();\n');
  put('Send-Push', 'push();\r\n\r\n');         // same, apart from CRLF and trailing blank line
  put('stripe-webhook', 'hook(v1);\n');         // the repo moved on, live didn't
  put('legacy-fn', 'old\n');                    // live, not in the repo
  return { root, repoDir, liveDir };
}

test('same, differs, live-only, repo-only and not-downloaded are each told apart', () => {
  const { repoDir, liveDir } = fixture();
  const r = compare({ liveSlugs: ['Send-Push', 'stripe-webhook', 'legacy-fn', 'uptime-alert'], liveDir, repoDir });
  assert.deepEqual(r.same, ['Send-Push'], 'slug case and line endings ignored');
  assert.deepEqual(r.differs, ['stripe-webhook']);
  assert.deepEqual(r.onlyLive, ['legacy-fn']);
  assert.deepEqual(r.onlyRepo, ['new-thing']);
  assert.deepEqual(r.notDownloaded, ['uptime-alert'], 'a failed download is not counted as a match');
  const text = report(r);
  assert.match(text, /Live differs from the repo \(1\)[\s\S]*`stripe-webhook`/);
  assert.match(text, /supabase functions deploy <slug>/);
  assert.match(text, /1 function\(s\) match\./);
  assert.equal(normalize('a\r\nb  \n\n'), 'a\nb\n');
});

test('the CLI entry point fails on drift and on an empty list, and passes when all match', () => {
  const { root, liveDir } = fixture();
  const list = path.join(root, 'functions.json');
  // Against the real edge-functions/: every live function "downloaded"
  // as an exact copy of the repo file passes.
  const realDir = repo('edge-functions');
  const slugs = fs.readdirSync(realDir).filter((f) => f.endsWith('-index.ts')).map((f) => f.slice(0, -9));
  const copyDir = path.join(root, 'copy');
  for (const s of slugs) {
    const live = s === 'send-push' ? 'Send-Push' : s;
    fs.mkdirSync(path.join(copyDir, live), { recursive: true });
    fs.copyFileSync(path.join(realDir, s + '-index.ts'), path.join(copyDir, live, 'index.ts'));
  }
  fs.writeFileSync(list, JSON.stringify(slugs.map((s) => ({ slug: s === 'send-push' ? 'Send-Push' : s }))));
  const ok = spawnSync('node', [repo('scripts', 'check-edge-function-drift.js'), '--list', list, '--live', copyDir], { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, new RegExp(`${slugs.length} function\\(s\\) match`));

  // One edited byte fails, naming the function.
  fs.appendFileSync(path.join(copyDir, 'trigger-workflow', 'index.ts'), '// hotfix made in the dashboard\n');
  const bad = spawnSync('node', [repo('scripts', 'check-edge-function-drift.js'), '--list', list, '--live', copyDir], { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /`trigger-workflow`/);
  assert.match(bad.stderr, /::error::1 edge function\(s\) out of step/);

  fs.writeFileSync(list, '[]');
  const empty = spawnSync('node', [repo('scripts', 'check-edge-function-drift.js'), '--list', list, '--live', liveDir], { encoding: 'utf8' });
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /live function list is empty/);
});

test('the workflow checks after merges to edge-functions/ and weekly, reads source with the CLI, and never deploys', () => {
  assert.match(WORKFLOW, /push:\n\s+branches: \[main\]\n\s+paths: \['edge-functions\/\*\*'\]/);
  assert.match(WORKFLOW, /cron: '40 14 \* \* 1'/);
  assert.match(WORKFLOW, /secrets\.SUPABASE_ACCESS_TOKEN/);
  assert.match(WORKFLOW, /supabase@2 functions list --project-ref "\$PROJECT_REF" -o json > live\/functions\.json/);
  assert.match(WORKFLOW, /supabase@2 functions download "\$slug" --project-ref "\$PROJECT_REF"/);
  assert.match(WORKFLOW, /run: node scripts\/check-edge-function-drift\.js --list live\/functions\.json --live live\/supabase\/functions/);
  assert.doesNotMatch(WORKFLOW.replace(/^#.*$/gm, ''), /functions deploy/, 'reports drift; doesn\'t deploy');
  assert.match(WORKFLOW, /permissions:\n\s+contents: read/);
});
