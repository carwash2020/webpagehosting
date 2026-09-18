// Tests for adding a real Privacy Policy page (audit item #19). Data
// collection was already scattered across the codebase in practice
// (contact/booking forms, client portal accounts, Stripe payments,
// Supabase storage, Resend email, Google Analytics, push
// notifications) but there was no single page telling a visitor or
// client what's actually collected and how it's used -- only
// terms.html's brief "Third-Party Services"/"Cookies and Analytics"
// sections, which are Terms & Conditions clauses, not a privacy policy.
//
// privacy.html is deliberately static (not live-CMS-backed like
// site_terms/site_faq): its content is tied directly to real
// integrations documented elsewhere in this repo (SECURITY.md,
// docs/CLIENT-PORTAL.md), and a live-editable text field could drift
// out of sync with what the code actually does in a way a human
// editing this file directly, alongside the integration it describes,
// would not.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);

test('privacy.html exists and uses the same page shell as terms.html (nav, footer, theme script, mobile menu)', () => {
  const html = fs.readFileSync(repo('privacy.html'), 'utf8');
  assert.match(html, /<title>Privacy Policy \| Triple H Enterprises<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.triplehenterprisesllc\.biz\/privacy\.html">/);
  assert.match(html, /<meta name="robots" content="index, follow">/);
  assert.match(html, /<button class="nav-toggle" aria-label="Toggle menu" aria-expanded="false" aria-controls="mobileMenu" id="navToggle">/);
  assert.match(html, /<h1>Privacy Policy<\/h1>/);
});

test('privacy.html actually names the real third-party data processors this business uses', () => {
  const html = fs.readFileSync(repo('privacy.html'), 'utf8');
  for (const provider of ['Stripe', 'Supabase', 'Resend', 'Google Analytics']) {
    assert.match(html, new RegExp(provider), `expected privacy.html to name ${provider}`);
  }
});

test('privacy.html covers client portal accounts, push notifications, and user rights, not just the public contact form', () => {
  const html = fs.readFileSync(repo('privacy.html'), 'utf8');
  assert.match(html, /Client Portal Accounts/);
  assert.match(html, /Push Notifications/);
  assert.match(html, /Your Rights/);
});

test('privacy.html has real contact information for privacy questions/requests, not a placeholder', () => {
  const html = fs.readFileSync(repo('privacy.html'), 'utf8');
  assert.match(html, /mailto:steve@triplehenterprisesllc\.biz/);
  assert.match(html, /tel:\+14354141667/);
});

test('privacy.html is included in sitemap.xml', () => {
  const sitemap = fs.readFileSync(repo('sitemap.xml'), 'utf8');
  assert.match(sitemap, /<loc>https:\/\/www\.triplehenterprisesllc\.biz\/privacy\.html<\/loc>/);
});

const PAGES_LINKING_TO_PRIVACY = [
  'index.html',
  'terms.html',
  'assembly-installation.html',
  'drywall-painting.html',
  'handyman-cedar-city-ut.html',
  'handyman-hurricane-ut.html',
  'handyman-la-verkin-ut.html',
  'handyman-leeds-ut.html',
  'handyman-mesquite-nv.html',
  'handyman-repairs.html',
  'handyman-santa-clara-ivins-ut.html',
  'handyman-st-george-ut.html',
  'handyman-washington-city-ut.html',
  'plumbing-repairs.html',
  'washer-dryer-repair.html',
  'washer-dryer-repair-st-george-ut.html',
];

for (const name of PAGES_LINKING_TO_PRIVACY) {
  test(`${name}'s footer links to the new Privacy Policy page`, () => {
    const html = fs.readFileSync(repo(name), 'utf8');
    assert.match(html, /<li><a href="\/privacy\.html">Privacy Policy<\/a><\/li>/);
  });
}

test('the footer Privacy Policy link sits right after the Terms & Conditions link on every landing page (not the homepage, which uses a JS modal trigger for Terms)', () => {
  const pagesWithHashTerms = PAGES_LINKING_TO_PRIVACY.filter((n) => n !== 'index.html' && n !== 'terms.html');
  for (const name of pagesWithHashTerms) {
    const html = fs.readFileSync(repo(name), 'utf8');
    const termsIdx = html.indexOf('<li><a href="/#terms">Terms &amp; Conditions</a></li>');
    const privacyIdx = html.indexOf('<li><a href="/privacy.html">Privacy Policy</a></li>');
    assert.ok(termsIdx !== -1 && privacyIdx !== -1, `${name}: expected both links`);
    assert.ok(privacyIdx > termsIdx && privacyIdx - termsIdx < 100, `${name}: Privacy Policy link should sit immediately after Terms & Conditions`);
  }
});

test('portal/login.html\'s sign-in disclaimer now also links to the Privacy Policy, alongside Terms and Conditions', () => {
  const html = fs.readFileSync(repo('portal', 'login.html'), 'utf8');
  assert.match(html, /By signing in you agree to Triple H Enterprises' <a href="\/terms\.html"[^>]*>Terms and Conditions<\/a> and <a href="\/privacy\.html"[^>]*>Privacy Policy<\/a>\./);
});
