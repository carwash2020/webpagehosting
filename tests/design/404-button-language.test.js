// 404 buttons (2026-09-23). The 404 page is standalone -- it must render
// even if /styles.css is what failed -- so it carries its own copy of the
// button CSS. That copy was never updated for U01 (2026-09-07), which
// retired the glossy gradient buttons site-wide: the page still showed two
// equal-weight gradient pills, blue "Back to Home" and orange "Call". Now it
// uses the same language as everywhere else: one flat orange primary with
// a solid offset shadow (Call, which already had the orange here), and a
// quieter outline partner.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const PAGE = fs.readFileSync(repo('404.html'), 'utf8');
const CSS = PAGE.replace(/\/\*[\s\S]*?\*\//g, '');
const SITE = fs.readFileSync(repo('styles.css'), 'utf8');
const rootToken = (t) => SITE.match(new RegExp(`:root\\{[^}]*${t}:\\s*([^;]+);`))[1].trim();

test('404: no glossy gradient buttons left', () => {
  assert.doesNotMatch(CSS, /linear-gradient/);
});

test('404: exactly one filled primary (Call) and one outline partner (Back to Home)', () => {
  const buttons = [...PAGE.matchAll(/<a class="btn ([\w-]+)" href="([^"]+)">/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(buttons, [['outline', '/'], ['orange', 'tel:+14354141667']]);
});

test("404: the orange primary is styles.css's flat fill + offset shadow, with the same colours", () => {
  const orange = rootToken('--orange'), dark = rootToken('--orange-dark');
  const rule = CSS.match(/a\.btn\.orange\{([^}]*)\}/)[1];
  assert.ok(rule.includes(`background:${orange};`), rule);
  assert.ok(rule.includes(`box-shadow:4px 4px 0 0 ${dark};`), rule);
  assert.match(CSS, new RegExp(`a\\.btn\\.orange:hover\\{box-shadow:6px 6px 0 0 ${dark};\\}`));
});

test('404: the outline partner and focus ring match the site, and hover motion respects reduced motion', () => {
  assert.match(CSS, /a\.btn\.outline\{background:transparent; color:#ff8000; border:1\.5px solid rgba\(255,128,0,\.3\);\}/);
  assert.match(CSS, new RegExp(`a\\.btn:focus-visible\\{outline:2px solid ${rootToken('--blue-light')};`));
  assert.match(CSS, /@media \(prefers-reduced-motion:reduce\)\{\s*a\.btn\{transition:none;\}\s*a\.btn:hover, a\.btn:active\{transform:none;\}\s*\}/);
});
