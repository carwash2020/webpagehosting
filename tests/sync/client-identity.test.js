// Tests for the client-identity unification (2026-09-02). The core
// problem this closed: a client's email could be typed on four
// different forms (Invoice, Quote, Job, Contract), and three of the
// four never wrote it back to the shared client registry -- and
// thEnsureClient() returned early for an already-existing client,
// silently discarding whatever was just learned. Since a client
// almost always DOES already exist by the time you're invoicing them,
// registry.email stayed blank for essentially everyone. That broke
// three things at once: sync-checkup-to-portal (which reads exactly
// that field) could never fire, the same details got re-typed per
// form, and a typo in any one of them silently created a second
// portal identity for one real person.
//
// Uses the same sandbox approach as data-layer.test.js -- its own
// window/localStorage per test, no shared state between tests.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const DATA_LAYER_PATH = path.join(__dirname, '..', '..', 'tools', 'data-layer.js');

function loadLayer(seed) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://example.com/' });
  const { window } = dom;

  // Set these on global as well as passing them in, matching
  // data-layer.test.js's own harness. Passing them as function
  // parameters alone covers direct references, but anything in
  // data-layer.js that reaches a global some other way (or any helper
  // it calls) would otherwise resolve against whatever a previously-run
  // test file happened to leave on global -- which passes locally and
  // fails in CI purely on test ordering and Node version.
  global.window = window;
  global.document = window.document;
  global.localStorage = window.localStorage;

  Object.entries(seed || {}).forEach(([k, v]) => {
    window.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  });

  const src = fs.readFileSync(DATA_LAYER_PATH, 'utf8');
  const exportNames = [
    'thLoadClients', 'thFindClientByName', 'thEnsureClient', 'thAutofillClientFields',
  ];
  const fn = new Function('window', 'document', 'localStorage',
    src + '\nreturn {' + exportNames.join(',') + '};');
  const sandbox = fn(window, window.document, window.localStorage);
  sandbox._document = window.document;
  return sandbox;
}

test('thEnsureClient fills in a detail the existing record was missing, instead of discarding it', () => {
  const L = loadLayer();
  // Created with no email -- the common real case: a job or booking
  // registered this client before anyone had their email.
  const created = L.thEnsureClient('Sarah Miller', { phone: '435-555-0123' });
  assert.equal(created.email, '');

  // Later, an invoice supplies the email for the first time.
  const enriched = L.thEnsureClient('Sarah Miller', { email: 'sarah@example.com' });
  assert.equal(enriched.id, created.id, 'should be the same client, not a second record');
  assert.equal(enriched.email, 'sarah@example.com', 'the newly-learned email should stick');
  assert.equal(enriched.phone, '435-555-0123', 'the existing phone should survive');

  // And it must actually be persisted, not just returned.
  assert.equal(L.thFindClientByName('Sarah Miller').email, 'sarah@example.com',
    'the enrichment must be saved, not in-memory only');
  assert.equal(L.thLoadClients().length, 1, 'must not have created a second record');
});

test('thEnsureClient never overwrites a detail that is already set', () => {
  const L = loadLayer();
  L.thEnsureClient('Sarah Miller', { email: 'correct@example.com' });
  // A differing value is a genuine conflict (a typo? a real change?)
  // and must not be silently resolved by whoever saved last.
  const after = L.thEnsureClient('Sarah Miller', { email: 'typo@example.com' });
  assert.equal(after.email, 'correct@example.com');
});

test('thEnsureClient still matches the same client across name spelling variations', () => {
  const L = loadLayer();
  const a = L.thEnsureClient('Sarah Miller', { email: 'sarah@example.com' });
  const b = L.thEnsureClient('sarah  miller', { phone: '435-555-0123' });
  assert.equal(b.id, a.id, 'normalized name matching should still hold after the enrichment change');
  assert.equal(b.email, 'sarah@example.com');
  assert.equal(b.phone, '435-555-0123');
});

test('thEnsureClient with no extras is still a safe no-op lookup', () => {
  const L = loadLayer();
  const a = L.thEnsureClient('Sarah Miller', { email: 'sarah@example.com' });
  const b = L.thEnsureClient('Sarah Miller');
  assert.equal(b.id, a.id);
  assert.equal(b.email, 'sarah@example.com', 'a bare lookup must not blank out existing details');
});

