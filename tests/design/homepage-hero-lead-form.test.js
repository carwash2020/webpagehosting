// Homepage above-fold estimate form (2026-09-18). Compact secondary
// path next to Schedule/Call. Reuses the existing th_leads insert —
// the same path as #scheduleForm. Does not invent a second backend,
// does not move Connor's hex-above-CTA stack, and does not touch
// AggregateRating (stays 5.0 / 7).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const INDEX = fs.readFileSync(repo('index.html'), 'utf8');
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');

function heroHtml() {
  const start = INDEX.indexOf('<section class="hero">');
  const end = INDEX.indexOf('</section>', start);
  return INDEX.slice(start, end);
}

function schemaOf(html) {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  return JSON.parse(m[1]);
}

test('the hero carries a compact estimate form after Schedule/Call and before the badge', () => {
  const hero = heroHtml();
  const ctasAt = hero.indexOf('class="hero-ctas"');
  const formAt = hero.indexOf('id="heroLeadForm"');
  const badgeAt = hero.indexOf('class="hero-badge"');
  assert.ok(ctasAt > 0 && formAt > ctasAt && badgeAt > formAt, 'form sits after the primary CTAs, still in the hero');
  assert.match(hero, /<form class="hero-lead-form" id="heroLeadForm"/);
});

test('hero form fields are name, phone, service, brief details, and optional email', () => {
  const hero = heroHtml();
  const formStart = hero.indexOf('id="heroLeadForm"');
  const formEnd = hero.indexOf('</form>', formStart);
  const form = hero.slice(formStart, formEnd);
  assert.match(form, /id="heroName" name="name"[^>]*required/);
  assert.match(form, /id="heroPhone" name="phone"[^>]*required/);
  assert.match(form, /id="heroService" name="service" required/);
  assert.match(form, /id="heroDetails" name="details"/);
  assert.match(form, /id="heroEmail" name="email"/);
  assert.doesNotMatch(form, /id="heroEmail"[^>]*required/);
  assert.match(form, /name="_gotcha"/);
  assert.match(form, /name="source" value="Homepage estimate form"/);
  assert.doesNotMatch(form, /id="heroDate"|name="date"/);
  assert.doesNotMatch(form, /name="referredBy"/);
});

test('hero service options match the #scheduleForm vocabulary', () => {
  const OPTIONS = [
    'Appliance Repair',
    'General Handyman Repairs',
    'Plumbing Fixes &amp; Leaks',
    'Drywall &amp; Painting',
    'Assembly &amp; Installation',
    'Emergency Calls',
    'Something Else',
  ];
  const hero = heroHtml();
  const modal = INDEX.slice(INDEX.indexOf('id="scheduleForm"'), INDEX.indexOf('</form>', INDEX.indexOf('id="scheduleForm"')));
  for (const opt of OPTIONS) {
    assert.ok(hero.includes('<option>' + opt + '</option>'), `hero missing ${opt}`);
    assert.ok(modal.includes('<option>' + opt + '</option>'), `modal missing ${opt}`);
  }
});

test('Schedule stays the filled orange primary and Call stays outline; form submit is secondary', () => {
  const hero = heroHtml();
  const orangeAt = hero.indexOf('class="btn orange"');
  const outlineAt = hero.indexOf('class="btn outline js-phone-link"');
  const formAt = hero.indexOf('id="heroLeadForm"');
  assert.ok(orangeAt > 0 && outlineAt > orangeAt && formAt > outlineAt);
  assert.match(hero, /href="\/booking\.html"/);
  assert.match(hero, /Schedule an appointment/);
  const form = hero.slice(formAt, hero.indexOf('</form>', formAt));
  assert.match(form, /class="btn outline" id="heroLeadSubmitBtn">Send details</);
  assert.doesNotMatch(form, /class="btn orange"/);
  assert.match(form, /href="sms:\+14354141667\?body=/);
  assert.match(form, />Text us</);
});

test('mobile still puts the hex crest above Schedule/Call; the form does not jump the stack', () => {
  const live = STYLES.replace(/\/\*[\s\S]*?\*\//g, '');
  const desktopChunk = live.split('@media (max-width:860px)')[0];
  assert.doesNotMatch(desktopChunk, /\.hero-badge\{[^}]*order:-1/, 'global order:-1 would swap desktop columns');
  assert.match(live, /@media \(max-width:860px\)\{[\s\S]*?\.hero-badge\{[^}]*order:-1/);
  assert.doesNotMatch(STYLES, /\.hero-lead-form\{[^}]*\border\s*:/);
  assert.match(STYLES, /\.hero-lead-form\{/);
  assert.match(STYLES, /\.hero-lead-form\{[\s\S]*?--orange-tint-border/);
  assert.match(STYLES, /\.hero-lead-form \.btn\{min-height:44px;\}/);
});

test('sticky Call+Text+Book stays; no second public lead backend is invented', () => {
  assert.match(INDEX, /<nav class="sticky-call sticky-call-sms" aria-label="Call, text, or book">/);
  const inserts = INDEX.match(/\/rest\/v1\/th_leads\?on_conflict=client_request_id/g) || [];
  assert.equal(inserts.length, 1, 'hero and modal must share the one th_leads insert');
  assert.match(INDEX, /function submitLeadFromForm\(form, status, submitBtn\)/);
  assert.match(INDEX, /bindLeadForm\(form, status, submitBtn\)/);
  assert.match(INDEX, /bindLeadForm\(heroLeadForm, heroLeadStatus, heroLeadSubmitBtn\)/);
  assert.doesNotMatch(INDEX, /formspree\.io/i);
  assert.doesNotMatch(INDEX, /\/rest\/v1\/th_bookings/);
});

test('AggregateRating stays 5.0 / 7; wall stays 4 written cards', () => {
  const schema = schemaOf(INDEX);
  assert.equal(schema.aggregateRating.ratingValue, '5.0');
  assert.equal(Number(schema.aggregateRating.reviewCount), 7);
  assert.equal((INDEX.match(/class="review-card"/g) || []).length, 4);
});

test('the shared insert still sends the modal fields and accepts an empty hero email as null', () => {
  const fnMatch = INDEX.match(/fetch\(LEADS_SUPABASE_URL \+ '\/rest\/v1\/th_leads\?on_conflict=client_request_id', \{[\s\S]*?\n\s*\.then\(\(response\)/);
  assert.ok(fnMatch, 'expected to isolate the one th_leads insert');
  assert.match(fnMatch[0], /name: formData\.get\('name'\),/);
  assert.match(fnMatch[0], /phone: formData\.get\('phone'\),/);
  assert.match(fnMatch[0], /email: formData\.get\('email'\) \|\| null,/);
  assert.match(fnMatch[0], /service: formData\.get\('service'\),/);
  assert.match(fnMatch[0], /details: formData\.get\('details'\),/);
  assert.match(fnMatch[0], /source: formData\.get\('source'\) \|\| null,/);
  assert.match(fnMatch[0], /client_request_id: getLeadRequestId\(\),/);
});
