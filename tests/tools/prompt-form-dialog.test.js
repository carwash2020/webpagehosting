// showPromptForm() (2026-09-19) replaces the tools suite's remaining
// native prompt() call sites -- recurring job templates in
// job-tracker.html, a photo caption also in job-tracker.html, a custom
// price-reference label in finance.html, license entries in
// workspace.html. Real bug fixed along the way, not just a style pass:
// the recurring-template flow was 3 stacked prompt() calls, and
// `prompt(...) || ''` can't tell a genuine Cancel (returns null) apart
// from OK on a deliberately blank field (returns ''), so cancelling the
// 2nd of 3 prompts used to silently continue with a blank value instead
// of aborting the whole thing.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const DIALOGS_JS = fs.readFileSync(repo('tools', 'tools-dialogs.js'), 'utf8');
const JOB_TRACKER = fs.readFileSync(repo('tools', 'job-tracker.html'), 'utf8');
const FINANCE = fs.readFileSync(repo('tools', 'finance.html'), 'utf8');
const WORKSPACE = fs.readFileSync(repo('tools', 'workspace.html'), 'utf8');

test('none of the 4 fixed call sites still use a native prompt()', () => {
  for (const [name, html] of [['job-tracker.html', JOB_TRACKER], ['finance.html', FINANCE], ['workspace.html', WORKSPACE]]) {
    const fnBodies = [
      html.match(/async function addTemplatePrompt\(\)[\s\S]*?\n  \}\n/),
      html.match(/async function editTemplatePrompt\(id\)[\s\S]*?\n  \}\n/),
      html.match(/async function toggleFeatureUI\(photoId[\s\S]*?\n  \}\n/),
      html.match(/async function savePriceReference\(\)[\s\S]*?\n  \}\n/),
      html.match(/async function addLicensePrompt\(\)[\s\S]*?\n  \}\n/),
    ].filter(Boolean);
    for (const m of fnBodies) {
      assert.doesNotMatch(m[0], /[^a-zA-Z.]prompt\(/, `${name}: a fixed function still calls native prompt()`);
    }
  }
});

test('addTemplatePrompt/editTemplatePrompt collect all 3 fields in one showPromptForm() call and abort cleanly on cancel', () => {
  const addFn = JOB_TRACKER.match(/async function addTemplatePrompt\(\)[\s\S]*?\n  \}\n/)[0];
  assert.match(addFn, /showPromptForm\('New recurring job template'/);
  assert.match(addFn, /if \(!values\) return; \/\/ cancelled/);
  assert.match(addFn, /id: 'title'/);
  assert.match(addFn, /id: 'client'/);
  assert.match(addFn, /id: 'intervalMonths'/);

  const editFn = JOB_TRACKER.match(/async function editTemplatePrompt\(id\)[\s\S]*?\n  \}\n/)[0];
  assert.match(editFn, /showPromptForm\('Edit recurring job template'/);
  assert.match(editFn, /if \(!values\) return; \/\/ cancelled/);
});

test('toggleFeatureUI\'s caption prompt actually aborts on cancel now (the old dead cancel-check is gone)', () => {
  const fn = JOB_TRACKER.match(/async function toggleFeatureUI\(photoId[\s\S]*?\n  \}\n/)[0];
  assert.match(fn, /showPromptForm\('Feature this photo on the website'/);
  assert.match(fn, /if \(!values\) return; \/\/ cancelled/);
  // The old bug: caption = prompt(...) || '' then `if (caption === null)`,
  // which could never be true since || '' already erased the null.
  assert.doesNotMatch(fn, /caption === null/);
});

test('savePriceReference/addLicensePrompt use showPromptForm() with real validation', () => {
  const priceFn = FINANCE.match(/async function savePriceReference\(\)[\s\S]*?\n  \}\n/)[0];
  assert.match(priceFn, /showPromptForm\('Name this job type'/);
  assert.match(priceFn, /validate: \(v\) => \(!v\.label/);

  const licenseFn = WORKSPACE.match(/async function addLicensePrompt\(\)[\s\S]*?\n  \}\n/)[0];
  assert.match(licenseFn, /showPromptForm\('Add a business license'/);
  assert.match(licenseFn, /validate: \(v\) => \(!v\.city/);
});

test('showPromptForm() resolves null on cancel and an object of trimmed values on submit, matching validation before resolving', () => {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'outside-only', url: 'https://example.com/' });
  const { window } = dom;
  window.escapeHtml = (s) => (s === null || s === undefined ? '' : String(s));
  window.escapeAttr = (s) => (s === null || s === undefined ? '' : String(s));
  window.eval(DIALOGS_JS);

  // Cancel path.
  let p = window.showPromptForm('Test', [{ id: 'a', label: 'A' }]);
  window.document.getElementById('customDialogCancelAction').click();
  return p.then((result) => {
    assert.equal(result, null);

    // Submit path, with validation rejecting an empty required field first.
    let p2 = window.showPromptForm('Test 2', [{ id: 'name', label: 'Name' }], {
      validate: (v) => (!v.name ? 'Enter a name.' : null),
    });
    const submitBtn = window.document.querySelector('#customDialogButtons .dialog-btn-primary');
    submitBtn.click();
    assert.equal(window.document.getElementById('customDialogFieldsError').style.display, 'block');

    window.document.getElementById('customDialogField0').value = '  Steve  ';
    submitBtn.click();
    return p2.then((result2) => {
      // Not assert.deepEqual: result2 is an object from the jsdom
      // realm, not Node's, so it's structurally equal but never
      // reference-equal the way deepEqual/deepStrictEqual expect.
      assert.equal(result2.name, 'Steve');
      assert.equal(Object.keys(result2).length, 1);
    });
  });
});
