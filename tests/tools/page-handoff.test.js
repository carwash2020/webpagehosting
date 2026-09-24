// Page hand-off (2026-09-23). Every tool page is its own document, and the
// cross-document view transition (app-shell-view-transitions.test.js)
// captured the incoming page at its first frame -- before
// tools-nav-pwa.js, deferred behind supabase-js, sync.js and five more,
// had built the shell. Measured in Chromium at 4x CPU throttle: the shell
// arrived 150-220ms after reveal on 15 of 15 navigations, so the old bar
// faded out with nothing under it and the new one popped in. Four fixes,
// covered here:
//   1. styles-tools.css holds the outgoing frame until body.th-tool-page
//      exists, then crossfades (pure CSS, capped, reduced-motion aware).
//   2. tools-nav-pwa.js lights the tapped tab at once and shows a thin
//      loading line if the next page takes more than 150ms.
//   3. workspace.html's "Welcome back" card shows once per person per
//      session, not on every return to Home.
//   4. workspace.html's Today hero and greeting open on skeletons, not on
//      empty cards and a placeholder "Good morning. 0 jobs today".

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM, VirtualConsole } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const read = (f) => fs.readFileSync(path.join(TOOLS, f), 'utf8');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const NAV = read('tools-nav-pwa.js');
const STYLES = stripComments(read('styles-tools.css'));
const RUNWAY = stripComments(read('runway-dashboard.html'));
const WORKSPACE = read('workspace.html');

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function rule(css, selector) {
  const m = css.match(new RegExp(esc(selector) + '\\s*\\{([^}]*)\\}'));
  return m ? m[1] : null;
}

// ---- 1. the hold -----------------------------------------------------------

const WAIT = 'html:has(> head > script[src*="/tools/tools-nav-pwa.js"]):not(:has(body.th-tool-page))';

for (const [name, css] of [['styles-tools.css', STYLES], ['runway-dashboard.html (its own copy)', RUNWAY]]) {
  test(`${name}: until the shell is in, the old frame holds still and the new one stays hidden`, () => {
    assert.match(rule(css, WAIT + '::view-transition-old(root)') || '', /animation:\s*th-vt-hold-wait 1\.2s linear/);
    assert.match(rule(css, WAIT + '::view-transition-new(root)') || '', /animation:\s*th-vt-hidden 1\.2s linear/);
    assert.match(css, /@keyframes th-vt-hold-wait \{ from, to \{ opacity: 1; \} \}/);
    assert.match(css, /@keyframes th-vt-hidden \{ from, to \{ opacity: 0; \} \}/);
  });

  test(`${name}: a shell captured only on the old side stays solid through the crossfade, but only where the new page has one`, () => {
    for (const [cls, vt] of [['.th-bottom-nav', 'th-app-bottomnav'], ['.th-desktop-sidebar', 'th-app-sidebar']]) {
      assert.ok(css.includes(`${WAIT}::view-transition-old(${vt}):only-child`), `hold-phase rule for ${vt}`);
      assert.ok(css.includes(`html:has(${cls})::view-transition-old(${vt}):only-child`), `after-hold rule for ${vt}, keyed on the new page having ${cls}`);
    }
    // The after-hold animation must have a different name from the hold's,
    // so it starts fresh when the hold lets go instead of resuming a timer
    // that has already run past its end.
    const after = css.match(/html:has\(\.th-desktop-sidebar\)::view-transition-old\(th-app-sidebar\):only-child\s*\{([^}]*)\}/)[1];
    assert.match(after, /animation:\s*th-vt-hold \.28s linear/);
    assert.match(css, /@keyframes th-vt-hold \{ from, to \{ opacity: 1; \} \}/);
  });

  test(`${name}: reduced motion keeps the hold (a still frame) and leaves the crossfade instant`, () => {
    const blocks = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?\}\s*)\}/g)].map((m) => m[1]);
    const hold = blocks.find((b) => b.includes(WAIT + '::view-transition-old(root)'));
    assert.ok(hold, 'a reduced-motion block for the hold');
    for (const sel of ['::view-transition-old(root)', '::view-transition-new(root)', '::view-transition-old(th-app-bottomnav):only-child', '::view-transition-old(th-app-sidebar):only-child']) {
      assert.ok(hold.includes(WAIT + sel), sel);
    }
    assert.match(hold, /animation-duration:\s*1\.2s !important/);
    // The existing blanket rule still makes everything else instant.
    assert.ok(blocks.some((b) => /::view-transition-group\(\*\), ::view-transition-old\(\*\), ::view-transition-new\(\*\)\s*\{\s*animation-duration:\s*0\.001ms !important/.test(b)));
  });
}

