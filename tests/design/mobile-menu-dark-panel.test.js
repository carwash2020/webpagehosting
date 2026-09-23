// Mobile menu in light mode (2026-09-23). The header and the mobile menu
// inside it stay dark in both themes (their text colours are hardcoded),
// but the tokens the menu's borders, carets, sub-links and theme switch
// read followed the light theme. So in light mode:
// - the dividers were near-white lines (10.6:1 painted, against a 1.4:1
//   hairline in dark mode);
// - the carets dropped to 3.5:1;
// - the theme switch turned into a light pill.
// Separately, the <=960px `.mobile-menu a` rule out-ranked the sub-list's
// own link rule by source order, so in both themes the Services/Areas
// sub-links rendered as uppercase top-level links, each with a ragged
// text-width underline.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const CSS = fs.readFileSync(path.join(__dirname, '..', '..', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function block(selectorRe) {
  const m = CSS.match(new RegExp(`(?:^|[\\s}])${selectorRe}\\{([^}]*)\\}`));
  assert.ok(m, `missing rule ${selectorRe}`);
  return m[1];
}
const tokenIn = (body, t) => { const m = body.match(new RegExp(`${t}\\s*:\\s*([^;]+);`)); return m ? m[1].trim() : null; };

test('every theme token the mobile menu reads is pinned on .mobile-menu when light mode would change it', () => {
  const dark = CSS.match(/:root\{([^}]*)\}/)[1];
  const light = CSS.match(/\[data-theme="light"\]\{([^}]*)\}/)[1];
  const menu = block('\\.mobile-menu');
  const used = new Set();
  for (const m of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/mobile-|theme-switch/.test(m[1])) for (const v of m[2].matchAll(/var\((--[\w-]+)/g)) used.add(v[1]);
  }
  const themed = [...used].filter((t) => tokenIn(light, t) !== null && tokenIn(light, t) !== tokenIn(dark, t));
  assert.ok(themed.includes('--border') && themed.includes('--text-dim'), `sanity: expected --border and --text-dim among ${themed}`);
  for (const t of themed) {
    assert.ok(tokenIn(menu, t) !== null, `${t} changes in light mode and the menu reads it, so .mobile-menu must pin it`);
  }
  assert.equal(tokenIn(menu, '--text-dim'), tokenIn(dark, '--text-dim'));
  assert.equal(tokenIn(menu, '--bg-panel-3'), tokenIn(dark, '--bg-panel-3'));
});

test('the divider is translucent white, so it stays a hairline on both paints of the translucent panel', () => {
  // The panel paints #0a0a0a in dark mode and #272727 over the light page;
  // a solid #2a2a2a vanished on the second (1.04:1).
  assert.match(tokenIn(block('\\.mobile-menu'), '--border'), /^rgba\(255,\s*255,\s*255,\s*\.1\d\)$/);
});

test('Services/Areas rows carry the divider across the caret, not just under the link', () => {
  const nav = CSS.slice(CSS.indexOf('@media (max-width:960px){'));
  assert.match(nav, /\.mobile-nav-row\{border-bottom:1px solid var\(--border\);\}/);
  assert.match(nav, /\.mobile-menu \.mobile-nav-row a\{border-bottom:none;\}/);
});

test('sub-links out-rank `.mobile-menu a`, so their own smaller, dimmer, 44px-row style applies', () => {
  const body = block('\\.mobile-menu \\.mobile-services-sublist a,\\s*\\.mobile-menu \\.mobile-areas-sublist a');
  for (const decl of ['display:block;', 'font-size:13.5px;', 'text-transform:none;', 'color:var(--text-dim);', 'padding:10px 4px;', 'border-bottom:none;']) {
    assert.ok(body.includes(decl), `sub-link rule is missing ${decl}`);
  }
  assert.doesNotMatch(CSS, /(?:^|[\s}])\.mobile-services-sublist a,\s*\.mobile-areas-sublist a\{/, 'the old equal-specificity selector should be gone');
});
