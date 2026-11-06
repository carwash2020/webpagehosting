// Fix plan FP2.5 (2026-11-06): the Dev Tools password prompt
// (confirmDevPassword(), #devPasswordOverlay) is asked from inside sheets,
// so it must sit above every sheet and overlay tier on every tools page --
// only the first-paint splash (9999) and the toast layer (10001) may be
// higher. It used to render behind Team's invite sheet (1200 vs 950).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const CSS = fs.readFileSync(path.join(TOOLS, 'styles-tools.css'), 'utf8');
const SOURCES = fs.readdirSync(TOOLS).filter((f) => /\.(html|css)$/.test(f)).map((f) => [f, fs.readFileSync(path.join(TOOLS, f), 'utf8')]);

test('the dev password prompt has its own tier, above every sheet and overlay on every tools page', () => {
  const m = CSS.match(/#devPasswordOverlay\s*\{\s*z-index:\s*(\d+);\s*\}/);
  assert.ok(m, 'one rule, in the shared stylesheet');
  const tier = Number(m[1]);
  for (const [file, src] of SOURCES) {
    for (const z of src.matchAll(/z-index:\s*(\d+)/g)) {
      const v = Number(z[1]);
      if (v >= 9999) continue; // the splash and toasts
      if (v === tier && file === 'styles-tools.css') continue;
      assert.ok(v < tier, `${file}: z-index ${v} would cover the dev password prompt (${tier})`);
    }
  }
});

test('every page with the prompt uses the shared stylesheet and the same id, and no page overrides its tier', () => {
  for (const [file, src] of SOURCES.filter(([f, s]) => f.endsWith('.html') && s.includes('id="devPasswordOverlay"'))) {
    assert.match(src, /styles-tools\.css/, file);
    assert.doesNotMatch(src, /#devPasswordOverlay\s*\{[^}]*z-index/, file);
  }
});

// Fix plan FP2.6 (2026-11-06): the bottom bar's New label reads the same on
// every page -- Dashboard's sentence-case list no longer includes it.
test('FP2.6: the New label is uppercase everywhere, Dashboard included', () => {
  const WS = fs.readFileSync(path.join(TOOLS, 'workspace.html'), 'utf8');
  assert.match(CSS, /body\.th-tool-page \.th-bottom-nav \.th-bn-create-label \{ text-transform: uppercase;/);
  for (const [file, src] of SOURCES) {
    for (const rule of src.matchAll(/([^{}]+)\{[^}]*text-transform:\s*none/g)) {
      assert.doesNotMatch(rule[1], /th-bn-create-label/, file + ' lowercases the New label');
    }
  }
  assert.ok(WS.includes('.section-heading-title'), 'the rest of the Dashboard list is untouched');
});
