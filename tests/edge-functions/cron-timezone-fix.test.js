// Tests for the cron timezone fix (audit item #15). send-push-index.ts
// runs on Deno Deploy, whose runtime local timezone is UTC -- but the
// business (and every job.date string it works with) is
// America/Denver. checkTomorrowsJobs() used to build "tomorrow" via
// `new Date(); .setDate(+1)` then read back `.getFullYear()/
// .getMonth()/.getDate()`, all evaluated in the RUNTIME's local
// timezone (UTC), not business-local. The daily-reminder-check cron
// fires at 1am UTC (sql/security/fix_cron_job_use_vault_secret.sql) --
// which is still EVENING of the previous day in Denver -- so the
// UTC-based "tomorrow" landed a full calendar day ahead of what
// "tomorrow" actually means in St. George, Utah: the notification
// either missed real jobs due tomorrow, or fired a day early for jobs
// actually two days out. todayAtMidnight() (used by 6 other checks via
// daysBetween) had the same root bug in a subtler form.
//
// The fix ports the exact same, already-proven zonedTimeToUtc/
// todayDateStrInBusinessTz/addDaysToDateStr functions from
// business-hours.js. These tests execute the REAL shipped functions
// (types stripped mechanically, not reimplemented) against real DST
// transition dates, not just a source-text regex check.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const SEND_PUSH = fs.readFileSync(repo('edge-functions', 'send-push-index.ts'), 'utf8');

function extractFn(name) {
  const start = SEND_PUSH.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  const braceStart = SEND_PUSH.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < SEND_PUSH.length; i++) {
    if (SEND_PUSH[i] === '{') depth++;
    else if (SEND_PUSH[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return SEND_PUSH.slice(start, i);
}

// Strips exactly the TypeScript type annotations these 3 pure helper
// functions actually carry (parameter types, return types, and one
// Record<string, string> local variable annotation) -- not a general
// TS-to-JS transpiler, just enough to make the REAL shipped source
// runnable as plain JS for direct execution.
function detype(src) {
  return src
    .replace(/dateStr: string/g, 'dateStr')
    .replace(/hh: number/g, 'hh')
    .replace(/mm: number/g, 'mm')
    .replace(/days: number/g, 'days')
    .replace(/\): Date \{/g, ') {')
    .replace(/\): string \{/g, ') {')
    .replace(/: Record<string, string> = \{\}/g, ' = {}');
}

function loadHelpers() {
  const src = [
    detype(extractFn('zonedTimeToUtc')),
    detype(extractFn('todayDateStrInBusinessTz')),
    detype(extractFn('addDaysToDateStr')),
    detype(extractFn('todayAtMidnight')),
  ].join('\n');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox;
}

test('checkTomorrowsJobs() no longer computes "tomorrow" via the runtime-local Date object', () => {
  const fnSrc = extractFn('checkTomorrowsJobs');
  assert.doesNotMatch(fnSrc, /tomorrow\.setDate\(tomorrow\.getDate\(\) \+ 1\)/);
  assert.doesNotMatch(fnSrc, /tomorrow\.getFullYear\(\)/);
  assert.match(fnSrc, /addDaysToDateStr\(todayDateStrInBusinessTz\(\), 1\)/);
});

test('todayAtMidnight() is business-timezone-aware, not runtime-local', () => {
  const fnSrc = extractFn('todayAtMidnight');
  assert.doesNotMatch(fnSrc, /d\.setHours\(0, 0, 0, 0\)/);
  assert.match(fnSrc, /zonedTimeToUtc\(todayDateStrInBusinessTz\(\), 0, 0\)/);
});

test('zonedTimeToUtc converts a Denver wall-clock time to the correct UTC instant across both MST and MDT', () => {
  const { zonedTimeToUtc } = loadHelpers();
  // MST (winter, UTC-7): Denver midnight on 2026-01-15 is 07:00 UTC.
  const winterMidnight = zonedTimeToUtc('2026-01-15', 0, 0);
  assert.equal(winterMidnight.toISOString(), '2026-01-15T07:00:00.000Z');
  // MDT (summer, UTC-6): Denver midnight on 2026-07-15 is 06:00 UTC.
  const summerMidnight = zonedTimeToUtc('2026-07-15', 0, 0);
  assert.equal(summerMidnight.toISOString(), '2026-07-15T06:00:00.000Z');
});

test('addDaysToDateStr adds calendar days correctly across a month boundary', () => {
  const { addDaysToDateStr } = loadHelpers();
  assert.equal(addDaysToDateStr('2026-09-30', 1), '2026-10-01');
  assert.equal(addDaysToDateStr('2026-02-27', 2), '2026-03-01');
});

test('the reminder-check cron firing at 1am UTC (evening of the PREVIOUS day in Denver) now computes the CORRECT business-local "tomorrow", not one full day ahead', () => {
  const src = [
    detype(extractFn('zonedTimeToUtc')),
    detype(extractFn('todayDateStrInBusinessTz')),
    detype(extractFn('addDaysToDateStr')),
  ].join('\n');
  const sandbox = {};
  vm.createContext(sandbox);
  // Simulate the exact moment the cron fires: 2026-09-16T01:00:00Z. In
  // Denver (MDT, UTC-6) that instant is 2026-09-15 19:00 -- so
  // business-local "today" is the 15th and "tomorrow" must be the
  // 16th. Overriding Date on the sandbox's OWN global object (not the
  // outer Node process's) -- vm.createContext gives this code its own
  // realm, so patching the real global.Date here would have no effect
  // on functions defined and called inside this context.
  const RealDate = vm.runInContext('Date', sandbox);
  const cronFireMs = new Date('2026-09-16T01:00:00.000Z').getTime();
  sandbox.Date = class extends RealDate {
    constructor(...args) {
      if (args.length === 0) return new RealDate(cronFireMs);
      return new RealDate(...args);
    }
    static now() { return cronFireMs; }
  };
  vm.runInContext(src, sandbox);

  const todayLocal = sandbox.todayDateStrInBusinessTz();
  assert.equal(todayLocal, '2026-09-15', 'business-local "today" at cron-fire time must be the 15th, not the 16th');
  const tomorrowLocal = sandbox.addDaysToDateStr(todayLocal, 1);
  assert.equal(tomorrowLocal, '2026-09-16', 'business-local "tomorrow" must be the 16th, not the 17th (the old UTC-based bug would have produced this)');
});
