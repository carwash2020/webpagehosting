// CodeQL "Clear text storage of sensitive information" alert #53
// (2026-09-07), on the localStorage.setItem() call inside logClientError().
// Root cause: event.message/event.error.stack come straight from the
// browser with no guarantee they're PII-free -- this tool suite handles
// real customer data (job-tracker's Contacts tab, invoice generator's
// client fields), so a validation error elsewhere could legitimately read
// like "Invalid phone: 435-555-0100" or echo a client's email back into a
// thrown Error's own message. Since this log syncs across devices via
// sync.js in clear text, that risk is real. Fixed by scrubbing known PII
// shapes (emails, phone numbers, long digit runs) before persisting.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const SRC = fs.readFileSync(repo('tools', 'tools-media-sharing.js'), 'utf8');

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

test('redactSensitiveText() scrubs emails, phone numbers, and long digit runs (SSN/card-shaped)', () => {
  const fn = extractFn(SRC, 'redactSensitiveText');
  const redactSensitiveText = eval(`(${fn})`); // eslint-disable-line no-eval

  assert.equal(redactSensitiveText('Invalid phone: 435-555-0100'), 'Invalid phone: [redacted-phone]');
  assert.equal(redactSensitiveText('Invalid phone: (435) 555-0100'), 'Invalid phone: [redacted-phone]');
  assert.equal(redactSensitiveText('Call +1 435.555.0100 now'), 'Call [redacted-phone] now');
  assert.equal(
    redactSensitiveText('Validation failed for steve@triplehenterprisesllc.biz'),
    'Validation failed for [redacted-email]'
  );
  assert.equal(redactSensitiveText('SSN 123456789 is invalid'), 'SSN [redacted-number] is invalid');
  assert.equal(redactSensitiveText('Card 4111111111111111 declined'), 'Card [redacted-number] declined');
});

test('redactSensitiveText() leaves ordinary JS exception text (no PII shapes) completely untouched', () => {
  const fn = extractFn(SRC, 'redactSensitiveText');
  const redactSensitiveText = eval(`(${fn})`); // eslint-disable-line no-eval

  const ordinary = "Cannot read properties of undefined (reading 'foo')";
  assert.equal(redactSensitiveText(ordinary), ordinary);
  const stackLine = 'TypeError: fetch failed at https://csvfqdjuobylgafgolho.supabase.co/rest/v1/jobs';
  assert.equal(redactSensitiveText(stackLine), stackLine);
});

test('redactSensitiveText() is a safe passthrough for null/undefined/empty', () => {
  const fn = extractFn(SRC, 'redactSensitiveText');
  const redactSensitiveText = eval(`(${fn})`); // eslint-disable-line no-eval
  assert.equal(redactSensitiveText(null), null);
  assert.equal(redactSensitiveText(undefined), undefined);
  assert.equal(redactSensitiveText(''), '');
});

test('logClientError() actually routes message and stack through redactSensitiveText() before storing', () => {
  const fn = extractFn(SRC, 'logClientError');
  assert.match(fn, /message: redactSensitiveText\(/);
  assert.match(fn, /stack: stack \? redactSensitiveText\(/);
});

// Widened 2026-09-08: the same CodeQL alert #53 was still open after the
// fix above, since a plain .replace() call isn't recognized as a
// sanitizer by CodeQL's dataflow analysis -- and the original patterns
// only covered customer PII, not a credential that ends up embedded in
// an error's message/stack/source (a JWT, or a token in a fetch URL's
// query string).
test('redactSensitiveText() scrubs a JWT-shaped auth token', () => {
  const fn = extractFn(SRC, 'redactSensitiveText');
  const redactSensitiveText = eval(`(${fn})`); // eslint-disable-line no-eval
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
  assert.equal(redactSensitiveText(`Auth failed, token ${jwt} rejected`), 'Auth failed, token [redacted-token] rejected');
});

test('redactSensitiveText() scrubs credential-shaped query-string parameters wherever they appear', () => {
  const fn = extractFn(SRC, 'redactSensitiveText');
  const redactSensitiveText = eval(`(${fn})`); // eslint-disable-line no-eval
  assert.equal(
    redactSensitiveText('fetch failed at https://example.com/api?token=abc123&id=5'),
    'fetch failed at https://example.com/api?token=[redacted]&id=5'
  );
  assert.equal(
    redactSensitiveText('https://example.com/reset?access_token=xyz789'),
    'https://example.com/reset?access_token=[redacted]'
  );
  // A plain "id" or "page" param (not credential-shaped) is untouched.
  const benign = 'https://example.com/api?id=5&page=2';
  assert.equal(redactSensitiveText(benign), benign);
});

test('logClientError() now also redacts the source field (a script/page URL that could carry a query-string token)', () => {
  const fn = extractFn(SRC, 'logClientError');
  assert.match(fn, /source: source \? redactSensitiveText\(/);
});
