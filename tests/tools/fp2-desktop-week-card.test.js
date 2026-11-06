// Fix plan FP2.9 (2026-11-06, approved "Dashboard on a computer"): on a
// computer (1024px and up) Your week moves to the bottom of the Dashboard's
// left column so both columns end at about the same height; below that it
// stays last in the right column, as before. Runs the real workspace.html
// in jsdom with matchMedia stubbed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { installDataLayer } = require('../data-layer-harness');

const WS = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'workspace.html'), 'utf8');

function dashboard(wide) {
  const listeners = [];
  const dom = new JSDOM(WS, {
    runScripts: 'dangerously', url: 'https://example.com/tools/workspace.html',
    beforeParse(w) {
      installDataLayer(w);
      w.requireAuth = () => {};
      w.__wide = wide;
      w.matchMedia = (q) => ({
        get matches() { return q === '(min-width: 1024px)' ? w.__wide : false; },
        addEventListener: (_e, fn) => listeners.push(fn), removeEventListener() {}, addListener() {}, removeListener() {},
      });
    },
  });
  const w = dom.window;
  const flip = (v) => { w.__wide = v; listeners.forEach((fn) => fn()); };
  return { w, flip };
}
const colOf = (w) => w.document.getElementById('weekCard').parentNode.className;

test('FP2.9: on a computer Your week is the last card in the left column, under Find client / Calendar', () => {
  const { w } = dashboard(true);
  assert.match(colOf(w), /today-col-main/);
  const main = w.document.querySelector('#todayCols .today-col-main');
  assert.equal(main.lastElementChild.id, 'weekCard');
  assert.equal(main.lastElementChild.previousElementSibling.id, 'dashPrimaryStrip');
});

test('FP2.9: on a phone or tablet it stays last in the right column, after Money owed', () => {
  const { w } = dashboard(false);
  assert.match(colOf(w), /today-col-side/);
  assert.equal(w.document.querySelector('#todayCols .today-col-side').lastElementChild.id, 'weekCard');
});

test('FP2.9: resizing across 1024px moves it back and forth; there is only ever one', () => {
  const { w, flip } = dashboard(false);
  flip(true);
  assert.match(colOf(w), /today-col-main/);
  flip(false);
  assert.match(colOf(w), /today-col-side/);
  assert.equal(w.document.querySelectorAll('#weekCard').length, 1);
});
