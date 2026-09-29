// Claude Design next pass, Package A (2026-09-29): accessibility polish.
// A1 44px tap floor, A2 contrast, A3 one focus ring on all three
// surfaces, A4 the service-area map by keyboard, A5 labels tied to their
// fields. Plus the portal invoice chart, which hid its own focusable bars.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const read = (...p) => fs.readFileSync(repo(...p), 'utf8');
const STYLES = read('styles.css');
const TOOLS_CSS = read('tools', 'styles-tools.css');
const PORTAL_CSS = read('portal', 'portal-polish.css');
const MAP_JS = read('js', 'service-area-map.js');

const KEY_PAGES = fs.readdirSync(repo('locations')).map((f) => path.join('locations', f))
  .concat(fs.readdirSync(repo('services')).map((f) => path.join('services', f)))
  .filter((f) => f.endsWith('.html') && read(f).includes('class="radius-key"'));

test('A1: settings row buttons, homepage chips and the map ring toggle meet the 44px floor', () => {
  const SETTINGS = read('tools', 'settings.html');
  assert.match(SETTINGS, /\.th-set-card > \.settings-row > \.secondary-btn:not\(\.th-set-switch\) \{\s*flex-shrink: 0; min-height: 44px; min-width: 44px;/);
  assert.match(STYLES, /body\.page-home #teardownStage \.td-chip\{\s*min-height:44px;/);
  assert.match(STYLES, /body\.page-home #revealJob \.reveal-view\{\s*min-height:44px;/);
  assert.match(STYLES, /\.radius-ring-toggle\{position:static; margin:8px 10px 10px; min-height:44px; padding:8px 12px; font-size:13px;\}/);
});

test('A2: clear lanes keep full-strength text, and the route link pins its ink and reports when it is inactive', () => {
  const WS = read('tools', 'workspace.html');
  assert.match(WS, /\.ops-lane\.is-clear \{ opacity: 0\.72; \}/, 'the clear-lane fade this compensates for');
  assert.match(WS, /\.ops-lane\.is-clear \.ops-lane-header \.ops-lane-label,\s*body\.th-tool-page\[data-th-page="workspace"\] \.ops-lane\.is-clear \.empty-state-small \{ color: var\(--text\); \}/);
  const RP = read('tools', 'route-planner.html');
  assert.match(RP, /#openRouteBtn:visited,\s*body\.th-tool-page\[data-th-page="route-planner"\] #openRouteBtn:hover \{ color: #140900; \}/);
  assert.match(RP, /#routeMapEmpty \{ color: var\(--text-dim\); font-size: 13px; \}/);
  // Every branch that fades the link also marks it aria-disabled, and the
  // one that enables it clears the attribute.
  const adds = RP.match(/btn\.classList\.add\('is-disabled'\);\s*btn\.setAttribute\('aria-disabled', 'true'\);/g) || [];
  const plainAdds = RP.match(/btn\.classList\.add\('is-disabled'\);/g) || [];
  assert.equal(adds.length, 2);
  assert.equal(plainAdds.length, adds.length);
  assert.match(RP, /btn\.classList\.remove\('is-disabled'\);\s*btn\.removeAttribute\('aria-disabled'\);/);
});

test('A3: one focus token pair, defined once for both themes and used by every surface', () => {
  assert.match(STYLES, /--focus-ring:var\(--orange-text\);\s*--focus-halo:rgba\(255,128,0,\.16\);/);
  assert.match(STYLES, /\[data-theme="light"\]\{[\s\S]*?--focus-ring:#994a00;\s*--focus-halo:rgba\(216,95,10,\.14\);/);
  // Base rule: tokens, and the attribute selectors kept at low specificity
  // so components' own focus rules still win.
  assert.match(STYLES, /:where\(\[role="button"\], \[tabindex\]:not\(\[tabindex="-1"\]\)\):focus-visible,[\s\S]{0,120}?\{[\s\S]*?outline:2px solid var\(--focus-ring\);\s*outline-offset:2px;\s*box-shadow:0 0 0 5px var\(--focus-halo\);/);
  assert.doesNotMatch(STYLES, /:focus-visible\{[^}]*outline:2px solid var\(--orange\)[;}]/, 'no one-off plain-orange rings left');
  // Tools: the universal rule uses the tokens and no longer forces 4px corners.
  const toolsBase = TOOLS_CSS.match(/\n:focus-visible \{[^}]*\}/);
  assert.ok(toolsBase);
  assert.match(toolsBase[0], /outline: 2px solid var\(--focus-ring\);/);
  assert.match(toolsBase[0], /box-shadow: 0 0 0 5px var\(--focus-halo\);/);
  assert.doesNotMatch(toolsBase[0].replace(/\/\*[\s\S]*?\*\//g, ''), /border-radius/);
  // Fields: the old :focus rule removes the outline; the :focus-visible
  // twin (same selectors, later) gives keyboard focus the ring back.
  assert.match(TOOLS_CSS, /body select:focus-visible, body textarea:focus-visible \{\s*border-color: var\(--focus-ring\);\s*outline: 2px solid var\(--focus-ring\);\s*outline-offset: 0;/);
  assert.ok(TOOLS_CSS.indexOf('body select:focus-visible, body textarea:focus-visible {') > TOOLS_CSS.indexOf('body select:focus, body textarea:focus {'));
  // Portal.
  assert.match(PORTAL_CSS, /\.portal-page textarea:focus-visible \{[^}]*outline: 2px solid var\(--focus-ring\);/);
  assert.match(PORTAL_CSS, /\.portal-page \.btn\.orange:focus-visible \{ outline-offset: 3px; \}/);
  assert.doesNotMatch(PORTAL_CSS, /:focus-visible \{[^}]*outline: 2px solid var\(--orange(-light)?\)/);
});

test('A4: every town in the key is a focus stop on all 11 pages', () => {
  assert.equal(KEY_PAGES.length, 11);
  for (const f of KEY_PAGES) {
    const key = new JSDOM(read(f)).window.document.querySelector('.radius-key');
    const items = Array.from(key.querySelectorAll('li[data-city]'));
    assert.ok(items.length >= 8, f);
    for (const li of items) assert.equal(li.getAttribute('tabindex'), '0', `${f}: ${li.dataset.city}`);
    assert.match(read(f), /<script src="\/js\/service-area-map\.js\?v=[0-9a-f]+"/, `${f} loads the map script`);
  }
});

test('A4: focusing a town links it on the map and rings its dot; leaving clears it', () => {
  const dom = new JSDOM(read('locations', 'handyman-hurricane-ut.html'), { runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(MAP_JS);
  const doc = w.document;
  const groups = Array.from(doc.querySelectorAll('.radius-figure g[data-city]'));
  for (const g of groups) {
    const node = g.querySelector('.radius-node, .radius-hub');
    const ring = g.querySelector('.radius-focus');
    assert.ok(ring, `${g.dataset.city} has a focus ring`);
    assert.equal(ring.namespaceURI, 'http://www.w3.org/2000/svg');
    assert.equal(ring.getAttribute('cx'), node.getAttribute('cx'));
    assert.equal(Number(ring.getAttribute('r')), Number(node.getAttribute('r')) + 5);
  }
  const li = doc.querySelector('.radius-key li[data-city="leeds"]');
  li.dispatchEvent(new w.FocusEvent('focusin', { bubbles: true }));
  assert.ok(li.classList.contains('is-linked'));
  assert.deepEqual(groups.filter((g) => g.classList.contains('is-linked')).map((g) => g.dataset.city), ['leeds']);
  li.dispatchEvent(new w.FocusEvent('focusout', { bubbles: true }));
  assert.ok(!li.classList.contains('is-linked'));
  assert.equal(groups.filter((g) => g.classList.contains('is-linked')).length, 0);
  // The script is idempotent about its rings.
  w.eval(MAP_JS);
  assert.equal(doc.querySelectorAll('.radius-figure .radius-focus').length, groups.length);
});

test('A4: the linked row and dot styles cover the desktop key selector too', () => {
  assert.match(STYLES, /\.wrap:has\(> \.radius-figure\) > \.radius-key li:focus-visible,\s*\.wrap:has\(> \.radius-figure\) > \.radius-key li\.is-linked\{\s*background:var\(--bg-panel-2\);\s*outline:2px solid var\(--focus-ring\);/);
  assert.match(STYLES, /\.radius-figure \.radius-focus\{fill:none; stroke:var\(--focus-ring\); stroke-width:2; opacity:0; pointer-events:none;\}/);
  assert.match(STYLES, /\.radius-figure g\.is-linked \.radius-focus\{opacity:1;\}/);
  assert.match(STYLES, /\.radius-ring-toggle:focus-visible\{outline:2px solid var\(--focus-ring\); outline-offset:3px;/);
});

test('A5: every field the scan flagged has a label tied to it', () => {
  const FIELDS = {
    'finance.html': ['hours', 'rate', 'parts', 'taxRate'],
    'contract-generator.html': ['pwo_clientName', 'pwo_phone', 'pwo_serviceAddress', 'pwo_contactPicker', 'pwo_email', 'pwo_workOrderDate', 'pwo_description'],
    'route-planner.html': ['tripDistance', 'tripFuelRate', 'tripTaxRate'],
    'runway-dashboard.html': ['settingSavingsPct'],
    'workspace.html': ['secureDocFile', 'secureDocCategory'],
    'parts-reference.html': ['prTypeFilterSelect'],
  };
  for (const [page, ids] of Object.entries(FIELDS)) {
    const doc = new JSDOM(read('tools', page)).window.document;
    for (const id of ids) {
      const field = doc.getElementById(id);
      assert.ok(field, `${page} #${id}`);
      const label = doc.querySelector(`label[for="${id}"]`);
      assert.ok(label, `${page}: label[for=${id}]`);
      assert.ok(label.textContent.trim().length > 2, `${page}: #${id} label has visible text`);
    }
  }
});

test('A5: tool fields are at least 16px on phones only', () => {
  assert.match(TOOLS_CSS, /@media \(max-width: 760px\) \{\s*body\.th-tool-page input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="range"\]\),\s*body\.th-tool-page select,\s*body\.th-tool-page textarea \{ font-size: max\(16px, 1em\); \}\s*\}/);
});

test('portal invoice chart: its focusable bars are not hidden from assistive tech', () => {
  const doc = new JSDOM(read('portal', 'dashboard.html')).window.document;
  const svg = doc.getElementById('invoiceChartSvg');
  assert.equal(svg.getAttribute('aria-hidden'), null);
  assert.equal(svg.getAttribute('role'), 'group');
  assert.equal(svg.getAttribute('aria-label'), 'Invoice history');
  assert.match(read('portal', 'dashboard.html'), /class="invoice-chart-bar-group" tabindex="0" role="button"/);
});
