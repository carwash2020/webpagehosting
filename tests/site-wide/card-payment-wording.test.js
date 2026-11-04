// Card payment wording (2026-11-04, Phase 3.4 decision 9): the public FAQ
// and Terms said cards were paid "via a secure Stripe invoice", which no
// longer matches how cards are taken -- in person (Charge a card) or online
// through the invoice's pay link. The static copies (the fallback text and
// the FAQPage JSON-LD Google reads) are fixed here; the live rows are a
// prepared, not-yet-applied SQL change (sql/site-content/).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const NEW_FAQ = 'Cash, check, Venmo, and Cash App are all accepted, along with credit and debit cards: in person when the job is done, or online through the secure pay link on your invoice. Card payments are processed by Stripe.';

function htmlFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'tests', 'docs', '.git', 'backups'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...htmlFiles(p));
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

test('no public page says cards are paid "via a secure Stripe invoice" any more', () => {
  const stale = htmlFiles(ROOT).filter((p) => fs.readFileSync(p, 'utf8').includes('via a secure Stripe invoice'));
  assert.deepEqual(stale.map((p) => path.relative(ROOT, p)), []);
});

test('every page with the payment FAQ says the same new thing in its visible answer and its FAQPage JSON-LD', () => {
  const pages = htmlFiles(ROOT).filter((p) => fs.readFileSync(p, 'utf8').includes('Cash, check, Venmo, and Cash App are all accepted'));
  assert.ok(pages.length >= 16, 'sanity: the FAQ is on the home, about, service and city pages');
  for (const p of pages) {
    const src = fs.readFileSync(p, 'utf8');
    assert.ok(src.includes('"text": "' + NEW_FAQ + '"'), path.relative(ROOT, p) + ': JSON-LD');
    assert.ok(src.includes('<p>' + NEW_FAQ + '</p>'), path.relative(ROOT, p) + ': visible answer');
  }
});

test('the live FAQ and Terms rows get the same text from a prepared SQL file that is marked not applied and only touches the old text', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'sql', 'site-content', '2026-11-04_card_payment_wording.sql'), 'utf8');
  assert.match(sql, /NOT APPLIED/);
  assert.ok(sql.includes("set answer = '" + NEW_FAQ + "'"));
  assert.match(sql, /where id = 5\s+and answer = 'Cash, check, Venmo, and Cash App are all accepted, along with credit and debit cards via a secure Stripe invoice\.';/);
  assert.match(sql, /where id = 4\s+and body = 'Payment is due upon completion[^']*\(via a secure Stripe invoice\) are accepted\.';/);
  const terms = fs.readFileSync(path.join(ROOT, 'terms.html'), 'utf8');
  assert.match(terms, /credit or debit cards \(in person, or online through the secure pay link on your invoice; card payments are processed by Stripe\) are accepted\./);
});

test('the Jobs page\'s browser title says Jobs, like the nav (Phase 3.4 decision 10)', () => {
  const jt = fs.readFileSync(path.join(ROOT, 'tools', 'job-tracker.html'), 'utf8');
  assert.match(jt, /<title>Jobs \| Triple H Enterprises \(Internal Tool\)<\/title>/);
});
