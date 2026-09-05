// Test for a real inconsistency found while investigating a reported
// client-side SyntaxError (2026-09-05): deleteLocalDataKey's own
// onclick used escapeHtml() for a value embedded inside a
// single-quoted JS string literal -- escapeHtml only escapes &, <, >
// (safe for text-node content), not the quote characters that
// actually matter in this specific context. escapeForInlineHandler
// exists precisely for this, documented in its own header comment,
// and every other similar call site on this page already uses it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const DEV_TOOLS = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'dev-tools.html'), 'utf8');

test('deleteLocalDataKey uses the correct escaping function for its inline handler context', () => {
  assert.match(DEV_TOOLS, /deleteLocalDataKey\(\\'\s*'\s*\+\s*escapeForInlineHandler\(k\)/);
  assert.doesNotMatch(DEV_TOOLS, /deleteLocalDataKey\(\\'\s*'\s*\+\s*escapeHtml\(k\)/);
});
