#!/usr/bin/env node
// Compares the live Supabase edge functions with edge-functions/ (2026-09-30).
//
// Merging a change to edge-functions/ doesn't deploy it, and nothing used
// to notice when the live copy and the repo disagreed. That drift bit three
// times (uptime-alert, Send-Push, stripe-webhook). .github/workflows/
// edge-function-drift.yml downloads every live function's source with the
// Supabase CLI and runs this; it fails on any difference, naming what to
// deploy.
//
// Usage:
//   node scripts/check-edge-function-drift.js --list <functions.json> --live <dir>
//     <functions.json>  `supabase functions list -o json` output (the slugs)
//     <dir>             where `supabase functions download` put them:
//                       <dir>/<slug>/index.ts
//
// Repo layout: edge-functions/<slug>-index.ts, slug lower-cased (the live
// Send-Push is edge-functions/send-push-index.ts). Line endings and
// trailing whitespace at the end of the file are ignored.

const fs = require('fs');
const path = require('path');

const REPO_DIR = path.join(__dirname, '..', 'edge-functions');

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, '')] = argv[i + 1];
  return out;
}

const normalize = (s) => s.replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n';

// Shape of a difference, never its content: the Actions log of this public
// repo is public, and a live function could hold something the repo doesn't.
function describeDifference(live, mine, liveFnDir) {
  const a = live.split('\n'), b = mine.split('\n');
  let first = 0;
  while (first < a.length && first < b.length && a[first] === b[first]) first++;
  const files = [];
  const walk = (d, rel) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) walk(path.join(d, e.name), r); else files.push(r);
  } };
  try { walk(liveFnDir, ''); } catch (e) { /* listing is best-effort */ }
  return { liveLines: a.length - 1, repoLines: b.length - 1, firstDiffLine: first + 1, files };
}

function compare({ liveSlugs, liveDir, repoDir = REPO_DIR }) {
  const repo = new Map(fs.readdirSync(repoDir).filter((f) => f.endsWith('-index.ts'))
    .map((f) => [f.slice(0, -'-index.ts'.length), path.join(repoDir, f)]));
  const result = { same: [], differs: [], onlyLive: [], onlyRepo: [], notDownloaded: [], details: {} };
  const seen = new Set();
  for (const slug of liveSlugs) {
    const key = slug.toLowerCase();
    seen.add(key);
    const repoFile = repo.get(key);
    if (!repoFile) { result.onlyLive.push(slug); continue; }
    const liveFile = path.join(liveDir, slug, 'index.ts');
    if (!fs.existsSync(liveFile)) { result.notDownloaded.push(slug); continue; }
    const live = normalize(fs.readFileSync(liveFile, 'utf8'));
    const mine = normalize(fs.readFileSync(repoFile, 'utf8'));
    if (live === mine) { result.same.push(slug); continue; }
    result.differs.push(slug);
    result.details[slug] = describeDifference(live, mine, path.join(liveDir, slug));
  }
  for (const key of repo.keys()) if (!seen.has(key)) result.onlyRepo.push(key);
  return result;
}

function report(r) {
  const lines = ['## Edge functions: live vs edge-functions/', ''];
  const list = (title, items, hint, extra = () => '') => {
    if (!items.length) return;
    lines.push(`**${title} (${items.length})**${hint ? ' ' + hint : ''}`, '');
    for (const s of items) lines.push(`- \`${s}\`${extra(s)}`);
    lines.push('');
  };
  const shape = (s) => {
    const d = (r.details || {})[s];
    return d ? ` -- live ${d.liveLines} lines, repo ${d.repoLines}; first difference at line ${d.firstDiffLine}; downloaded: ${d.files.join(', ')}` : '';
  };
  list('Live differs from the repo', r.differs, '-- deploy from main (`supabase functions deploy <slug>`), or bring the repo in line if the live copy is the right one.', shape);
  list('Live only, not in edge-functions/', r.onlyLive, '-- add its source to the repo.');
  list('In edge-functions/, not deployed', r.onlyRepo, '-- deploy it, or remove the file.');
  list('Could not download', r.notDownloaded, '-- the download step failed for these; the check could not compare them.');
  lines.push(`${r.same.length} function(s) match.`);
  return lines.join('\n') + '\n';
}

function main() {
  const a = args(process.argv.slice(2));
  if (!a.list || !a.live) {
    console.error('Usage: node scripts/check-edge-function-drift.js --list <functions.json> --live <dir>');
    process.exit(2);
  }
  const liveSlugs = JSON.parse(fs.readFileSync(a.list, 'utf8')).map((f) => f.slug);
  if (!liveSlugs.length) {
    console.error('::error::The live function list is empty -- the list step failed, so nothing was compared.');
    process.exit(1);
  }
  const r = compare({ liveSlugs, liveDir: a.live });
  const text = report(r);
  process.stdout.write(text);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  const bad = r.differs.length + r.onlyLive.length + r.onlyRepo.length + r.notDownloaded.length;
  if (bad) {
    console.error(`::error::${bad} edge function(s) out of step with edge-functions/ -- see the summary above.`);
    process.exit(1);
  }
}

if (require.main === module) main();
module.exports = { compare, report, normalize };
