// Tests for the iOS Safari zoom-on-focus fix applied everywhere
// (2026-09-05), following up on the invoice-generator.html-specific
// fix from earlier the same day: "Want me to fix the zoom bug across
// the rest of the app now?" -- "Yes, everywhere (portal + tools)."
// A comprehensive scan (the same methodology used to find these in
// the first place) found the identical bug on every single portal
// page (via a shared "Report a problem" textarea), several tools
// pages, and the public booking form.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);

function findAllHtmlFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findAllHtmlFiles(full, out);
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

// Strips comments before scanning, same as the invoice-generator.html
// test's own fix for a real false positive found there: a comment
// mentioning a form-field word (like "input") could otherwise be
// mistaken for part of an actual CSS selector.
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function findDangerousRules(html) {
  const styleBlocks = html.match(/<style>[\s\S]*?<\/style>/g) || [];
  const dangerous = [];
  for (const raw of styleBlocks) {
    const clean = stripComments(raw);
    for (const m of clean.matchAll(/([^{}]*\b(?:input|select|textarea)\b[^{}]*)\{([^}]*)\}/g)) {
      const sizeMatch = m[2].match(/font-size:\s*(\d+(?:\.\d+)?)px/);
      if (sizeMatch && parseFloat(sizeMatch[1]) < 16) {
        dangerous.push(m[1].trim().slice(0, 80));
      }
    }
  }
  return dangerous;
}

test('zero HTML files anywhere in the repo have a sub-16px font-size on an input/select/textarea selector -- a real, repo-wide guardrail against this whole bug class reappearing, not just the files fixed today', () => {
  const allFiles = findAllHtmlFiles(repo());
  const offenders = {};
  for (const file of allFiles) {
    const html = fs.readFileSync(file, 'utf8');
    const dangerous = findDangerousRules(html);
    if (dangerous.length) offenders[path.relative(repo(), file)] = dangerous;
  }
  assert.deepEqual(offenders, {}, 'expected zero files with a sub-16px form-field rule');
});

test('every one of the 8 portal pages has the generic 16px fallback rule, covering fields with no explicit font-size at all', () => {
  for (const page of ['home', 'dashboard', 'jobs', 'login', 'quotes', 'set-password', 'settings', 'work-orders']) {
    const html = fs.readFileSync(repo('portal', `${page}.html`), 'utf8');
    assert.match(html, /input, select, textarea \{ font-size: 16px; \}/, `${page}.html should have the generic fallback rule`);
  }
});

test('every affected tools page and the public booking form also got the fix', () => {
  for (const file of [
    'tools/job-tracker.html', 'tools/login.html', 'tools/parts-reference.html', 'tools/reset-password.html',
    'tools/review-request.html', 'tools/route-planner.html', 'tools/runway-dashboard.html', 'tools/workspace.html',
  ]) {
    const html = fs.readFileSync(repo(file), 'utf8');
    assert.match(html, /input, select, textarea \{ font-size: 16px; \}/, `${file} should have the generic fallback rule`);
  }
  const booking = fs.readFileSync(repo('booking.html'), 'utf8');
  assert.match(booking, /font-size:16px;/, 'booking.html\u2019s own generic input/textarea rule should be bumped to 16px');
});

test('the shared "Report a problem" textarea, identical across all 8 portal pages, is fixed on every one of them -- not just some', () => {
  for (const page of ['home', 'dashboard', 'jobs', 'login', 'quotes', 'set-password', 'settings', 'work-orders']) {
    const html = fs.readFileSync(repo('portal', `${page}.html`), 'utf8');
    assert.match(html, /\.report-bug-modal textarea \{[^}]*font-size: 16px;/, `${page}.html's report-bug-modal textarea should be at 16px`);
  }
});

test('the shared login-field rule, identical across portal login/set-password and tools login/reset-password, is fixed on all four', () => {
  for (const file of ['portal/login.html', 'portal/set-password.html', 'tools/login.html', 'tools/reset-password.html']) {
    const html = fs.readFileSync(repo(file), 'utf8');
    assert.match(html, /font-size: 16px; font-family: inherit; box-sizing: border-box;\s*\n\s*\}/, `${file}'s login-field input should be at 16px`);
  }
});
