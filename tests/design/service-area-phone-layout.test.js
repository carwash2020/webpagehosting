// The service-area diagram's phone layout (2026-09-25). The SVG has a
// 760-unit viewBox, so on a phone every label shrank with it: 8.2px at
// 375px, 6.8px at 320px. The old <=760px block raised the font sizes,
// but the labels sit in fixed SVG units, so at 19px ten of them
// collided at every width up to 760 (and a cascade slip meant the notes
// got 19px, not the 16px that block asked for). Hiding the notes wasn't
// an option either: 11 pages show the diagram without the .areas-links
// cards that repeat them.
//
// So at <=760px the SVG keeps only its drawing, zoomed 1.5x around St.
// George, plus the hub's name. The labels move into real HTML text:
// a .radius-key list on the 11 pages without .areas-links, and the
// .areas-links cards on the 6 pages with them. The browser measurements
// behind this (16px+ everywhere, no collisions at 320/375/390) are in
// the PR and docs/specialist-logs/visual.md; these checks keep the
// pieces from drifting apart.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');

const PAGES = ['index.html',
  ...fs.readdirSync(repo('locations')).filter((f) => f.endsWith('.html')).map((f) => `locations/${f}`),
  ...fs.readdirSync(repo('services')).filter((f) => f.endsWith('.html')).map((f) => `services/${f}`)]
  .map((page) => ({ page, html: fs.readFileSync(repo(page), 'utf8') }))
  .filter(({ html }) => html.includes('class="radius-figure'));

const PHONE_WIDTHS = [320, 375, 390];
// .wrap's side padding: the SVG is (viewport - 48px) wide on a phone.
const GUTTER = 48;
const VIEWBOX_W = 760;
const VIEWBOX_H = 480;

// The body of the first `@media (max-width:760px){` block that contains `marker`.
function phoneBlock(marker) {
  let from = 0;
  for (;;) {
    const start = STYLES.indexOf('@media (max-width:760px){', from);
    assert.ok(start !== -1, `no <=760px block contains ${marker}`);
    let depth = 0;
    let i = STYLES.indexOf('{', start);
    const open = i;
    for (; i < STYLES.length; i++) {
      if (STYLES[i] === '{') depth++;
      else if (STYLES[i] === '}' && --depth === 0) break;
    }
    const body = STYLES.slice(open + 1, i);
    if (body.includes(marker)) return { body, start };
    from = i;
  }
}

