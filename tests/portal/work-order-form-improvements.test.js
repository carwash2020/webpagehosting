// Focused improvements to the work-order request FORM itself (2026-09-07,
// requested directly), distinct from the request-card/progress-track
// work already covered by tests/portal/work-order-progress-track.test.js:
//   - title/description marked Required, matching the existing Optional
//     wording already on the fields below them
//   - submitting with either blank highlights that specific field,
//     not just the one error line at the bottom of a long form
//   - a live character count on description against its real maxlength
//   - icons on the 3 urgency buttons

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const WORK_ORDERS = fs.readFileSync(repo('portal', 'work-orders.html'), 'utf8');
const SERVICE_WORKER = fs.readFileSync(repo('portal', 'service-worker.js'), 'utf8');

function extractFn(html, name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  const braceStart = html.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(start, i);
}

test('title and description are marked Required, matching the Optional wording already used on the fields below them', () => {
  const formBlock = WORK_ORDERS.slice(WORK_ORDERS.indexOf('id="requestForm"'), WORK_ORDERS.indexOf('id="woAddress"'));
  const requiredCount = (formBlock.match(/class="wo-required"/g) || []).length;
  assert.equal(requiredCount, 2, 'expected exactly title and description to carry the Required tag');
  assert.match(WORK_ORDERS, /for="woTitle">What do you need done\? <span class="wo-required">Required<\/span>/);
  assert.match(WORK_ORDERS, /for="woDescription">Tell us more <span class="wo-required">Required<\/span>/);
});

test('the description field has a live character counter element, reset alongside the field on successful submit', () => {
  assert.match(WORK_ORDERS, /<div class="wo-char-count" id="woDescriptionCount">0 \/ 2000<\/div>/);
  const submitFn = extractFn(WORK_ORDERS, 'submitRequest');
  assert.match(submitFn, /woDescriptionCount'\)\.textContent = '0 \/ 2000'/);
});

test('the character counter updates from the real input length against the real maxlength, not a hardcoded or invented limit', () => {
  const realMaxlength = WORK_ORDERS.match(/<textarea id="woDescription" maxlength="(\d+)"/)[1];
  assert.equal(realMaxlength, '2000');
  assert.match(WORK_ORDERS, /woDescriptionCount'\)\.textContent = e\.target\.value\.length \+ ' \/ 2000'/);
});

test('submitting with a blank title highlights the title field specifically, focuses it, and scrolls it into view', () => {
  const submitFn = extractFn(WORK_ORDERS, 'submitRequest');
  const titleBranch = submitFn.slice(submitFn.indexOf('if (!title)'), submitFn.indexOf('if (!description)'));
  assert.match(titleBranch, /woTitleField'\)/);
  assert.match(titleBranch, /classList\.add\('has-error'\)/);
  assert.match(titleBranch, /scrollIntoView/);
  assert.match(titleBranch, /woTitle'\)\.focus\(\)/);
});

test('submitting with a blank description highlights the description field specifically, focuses it, and scrolls it into view', () => {
  const submitFn = extractFn(WORK_ORDERS, 'submitRequest');
  const descBranch = submitFn.slice(submitFn.indexOf('if (!description)'), submitFn.indexOf('const { data: { session } }'));
  assert.match(descBranch, /woDescriptionField'\)/);
  assert.match(descBranch, /classList\.add\('has-error'\)/);
  assert.match(descBranch, /scrollIntoView/);
  assert.match(descBranch, /woDescription'\)\.focus\(\)/);
});

test('both error highlights are cleared at the start of every submit attempt, not just accumulated', () => {
  const submitFn = extractFn(WORK_ORDERS, 'submitRequest');
  const beforeFirstCheck = submitFn.slice(0, submitFn.indexOf('if (!title)'));
  assert.match(beforeFirstCheck, /woTitleField'\)\.classList\.remove\('has-error'\)/);
  assert.match(beforeFirstCheck, /woDescriptionField'\)\.classList\.remove\('has-error'\)/);
});

test('typing into a field clears its own error highlight without needing to re-submit', () => {
  assert.match(WORK_ORDERS, /woTitle'\)\.addEventListener\('input', \(\) => \{\s*document\.getElementById\('woTitleField'\)\.classList\.remove\('has-error'\);\s*\}\)/);
  const descListener = WORK_ORDERS.slice(WORK_ORDERS.indexOf("getElementById('woDescription').addEventListener('input'"));
  assert.match(descListener.slice(0, 300), /woDescriptionField'\)\.classList\.remove\('has-error'\)/);
});

test('all 3 urgency buttons carry a distinct icon, and the selected state still applies to the whole button', () => {
  const urgencyRow = WORK_ORDERS.slice(WORK_ORDERS.indexOf('id="woUrgencyRow"'), WORK_ORDERS.indexOf('</div>\n  </div>\n\n  <!--'));
  const svgCount = (urgencyRow.match(/<svg viewBox="0 0 24 24" aria-hidden="true">/g) || []).length;
  assert.equal(svgCount, 3, 'expected one icon per urgency button');
  // The 3 icon paths should differ from each other -- not the same
  // shape copy-pasted for all three.
  const paths = [...urgencyRow.matchAll(/<svg viewBox="0 0 24 24" aria-hidden="true">([\s\S]*?)<\/svg>/g)].map((m) => m[1]);
  assert.equal(new Set(paths).size, 3, 'expected 3 distinct icon shapes');
  assert.match(WORK_ORDERS, /\.wo-urgency-btn\.is-selected \{ border-color: var\(--orange\); background: var\(--orange-tint-soft\); color: var\(--orange-light\); \}/);
});

test('the "Soon" urgency icon reuses the exact calendar icon already used for scheduling elsewhere on the site, rather than inventing a new one', () => {
  const soonBtn = WORK_ORDERS.match(/data-urgency="soon">[\s\S]*?<\/button>/)[0];
  assert.match(soonBtn, /<rect x="3" y="4" width="18" height="18" rx="2"\/><line x1="16" y1="2" x2="16" y2="6"\/><line x1="8" y1="2" x2="8" y2="6"\/><line x1="3" y1="10" x2="21" y2="10"\/>/);
});

test('the has-error state is visually distinct (colored border and label), not just a class with no styling', () => {
  assert.match(WORK_ORDERS, /\.wo-field\.has-error label \{ color: #ff8a80; \}/);
  assert.match(WORK_ORDERS, /\.wo-field\.has-error input\[type="text"\], \.wo-field\.has-error textarea \{/);
});

test('the portal service worker cache was bumped for this change', () => {
  const versionMatch = SERVICE_WORKER.match(/const CACHE_NAME = 'th-portal-v(\d+)';/);
  assert.ok(versionMatch, 'expected a th-portal-vN CACHE_NAME');
  assert.ok(Number(versionMatch[1]) >= 25, `expected v25 or later, got v${versionMatch[1]}`);
});
