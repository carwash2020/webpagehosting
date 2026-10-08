// A client first seen on a contract gets the contract's phone, address and
// email on their client card (2026-10-01). The contract forms save these as
// phone / serviceAddress / email (contract-generator.html collectFields),
// but the save path and the backfill read clientPhone / clientAddress /
// clientEmail, which no contract has, so those details were always dropped
// (found in the Item 1 inventory, docs/ITEM-1-INVENTORY.md bugs table).
//
// Same sandbox approach as client-identity.test.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const DATA_LAYER = fs.readFileSync(path.join(TOOLS, 'data-layer.js'), 'utf8');
const CONTRACTS = fs.readFileSync(path.join(TOOLS, 'contract-generator.html'), 'utf8');

function loadLayer(seed) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://example.com/' });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.localStorage = window.localStorage;
  Object.entries(seed || {}).forEach(([k, v]) => window.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)));
  const names = ['thLoadClients', 'thEnsureClient', 'thContractClientDetails', 'thBackfillClients'];
  const fn = new Function('window', 'document', 'localStorage', DATA_LAYER + '\nreturn {' + names.join(',') + '};');
  return fn(window, window.document, window.localStorage);
}

// Exactly what collectFields() produces for a Work Order (the live contract
// on 2026-09-30 had this shape).
const WORK_ORDER = {
  clientName: 'Dana Reyes', serviceAddress: '3080 S Bloomington E Street', phone: '(435) 555-0177',
  email: 'dana@example.com', workOrderDate: '2026-10-01', description: 'Washer repair',
  laborPrice: '300', partsPrice: '90', totalPrice: '398.88',
};

test('every contract form saves phone, serviceAddress and email: the keys the helper reads', () => {
  const lists = CONTRACTS.match(/pwo: \[[^\]]*\],\s*stpa: \[[^\]]*\],\s*ltsa: \[[^\]]*\]/);
  assert.ok(lists, 'found the per-type field lists');
  for (const type of ['pwo', 'stpa', 'ltsa']) {
    const list = lists[0].match(new RegExp(type + ": \\[([^\\]]*)\\]"))[1];
    for (const key of ['clientName', 'serviceAddress', 'phone', 'email']) {
      assert.match(list, new RegExp("'" + key + "'"), type + ' saves ' + key);
    }
  }
});

test('thContractClientDetails reads the real keys', () => {
  const L = loadLayer();
  assert.deepEqual(L.thContractClientDetails(WORK_ORDER),
    { phone: '(435) 555-0177', address: '3080 S Bloomington E Street', email: 'dana@example.com' });
  assert.deepEqual(L.thContractClientDetails(undefined), { phone: '', address: '', email: '' });
  // The old names still work as a fallback.
  assert.deepEqual(L.thContractClientDetails({ clientPhone: '1', clientAddress: '2', clientEmail: '3' }),
    { phone: '1', address: '2', email: '3' });
});

test('saving a contract for a new client creates their card with phone, address and email', () => {
  const L = loadLayer();
  const c = L.thEnsureClient(WORK_ORDER.clientName, L.thContractClientDetails(WORK_ORDER));
  assert.equal(c.phone, '(435) 555-0177');
  assert.equal(c.address, '3080 S Bloomington E Street');
  assert.equal(c.email, 'dana@example.com');
});

test("saving a contract fills an existing client's blank details, never overwriting", () => {
  const L = loadLayer({ th_clients: [{ id: 'c_dana', name: 'Dana Reyes', phone: '435-555-0100', email: '', address: '' }] });
  const c = L.thEnsureClient(WORK_ORDER.clientName, L.thContractClientDetails(WORK_ORDER));
  assert.equal(c.id, 'c_dana');
  assert.equal(c.phone, '435-555-0100', 'existing phone kept');
  assert.equal(c.address, '3080 S Bloomington E Street', 'blank address filled');
  assert.equal(c.email, 'dana@example.com', 'blank email filled');
});

test('the backfill picks up a contract-only client with their contract details', () => {
  const L = loadLayer({ th_contracts: [{ id: 1, type: 'pwo', fields: WORK_ORDER }] });
  assert.equal(L.thBackfillClients().created, 1);
  const [c] = L.thLoadClients();
  assert.deepEqual([c.name, c.phone, c.address, c.email],
    ['Dana Reyes', '(435) 555-0177', '3080 S Bloomington E Street', 'dana@example.com']);
});