function rule(css, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|[}\\s])${esc}\\{([^}]*)\\}`));
  assert.ok(m, `expected a rule for ${selector}`);
  return m[1];
}
const px = (decls, prop) => Number(decls.match(new RegExp(`(?:^|;|\\s)${prop}:([\\d.]+)px`))[1]);

test('the diagram count is what the fix was sized for: 17 pages, 11 of them without .areas-links', () => {
  assert.equal(PAGES.length, 17);
  assert.equal(PAGES.filter(({ html }) => !html.includes('class="areas-links')).length, 11);
});

test('the old font-size patch is gone, and with it the cascade slip', () => {
  const { body } = phoneBlock('.radius-key');
  assert.doesNotMatch(body, /\.radius-figure text\{font-size/);
  assert.doesNotMatch(STYLES, /\.radius-figure text\{font-size:19px;\}/);
  assert.match(rule(body, '.radius-figure text'), /display:none/);
});

test('on a phone the only SVG text left, the hub name, renders at 16px or more', () => {
  const { body } = phoneBlock('.radius-key');
  const group = rule(body, '.radius-figure g[data-city]');
  const scale = Number(group.match(/scale\(([\d.]+)\)/)[1]);
  const hub = rule(body, '.radius-figure .radius-hub-name');
  assert.match(hub, /display:inline/);
  const fontSize = px(hub, 'font-size');
  const maxW = px(rule(body, '.radius-figure svg'), 'max-width');
  for (const w of PHONE_WIDTHS) {
    const svgW = Math.min(w - GUTTER, maxW);
    const rendered = fontSize * scale * (svgW / VIEWBOX_W);
    assert.ok(rendered >= 16, `hub name renders at ${rendered.toFixed(1)}px at ${w}px`);
  }
});

test('the key is hidden on desktop, shown on phones, and its text is 16px or more', () => {
  assert.match(STYLES, /\.radius-key\{display:none;\}/);
  const { body, start } = phoneBlock('.radius-key');
  assert.ok(STYLES.indexOf('.radius-key{display:none;}') < start, 'the desktop display:none must come before the phone block');
  assert.match(rule(body, '.radius-key'), /display:grid/);
  assert.ok(px(rule(body, '.radius-key b'), 'font-size') >= 16);
  assert.ok(px(rule(body, '.radius-key small'), 'font-size') >= 16);
});

test('the .areas-links cards get the same 16px floor, and win the cascade', () => {
  const { body, start } = phoneBlock('.areas-link small');
  assert.ok(px(rule(body, '.areas-link b'), 'font-size') >= 16);
  assert.ok(px(rule(body, '.areas-link small'), 'font-size') >= 16);
  // Same specificity as the base rules, so it has to come after them.
  assert.ok(start > STYLES.indexOf('.areas-link small{'), 'the phone .areas-link sizes must come after the base rule');
});

function svgGroups(html) {
  const figStart = html.indexOf('class="radius-figure');
  const svg = html.slice(figStart, html.indexOf('</svg>', figStart));
  const groups = {};
  for (const m of svg.matchAll(/<g data-city="([a-z-]+)"([^>]*)>([\s\S]*?)<\/g>/g)) {
    const [, city, attrs, body] = m;
    const circle = body.match(/<circle class="radius-(node|hub)[^"]*" cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/);
    groups[city] = {
      name: body.match(/<text class="radius-(?:hub-)?name[^"]*"[^>]*>([^<]*)<\/text>/)[1],
      note: body.match(/<text class="radius-note"[^>]*>([^<]*)<\/text>/)[1],
      isRequest: /is-request/.test(attrs),
      isHub: /is-hub/.test(attrs),
      cx: Number(circle[2]), cy: Number(circle[3]), r: Number(circle[4]),
    };
  }
  return groups;
}

for (const { page, html } of PAGES) {
  test(`${page}: a phone still gets every city's name and note as real text`, () => {
    if (html.includes('class="areas-links')) {
      assert.doesNotMatch(html, /class="radius-key/, 'a page with .areas-links does not need the key too');
      return;
    }
    const key = html.match(/<ul class="radius-key"[^>]*>([\s\S]*?)<\/ul>/);
    assert.ok(key, 'expected a .radius-key after the diagram');
    assert.ok(html.indexOf('<ul class="radius-key"') > html.indexOf('class="radius-figure'), 'the key follows the figure (the data-focus rules use ~)');
    const rows = [...key[1].matchAll(/<li(?: class="([^"]*)")? data-city="([a-z-]+)"><b>([^<]*)<\/b> <small>([^<]*)<\/small><\/li>/g)];
    const groups = svgGroups(html);
    assert.deepEqual(rows.map((r) => r[2]).sort(), Object.keys(groups).sort(), 'the key and the SVG list the same cities');
    for (const [, cls = '', city, name, note] of rows) {
      const g = groups[city];
      assert.equal(name.toLowerCase(), g.name.toLowerCase(), `${city}: name matches the SVG`);
      assert.equal(note, g.note, `${city}: note matches the SVG`);
      assert.equal(/is-request/.test(cls), g.isRequest, `${city}: by-request styling matches the SVG`);
      assert.equal(/is-hub/.test(cls), g.isHub, `${city}: hub styling matches the SVG`);
    }
    const focus = html.match(/class="radius-figure"[^>]*data-focus="([a-z-]+)"/);
    if (focus) {
      assert.ok(rows.some((r) => r[2] === focus[1]), `the focused city (${focus[1]}) has a row`);
      assert.match(STYLES, new RegExp(`\\.radius-figure\\[data-focus="${focus[1]}"\\]\\s+~ \\.radius-key li\\[data-city="${focus[1]}"\\]`));
    }
  });

  test(`${page}: every node still fits inside the SVG once the phone zoom is applied`, () => {
    const { body } = phoneBlock('.radius-key');
    const group = rule(body, '.radius-figure g[data-city]');
    const [ox, oy] = group.match(/transform-origin:([\d.]+)px ([\d.]+)px/).slice(1).map(Number);
    const dy = Number(group.match(/translateY\(([\d.]+)px\)/)[1]);
    const s = Number(group.match(/scale\(([\d.]+)\)/)[1]);
    for (const [city, g] of Object.entries(svgGroups(html))) {
      // Focused nodes grow (r:9, the hub r:13), so allow for that.
      const r = (g.isHub ? 13 : 9) * s;
      const x = ox + s * (g.cx - ox);
      const y = oy + dy + s * (g.cy - oy);
      assert.ok(x - r >= 0 && x + r <= VIEWBOX_W && y - r >= 0 && y + r <= VIEWBOX_H,
        `${city} lands at (${x.toFixed(0)}, ${y.toFixed(0)}) and would be clipped on a phone`);
    }
  });
}
