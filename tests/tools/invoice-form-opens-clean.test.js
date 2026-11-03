// Handoff 2026-11-03 §4F: "+ New invoice" opened showing "Preferred
// Property Management / GE Range/Stove Repair / $0.00" -- read as another
// client's half-finished draft. Two causes, both fixed here:
//   1. Those words were the blank form's own placeholders, written as a
//      realistic client and job, so an empty form looked filled in.
//   2. A half-finished invoice really did stay in the form: leaving the
//      tab and pressing + New invoice showed it again, along with the
//      quote it was converted from (pendingSourceQuoteId), which the next,
//      unrelated invoice would then have marked converted.
// Now: the form opens clean every time, and a draft comes back only from
// an explicit "Resume draft?" prompt that names its time.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const INV = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'invoice-generator.html'), 'utf8');

async function loadPage() {
  const prompts = [];
  const dom = new JSDOM(INV, {
    runScripts: 'dangerously', url: 'https://example.com/tools/invoice-generator.html',
    beforeParse(w) {
      w.requireAuth = () => {};
      w.canManageInvoices = () => true;
      w.localStorage.setItem('th_invoices', '[]');
      w.localStorage.setItem('th_quotes', '[]');
    },
  });
  const w = dom.window;
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  Object.assign(w, {
    escapeHtml: esc, escapeAttr: (s) => esc(s).replace(/"/g, '&quot;'), money: (n) => '$' + (Number(n) || 0).toFixed(2), personDot: () => '',
    showToast: () => {}, haptic: () => {}, scheduleSync: () => {},
    todayDateStrBusinessTz: () => '2026-11-03',
    showUndoToast: (message, onAction, options) => prompts.push({ message, onAction, options: options || {} }),
  });
  await new Promise((r) => (w.document.readyState === 'complete' ? r() : w.addEventListener('load', r)));
  return { w, prompts, $: (id) => w.document.getElementById(id) };
}

function fillDraft(p) {
  p.w.activateGenTab('invoice');
  p.$('clientName').value = 'Tony Perides';
  p.$('clientAddress').value = '12 Main St';
  p.$('jobDescription').value = 'Dryer repair';
  const row = p.w.document.querySelector('#lineItemsBody tr');
  row.querySelector('.li-desc').value = 'Labor';
  row.querySelector('.li-price').value = '120';
  p.w.addLineItem('Belt "OEM"', 'WE12', 2, '15', false, 'part');
  p.w.document.querySelector('.contact-block .contact-email').value = 'tony@example.com';
}

test('the blank form no longer shows a real-looking client and job as its placeholders', () => {
  for (const id of ['clientName', 'jobDescription', 'quoteJobDescription']) {
    const ph = (INV.match(new RegExp('id="' + id + '"[^>]*placeholder="([^"]*)"')) || [])[1];
    assert.ok(ph !== undefined, id + ' keeps a placeholder');
    assert.doesNotMatch(ph, /Preferred Property|GE Range|JB256D/, id + ' placeholder must not read as a real client or job');
  }
});

test('+ New invoice opens clean after a half-finished invoice, and offers the draft back with its time', async () => {
  const p = await loadPage();
  fillDraft(p);
  p.w.activateGenTab('recent');
  p.w.openNewInvoice();
  assert.equal(p.$('tab-invoice').classList.contains('is-active'), true);
  assert.equal(p.$('clientName').value, '');
  assert.equal(p.$('jobDescription').value, '');
  const rows = p.w.document.querySelectorAll('#lineItemsBody tr');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].querySelector('.li-desc').value, '');
  assert.equal(p.w.document.querySelector('.contact-block .contact-email').value, '');
  assert.equal(p.prompts.length, 1, 'one Resume draft? prompt');
  assert.match(p.prompts[0].message, /^Resume draft\?/);
  assert.match(p.prompts[0].message, /Tony Perides/);
  assert.match(p.prompts[0].message, /\d{1,2}:\d{2}/, 'the prompt names the draft time');
  assert.equal(p.prompts[0].options.actionLabel, 'Resume');

  p.prompts[0].onAction();
  assert.equal(p.$('clientName').value, 'Tony Perides');
  assert.equal(p.$('clientAddress').value, '12 Main St');
  assert.equal(p.$('jobDescription').value, 'Dryer repair');
  const items = JSON.parse(JSON.stringify(p.w.getLineItems()));
  assert.deepEqual(items.map((i) => [i.desc, i.part, i.qty, i.price, i.taxable, i.type]),
    [['Labor', '', 1, 120, true, ''], ['Belt "OEM"', 'WE12', 2, 15, false, 'part']]);
  assert.equal(p.w.document.querySelector('.contact-block .contact-email').value, 'tony@example.com');
  p.w.close();
});

test('nothing is stashed and no prompt shows when the form was already blank', async () => {
  const p = await loadPage();
  p.w.openNewInvoice();
  assert.equal(p.prompts.length, 0);
  p.w.close();
});

test('a converted quote does not stay attached to the next, unrelated invoice', async () => {
  const p = await loadPage();
  p.w.eval("pendingSourceQuoteId = 'quote-A';");
  fillDraft(p);
  p.w.activateGenTab('recent');
  p.w.openNewInvoice();
  assert.equal(p.w.eval('pendingSourceQuoteId'), null, 'the clean form is not linked to the old quote');
  p.prompts[0].onAction();
  assert.equal(p.w.eval('pendingSourceQuoteId'), 'quote-A', 'resuming the draft brings its quote link back');
  p.w.close();
});

test('pressing New invoice while already on the form never wipes it', async () => {
  const p = await loadPage();
  fillDraft(p);
  p.w.openNewInvoice();
  assert.equal(p.$('clientName').value, 'Tony Perides');
  assert.equal(p.prompts.length, 0);
  p.w.close();
});

test('every New invoice button goes through openNewInvoice; quote conversion and links keep their prefill', () => {
  assert.match(INV, /<button class="tab-btn" data-tab="invoice" onclick="openNewInvoice\(\)">New invoice<\/button>/);
  assert.match(INV, /class="mn-new-btn" onclick="openNewInvoice\(\)">\+ New invoice<\/button>/);
  assert.match(INV, /onclick="openNewInvoice\(\)">New invoice<\/button><\/div>'/);
  assert.doesNotMatch(INV, /onclick="activateGenTab\('invoice'\)"/);
  assert.doesNotMatch(INV, /onclick=\\?"activateGenTab\(\\?'invoice\\?'\)\\?"/);
  const convert = INV.slice(INV.indexOf('async function convertQuoteToInvoice('));
  assert.match(convert.slice(0, convert.indexOf('\n  }\n')), /activateGenTab\('invoice'\);/);
});

test('showUndoToast takes a custom action label and still defaults to Undo', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'tools-media-sharing.js'), 'utf8');
  const fn = src.slice(src.indexOf('function showUndoToast('));
  assert.match(fn, /options\.actionLabel \|\| 'Undo'/);
});
