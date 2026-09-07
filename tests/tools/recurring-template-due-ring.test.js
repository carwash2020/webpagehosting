// A real-fraction ring for recurring job templates (2026-09-07), the
// same device just added to the client portal's Jobs page warranty
// pill (portal/jobs.html) -- deliberately reusing that exact pattern
// (size, track brightness, stroke width) for cross-surface consistency
// rather than a third slightly-different ring implementation.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const JOB_TRACKER = fs.readFileSync(repo('tools', 'job-tracker.html'), 'utf8');
const PORTAL_JOBS = fs.readFileSync(repo('portal', 'jobs.html'), 'utf8');

function extractFn(html, name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  // Balance braces from the first '{' after the signature to find the end.
  const braceStart = html.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(start, i);
}

function loadTemplateDueInfo() {
  const ringFn = extractFn(JOB_TRACKER, 'templateDueRingSvg');
  const circumferenceLine = JOB_TRACKER.match(/const TEMPLATE_DUE_RING_CIRCUMFERENCE = [^;]+;/)[0];
  const infoFn = extractFn(JOB_TRACKER, 'templateDueInfo');
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(`${circumferenceLine}\n${ringFn}\n${infoFn}\nthis.templateDueInfo = templateDueInfo;`, ctx);
  return ctx.templateDueInfo;
}

test('the ring fraction is real days-remaining over the template\'s own real cycle length', () => {
  const templateDueInfo = loadTemplateDueInfo();
  // A 3-month template created 85 days ago: mostly through its cycle,
  // so the ring should be mostly empty (small remaining arc).
  const today = new Date(new Date().toDateString());
  const last = new Date(today.getTime() - 85 * 86400000);
  const iso = last.toISOString().slice(0, 10);
  const info = templateDueInfo({ intervalMonths: 3, lastCreatedDate: iso });
  assert.equal(info.isDue, false);
  assert.match(info.ring, /<svg class="template-due-ring"/);
  const offsetMatch = info.ring.match(/stroke-dashoffset="([\d.]+)"/);
  const circumference = 2 * Math.PI * 15;
  const offset = Number(offsetMatch[1]);
  const fraction = 1 - offset / circumference;
  assert.ok(fraction > 0 && fraction < 0.3, `expected a small remaining fraction, got ${fraction}`);
});

test('a template that has never been created gets no ring (nothing to compute a fraction of)', () => {
  const templateDueInfo = loadTemplateDueInfo();
  const info = templateDueInfo({ intervalMonths: 3, lastCreatedDate: null });
  assert.equal(info.isDue, true);
  assert.equal(info.ring, '');
});

test('an overdue template gets no ring either -- the fraction would be negative, not zero', () => {
  const templateDueInfo = loadTemplateDueInfo();
  const today = new Date(new Date().toDateString());
  const last = new Date(today.getTime() - 400 * 86400000);
  const info = templateDueInfo({ intervalMonths: 1, lastCreatedDate: last.toISOString().slice(0, 10) });
  assert.equal(info.isDue, true);
  assert.equal(info.ring, '');
});

test('the ring reuses the portal warranty ring\'s exact size and track brightness, not a fresh guess', () => {
  const jtRing = extractFn(JOB_TRACKER, 'templateDueRingSvg');
  assert.match(jtRing, /width="20" height="20"/);
  assert.match(jtRing, /stroke-width="5"/);
  assert.match(JOB_TRACKER, /\.template-due-ring-track \{ opacity: \.35; \}/);
  // Cross-check against the portal's own values, so if one is ever
  // retuned without the other, this test says so.
  const portalRing = extractFn(PORTAL_JOBS, 'warrantyRingSvg');
  assert.match(portalRing, /width="20" height="20"/);
  assert.match(portalRing, /stroke-width="5"/);
});
