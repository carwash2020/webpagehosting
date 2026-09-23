// Workspace rework part 8 (2026-09-23): quick add from anywhere. A client's
// text message -- shared from Android's share sheet (manifest share_target),
// pasted (the Paste button, iPhone's way in), or passed as ?quick= (an
// iPhone Shortcut, a link) -- opens the Create sheet with the message in
// quick add. A long message titles itself from its first real sentence and
// keeps all of itself for the job's notes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const read = (f) => fs.readFileSync(path.join(TOOLS, f), 'utf8');
const NAV = read('tools-nav-pwa.js');
const PALETTE = read('tools-command-palette.js');
const MANIFEST = JSON.parse(read('manifest.json'));

const QA_SRC = NAV.slice(NAV.lastIndexOf('// ----', NAV.indexOf('// QUICK ADD (2026-09-22')));
const ctx = { URLSearchParams, console, Date, Math, JSON, String, Number, Object, localStorage: { getItem: () => null } };
vm.createContext(ctx);
vm.runInContext(QA_SRC + ';this.api = { parse: thParseQuickEntry, href: thQuickEntryHref };', ctx);
const { parse, href } = ctx.api;
const NOW = new Date(2026, 8, 22, 10); // Tuesday
const OPTS = { now: NOW, clients: [{ id: 'c1', name: 'Sarah Miller' }, { id: 'c2', name: 'Tom Nguyen' }] };

test('a client\'s text message: the title is what\'s wrong (not the greeting, not the ask), and who / when / what time still come out', () => {
  const cases = [
    ['Hi, this is Sarah. My kitchen sink is leaking under the cabinet again. Can you come tomorrow around 2?', ['My kitchen sink is leaking under the cabinet again', 'Sarah Miller', '2026-09-23', '2:00 PM']],
    ["Hey it's Tom! Garage door opener stopped working, any chance Friday works?", ['Garage door opener stopped working', 'Tom Nguyen', '2026-09-25', '']],
    ['Can you come look at our water heater? It is making a banging noise every morning. Thanks!', ['Water heater', null, null, '']],
    ['Could you fix the ceiling fan in the bedroom next week? It wobbles a lot.', ['Ceiling fan in the bedroom', null, '2026-09-28', '']],
  ];
  for (const [text, [title, client, date, time]] of cases) {
    const r = parse(text, OPTS);
    assert.deepEqual([r.title, r.client && r.client.name, r.date, r.timeLabel], [title, client, date, time], text);
    assert.equal(r.long, true);
    assert.equal(r.sourceText, text);
  }
  const long = 'My dryer runs but does not heat at all and the clothes come out wet every single time, even on high heat.';
  assert.ok(parse(long, OPTS).title.endsWith('…') && parse(long, OPTS).title.length <= 61, 'a very long sentence is cut at a word');
});

test('the whole message rides along in the job\'s notes, after the time', () => {
  const link = href(parse('Hi, this is Sarah. My kitchen sink is leaking. Can you come tomorrow around 2?', OPTS));
  const notes = new URL('https://x' + link).searchParams.get('notes');
  assert.equal(notes, 'Time: 2:00 PM\nTheir message: “Hi, this is Sarah. My kitchen sink is leaking. Can you come tomorrow around 2?”');
  assert.equal(new URL('https://x' + href(parse('Sink leak for Sarah tomorrow 2pm', OPTS))).searchParams.get('notes'), 'Time: 2:00 PM', 'a short note stays short');
});

test('bare hours after at / around / about are times (1-6 is the afternoon), and week / weekend phrases pick a sensible day', () => {
  const t = (s) => { const r = parse(s, OPTS); return [r.title, r.timeLabel, r.date]; };
  assert.deepEqual(t('fence repair around 4'), ['Fence repair', '4:00 PM', null]);
  assert.deepEqual(t('tile at 9'), ['Tile', '9:00 AM', null]);
  assert.deepEqual(t('fix the 2 doors'), ['Fix the 2 doors', '', null], 'a number that is not after at/around stays in the title');
  assert.deepEqual(t('gutters this weekend'), ['Gutters', '', '2026-09-26']);
  assert.deepEqual(t('deck next weekend'), ['Deck', '', '2026-10-03']);
  assert.deepEqual(t('trim next week'), ['Trim', '', '2026-09-28']);
});

// late: load the shell after the page is ready, the way finance and the job
// list do -- inject() then runs at once, ahead of the rest of the file.
async function page(url, setup, { late = false } = {}) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div class="hub-header"><div class="hub-header-right"></div></div></body></html>', {
    runScripts: 'dangerously', url,
    beforeParse(w) {
      w.localStorage.setItem('th_clients', JSON.stringify([{ id: 'c1', name: 'Sarah Miller' }]));
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      w.Element.prototype.scrollIntoView = function () {};
      if (setup) setup(w);
    },
  });
  const w = dom.window;
  if (late) await new Promise(r => (w.document.readyState === 'complete' ? r() : w.addEventListener('load', r)));
  for (const src of [NAV, PALETTE]) { const s = w.document.createElement('script'); s.textContent = src; w.document.body.appendChild(s); }
  if (!late) w.document.dispatchEvent(new w.Event('DOMContentLoaded')); // the shell injects itself on it
  await new Promise(r => setTimeout(r, 5)); // the URL check waits a tick
  return w;
}

