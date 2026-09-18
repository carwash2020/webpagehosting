// Homepage above-fold estimate form (2026-09-18). Compact secondary
// path next to Schedule/Call. Reuses the existing th_leads insert —
// the same path as #scheduleForm. Does not invent a second backend,
// does not move Connor's hex-above-CTA stack, and does not touch
// AggregateRating (stays 5.0 / 7).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

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
  assert.match(form, /id="heroLeadSubmitBtn">Send details</);
  assert.match(form, /href="sms:\+14354141667\?body=/);
  assert.match(form, />Text us</);
});

test('mobile still puts the hex crest above Schedule/Call; the form does not jump the stack', () => {
  const live = STYLES.replace(/\/\*[\s\S]*?\*\//g, '');
  const desktopChunk = live.split('@media (max-width:860px)')[0];
  assert.doesNotMatch(desktopChunk, /\.hero-badge\{[^}]*order:-1/, 'global order:-1 would swap desktop columns');
  assert.match(live, /@media \(max-width:860px\)\{[\s\S]*?\.hero-badge\{[^}]*order:-1/);
  assert.doesNotMatch(STYLES, /\.hero-lead-form\{[^}]*order\s*:/);
  assert.match(STYLES, /\.hero-lead-form\{/);
  assert.match(STYLES, /\.hero-lead-form\{[\s\S]*?--orange-tint-border/);
  assert.match(STYLES, /\.hero-lead-form \.btn\.orange\{min-height:44px;\}/);
});

test('sticky Call+Book stays; no second public lead backend is invented', () => {
  assert.match(INDEX, /<nav class="sticky-call" aria-label="Call or book">/);
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

test('a real submit from the hero form posts the same th_leads payload shape as the modal', () => {
  const fetchCalls = [];
  const dom = new JSDOM(`<!DOCTYPE html>
    <form id="heroLeadForm">
      <input name="_gotcha" />
      <input name="source" value="Homepage estimate form" />
      <input name="name" value="Jane Smith" />
      <input name="phone" value="4354141667" />
      <input name="email" value="" />
      <select name="service"><option selected>Appliance Repair</option></select>
      <textarea name="details">Washer will not drain</textarea>
      <button type="submit" id="heroLeadSubmitBtn">Send details</button>
      <span id="heroLeadStatus"></span>
    </form>
    <form id="scheduleForm">
      <input name="name" value="Pat" />
      <input name="phone" value="4350000000" />
      <input name="email" value="pat@example.com" />
      <select name="service"><option selected>Plumbing Fixes &amp; Leaks</option></select>
      <input name="date" value="2026-09-25" />
      <select name="time"><option selected>Morning (8AM to 11AM)</option></select>
      <textarea name="details">Drip</textarea>
      <input name="referredBy" value="" />
      <select name="source"><option value="" selected></option></select>
      <button type="submit" id="formSubmitBtn">Submit Request</button>
      <span id="formStatus"></span>
    </form>`, { url: 'https://www.triplehenterprisesllc.biz/' });

  const { window } = dom;
  window.fetch = (url, opts) => {
    fetchCalls.push({ url: String(url), opts });
    return Promise.resolve({ ok: true });
  };
  window.gtag = () => {};
  window.getStoredUtmParams = () => null;

  const start = INDEX.indexOf("  const form = document.getElementById('scheduleForm');");
  const end = INDEX.indexOf('bindLeadForm(heroLeadForm, heroLeadStatus, heroLeadSubmitBtn);') + 'bindLeadForm(heroLeadForm, heroLeadStatus, heroLeadSubmitBtn);'.length;
  assert.ok(start > 0 && end > start, 'expected to isolate the shared lead-submit wiring');
  window.eval(INDEX.slice(start, end));

  const heroForm = window.document.getElementById('heroLeadForm');
  heroForm.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

  assert.equal(fetchCalls.length, 1, 'hero submit should hit th_leads once');
  assert.match(fetchCalls[0].url, /\/rest\/v1\/th_leads\?on_conflict=client_request_id/);
  assert.equal(fetchCalls[0].opts.headers.Prefer, 'resolution=ignore-duplicates');
  const payload = JSON.parse(fetchCalls[0].opts.body)[0];
  assert.equal(payload.name, 'Jane Smith');
  assert.equal(payload.phone, '4354141667');
  assert.equal(payload.email, null);
  assert.equal(payload.service, 'Appliance Repair');
  assert.equal(payload.details, 'Washer will not drain');
  assert.equal(payload.source, 'Homepage estimate form');
  assert.ok(payload.client_request_id);
});