test('thAutofillClientFields fills blank form fields but never overwrites typed input', () => {
  const L = loadLayer();
  L.thEnsureClient('Sarah Miller', { phone: '435-555-0123', email: 'sarah@example.com', address: '1 Main St' });

  L._document.body.innerHTML = '<input id="e"><input id="p"><input id="a" value="Already Typed">';
  const found = L.thAutofillClientFields('Sarah Miller', { email: 'e', phone: 'p', address: 'a' });

  assert.ok(found, 'should resolve the client');
  assert.equal(L._document.getElementById('e').value, 'sarah@example.com');
  assert.equal(L._document.getElementById('p').value, '435-555-0123');
  assert.equal(L._document.getElementById('a').value, 'Already Typed', 'must not overwrite what the user typed');
});

test('thAutofillClientFields is a no-op for an unknown client', () => {
  const L = loadLayer();
  L._document.body.innerHTML = '<input id="e">';
  const found = L.thAutofillClientFields('Nobody At All', { email: 'e' });
  assert.equal(found, null);
  assert.equal(L._document.getElementById('e').value, '');
});

test('thAutofillClientFields tolerates a form that lacks some of the fields', () => {
  // The Quote tab has no phone field, for instance -- a missing
  // element must not throw and must not stop the others filling.
  const L = loadLayer();
  L.thEnsureClient('Sarah Miller', { phone: '435-555-0123', email: 'sarah@example.com' });
  L._document.body.innerHTML = '<input id="e">';
  L.thAutofillClientFields('Sarah Miller', { email: 'e', phone: 'nonexistent' });
  assert.equal(L._document.getElementById('e').value, 'sarah@example.com');
});

// ---- every form that captures a client email must feed the registry ----

test('all four client-facing forms pass email into thEnsureClient', () => {
  const cases = [
    { file: 'invoice-generator.html', fn: /function logInvoice\(totals\)[\s\S]*?\n  \}\n/, label: 'logInvoice' },
    { file: 'invoice-generator.html', fn: /function logQuote\(totals\)[\s\S]*?\n  \}\n/, label: 'logQuote' },
    { file: 'job-tracker.html', fn: /async function addJob\(\)[\s\S]*?\n  \}\n/, label: 'addJob' },
    { file: 'contract-generator.html', fn: /thEnsureClient\([\s\S]{0,200}/, label: 'contract-generator' },
  ];
  for (const c of cases) {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', c.file), 'utf8');
    const m = src.match(c.fn);
    assert.ok(m, `${c.label}: could not isolate the function`);
    const call = m[0].match(/thEnsureClient\([\s\S]*?\}\)/);
    assert.ok(call, `${c.label}: expected a thEnsureClient call with a details object`);
    assert.match(call[0], /email/, `${c.label} must pass email into the client registry`);
  }
});

test('a booking converted to a job carries the email captured on the public website', () => {
  // booking.email comes from the real public booking form -- it was
  // dropped here until 2026-09-02, forcing a manual re-type later.
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'workspace.html'), 'utf8');
  const fnMatch = src.match(/async function convertBookingToJob\(id\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'convertBookingToJob() not found');
  assert.match(fnMatch[0], /email: booking\.email/, 'should pass the booking email into thEnsureClient');
  assert.match(fnMatch[0], /clientEmail: booking\.email/, 'should store it on the job record too');
});

test('the Invoice, Quote, and Job forms all autofill client details from the registry', () => {
  const invoiceSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'invoice-generator.html'), 'utf8');
  const jobSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'job-tracker.html'), 'utf8');
  // The read side of the unification -- without this, the details are
  // captured but still re-typed by hand on every other form.
  assert.match(invoiceSrc, /thAutofillClientFields\(typedName, \{ email: 'clientEmail'/, 'invoice form');
  assert.match(invoiceSrc, /thAutofillClientFields\(typedName, \{ email: 'quoteClientEmail'/, 'quote form');
  assert.match(jobSrc, /thAutofillClientFields\(typedName, \{ phone: 'jobPhone'/, 'job form');
  // And each must actually be wired to its name field, not just defined.
  assert.match(invoiceSrc, /id="quoteClientName"[^>]*onchange="autofillQuoteClient\(\)"/);
  assert.match(jobSrc, /id="jobClient"[^>]*onchange="autofillJobClient\(\)"/);
});