test('the class the hold waits for is added in the same synchronous pass that builds the shell', () => {
  const start = NAV.indexOf('  function inject() {');
  const body = NAV.slice(start, NAV.indexOf('\n  }\n', start));
  const at = (s) => { const i = body.indexOf(s); assert.ok(i > -1, s); return i; };
  for (const step of ['injectSidebar();', 'injectHeaderActions();', 'document.body.appendChild(nav);']) {
    assert.ok(at("classList.add('th-tool-page')") < at(step), step);
  }
  assert.doesNotMatch(body.slice(0, at('document.body.appendChild(nav);')), /await |setTimeout|requestAnimationFrame|\.then\(/);
  // login.html has no shell but still gets the class, so the hold ends there too.
  assert.ok(at("classList.add('th-tool-page')") < at('if (onLogin) return;'));
});

test('the hold only ever applies to a page that will build the shell: never the portal or the redirect stubs, which load this stylesheet too', () => {
  const REPO = path.join(TOOLS, '..');
  // Every page that loads the stylesheet (and runway, which carries its own copy of the rules), each read once.
  const pages = ['tools', 'portal'].flatMap((dir) => fs.readdirSync(path.join(REPO, dir)).filter((f) => f.endsWith('.html')).map((f) => dir + '/' + f))
    .map((f) => ({ f, html: fs.readFileSync(path.join(REPO, f), 'utf8') }))
    .filter(({ f, html }) => f === 'tools/runway-dashboard.html' || html.includes('/tools/styles-tools.css'));
  let shellPages = 0, others = 0;
  for (const { f, html } of pages) {
    const doc = new JSDOM(html).window.document;
    const loadsShell = /<script src="\/tools\/tools-nav-pwa\.js\?v=[a-z0-9]+" defer><\/script>/.test(html);
    // The real selector from the stylesheet, against the real page.
    assert.equal(doc.documentElement.matches(WAIT), loadsShell, f + (loadsShell ? ' should hold until its shell is in' : ' never gets the class, so must never hold'));
    if (!loadsShell) { others++; continue; }
    shellPages++;
    doc.body.classList.add('th-tool-page');
    assert.equal(doc.documentElement.matches(WAIT), false, f + ': the hold lets go once inject() has run');
  }
  assert.ok(shellPages >= 17, 'every tool page with a shell');
  assert.ok(others >= 9, 'the portal pages and redirect stubs are checked too');
});

// ---- 2. tap feedback and the loading line --------------------------------

const windows = [];
after(() => windows.forEach((w) => w.close())); // clears the 10s give-up timers

function page(pathname) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <nav class="th-bottom-nav">
      <a href="/tools/workspace.html" class="is-active" aria-current="page">Home</a>
      <a href="/tools/job-tracker.html">Jobs</a>
    </nav>
    <a id="hash" href="${pathname}#calendar">Calendar</a>
    <a id="away" href="https://www.google.com/maps">Maps</a>
    <a id="newtab" href="/tools/finance.html" target="_blank">Finance</a>
    <a id="row" href="/tools/job-detail.html?id=7">A job</a>
  </body></html>`, { url: 'https://example.com' + pathname, runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  // Only the hand-off section: the rest of the file builds a real shell,
  // which this markup stands in for.
  const start = NAV.indexOf('// PAGE HAND-OFF (2026-09-23)');
  const end = NAV.indexOf('// ON THE CLOCK (2026-09-23', start);
  dom.window.eval(NAV.slice(start, end));
  windows.push(dom.window);
  return dom.window;
}
const tap = (w, el, init) => el.dispatchEvent(new w.MouseEvent('click', Object.assign({ bubbles: true, cancelable: true, button: 0 }, init)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lit = (w) => [...w.document.querySelectorAll('.th-bottom-nav .is-active')].map((a) => a.textContent);
const slow = (w) => w.document.documentElement.classList.contains('th-nav-slow');
// Back to how the page was before the tap: Home lit, no loading line.
function assertUndone(w) {
  assert.deepEqual(lit(w), ['Home']);
  assert.equal(slow(w), false);
}

test('a tapped tab lights at once; the loading line only appears once the wait passes 150ms', async () => {
  const w = page('/tools/workspace.html');
  tap(w, w.document.querySelector('a[href="/tools/job-tracker.html"]'));
  assert.deepEqual(lit(w), ['Jobs']);
  assert.equal(w.document.querySelector('a[href="/tools/workspace.html"]').getAttribute('aria-current'), 'page', 'aria-current still names the page you are on');
  assert.ok(w.document.getElementById('thNavProgress'), 'the line is in place, hidden');
  assert.equal(slow(w), false);
  await sleep(60);
  assert.equal(slow(w), false, 'a quick hop never shows it');
  await sleep(140);
  assert.equal(slow(w), true);
});

test('links that do not leave the page, or leave the app, get no hand-off', async () => {
  const w = page('/tools/workspace.html');
  tap(w, w.document.getElementById('hash'));
  tap(w, w.document.getElementById('away'));
  tap(w, w.document.getElementById('newtab'));
  tap(w, w.document.querySelector('a[href="/tools/job-tracker.html"]'), { metaKey: true });
  const prevented = w.document.getElementById('row');
  prevented.addEventListener('click', (e) => e.preventDefault());
  tap(w, prevented);
  await sleep(200);
  assertUndone(w);
  assert.equal(w.document.getElementById('thNavProgress'), null);
});

test('a plain link to another tool page (not only the bar) gets the loading line', async () => {
  const w = page('/tools/workspace.html');
  tap(w, w.document.getElementById('row'));
  await sleep(200);
  assert.equal(slow(w), true);
  assert.deepEqual(lit(w), ['Home'], 'no tab to light for a list row');
});

test('coming back through the back/forward cache undoes it', async () => {
  const w = page('/tools/workspace.html');
  tap(w, w.document.querySelector('a[href="/tools/job-tracker.html"]'));
  await sleep(200);
  const e = new w.Event('pageshow');
  Object.defineProperty(e, 'persisted', { value: true });
  w.dispatchEvent(e);
  assertUndone(w);
});

test('answering Stay to a "leave with unsaved changes?" prompt undoes it; a normal leave does not', async () => {
  const w = page('/tools/site-content.html');
  tap(w, w.document.querySelector('a[href="/tools/job-tracker.html"]'));
  const plain = new w.Event('beforeunload', { cancelable: true });
  w.dispatchEvent(plain);
  await sleep(200);
  assert.equal(slow(w), true, 'nothing asked, so the page is still on its way out');

  w.addEventListener('beforeunload', (e) => e.preventDefault()); // site-content.html's own guard, registered after this file runs
  w.dispatchEvent(new w.Event('beforeunload', { cancelable: true }));
  await sleep(10);
  assertUndone(w);
});

test('the loading line: fixed under the status bar, click-through, a still line under reduced motion', () => {
  for (const css of [STYLES, RUNWAY]) {
    const base = rule(css, '.th-nav-progress');
    assert.match(base, /position: fixed; top: max\(env\(safe-area-inset-top, 0px\), 44px\)/, 'the same 44px floor as the header (finance-split.test.js guards every use)');
    assert.match(css, /@media \(min-width: 1024px\) \{ \.th-nav-progress \{ top: 0; \} \}/, 'no notch on a computer: the top edge');
    assert.match(base, /pointer-events: none/);
    assert.match(base, /opacity: 0/);
    assert.match(rule(css, 'html.th-nav-slow .th-nav-progress'), /opacity: 1/);
    assert.match(rule(css, 'html.th-nav-slow .th-nav-progress::after'), /animation: thNavProgress 1\.1s/);
    assert.match(css, /@keyframes thNavProgress \{ from \{ transform: translateX\(-100%\); \} to \{ transform: translateX\(250%\); \} \}/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*html\.th-nav-slow \.th-nav-progress::after \{ animation: none; transform: none; width: 100%;/);
  }
});

// ---- 3. the welcome card -------------------------------------------------

function welcome({ email = 'steve@example.com', storage } = {}) {
  const src = ['const WELCOME_SHOWN_KEY', 'let _welcomeFadeTimeouts', 'function showWelcomeOverlay', 'function renderWelcomeGreeting'].map((head) => {
    const i = WORKSPACE.indexOf(head);
    assert.ok(i > -1, head);
    if (head.startsWith('function')) {
      let depth = 0, j = WORKSPACE.indexOf('{', i);
      for (; j < WORKSPACE.length; j++) { if (WORKSPACE[j] === '{') depth++; else if (WORKSPACE[j] === '}' && --depth === 0) break; }
      return WORKSPACE.slice(i, j + 1);
    }
    return WORKSPACE.slice(i, WORKSPACE.indexOf(';', i) + 1);
  }).join('\n');
  const shown = [];
  const overlay = { style: {}, classList: { add() {}, remove() {} } };
  const ctx = {
    sessionStorage: storage,
    setTimeout: () => 0, clearTimeout: () => {},
    getCurrentUserFirstName: () => 'Steve',
    getCurrentUserEmail: () => ctx.__email,
    getCurrentUserRole: () => null,
    document: { getElementById: (id) => (id === 'welcomeOverlay' ? overlay : { set textContent(t) { shown.push(t); } }) },
    __email: email,
  };
  vm.createContext(ctx);
  vm.runInContext(src + '\nthis.run = renderWelcomeGreeting;', ctx);
  return { ctx, shown };
}
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

test('"Welcome back" shows once per person per session, not on every return to Home', () => {
  const storage = memoryStorage();
  const { ctx, shown } = welcome({ storage });
  ctx.run(); ctx.run(); ctx.run();
  assert.deepEqual(shown, ['Welcome back, Steve']);
  ctx.__email = 'connor@example.com';
  ctx.run();
  assert.equal(shown.length, 2, 'someone else signing in on the same tab is greeted');
});

test('with storage blocked it greets every time, as it did before', () => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const { ctx, shown } = welcome({ storage: blocked });
  ctx.run(); ctx.run();
  assert.equal(shown.length, 2);
});

// ---- 4. skeletons on Home ------------------------------------------------

test('the Today hero and greeting open on the shared skeleton, not on empty cards and a made-up count', () => {
  assert.match(WORKSPACE, /<div class="today-next-job" id="todayNextJob">(<div class="skeleton-line w-\d+"><\/div>){3}<\/div>/);
  assert.match(WORKSPACE, /<div class="today-money" id="todayMoney"><div class="today-money-label">Money Owed<\/div>(<div class="skeleton-line w-100"><\/div>){2}<\/div>/);
  assert.match(WORKSPACE, /<div id="todayRestOfDay"><div class="skeleton-line w-60"><\/div><\/div>/);
  assert.match(WORKSPACE, /<p class="greeting-banner-greeting" id="greetingBannerGreeting"><span class="skeleton-line"><\/span><\/p>/);
  assert.match(WORKSPACE, /<p class="greeting-banner-number" id="greetingBannerNumber"><span class="skeleton-line"><\/span><\/p>/);
  assert.doesNotMatch(WORKSPACE, /id="greetingBannerGreeting">Good morning\.</);
  // Inline in the band, sized to the words that replace it.
  assert.match(WORKSPACE, /\.greeting-banner \.skeleton-line \{ display: inline-block;/);
});

test('nothing can leave those skeletons behind: the first render runs whether the sync succeeds or fails, and rewrites each one', () => {
  assert.match(WORKSPACE, /initSyncOnLoad\(\)\.then\(renderDashboard\)\.catch\(renderDashboard\)/);
  const fn = (name) => {
    const i = WORKSPACE.indexOf('function ' + name + '(');
    let depth = 0, j = WORKSPACE.indexOf('{', i);
    for (; j < WORKSPACE.length; j++) { if (WORKSPACE[j] === '{') depth++; else if (WORKSPACE[j] === '}' && --depth === 0) break; }
    return WORKSPACE.slice(i, j + 1);
  };
  const dash = fn('renderDashboard');
  assert.ok(dash.indexOf('renderGreetingBanner();') > -1 && dash.indexOf('renderTodayHero();') > -1 && dash.indexOf('renderMetrics();') > -1);
  assert.match(fn('renderMetrics'), /renderTodayMoney\(owed\);/);
  // The empty-day branch clears both hero containers too.
  assert.match(fn('renderTodayHero'), /if \(todaysJobs\.length === 0\) \{\s*nextEl\.innerHTML = [^;]+;\s*restEl\.innerHTML = '';/);
  assert.match(fn('renderTodayMoney'), /el\.innerHTML = `/);
  assert.match(fn('renderGreetingBanner'), /greetingBannerGreeting'\)\.textContent =/);
  assert.match(fn('renderGreetingBanner'), /greetingBannerNumber'\)\.textContent = count/);
});
