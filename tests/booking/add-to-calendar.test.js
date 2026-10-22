// Tests for add-to-calendar.html (2026-10-22) -- the redirect-through-our-
// domain page for the "Add to Google Calendar" link in booking emails.
// Resend's deliverability advisor flags a link whose domain doesn't match
// the sending domain as a spam-filter risk, so send-booking-email-index.ts
// now points that link here instead of a raw calendar.google.com href.
// This page's one job is checking the real destination (passed in the `u`
// query param) is genuinely calendar.google.com before following it --
// deliberately NOT a generic "redirect to any URL" page, which would be an
// open redirect trading on this domain's trust.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const HTML = fs.readFileSync(repo('add-to-calendar.html'), 'utf8');

// jsdom doesn't implement real navigation -- window.location.replace is a
// non-writable, non-configurable property there, and calling it just logs
// "Not implemented: navigation to another Document" and no-ops. The page
// itself provides a __addToCalendarRedirect hook for exactly this reason
// (see its own comment) -- set it before parsing so it's in place before
// the inline script runs, and it captures the computed target instead of
// a real navigation.
function loadWithQuery(query) {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: `https://www.triplehenterprisesllc.biz/add-to-calendar.html${query}`,
    beforeParse(window) {
      window.__addToCalendarRedirect = (url) => { window.__replacedTo = url; };
    },
  });
  return dom.window;
}

test('add-to-calendar.html is noindex -- it is a utility redirect page, not something to crawl or list in the sitemap', () => {
  assert.match(HTML, /<meta name="robots" content="noindex">/);
});

test('a real calendar.google.com target is followed via location.replace', () => {
  const target = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Test';
  const window = loadWithQuery('?u=' + encodeURIComponent(target));
  assert.equal(window.__replacedTo, target);
});

test('a non-Google target is rejected -- never followed, shows a fallback instead', () => {
  const evil = 'https://not-google.example.com/phish';
  const window = loadWithQuery('?u=' + encodeURIComponent(evil));
  assert.equal(window.__replacedTo, undefined);
  assert.match(window.document.getElementById('redirectMsg').textContent, /invalid/i);
  assert.equal(window.document.getElementById('fallback').style.display, 'block');
});

test('a calendar.google.com URL over plain http (not https) is rejected', () => {
  const insecure = 'http://calendar.google.com/calendar/render?action=TEMPLATE';
  const window = loadWithQuery('?u=' + encodeURIComponent(insecure));
  assert.equal(window.__replacedTo, undefined);
  assert.equal(window.document.getElementById('fallback').style.display, 'block');
});

test('a lookalike host (e.g. calendar.google.com.evil.example) is rejected -- hostname must match exactly', () => {
  const lookalike = 'https://calendar.google.com.evil.example/calendar/render';
  const window = loadWithQuery('?u=' + encodeURIComponent(lookalike));
  assert.equal(window.__replacedTo, undefined);
  assert.equal(window.document.getElementById('fallback').style.display, 'block');
});

test('no `u` param at all shows the fallback, not an error', () => {
  const window = loadWithQuery('');
  assert.equal(window.document.getElementById('fallback').style.display, 'block');
});

test('a malformed `u` value (not a parseable URL) is caught and shows the fallback', () => {
  const window = loadWithQuery('?u=not-a-url-at-all');
  assert.equal(window.document.getElementById('fallback').style.display, 'block');
});
