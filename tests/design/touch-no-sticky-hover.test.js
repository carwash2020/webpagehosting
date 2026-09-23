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

const CSS = fs.readFileSync(path.join(__dirname, '..', '..', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// Walk the stylesheet keeping track of enclosing @media blocks.
function rules() {
  const out = []; const stack = [];
  for (const m of CSS.matchAll(/(@media[^{]+)\{|([^{}]+)\{([^{}]*)\}|\}/g)) {
    if (m[1]) { stack.push(m[1].trim()); continue; }
    if (m[2] !== undefined) { out.push({ sel: m[2].trim().replace(/\s+/g, ' '), body: m[3], media: [...stack] }); continue; }
    stack.pop();
  }
  return out;
}
const ALL = rules();
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
