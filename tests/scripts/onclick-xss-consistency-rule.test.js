// Tests for the automated onclick-XSS regression guard added to
// scripts/check-consistency.js (audit item #16). SECURITY.md
// documents a real, hand-run "exhaustive escapeHtml() audit" that
// found and fixed every call site interpolating free-text business
// data directly into a single-quoted JS-string-literal argument
// inside an on\w+="..." attribute (onclick, onchange, etc.) without
// escapeForInlineHandler() -- the only helper actually safe for that
// context. That was a one-time manual sweep with no automated guard
// against a new instance of the exact same bug shape shipping later.
//
// scanForRiskyInlineHandlers() turns it into a permanent check.
// Extracted and executed directly here (not just asserted clean
// against today's real repo, which would only prove today's files
// happen to be clean, not that the regex genuinely catches the bug it
// claims to) against synthetic HTML strings covering both shapes the
// original audit covered (template-literal and string-concatenation),
// plus the real false-positive cases already living in the repo
// (calendar.html's `key`, workspace.html's `advance.next` and
// `wo.preferred_slot_at`) to confirm the rule doesn't flag those.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const CHECK_SRC = fs.readFileSync(repo('scripts', 'check-consistency.js'), 'utf8');

function loadScanFn() {
  const constMatch = CHECK_SRC.match(/const RISKY_INLINE_HANDLER_FIELD = \/[\s\S]*?\/i;/);
  const fnMatch = CHECK_SRC.match(/function scanForRiskyInlineHandlers\(src\) \{[\s\S]*?\n\}/);
  assert.ok(constMatch, 'expected to find RISKY_INLINE_HANDLER_FIELD');
  assert.ok(fnMatch, 'expected to find scanForRiskyInlineHandlers()');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(constMatch[0] + '\n' + fnMatch[0] + '\nthis.scanForRiskyInlineHandlers = scanForRiskyInlineHandlers;', sandbox);
  return sandbox.scanForRiskyInlineHandlers;
}

test('flags an unescaped template-literal interpolation of a risky field (client.name)', () => {
  const scan = loadScanFn();
  const risky = scan(`<button onclick="doThing('\${client.name}')">Go</button>`);
  assert.equal(risky.size, 1);
  assert.ok(risky.has('client.name'));
});

test('does not flag the same value once wrapped in escapeForInlineHandler()', () => {
  const scan = loadScanFn();
  const risky = scan(`<button onclick="doThing('\${escapeForInlineHandler(client.name)}')">Go</button>`);
  assert.equal(risky.size, 0);
});

test('does not flag a bare numeric interpolation outside of quotes (e.g. a job id)', () => {
  const scan = loadScanFn();
  const risky = scan(`<button onclick="doThing(\${job.id})">Go</button>`);
  assert.equal(risky.size, 0);
});

test('flags the older string-concatenation shape too (vendorName, unescaped)', () => {
  const scan = loadScanFn();
  const risky = scan(`<button onclick="'doThing(\\'' + job.vendorName + '\\')'">Go</button>`);
  assert.equal(risky.size, 1);
  assert.ok(risky.has('job.vendorName'));
});

test('does not flag the concatenation shape once wrapped in escapeForInlineHandler()', () => {
  const scan = loadScanFn();
  const risky = scan(`<button onclick="'doThing(\\'' + escapeForInlineHandler(job.vendorName) + '\\')'">Go</button>`);
  assert.equal(risky.size, 0);
});

test('real false positives already living in the repo stay unflagged: a plain "key" is not a risky field name', () => {
  const scan = loadScanFn();
  // Matches calendar.html's actual selectDay('${key}') call -- key is a
  // date-string identifier, not free-text business data.
  const risky = scan(`<div onclick="selectDay('\${key}')"></div>`);
  assert.equal(risky.size, 0);
});

test('real false positives already living in the repo stay unflagged: advance.next and preferred_slot_at', () => {
  const scan = loadScanFn();
  // Matches workspace.html's actual call sites -- an enum-like status
  // string and a timestamp, neither of which contain a risky keyword.
  const risky = scan(`<button onclick="advanceWorkRequest(\${wo.id}, '\${advance.next}')"></button>`);
  assert.equal(risky.size, 0);
  const risky2 = scan(`<button onclick="openWorkOrderApproval(\${wo.id}, this, '\${wo.preferred_slot_at}')"></button>`);
  assert.equal(risky2.size, 0);
});

test('checkOnclickXssRisk() is wired into main() alongside the other button-handler checks', () => {
  assert.match(CHECK_SRC, /checkTopLevelDeferredCalls\(problems\);\s*\n\s*checkButtonHandlers\(problems\);\s*\n\s*checkOnclickXssRisk\(problems\);/);
});

test('the real, current repo passes this check cleanly (every previously-fixed call site still uses escapeForInlineHandler())', () => {
  const { execFileSync } = require('child_process');
  // Runs the real script as a subprocess against the real repo -- the
  // most direct proof that today's files are actually clean, not just
  // that the synthetic cases above behave as expected.
  const result = execFileSync(process.execPath, [repo('scripts', 'check-consistency.js')], { encoding: 'utf8' });
  assert.match(result, /all clean\.\s*$/);
});
