// /pay/ (2026-11-04, handoff §3A; approved "Pay an invoice, no account"
// design). Runs the real page in jsdom with guest-pay stubbed: what the
// payer sees for an open, overdue, paid or unknown invoice, and that the
// code is the only thing sent. Stripe itself is not loaded here; the
// browser check in the PR notes covers the mounted card form.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'pay', 'index.html'), 'utf8');
const NOT_FOUND = fs.readFileSync(path.join(ROOT, '404.html'), 'utf8');

const settle = () => new Promise((r) => setTimeout(r, 30));

async function open(search, answers) {
  const calls = [];
  const dom = new JSDOM(PAGE, {
    url: 'https://www.triplehenterprisesllc.biz/pay/' + search,
    runScripts: 'dangerously',
    beforeParse(w) {
      w.fetch = async (url, init) => {
        const body = JSON.parse(init.body);
        calls.push({ url, body, headers: init.headers });
        const a = answers[body.action] || { status: 404, ok: false, error: 'not_found' };
        return { status: a.status || 200, json: async () => a };
      };
      // Stripe.js never loads in jsdom; the page must say so, not hang.
      w.HTMLElement.prototype.focus = function () {};
    },
  });
  await settle();
  return { dom, doc: dom.window.document, calls, w: dom.window };
}

const VIEW = { ok: true, invoice_number: 'INV-2026-1112', invoice_date: '2026-10-28', description: 'Repair fridge', billed_to: 'T. Perides', amount_due: 300, due_date: '2099-11-15', paid: false, paid_at: null };

test('an open invoice: number, amount, due date, what it was for and the initial-and-surname -- nothing else', async () => {
  const { doc, calls } = await open('?c=INV-2026-1112-k7f3qm2xw9', { view: VIEW, pay: { ok: false, error: 'stub' } });
  assert.equal(doc.getElementById('invoiceView').hidden, false);
  assert.equal(doc.getElementById('invoiceKicker').textContent, 'Invoice INV-2026-1112');
  assert.equal(doc.getElementById('amountDue').textContent, '$300.00');
  assert.equal(doc.getElementById('dueLine').textContent, 'Due Nov 15, 2099');
  assert.equal(doc.getElementById('forLine').textContent, 'Repair fridge · Oct 28');
  assert.equal(doc.getElementById('billedTo').textContent, 'T. Perides');
  assert.deepEqual(calls[0].body, { action: 'view', token: 'k7f3qm2xw9' }, 'only the code is sent, never the invoice number as a key');
  assert.match(calls[0].url, /\/functions\/v1\/guest-pay$/);
});

test('an overdue invoice says how overdue, in red, as in the design', async () => {
  const { w } = await open('?c=INV-1-k7f3qm2xw9', { view: { ...VIEW, due_date: '2026-10-30' } });
  const due = w.__thPay.dueText({ ...VIEW, due_date: '2026-10-30' }, new Date('2026-11-03T18:00:00Z'));
  assert.deepEqual({ text: due.text, tone: due.tone }, { text: 'Was due Oct 30 · 4 days overdue', tone: 'is-overdue' });
  assert.equal(w.__thPay.dueText({ ...VIEW, due_date: '2026-11-03' }, new Date('2026-11-03T18:00:00Z')).text, 'Due today');
  assert.equal(w.__thPay.dueText({ ...VIEW, due_date: null }, new Date()).text, '', 'no due date known, no line');
});

test('a paid invoice: "Paid on <date>", $0.00, and no card form', async () => {
  const { doc, calls } = await open('?c=INV-2026-1112-k7f3qm2xw9', { view: { ...VIEW, paid: true, amount_due: 0, paid_at: '2026-11-04T16:00:00Z' } });
  assert.equal(doc.getElementById('dueLine').textContent, 'Paid on Nov 4');
  assert.equal(doc.getElementById('amountDue').textContent, '$0.00');
  assert.equal(doc.getElementById('payArea').hidden, true);
  assert.ok(!calls.some((c) => c.body.action === 'pay'), 'no payment is started for a paid invoice');
});

test('a wrong or missing code: one plain message, and a malformed one never leaves the page', async () => {
  const wrong = await open('?c=INV-1-zzzzzzzzzz', {});
  assert.equal(wrong.doc.getElementById('notFoundView').hidden, false);
  assert.equal(wrong.doc.getElementById('invoiceView').hidden, true);
  const bad = await open('?c=INV-1-<script>', {});
  assert.equal(bad.doc.getElementById('notFoundView').hidden, false);
  assert.equal(bad.calls.length, 0);
  const none = await open('', {});
  assert.equal(none.calls.length, 0);
});

test('a payment that cannot start shows the server\'s reason on the page', async () => {
  const { doc } = await open('?c=INV-1-k7f3qm2xw9', { view: VIEW, pay: { ok: false, already_paying: true, error: 'A payment for this invoice has already gone through or is still processing.' } });
  assert.match(doc.getElementById('payError').textContent, /already gone through/);
});

test('back from a bank step: the thank-you, with the receipt address the payer typed', async () => {
  const { doc } = await open('?c=INV-2026-1112-k7f3qm2xw9&redirect_status=succeeded&receipt=office%40example.com', { view: VIEW });
  assert.equal(doc.getElementById('doneView').hidden, false);
  assert.equal(doc.getElementById('doneLead').textContent, '$300.00 for invoice INV-2026-1112. A receipt is on its way to office@example.com, and Steve has been told.');
});

test('the page loads nothing it does not need: no Supabase SDK, no Workspace or portal scripts, Stripe only from js.stripe.com', () => {
  assert.doesNotMatch(PAGE, /supabase-js/);
  assert.doesNotMatch(PAGE, /<script src="\/(tools|portal)\//);
  assert.match(PAGE, /script-src 'self' 'unsafe-inline' https:\/\/js\.stripe\.com;/);
  assert.match(PAGE, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(PAGE, /<div class="bg-blueprint" aria-hidden="true"><\/div>/, 'the grid background Connor chose for client screens');
  assert.doesNotMatch(PAGE, /sk_live|sk_test|service_role/);
});

test('404.html sends /pay/<number>-<code> to the pay page before it paints', () => {
  const at = NOT_FOUND.indexOf("location.replace('/pay/?c='");
  assert.ok(at > 0 && at < NOT_FOUND.indexOf('<title>'), 'in <head>, ahead of everything else');
  const script = NOT_FOUND.slice(NOT_FOUND.indexOf('<script>') + 8, NOT_FOUND.indexOf('</script>'));
  const go = (pathname) => {
    let to = null;
    new Function('location', script)({ pathname, replace: (u) => { to = u; } });
    return to;
  };
  assert.equal(go('/pay/INV-2026-1112-k7f3qm2xw9'), '/pay/?c=INV-2026-1112-k7f3qm2xw9');
  assert.equal(go('/pay/INV-2026-1112-k7f3qm2xw9/'), '/pay/?c=INV-2026-1112-k7f3qm2xw9');
  assert.equal(go('/pay/INV%2F7-k7f3qm2xw9'), '/pay/?c=INV%2F7-k7f3qm2xw9');
  assert.equal(go('/services/nope.html'), null, 'every other 404 is untouched');
  assert.equal(go('/pay/a/b'), null);
});
