// Booking entry point: index.html's service modal "or schedule online"
// hand-off (2026-09-23). It scrolled to the #schedule form with an
// explicit behavior:'smooth', which overrides the CSS scroll-behavior
// reset, so reduced-motion visitors still got the animated scroll. Logged
// for this lane by the visual lane (docs/specialist-logs/features.md,
// 2026-09-23); same fix as back-to-top and the triage result.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const read = (p) => fs.readFileSync(repo(p), 'utf8');

function stubMotion(window, reduce) {
  window.matchMedia = (q) => ({ matches: reduce && /prefers-reduced-motion: reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
}

test('service modal -> schedule form: smooth normally, instant under reduced motion, and the hand-off still works', () => {
  const html = read('index.html');
  for (const reduce of [false, true]) {
    const calls = [];
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      url: 'https://www.triplehenterprisesllc.biz/',
      beforeParse(window) {
        stubMotion(window, reduce);
        window.HTMLElement.prototype.scrollIntoView = function (opts) { calls.push({ id: this.id, opts }); };
      },
    });
    const doc = dom.window.document;
    doc.querySelector('.service-card[data-service="appliance"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    calls.length = 0; // only the hand-off's own scroll counts
    doc.getElementById('modalSchedule').dispatchEvent(new dom.window.Event('click', { bubbles: true }));

    const toForm = calls.filter((c) => c.id === 'schedule');
    assert.equal(toForm.length, 1, `reduce=${reduce}: one scroll to #schedule`);
    assert.equal(toForm[0].opts.behavior, reduce ? 'auto' : 'smooth', `reduce=${reduce}`);
    assert.equal(doc.activeElement && doc.activeElement.id, 'name', `reduce=${reduce}: focus lands on the first form field`);
    assert.notEqual(doc.getElementById('service').value, '', `reduce=${reduce}: the picked service is carried into the form`);
  }
});

test('no unguarded smooth scroll is left in index.html\'s booking hand-off', () => {
  const html = read('index.html');
  const handler = html.slice(html.indexOf("modalSchedule.addEventListener('click'"), html.indexOf("const form = document.getElementById('scheduleForm');"));
  assert.ok(handler.length > 0);
  assert.doesNotMatch(handler, /behavior\s*:\s*'smooth'\s*\}/, 'smooth must be the non-reduced branch of a ternary');
  assert.match(handler, /behavior: reduced \? 'auto' : 'smooth'/);
});
