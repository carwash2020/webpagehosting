// Finance's "First-time client — apply discount" check (2026-10-01). It
// compared the typed name to job names exactly (just lowercased), so a
// returning client typed with extra spaces, or whose earlier work was saved
// under another spelling but linked to the same client card, read as new
// and got the discount box ticked (found in the Item 1 inventory). It now
// goes through thClientHistory() in tools/data-layer.js.
//
// Runs the real data-layer.js and finance.html's real checkClientHistory()
// in jsdom.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const DATA_LAYER = fs.readFileSync(path.join(TOOLS, 'data-layer.js'), 'utf8');
const FINANCE = fs.readFileSync(path.join(TOOLS, 'finance.html'), 'utf8');
const CHECK = FINANCE.match(/  function checkClientHistory\(\) \{[\s\S]*?\n  \}\n/)[0];

const CLIENTS = [
  { id: 'c_sarah', name: 'Sarah Miller', email: '', phone: '' },
  { id: 'c_bill', name: 'Bill Adams', email: '', phone: '' },
  { id: 'c_lead', name: 'Nina Lead', email: '', phone: '' }, // on file, never had work done
];
const JOBS = [
  { id: 1, title: 'Washer', client: 'Sarah Miller', clientId: 'c_sarah' },
  { id: 2, title: 'Dryer', client: 'S. Miller (rental)', clientId: 'c_sarah' }, // other spelling, same card
];
const INVOICES = [
  { id: 10, clientName: 'Bill Adams', total: 100 }, // invoice only, no job
];

function load(seed = { th_clients: CLIENTS, th_tracker_jobs: JOBS, th_invoices: INVOICES }) {
  const dom = new JSDOM(`<!doctype html><body>
    <input id="costClientName"><p id="clientHistoryNote"></p><input type="checkbox" id="firstTimeClient">
  </body>`, { url: 'https://example.com/tools/finance.html', runScripts: 'outside-only' });
  const w = dom.window;
  Object.entries(seed).forEach(([k, v]) => w.localStorage.setItem(k, JSON.stringify(v)));
  w.calculateCost = () => {};
  w.eval(DATA_LAYER + '\n' + CHECK + '\nwindow.__f = { thClientHistory, checkClientHistory };');
  const check = (typed) => {
    w.document.getElementById('firstTimeClient').checked = false;
    w.document.getElementById('costClientName').value = typed;
    w.__f.checkClientHistory();
    return { firstTime: w.document.getElementById('firstTimeClient').checked, note: w.document.getElementById('clientHistoryNote').textContent };
  };
  return { w, h: w.__f.thClientHistory, check };
}

test('extra spaces or capitals no longer make a returning client look new', () => {
  const { check } = load();
  for (const typed of ['Sarah Miller', '  sarah   MILLER ', 'SARAH MILLER']) {
    const r = check(typed);
    assert.equal(r.firstTime, false, typed);
    assert.match(r.note, /Returning client \(Sarah Miller\) — 2 prior jobs found\./, typed);
  }
});

test("jobs saved under another spelling but linked to the same client card count", () => {
  const { h } = load();
  const r = h('Sarah Miller');
  assert.equal(r.jobs, 2, 'both jobs, including "S. Miller (rental)"');
  assert.equal(r.client.id, 'c_sarah');
});

test('an invoice with no job still makes them a returning client', () => {
  const { check } = load();
  const r = check('bill adams');
  assert.equal(r.firstTime, false);
  assert.match(r.note, /1 invoice found/);
});

test('a client card with no work done yet is still a first-time client', () => {
  const { check } = load();
  const r = check('Nina Lead');
  assert.equal(r.firstTime, true);
  assert.match(r.note, /No prior jobs or invoices found/);
});

test('a name that only resembles someone on file gets a hint, and the box stays ticked', () => {
  const { check, h } = load();
  const r = check('sarah m');
  assert.equal(r.firstTime, true, 'a hint, not a decision');
  assert.match(r.note, /Sarah Miller is on file\. If that's the same person, uncheck the first-time box below\./);
  assert.deepEqual(Array.from(h('miller').similar), ['Sarah Miller']);
  assert.deepEqual(Array.from(h('Brand New Person').similar), []);
});

test('a genuinely new name is a first-time client with no hint', () => {
  const { check } = load();
  const r = check('Brand New Person');
  assert.equal(r.firstTime, true);
  assert.match(r.note, /No prior jobs or invoices found for this name/);
});

test('an empty name clears the note and changes nothing', () => {
  const { w, check } = load();
  const r = check('   ');
  assert.equal(r.note, '');
  assert.equal(w.document.getElementById('firstTimeClient').checked, false);
});

test('works with no data on the device at all', () => {
  const { check } = load({});
  assert.equal(check('Anyone').firstTime, true);
});
