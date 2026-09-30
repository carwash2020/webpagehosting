// One client per person in the app's own client list (Connor, 2026-09-30:
// "make sure we can't have duplicates in the future"). thEnsureClient() and
// thBackfillClients() now find an existing client by email first, then name,
// then phone, before creating one. The server side of the same rule is
// sql/item1/04_one_client_per_email.sql (tests/sync/client-one-per-email-db.test.js).
//
// Same sandbox approach as client-identity.test.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const DATA_LAYER_PATH = path.join(__dirname, '..', '..', 'tools', 'data-layer.js');

function loadLayer(seed) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://example.com/' });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.localStorage = window.localStorage;
  Object.entries(seed || {}).forEach(([k, v]) => {
    window.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  });
  const src = fs.readFileSync(DATA_LAYER_PATH, 'utf8');
  const exportNames = ['thLoadClients', 'thEnsureClient', 'thFindExistingClient', 'thCreateClient', 'thBackfillClients'];
  const fn = new Function('window', 'document', 'localStorage', src + '\nreturn {' + exportNames.join(',') + '};');
  return fn(window, window.document, window.localStorage);
}

const SARAH = { id: 'c_sarah', name: 'Sarah Miller', email: 'Sarah@Example.com', phone: '(435) 555-0101', address: '', createdAt: '2026-09-01T00:00:00Z', source: 'created' };

test('the same email under a different name is the existing client, not a new one', () => {
  const L = loadLayer({ th_clients: [SARAH] });
  const r = L.thEnsureClient('Sarah M.', { email: ' sarah@example.com ' });
  assert.equal(r.id, 'c_sarah');
  assert.equal(L.thLoadClients().length, 1);
  assert.deepEqual(L.thFindExistingClient('Sarah M.', { email: 'SARAH@example.com' }).matchedBy, 'email');
});

test('the same phone, in any format and with or without a leading 1, is the existing client', () => {
  const L = loadLayer({ th_clients: [SARAH] });
  for (const phone of ['4355550101', '+1 435.555.0101', '1-435-555-0101']) {
    const r = L.thEnsureClient('S. Miller', { phone });
    assert.equal(r.id, 'c_sarah', phone);
  }
  assert.equal(L.thLoadClients().length, 1);
  assert.equal(L.thFindExistingClient('S. Miller', { phone: '4355550101' }).matchedBy, 'phone');
});

test('email beats name: a typed name that matches someone else still goes to the email owner', () => {
  const L = loadLayer({ th_clients: [SARAH, { id: 'c_bill', name: 'Bill Adams', email: '', phone: '' }] });
  assert.equal(L.thEnsureClient('Bill Adams', { email: 'sarah@example.com' }).id, 'c_sarah');
});

test('short numbers and blanks never match anyone', () => {
  const L = loadLayer({ th_clients: [{ id: 'c_x', name: 'X', email: '', phone: '12345' }] });
  assert.equal(L.thFindExistingClient('Y', { phone: '12345', email: '' }).record, null);
  assert.equal(L.thEnsureClient('Y', { phone: '12345' }).name, 'Y');
  assert.equal(L.thLoadClients().length, 2);
});

test("enrichment never copies another client's email onto this one", () => {
  const L = loadLayer({ th_clients: [SARAH, { id: 'c_bill', name: 'Bill Miller', email: '', phone: '435-555-0199' }] });
  // Bill found by name; the email typed belongs to Sarah, so it stays Sarah's.
  const r = L.thEnsureClient('Bill Miller', { email: 'sarah@example.com' });
  assert.equal(r.id, 'c_sarah', 'the email identifies Sarah, so this is her');
  const bill = L.thLoadClients().find((c) => c.id === 'c_bill');
  assert.equal(bill.email, '', "Bill did not get Sarah's email");
});

test('thCreateClient adds a separate person with the same phone, but never the same email', () => {
  const L = loadLayer({ th_clients: [SARAH] });
  const bill = L.thCreateClient('Bill Miller', { phone: '435-555-0101' });
  assert.ok(bill && bill.id !== 'c_sarah');
  assert.equal(L.thCreateClient('Sarah Two', { email: 'sarah@example.com' }), null);
  assert.equal(L.thLoadClients().length, 2);
});

test('the backfill does not make a second client for a name whose email or phone is already on file', () => {
  const L = loadLayer({
    th_clients: [SARAH],
    th_tracker_jobs: [{ id: 1, client: 'Sarah (kitchen)', phone: '435-555-0101' }],
    th_tracker_contacts: [{ id: 2, name: 'S Miller', email: 'sarah@example.com', phone: '' }],
    th_invoices: [{ id: 3, clientName: 'Brand New Person' }],
  });
  const r = L.thBackfillClients();
  assert.equal(r.created, 1, 'only the genuinely new person');
  assert.deepEqual(L.thLoadClients().map((c) => c.name).sort(), ['Brand New Person', 'Sarah Miller']);
});

test('the backfill does not create two clients for one email found under two names in one run', () => {
  const L = loadLayer({
    th_tracker_contacts: [
      { id: 1, name: 'Pat Jones', email: 'pat@example.com', phone: '' },
      { id: 2, name: 'Patricia Jones', email: 'PAT@example.com', phone: '' },
    ],
  });
  assert.equal(L.thBackfillClients().created, 1);
});
