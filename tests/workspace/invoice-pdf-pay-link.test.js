// Handoff 2026-11-03 §3A: the emailed invoice PDF had zero links, zero URLs.
// Approved design (Connor, 2026-11-04): one sentence on the dark "Pay this
// invoice online" card ending in the pay address as a blue, underlined
// link -- clickable on screen, and the full address printed so it still
// works on paper ("The link must survive in the printed PDF, not only as
// a clickable annotation").
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const LAYOUT = fs.readFileSync(path.join(ROOT, 'js', 'pdf-layout.js'), 'utf8');
const INV = fs.readFileSync(path.join(ROOT, 'tools', 'invoice-generator.html'), 'utf8');

function recordingDoc() {
  const ops = [];
  let color = '';
  const doc = {
    ops, internal: { pageSize: { getWidth: () => 612, getHeight: () => 792 } },
    getNumberOfPages: () => 1, setPage() {}, addPage() {},
    splitTextToSize: (t) => [String(t)], getTextWidth: (t) => String(t).length * 4.4,
    text: (t, x, y) => ops.push(['text', String(t), x, y, color]),
    textWithLink: (t, x, y, o) => ops.push(['link', String(t), x, y, color, o && o.url]),
    line: (x1, y1, x2, y2) => ops.push(['line', x1, y1, x2, y2, color]),
    rect: (x, y, w, h) => ops.push(['rect', x, y, w, h]), addImage() {},
    setFont() {}, setFontSize() {}, setFillColor() {}, setLineWidth() {}, setDrawColor() {},
    setTextColor: (...c) => { color = c.join(','); },
  };
  return doc;
}
function draw(cta) {
  const c = { Math, Number, String, Array, Object };
  vm.createContext(c);
  vm.runInContext(LAYOUT + '\nthis.summary = pdfDrawSummary;', c);
  const doc = recordingDoc();
  c.summary(doc, { y: 300, rows: [{ label: 'Subtotal', value: '$279.72' }], total: { label: 'TOTAL DUE', value: '$300.00' }, cta, theme: 'inter' });
  return doc;
}
const URL_TEXT = 'triplehenterprisesllc.biz/pay/INV-2026-1112-k7f3qm2xw9';
const URL = 'https://www.' + URL_TEXT;

test('the pay link is printed as visible text AND is a real link to the same address', () => {
  const doc = draw({ heading: 'Pay this invoice online', lines: ['Pay by card or bank, no account needed, at'], link: { text: URL_TEXT, url: URL } });
  const link = doc.ops.find((op) => op[0] === 'link');
  assert.ok(link, 'a textWithLink call: clickable on screen');
  assert.equal(link[1], URL_TEXT, 'the whole address is the visible text, so a printed copy works');
  assert.equal(link[5], URL);
  assert.equal(link[4], '108,180,255', 'blue (#6cb4ff), readable on the dark card');
  const underline = doc.ops.find((op) => op[0] === 'line' && op[5] === '108,180,255');
  assert.ok(underline, 'and underlined');
});

test('the card widens for a link so the address stays on one line beside the totals', () => {
  const doc = draw({ heading: 'Pay this invoice online', lines: [], link: { text: URL_TEXT, url: URL } });
  const card = doc.ops.find((op) => op[0] === 'rect' && op[1] === 48);
  assert.ok(card[3] > 230, 'wider than the old 230pt card');
  const total = doc.ops.find((op) => op[0] === 'text' && op[1] === '$300.00');
  assert.ok(48 + card[3] < total[2], 'and still clear of the totals column');
});

test('without a link the card is exactly as before (the estimate PDF, an invoice only downloaded)', () => {
  const doc = draw({ heading: 'Approve this estimate', lines: ['Reply or call to approve.'] });
  assert.equal(doc.ops.filter((op) => op[0] === 'link').length, 0);
  const card = doc.ops.find((op) => op[0] === 'rect' && op[1] === 48);
  assert.ok(card[3] <= 230);
});

test('invoice-generator: a sent invoice gets a pay code, prints the link, keeps the code, and hands it to the portal sync', () => {
  assert.match(INV, /function makePayToken\(\)/);
  assert.match(INV, /function payLinkFor\(invoiceNumber, token\)/);
  const gen = INV.slice(INV.indexOf('async function generatePDF('), INV.indexOf('async function generatePDF(') + 20000);
  assert.match(gen, /const payToken = willSend \? makePayToken\(\) : null;/);
  assert.match(gen, /link: payToken \? payLinkFor\(invoiceNumberVal, payToken\) : null/);
  assert.match(gen, /logInvoice\(\{ subtotal, tax, discount, total, payToken \}\)/);
  assert.match(gen, /pay_token: payToken,/);
  assert.doesNotMatch(INV, /via a secure Stripe invoice/, 'the PDF no longer promises a Stripe invoice nobody could open');
});

test('makePayToken: 10 characters from an alphabet without look-alikes, the shape guest-pay accepts', () => {
  const fn = INV.slice(INV.indexOf('function makePayToken()'), INV.indexOf('\n  }\n', INV.indexOf('function makePayToken()')) + 4);
  const ctx = { crypto: globalThis.crypto, Uint8Array };
  vm.createContext(ctx);
  vm.runInContext(fn + ';this.f = makePayToken;', ctx);
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const t = ctx.f();
    assert.match(t, /^[a-hjkmnp-z2-9]{10}$/);
    seen.add(t);
  }
  assert.equal(seen.size, 200);
  const GP = fs.readFileSync(path.join(ROOT, 'edge-functions', 'guest-pay-index.ts'), 'utf8');
  assert.match(GP, /const TOKEN_SHAPE = \/\^\[a-hjkmnp-z2-9\]\{10,40\}\$\/;/);
});

test('the line after the address (secure checkout, phone) sits under the link, inside the card', () => {
  const doc = draw({ heading: 'Pay this invoice online', lines: ['Pay by card or bank, no account needed, at'], link: { text: URL_TEXT, url: URL }, after: ['Secure checkout by Stripe. Questions? Call or text (435) 414-1667.'] });
  const link = doc.ops.find((op) => op[0] === 'link');
  const after = doc.ops.find((op) => op[0] === 'text' && op[1].startsWith('Secure checkout'));
  assert.ok(after[3] > link[3], 'below the address');
  const card = doc.ops.find((op) => op[0] === 'rect' && op[1] === 48);
  assert.ok(after[3] < card[2] + card[4], 'inside the dark card');
});