test('a share from Android (share_title / share_text / share_url) opens the Create sheet with the message in quick add, keeps the longer of title and text, and leaves the URL', async () => {
  const w = await page('https://example.com/tools/workspace.html?share_title=Sink%20leaking&share_text=Hi%2C%20this%20is%20Sarah.%20Sink%20leaking%20under%20the%20cabinet.%20Can%20you%20come%20tomorrow%3F&keep=1');
  const sheet = w.document.getElementById('thCreateSheet');
  assert.equal(sheet.hasAttribute('hidden'), false, 'the sheet is open');
  assert.equal(w.document.getElementById('thQuickAdd').value, 'Hi, this is Sarah. Sink leaking under the cabinet. Can you come tomorrow?');
  assert.match(w.document.getElementById('thQuickAddPreview').textContent, /Sink leaking under the cabinet/);
  assert.equal(w.location.search, '?keep=1');
  w.close();
});

test('?quick= does the same from any link, and the home-screen shortcut\'s #quick-add opens it empty', async () => {
  for (const late of [false, true]) {
    const w = await page('https://example.com/tools/job-tracker.html?quick=invoice%20sarah%20%24150%20repair', (win) => { win.canManageInvoices = () => true; }, { late });
    assert.equal(w.document.getElementById('thQuickAdd').value, 'invoice sarah $150 repair', late ? 'shell loaded after the page' : 'shell loaded with the page');
    assert.match(w.document.querySelector('#thQuickAddPreview .th-qa-go').getAttribute('href'), /^\/tools\/invoice-generator\.html\?client=Sarah\+Miller&item=Repair&price=150#invoice$/);
    assert.equal(w.location.search, '');
    w.close();
  }
  // Shared in before the role has loaded: "can't create" first, then the
  // button once th-role-loaded says the account can.
  let allowed = false;
  const w1 = await page('https://example.com/tools/finance.html?quick=invoice%20sarah%20%24150%20repair', (win) => { win.canManageInvoices = () => allowed; }, { late: true });
  assert.equal(w1.document.querySelector('#thQuickAddPreview .th-qa-go'), null);
  assert.match(w1.document.getElementById('thQuickAddPreview').textContent, /can.t create invoices/);
  allowed = true;
  w1.dispatchEvent(new w1.CustomEvent('th-role-loaded', { detail: {} }));
  assert.ok(w1.document.querySelector('#thQuickAddPreview .th-qa-go'), 'the button appears once the role loads');
  w1.close();
  const w2 = await page('https://example.com/tools/workspace.html#quick-add');
  assert.equal(w2.document.getElementById('thCreateSheet').hasAttribute('hidden'), false);
  assert.equal(w2.document.getElementById('thQuickAdd').value, '');
  assert.equal(w2.location.hash, '');
  w2.close();
  const w3 = await page('https://example.com/tools/workspace.html');
  assert.equal(w3.document.getElementById('thCreateSheet').hasAttribute('hidden'), true, 'no params, no sheet');
  w3.close();
});

test('Paste (where the clipboard API exists) drops the copied message into quick add', async () => {
  const w = await page('https://example.com/tools/workspace.html', (win) => {
    Object.defineProperty(win.navigator, 'clipboard', { value: { readText: () => Promise.resolve('  Hey it\'s Sarah, dishwasher leaking again. Friday?  ') }, configurable: true });
  });
  w.openCreateSheet();
  const btn = w.document.getElementById('thQuickAddPaste');
  assert.equal(btn.hidden, false);
  btn.click();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(w.document.getElementById('thQuickAdd').value, "Hey it's Sarah, dishwasher leaking again. Friday?");
  assert.match(w.document.getElementById('thQuickAddPreview').textContent, /Sarah Miller/);
  w.close();
  const w2 = await page('https://example.com/tools/workspace.html');
  assert.equal(w2.document.getElementById('thQuickAddPaste').hidden, true, 'no clipboard API, no button');
  w2.close();
});

test('the manifest makes Triple H a share target and adds a Quick add shortcut', () => {
  assert.deepEqual(MANIFEST.share_target, { action: '/tools/workspace.html', method: 'GET', params: { title: 'share_title', text: 'share_text', url: 'share_url' } });
  const sc = MANIFEST.shortcuts.find(s => s.name === 'Quick add');
  assert.ok(sc && sc.url === '/tools/workspace.html#quick-add');
  assert.ok(MANIFEST.shortcuts.find(s => s.name === 'Calendar'), 'the existing shortcuts stay');
});
