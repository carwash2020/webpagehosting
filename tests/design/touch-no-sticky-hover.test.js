// No sticky hover on touch screens (2026-09-23). A phone applies :hover to
// whatever was last tapped and leaves it there. So a tapped service card
// stayed lifted with a blue border, a tapped review card too (not even a
// link), and in the Call/Book bar a tapped outline button stayed tinted.
// Every hover that changes a surface (transform, box-shadow, border,
// background, filter) now sits behind @media (hover:hover): desktop is
// unchanged, touch gets :active press feedback instead. Text-colour link
// hovers and the desktop nav dropdown opener stay unconditional -- the
// dropdown's :hover is how an iPad in landscape opens it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const CSS = read('styles.css');
// blog.css (the blog index cards, also loaded by 8 service pages) follows
// the same rule since 2026-09-23.
const BLOG = read('blog/blog.css');

// Walk the stylesheet keeping track of enclosing @media blocks.
function rules(css = CSS) {
  const out = []; const stack = [];
  for (const m of css.matchAll(/(@media[^{]+)\{|([^{}]+)\{([^{}]*)\}|\}/g)) {
    if (m[1]) { stack.push(m[1].trim()); continue; }
    if (m[2] !== undefined) { out.push({ sel: m[2].trim().replace(/\s+/g, ' '), body: m[3], media: [...stack] }); continue; }
    stack.pop();
  }
  return out;
}
const ALL = rules();
const BLOG_RULES = rules(BLOG);
const SURFACE = /(^|;)\s*(transform|box-shadow|border(-[a-z]+)?(-color)?|background(-color)?|filter)\s*:/;
const UNGUARDED_OK = [
  /^\.nav-dropdown:hover \.nav-dropdown-menu, \.nav-dropdown:focus-within \.nav-dropdown-menu$/, // opens the menu on iPad
  /^\.nav-dropdown-menu a:hover, \.nav-dropdown-menu a:focus-visible$/, // inside that open menu; tapping navigates
  /^::-webkit-scrollbar-thumb:hover$/, // no touch equivalent
];

test('every surface-changing :hover is behind @media (hover:hover)', () => {
  const bad = ALL.filter((r) => r.sel.includes(':hover') && SURFACE.test(r.body)
    && !r.media.some((m) => /\(hover:\s*hover\)/.test(m))
    && !UNGUARDED_OK.some((re) => re.test(r.sel)));
  assert.deepEqual(bad.map((r) => r.sel), []);
});

test('the scan is not vacuous: the card/chip/button hovers it guards are all present', () => {
  const guarded = ALL.filter((r) => r.media.some((m) => /\(hover:\s*hover\)/.test(m))).map((r) => r.sel);
  for (const sel of ['.btn:hover', '.btn.orange:hover', '.service-card:hover', '.review-card:hover', '.gallery-tile:hover', '.gallery-filter-chip:hover', '.triage-appliance-pill:hover', '.triage-symptom-pill:hover', '.areas-link:hover', '.lightbox-nav:hover', '.hero .btn.outline:hover, .sticky-call .btn.outline:hover']) {
    assert.ok(guarded.includes(sel), `${sel} should be inside @media (hover:hover)`);
  }
});

test('keyboard focus states that shared a rule with :hover stay unconditional', () => {
  const unguarded = ALL.filter((r) => !r.media.length).map((r) => r.sel);
  for (const sel of ['.service-card:focus-visible::after', '.service-card:focus-visible::before', '.areas-link:focus-visible', '.areas-link.is-request:focus-visible']) {
    assert.ok(unguarded.includes(sel), `${sel} should apply without a media query`);
  }
});

test('tappable chips, pills, area links, gallery tiles and the chat bubble get :active press feedback', () => {
  for (const [sel, scale] of [['.gallery-filter-chip', '.97'], ['.triage-appliance-pill', '.97'], ['.triage-symptom-pill', '.97'], ['.areas-link', '.98'], ['.gallery-tile', '.98'], ['.chat-bubble-btn', '.94']]) {
    const r = ALL.find((x) => x.sel === `${sel}:active` && !x.media.length);
    assert.ok(r, `missing ${sel}:active`);
    assert.match(r.body, new RegExp(`transform:scale\\(${scale.replace('.', '\\.')}\\);`));
  }
});

test('blog.css: the blog index cards follow the same rule, and keep their keyboard focus look', () => {
  const bad = BLOG_RULES.filter((r) => r.sel.includes(':hover') && SURFACE.test(r.body) && !r.media.some((m) => /\(hover:\s*hover\)/.test(m)));
  assert.deepEqual(bad.map((r) => r.sel), []);
  const hover = BLOG_RULES.find((r) => r.sel === '.blog-index-item:hover' && r.media.some((m) => /\(hover:\s*hover\)/.test(m)));
  const focus = BLOG_RULES.find((r) => r.sel === '.blog-index-item:focus-visible' && !r.media.length);
  assert.ok(hover && focus, 'expected a guarded :hover rule and an unconditional :focus-visible rule');
  const norm = (b) => b.replace(/\s+/g, ' ').trim();
  assert.equal(norm(hover.body), norm(focus.body), 'hover and keyboard focus should look the same');
  assert.ok(BLOG_RULES.some((r) => r.sel === '.blog-index-item:focus-visible .blog-index-item-title' && !r.media.length));
});

// The apps follow the same rule (2026-09-25, cross-surface X2). The
// Workspace and the portal are mostly used on phones, where a tapped tool
// card, invoice card, date or time stayed lifted/tinted until the next tap
// -- on the booking pickers that read as a second selection. The booking
// pages (own <style> blocks, no styles.css) are scanned too.
// A walker that also tracks @supports/@keyframes blocks, so a nested
// block's closing brace can't pop the wrong @media off the stack.
function appRules(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = []; const stack = [];
  for (const m of css.matchAll(/(@[a-z-]+[^{;]*)\{|([^{}]+)\{([^{}]*)\}|\}/g)) {
    if (m[1]) { stack.push(m[1].trim()); continue; }
    if (m[2] !== undefined) { out.push({ sel: m[2].trim().replace(/\s+/g, ' '), body: m[3], media: [...stack] }); continue; }
    stack.pop();
  }
  return out;
}
const inlineStyle = (f) => { const h = read(f); return h.slice(h.indexOf('<style>') + 7, h.indexOf('</style>')); };
const APP_SHEETS = {
  'tools/styles-tools.css': read('tools/styles-tools.css'),
  'portal/portal-app.css': read('portal/portal-app.css'),
  'portal/portal-polish.css': read('portal/portal-polish.css'),
  'booking.html': inlineStyle('booking.html'),
  'manage-booking.html': inlineStyle('manage-booking.html'),
  'manage-job.html': inlineStyle('manage-job.html'),
  // runway-dashboard.html carries its own copy of the shell CSS (no styles.css).
  'tools/runway-dashboard.html': inlineStyle('tools/runway-dashboard.html'),
};
const APP_OK = [/::-webkit-scrollbar-thumb:hover$/];

for (const [file, css] of Object.entries(APP_SHEETS)) {
  test(`${file}: every surface-changing :hover is behind @media (hover:hover)`, () => {
    const bad = appRules(css).filter((r) => r.sel.includes(':hover') && SURFACE.test(r.body)
      && !r.media.some((m) => /\(hover:\s*hover\)/.test(m))
      && !APP_OK.some((re) => re.test(r.sel)));
    assert.deepEqual(bad.map((r) => r.sel), []);
  });
}

test('the app scan is not vacuous, and focus rings that shared a hover rule stay unconditional', () => {
  const guarded = (file) => appRules(APP_SHEETS[file]).filter((r) => r.media.some((m) => /\(hover:\s*hover\)/.test(m))).map((r) => r.sel);
  const tools = guarded('tools/styles-tools.css');
  for (const sel of ['.tool-card:hover', '.job-card:hover', '.small-btn:hover', '.th-sidebar-link:hover', '.th-row:hover']) assert.ok(tools.includes(sel), sel);
  const polish = guarded('portal/portal-polish.css');
  for (const sel of ['.invoice-card:hover, .job-card:hover, .quote-card:hover, .wo-card:hover, .contract-card:hover', '.date-btn:hover, .slot-btn:hover, .wo-urgency-btn:hover', '.home-card:hover']) assert.ok(polish.includes(sel), sel);
  for (const f of ['booking.html', 'manage-booking.html']) {
    const g = guarded(f);
    assert.ok(g.includes('.date-btn:hover') && g.includes('.slot-btn:hover'), f);
  }
  const unguarded = appRules(APP_SHEETS['tools/styles-tools.css']).filter((r) => !r.media.length).map((r) => r.sel);
  for (const sel of ['.th-more-sheet-link:focus-visible', '.th-create-tile:focus-visible', '.th-hdr-btn:focus-visible', '.th-icon-btn:focus-visible']) assert.ok(unguarded.includes(sel), sel + ' should apply without a media query');
});
