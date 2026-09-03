// Tests for two things requested directly (2026-09-03): quick-add
// Labor/Mileage line items on invoices and quotes ("we currently have
// no way of adding mileage or labor to the invoice which needs to be
// fixed"), and linking the internal Client Registry to the Portal
// ("link client history and Portal clients together").

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const INVOICE_GEN = fs.readFileSync(repo('tools', 'invoice-generator.html'), 'utf8');
const DEV_TOOLS = fs.readFileSync(repo('tools', 'dev-tools.html'), 'utf8');
const CLIENTS = fs.readFileSync(repo('tools', 'clients.html'), 'utf8');
const DATA_LAYER = fs.readFileSync(repo('tools', 'data-layer.js'), 'utf8');

// ---- Labor / Mileage quick-add ----

test('both invoices and quotes have Add Labor and Add Mileage buttons', () => {
  assert.match(INVOICE_GEN, /onclick="addLaborLineItem\('addLineItem'\)">\+ Add Labor</);
  assert.match(INVOICE_GEN, /onclick="addMileageLineItem\('addLineItem'\)">\+ Add Mileage</);
  assert.match(INVOICE_GEN, /onclick="addLaborLineItem\('addQuoteLineItem'\)">\+ Add Labor</);
  assert.match(INVOICE_GEN, /onclick="addMileageLineItem\('addQuoteLineItem'\)">\+ Add Mileage</);
});

test('Labor defaults to taxable, matching this business\'s own labor-is-taxed setup; Mileage defaults to not taxable', () => {
  const laborFn = INVOICE_GEN.match(/function addLaborLineItem\(addFnName\) \{[\s\S]*?\n  \}\n/);
  const mileageFn = INVOICE_GEN.match(/function addMileageLineItem\(addFnName\) \{[\s\S]*?\n  \}\n/);
  assert.ok(laborFn && mileageFn);
  assert.match(laborFn[0], /window\[addFnName\]\('Labor', '', 1, savedRate, true, true\);/);
  assert.match(mileageFn[0], /window\[addFnName\]\('Mileage', '', 1, savedRate, false, true\);/);
});

test('the last-used rate is remembered per type, not shared between Labor and Mileage', () => {
  assert.match(INVOICE_GEN, /const LABOR_RATE_KEY = 'th_invoice_labor_rate';/);
  assert.match(INVOICE_GEN, /const MILEAGE_RATE_KEY = 'th_invoice_mileage_rate';/);
  const rememberFn = INVOICE_GEN.match(/function rememberLineItemRate\(descValue, priceValue\) \{[\s\S]*?\n  \}\n/);
  assert.ok(rememberFn);
  assert.match(rememberFn[0], /localStorage\.setItem\(LABOR_RATE_KEY/);
  assert.match(rememberFn[0], /localStorage\.setItem\(MILEAGE_RATE_KEY/);
});

test('the remembered rate updates automatically as Connor edits a row, on both the invoice and quote recalc loops', () => {
  const recalcFn = INVOICE_GEN.match(/function recalc\(\) \{[\s\S]*?\n  \}\n/);
  const recalcQuoteFn = INVOICE_GEN.match(/function recalcQuote\(\) \{[\s\S]*?\n    return \{ subtotal, tax, discount, total \};/);
  assert.ok(recalcFn, 'expected to isolate recalc()');
  assert.ok(recalcQuoteFn, 'expected to isolate recalcQuote()');
  assert.match(recalcFn[0], /rememberLineItemRate\(row\.querySelector\('\.li-desc'\)\.value, price\);/);
  assert.match(recalcQuoteFn[0], /rememberLineItemRate\(row\.querySelector\('\.qli-desc'\)\.value, price\);/);
});

test('Labor and Mileage insert a normal editable line item row -- no separate UI, same table Connor already knows', () => {
  const laborFn = INVOICE_GEN.match(/function addLaborLineItem\(addFnName\) \{[\s\S]*?\n  \}\n/);
  assert.doesNotMatch(laborFn[0], /prompt\(|confirm\(|showAlert\(/,
    'should just insert a row, not interrupt with a dialog');
});

// ---- Client Registry <-> Portal link ----

test('each registry client surfaces a best-known email, derived from their invoices rather than stored redundantly', () => {
  const fnMatch = DATA_LAYER.match(/function thGetAllClientsWithTotals\(\) \{[\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate thGetAllClientsWithTotals()');
  const body = fnMatch[0];
  assert.match(body, /i => i\.clientEmail/);
  assert.match(body, /knownEmail: emailedInvoice \? emailedInvoice\.clientEmail : null,/);
});

test('a registry row with a known email links to the Clients tool, pre-filtered to that email', () => {
  const registryFn = DEV_TOOLS.match(/function renderClientRegistry\(\) \{[\s\S]*?\n  \}\n/);
  assert.ok(registryFn, 'expected to isolate renderClientRegistry()');
  const body = registryFn[0];
  assert.match(body, /c\.knownEmail/);
  assert.match(body, /\/tools\/clients\.html\?search=' \+ encodeURIComponent\(c\.knownEmail\)/);
  assert.match(body, /View in Clients/);
});

test('a registry row with no known email shows no dead link', () => {
  const registryFn = DEV_TOOLS.match(/function renderClientRegistry\(\) \{[\s\S]*?\n  \}\n/);
  const body = registryFn[0];
  // The ternary's false branch must render nothing, not a link with an
  // empty or undefined email in it.
  assert.match(body, /c\.knownEmail\s*\n\s*\? '<a class="small-btn"[\s\S]*?\n\s*: ''/);
});

test('the Clients tool reads a ?search= URL param and pre-fills the accounts search on load', () => {
  assert.match(CLIENTS, /const params = new URLSearchParams\(window\.location\.search\);/);
  assert.match(CLIENTS, /document\.getElementById\('portalAccountSearch'\)\.value = searchParam;/);
  // Must be set BEFORE the first render, or the filter would not
  // apply until a second, manual interaction.
  const initMatch = CLIENTS.match(/document\.addEventListener\('DOMContentLoaded', function \(\) \{[\s\S]*?renderPortalAccounts\(\);/);
  assert.ok(initMatch, 'expected to isolate the init sequence up through renderPortalAccounts()');
  const searchIdx = initMatch[0].indexOf('searchParam');
  const renderIdx = initMatch[0].indexOf('renderPortalAccounts();');
  assert.ok(searchIdx !== -1 && searchIdx < renderIdx, 'the search param must be applied before the first render');
});
