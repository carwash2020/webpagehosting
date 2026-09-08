// Dead CSS cleanup (2026-09-07), same shape as the earlier .blog-meta
// and .teardown-sticky/.terms-disclaimer/.gallery-note finds: .form-card
// was defined twice in styles.css (base rule + a mobile padding
// override) but no page loading that stylesheet has any markup using
// the class. The name survives only as an unrelated, same-named local
// class in tools/runway-dashboard.html's own self-contained <style>
// block -- that page never loads styles.css at all (confirmed in
// scripts/check-consistency.js's own SKIP_STYLES_CSS_PAGES list), so
// it isn't the same class and was never at risk from this removal.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');

test('.form-card no longer appears anywhere in styles.css', () => {
  assert.doesNotMatch(STYLES, /\.form-card/);
});

test('no page that loads styles.css has markup using the form-card class', () => {
  const glob = require('fs').readdirSync(repo('.')).filter((f) => f.endsWith('.html'));
  for (const file of glob) {
    const html = fs.readFileSync(repo(file), 'utf8');
    if (!/\/styles\.css\?v=/.test(html) && !/^styles\.css\?v=/m.test(html)) continue;
    assert.doesNotMatch(html, /class="[^"]*\bform-card\b/, `${file} still has form-card markup but no longer any CSS for it`);
  }
});

test('tools/runway-dashboard.html keeps its own unrelated, self-contained .form-card rules and markup untouched', () => {
  const runway = fs.readFileSync(repo('tools', 'runway-dashboard.html'), 'utf8');
  assert.doesNotMatch(runway, /\/styles\.css\?v=/, 'runway-dashboard.html should still not load the shared styles.css');
  assert.match(runway, /\.form-card\{display:none;\}/);
  assert.match(runway, /class="card form-card" id="incomeFormCard"/);
});

test('the neighboring .form-row rules (base and mobile override) are untouched', () => {
  assert.match(STYLES, /\.form-row\{display:grid; grid-template-columns:1fr 1fr; gap:18px; margin-bottom:18px;\}/);
  // F30 (2026-09-07): merged from 640px into 600px, matching the other
  // form-row-collapse breakpoint (.email-form .form-row) already at 600px.
  assert.match(STYLES, /@media \(max-width:600px\)\{\s*\.form-row\{grid-template-columns:1fr;\}\s*\}/);
});
