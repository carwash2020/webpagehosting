// UI audit findings F23, F24, F25, F27, F28 (7 September 2026) -- the
// public site's light mode never got the same contrast/elevation
// attention dark mode did. Each fix verified with the WCAG relative
// luminance formula against the actual rendered background, not just
// read from the CSS.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');

function hex(c) {
  const n = parseInt(c.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function relLum([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const [rr, gg, bb] = [f(r), f(g), f(b)];
  return 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
}
function contrast(c1, c2) {
  const L1 = relLum(hex(c1)), L2 = relLum(hex(c2));
  const lighter = Math.max(L1, L2), darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

test('F27: no hardcoded rgba(0,0,0,...) box-shadows remain outside the reveal-divider exception', () => {
  const shadowLines = [...STYLES.matchAll(/box-shadow:\s*0[^;]*rgba\(0,0,0[^;]*;/g)].map(m => m[0]);
  // .reveal-divider is a deliberate exception: a decorative outline+glow
  // for the exploded-appliance slider's divider line, not a card
  // elevation shadow -- it needs to stay visible against photo content
  // regardless of site theme, unlike --shadow-resting/--shadow-hover.
  const unexpected = shadowLines.filter(s => s !== 'box-shadow:0 0 0 1px rgba(0,0,0,.35), 0 0 24px rgba(0,0,0,.4);');
  assert.deepEqual(unexpected, [], `expected every other hardcoded shadow to be routed through --shadow-resting/--shadow-hover, found: ${JSON.stringify(unexpected)}`);
});

test('F27: --shadow-resting/--shadow-hover are actually used by the cards the audit named', () => {
  for (const selector of ['.trust-item', '.service-card', '.value-pill', '.contact-card', '.faq-item', '.review-card', '.triage-shell', '.verdict-col']) {
    const escaped = selector.replace('.', '\\.');
    const re = new RegExp(escaped + '\\{[^}]*box-shadow:var\\(--shadow-resting\\)');
    assert.match(STYLES, re, `expected ${selector} to use var(--shadow-resting)`);
  }
});

test('F23: .theme-toggle text color is hardcoded (matching .nav-links a\'s pattern), not theme-dependent, since this bar is always dark', () => {
  const rule = STYLES.match(/\.theme-toggle\{([\s\S]*?)\}/)[1];
  assert.match(rule, /color:#d8d8d8;/);
  assert.doesNotMatch(rule, /color:var\(--text-dim\)/);
  assert.match(STYLES, /\.theme-toggle:hover\{color:#ffffff;/);
  assert.ok(contrast('#d8d8d8', '#111111') >= 4.5);
});

test('F24: .gallery-category and .radius-name.is-request use the theme-aware text tokens, not the fixed brand colors', () => {
  assert.match(STYLES, /\.gallery-category\{[\s\S]*?color:var\(--blue-text\)/);
  assert.match(STYLES, /\.radius-name\.is-request\{fill:var\(--orange-text\);\}/);
});

test('F24/F25: the light-theme text tokens meet 4.5:1 against a white panel', () => {
  assert.ok(contrast('#1a5a94', '#ffffff') >= 4.5, '--blue-text (light)');
  assert.ok(contrast('#994a00', '#ffffff') >= 4.5, '--orange-text (light)');
});

test('F25: .copy-email-btn:hover text is a dark navy on the pale-blue hover fill, not white (which measured 1.87:1)', () => {
  assert.match(STYLES, /\.copy-email-btn:hover\{background:var\(--blue-light\); border-color:var\(--blue-text\); color:#08131f;\}/);
  assert.ok(contrast('#08131f', '#7ec4ff') >= 4.5);
});

test('F28: the post-submit success message, dropdown chevron, and input placeholder all route through theme-aware tokens now', () => {
  assert.match(STYLES, /\.form-status\.is-success\{color:var\(--success-text\);\}/);
  assert.match(STYLES, /input::placeholder, textarea::placeholder\{color:var\(--placeholder-text\);\}/);
  assert.match(STYLES, /\[data-theme="light"\] select\{background-image:url\('data:image\/svg\+xml;utf8,<svg[^']*fill="%23545454"/);

  assert.ok(contrast('#146c34', '#ffffff') >= 4.5, '--success-text (light)');
  assert.ok(contrast('#545454', '#ffffff') >= 4.5, 'light-mode select chevron');
  assert.ok(contrast('#5c5750', '#e8e5df') >= 4.5, '--placeholder-text (light) against --bg-panel-3');
  assert.ok(contrast('#8c8c8c', '#1f1f1f') >= 4.5, '--placeholder-text (dark) against --bg-panel-3');
});
