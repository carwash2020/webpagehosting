// Returning-client check, thClientHistory() in tools/data-layer.js
// (2026-10-01). It used to compare a typed name to job names exactly (just
// lowercased), so a returning client typed with extra spaces, or whose
// earlier work was saved under another spelling but linked to the same
// client card, read as new (found in the Item 1 inventory).
//
// Finance's Cost Lookup tab, whose "First-time client" box was this
// function's only caller (checkClientHistory()), left in the redundancy
// pass (2026-10-31). The data-layer function stays, so these run it
// directly in jsdom against the same fixtures -- the matching rules it
// carries are unchanged.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const DATA_LAYER = fs.readFileSync(path.join(TOOLS, 'data-layer.js'), 'utf8');
const FINANCE = fs.readFileSync(path.join(TOOLS, 'finance.html'), 'utf8');

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
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.com/tools/finance.html', runScripts: 'outside-only' });
  const w = dom.window;
  Object.entries(seed).forEach(([k, v]) => w.localStorage.setItem(k, JSON.stringify(v)));
  w.eval(DATA_LAYER + '\nwindow.__h = thClientHistory;');
  return { w, h: w.__h };
}

test('the Cost Lookup "First-time client" box left Finance with its tab (2026-10-31); thClientHistory() stays in the data layer', () => {
  assert.doesNotMatch(FINANCE, /function checkClientHistory\(\)|id="firstTimeClient"/);
  assert.match(DATA_LAYER, /function thClientHistory\(/);
});

test('extra spaces or capitals no longer make a returning client look new', () => {
  const { h } = load();
  for (const typed of ['Sarah Miller', '  sarah   MILLER ', 'SARAH MILLER']) {
    const r = h(typed);
    assert.equal(r.returning, true, typed);
    assert.equal(r.jobs, 2, typed);
    assert.equal(r.client.name, 'Sarah Miller', typed);
  }
});

test("jobs saved under another spelling but linked to the same client card count", () => {
  const { h } = load();
  const r = h('Sarah Miller');
  assert.equal(r.jobs, 2, 'both jobs, including "S. Miller (rental)"');
  assert.equal(r.client.id, 'c_sarah');
});

test('an invoice with no job still makes them a returning client', () => {
  const { h } = load();
  const r = h('bill adams');
  assert.equal(r.returning, true);
  assert.equal(r.invoices, 1);
});

test('a client card with no work done yet is still a first-time client', () => {
  const { h } = load();
  assert.equal(h('Nina Lead').returning, false);
});

test('a name that only resembles someone on file is a hint (similar), not a returning client', () => {
  const { h } = load();
  const r = h('sarah m');
  assert.equal(r.returning, false, 'a hint, not a decision');
  assert.ok(Array.from(r.similar).includes('Sarah Miller'));
  assert.deepEqual(Array.from(h('miller').similar), ['Sarah Miller']);
  assert.deepEqual(Array.from(h('Brand New Person').similar), []);
});

test('a genuinely new name is a first-time client with no hint', () => {
  const { h } = load();
  const r = h('Brand New Person');
  assert.equal(r.returning, false);
  assert.deepEqual(Array.from(r.similar), []);
});

test('works with no data on the device at all', () => {
  const { h } = load({});
  assert.equal(h('Anyone').returning, false);
});
