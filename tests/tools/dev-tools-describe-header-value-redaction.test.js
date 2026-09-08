// CodeQL alert #57 "Clear text storage of sensitive information"
// (2026-09-08), found while investigating why the CodeQL rescan of PR
// #194's own suppression fix for alert #53 still failed: describeHeaderValue()
// is called with real credentials (SUPABASE_ANON_KEY, a live
// Authorization bearer token) to diagnose a "not a valid ByteString"
// fetch error, and its return value can end up in logClientError()'s
// message on a failure. The old implementation's own header comment
// called its return value a "safe-to-log preview" -- it was not: the
// clean-value branch echoed the value's first 12 characters, and the
// bad-char branch echoed up to 10 characters around the bad index.
// redactSensitiveText() only catches full JWT/credential *shapes*
// (three dot-separated JWT segments, a whole credential-looking query
// param), never a short arbitrary excerpt of one -- so a 12-character
// slice of a real Supabase anon key or bearer token survived
// redaction and would have been stored (and synced across devices) in
// clear text. Fixed by never echoing back any of the value's own
// characters, clean or not -- only length and the bad character's
// position/code point.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const HTML = fs.readFileSync(repo('tools', 'dev-tools.html'), 'utf8');

function extractFn(name) {
  const start = HTML.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  const braceStart = HTML.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return HTML.slice(start, i);
}

test('describeHeaderValue() never echoes back any character of a clean credential-shaped value', () => {
  const fn = extractFn('describeHeaderValue');
  const describeHeaderValue = eval(`(${fn})`); // eslint-disable-line no-eval
  const realLookingKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.superSecretSignaturePart';
  const result = describeHeaderValue('apikey', realLookingKey);
  assert.ok(!result.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'), 'must not leak the first 36 chars of the key');
  assert.ok(!result.includes(realLookingKey.slice(0, 12)), 'must not leak even a 12-char prefix of the key');
  assert.match(result, /^apikey: length \d+, clean$/);
});

test('describeHeaderValue() never echoes back characters surrounding a bad byte in a credential-shaped value', () => {
  const fn = extractFn('describeHeaderValue');
  const describeHeaderValue = eval(`(${fn})`); // eslint-disable-line no-eval
  const withBadChar = 'Bearer eyJhbGciOiJIUzI1NiJ9.abc’def.signaturePart';
  const badIndex = withBadChar.indexOf('’');
  const result = describeHeaderValue('Authorization', withBadChar);
  assert.ok(!result.includes(withBadChar.slice(Math.max(0, badIndex - 5), badIndex + 5)), 'must not leak characters around the bad byte');
  assert.ok(!result.includes('eyJhbGciOiJIUzI1NiJ9'), 'must not leak any other part of the token either');
  assert.match(result, /^Authorization: length \d+, bad char at index \d+ \(code point \d+\)$/);
});

test('describeHeaderValue() still reports the non-string case (unrelated to the redaction fix)', () => {
  const fn = extractFn('describeHeaderValue');
  const describeHeaderValue = eval(`(${fn})`); // eslint-disable-line no-eval
  assert.equal(describeHeaderValue('apikey', undefined), 'apikey: not a string (type undefined)');
});

test('the service worker cache was bumped for this change', () => {
  const sw = fs.readFileSync(repo('service-worker.js'), 'utf8');
  const version = Number(sw.match(/const CACHE_NAME = 'th-workspace-v(\d+)';/)[1]);
  assert.ok(version >= 112, `expected v112 or later, got v${version}`);
});
