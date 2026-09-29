// 2026-09-29: three layout slips found on screenshots after the v2
// packages landed. (1) Workspace Home lead / applicant / booking rows: a long email
// pushed Handled + ⋯ onto their own line, and a long message stretched
// the lane by a screen. (2) privacy.html / terms.html: "Back to Home" sat
// in the contents column and ran into the sticky list. (3) Homepage
// reviews: the featured card on its own row plus an even count left the
// last card alone in a half-empty row.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const WORKSPACE = fs.readFileSync(repo('tools', 'workspace.html'), 'utf8');
const DIALOGS = fs.readFileSync(repo('tools', 'tools-dialogs.js'), 'utf8');
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');
const PRIVACY = fs.readFileSync(repo('privacy.html'), 'utf8');
const TERMS = fs.readFileSync(repo('terms.html'), 'utf8');
const HOME = fs.readFileSync(repo('index.html'), 'utf8');

function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  const braceStart = src.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

test('lead rows: the name column shrinks from a basis so Handled + ⋯ stay on the right', () => {
  assert.match(WORKSPACE, /\[data-th-page="workspace"\] \.lead-card-top > div:first-child \{ flex: 1 1 12rem; \}/);
  assert.match(WORKSPACE, /\[data-th-page="workspace"\] \.lead-card-top > \.dash-list-item-right \{ flex: 0 0 auto; \}/);
});

test('lead rows: long messages start clamped to four lines, with a 44px Show more toggle', () => {
  assert.match(WORKSPACE, /\.lead-card-details\.is-clampable:not\(\.is-expanded\) \{[^}]*-webkit-line-clamp: 4;[^}]*overflow: hidden;/);
  assert.match(WORKSPACE, /\.lead-card-more \{[^}]*min-height: 44px;/);
  assert.match(WORKSPACE, /\.lead-card-more:focus-visible \{/);
  // Leads, both applicant fields and booking notes go through the helper;
  // no raw copies left.
  assert.match(WORKSPACE, /\$\{l\.details \? leadDetailsHtml\(l\.details\) : ''\}/);
  assert.match(WORKSPACE, /\$\{a\.experience \? leadDetailsHtml\(a\.experience\) : ''\}/);
  assert.match(WORKSPACE, /\$\{a\.message \? leadDetailsHtml\(a\.message\) : ''\}/);
  assert.match(WORKSPACE, /\$\{b\.notes \? leadDetailsHtml\(b\.notes\) : ''\}/);
  assert.doesNotMatch(WORKSPACE, /'<div class="lead-card-details">"' \+ escapeHtml/);
  assert.equal((WORKSPACE.match(/requestAnimationFrame\(\(\) => trimUnneededShowMore\(container\)\);/g) || []).length, 3);
});

test('lead rows: Show more toggles the clamp and aria-expanded, and escapes the text', () => {
  const dom = new JSDOM('<!doctype html><div id="list"></div>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(extractFn(DIALOGS, 'escapeHtml'));
  const start = WORKSPACE.indexOf('const LEAD_DETAILS_CLAMP_CHARS');
  const end = WORKSPACE.indexOf('// Item #13 extended (2026-08-20): undoable-delete tracking for leads.');
  assert.ok(start > 0 && end > start);
  w.eval(WORKSPACE.slice(start, end));

  const shortHtml = w.eval('leadDetailsHtml("Leaks when it drains.")');
  assert.doesNotMatch(shortHtml, /is-clampable|lead-card-more/, 'short messages get no toggle');

  const list = w.document.getElementById('list');
  list.innerHTML = w.eval('leadDetailsHtml(' + JSON.stringify('<b>x</b> ' + 'word '.repeat(80)) + ')');
  const box = list.querySelector('.lead-card-details');
  const btn = list.querySelector('.lead-card-more');
  assert.ok(box.classList.contains('is-clampable'));
  assert.equal(box.querySelector('b'), null, 'message text is escaped');
  assert.equal(btn.getAttribute('type'), 'button');
  assert.equal(btn.getAttribute('aria-expanded'), 'false');

  btn.click();
  assert.ok(box.classList.contains('is-expanded'));
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  assert.equal(btn.textContent, 'Show less');
  btn.click();
  assert.ok(!box.classList.contains('is-expanded'));
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.equal(btn.textContent, 'Show more');

  // Text that turns out to fit loses the toggle once measured.
  Object.defineProperty(box, 'clientHeight', { value: 80 });
  Object.defineProperty(box, 'scrollHeight', { value: 80 });
  w.trimUnneededShowMore(list);
  assert.ok(!box.classList.contains('is-clampable'));
  assert.equal(list.querySelector('.lead-card-more'), null);
});

test('legal pages: Back to Home sits in the text column on desktop, with a 44px tap height', () => {
  assert.match(STYLES, /@media \(min-width:861px\)\{html\.page-legal \.legal-doc > p\{grid-column:2;\}\}/);
  assert.match(STYLES, /html\.page-legal \.legal-doc > p a\{display:inline-flex; align-items:center; min-height:44px;/);
  for (const [name, src] of [['privacy.html', PRIVACY], ['terms.html', TERMS]]) {
    assert.match(src, /<html[^>]*class="[^"]*\bpage-legal\b/, `${name} is a page-legal page`);
    const doc = new JSDOM(src).window.document;
    const kids = Array.from(doc.querySelector('.legal-doc').children);
    const back = kids.find((el) => el.tagName === 'P' && /Back to Home/.test(el.textContent));
    assert.ok(back, `${name}: Back to Home is a direct <p> child of .legal-doc`);
  }
});

test('homepage reviews: an even card count spans the last card instead of leaving it alone', () => {
  assert.match(STYLES, /body\.page-home #reviews \.reviews-wall > \.review-card:last-child:nth-child\(even\)\{grid-column:1 \/ -1;\}/);
  assert.match(STYLES, /body\.page-home #reviews \.reviews-wall > \.review-card:last-child:nth-child\(even\) \.review-quote\{height:auto;\}/);
  const wall = new JSDOM(HOME).window.document.querySelector('#reviews .reviews-wall');
  assert.ok(wall.children.length > 0);
  assert.ok(Array.from(wall.children).every((el) => el.classList.contains('review-card')),
    'only review cards in the wall, so :nth-child counts cards');
});
