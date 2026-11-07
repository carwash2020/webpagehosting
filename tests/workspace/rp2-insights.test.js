// Fix plan Group 4, RP2 (2026-11-06): where a lead came from, said the same
// way everywhere, and the money behind it written in whole cents. Runs the
// real code from the pages (made-up records only).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const read = (...p) => fs.readFileSync(repo(...p), 'utf8');
const fnSrc = (src, name, prefix = '') => {
  const start = src.indexOf(prefix + 'function ' + name + '(');
  assert.ok(start >= 0, name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } } }
  return src.slice(start, i);
};

function dl() {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.com/tools/', runScripts: 'outside-only' });
  dom.window.eval(read('tools', 'data-layer.js') + ';Object.assign(window, { thChannelLabel });');
  return dom.window;
}

test('RP2.5: "Who referred you?" answered with Google or Facebook is not a referral; a real name or a referral code is', () => {
  const w = dl();
  const L = (r) => w.thChannelLabel(r);
  assert.equal(L({ referred_by: 'Google' }), 'Not known');
  assert.equal(L({ referred_by: 'google  search', source: 'Google Search' }), 'Google search');
  assert.equal(L({ referred_by: 'Facebook', utm_source: 'facebook', utm_medium: 'paid', utm_campaign: 'spring-tuneup' }), 'spring-tuneup', 'the campaign is no longer lost');
  assert.equal(L({ referred_by: 'yelp reviews', source: 'Yelp / Online Reviews' }), 'Yelp / Online Reviews');
  assert.equal(L({ referred_by: 'Pat Neighbor' }), 'Referral');
  assert.equal(L({ referred_by: 'Googleman Pat' }), 'Referral', 'only the whole answer counts as a site name');
  assert.equal(L({ referred_by: 'Pat Neighbor', referred_by_code: 'PAT123' }), 'Referral');
  assert.equal(L({ referred_by: 'Google', referred_by_code: 'PAT123' }), 'Referral', 'a referral code always counts');
  assert.equal(L({ source: 'Referral (friend or family)' }), 'Referral');
  assert.equal(L({ referredBy: 'Nextdoor' }), 'Not known', 'a job (camelCase) reads the same');
});

test('RP2.11: the same names the website card uses for direct visits and Google search', () => {
  const w = dl();
  const L = (r) => w.thChannelLabel(r);
  assert.equal(L({ utm_source: '(direct)' }), 'Direct');
  assert.equal(L({ utm_source: 'google', utm_medium: 'organic' }), 'Google search');
  assert.equal(L({ utm_source: 'Google', utm_medium: 'Organic' }), 'Google search');
  assert.equal(L({ utm_source: 'google', utm_medium: 'cpc' }), 'Google Ads');
  assert.equal(L({ utm_source: 'google', utm_medium: 'organic', utm_campaign: 'spring' }), 'spring', 'a campaign is still its own row');
  const ga = read('edge-functions', 'ga4-report-index.ts');
  assert.match(ga, /if \(s === "\(direct\)"\) return "Direct";/);
  assert.match(ga, /return "Google search";/);
});

test('RP2.6: Add to Jobs on a booking links the booking to the job and keeps where it came from', () => {
  const ws = read('tools', 'workspace.html');
  const fn = fnSrc(ws, 'convertBookingToJob', 'async ');
  assert.match(fn, /Object\.assign\(newJob, thJobAttributionFrom\(booking\), \{ sourceFrom: 'booking' \}\)/);
  assert.match(fn, /await markBookingConverted\(id, newId\)/);
  assert.match(fnSrc(read('tools', 'sync.js'), 'markBookingConverted', 'async '), /body: JSON\.stringify\(\{ job_id: jobId \}\)/);
});

test('RP1.10: the invoices mirror writes whole cents, and a paid invoice with no recorded amount as paid in full', () => {
  const sync = read('tools', 'sync.js');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fnSrc(sync, 'deriveInvoicePaid') + fnSrc(sync, 'centsOrNull') + fnSrc(sync, 'mirrorInvoicePaidAmount') +
    ';this.c = centsOrNull; this.p = mirrorInvoicePaidAmount;', ctx);
  assert.equal(ctx.c(125.0025), 125);
  assert.equal(ctx.c('19.999'), 20);
  assert.equal(ctx.c(''), null);
  assert.equal(ctx.c(null), null);
  assert.equal(ctx.c('abc'), null);
  assert.equal(ctx.p({ total: 125.0025, paid: true }), 125, 'paid before amounts were kept: the whole total');
  assert.equal(ctx.p({ total: 300, paidAmount: 150 }), 150);
  assert.equal(ctx.p({ total: 300, paid: false }), null);
  const mirror = fnSrc(sync, 'mirrorInvoiceToRelational');
  assert.match(mirror, /subtotal: centsOrNull\(entry\.subtotal\)/);
  assert.match(mirror, /total: centsOrNull\(entry\.total\)/);
  assert.match(mirror, /paid_amount: mirrorInvoicePaidAmount\(entry\)/);
});
