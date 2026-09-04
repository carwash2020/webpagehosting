// Tests for real notification toggles (2026-09-03), requested
// directly: "Real notification toggles" -- Settings previously just
// showed a fixed paragraph of text with no actual control.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const SEND_INVOICE = fs.readFileSync(repo('edge-functions', 'send-invoice-notification-index.ts'), 'utf8');
const SEND_QUOTE = fs.readFileSync(repo('edge-functions', 'send-quote-notification-index.ts'), 'utf8');
const SCHEDULED = fs.readFileSync(repo('edge-functions', 'notify-work-order-scheduled-email-index.ts'), 'utf8');
const MESSAGE = fs.readFileSync(repo('edge-functions', 'notify-work-order-message-email-index.ts'), 'utf8');
const SETTINGS = fs.readFileSync(repo('portal', 'settings.html'), 'utf8');

const FUNCS = [
  { name: 'send-invoice-notification', src: SEND_INVOICE, column: 'wants_invoice_quote_emails' },
  { name: 'send-quote-notification', src: SEND_QUOTE, column: 'wants_invoice_quote_emails' },
  { name: 'notify-work-order-scheduled-email', src: SCHEDULED, column: 'wants_work_order_emails' },
];

for (const { name, src, column } of FUNCS) {
  test(`${name} checks ${column} before sending, defaulting to true if unset`, () => {
    const fnMatch = src.match(/async function clientWantsNotification\(email: string, column: string\)[\s\S]*?\n\}\n/);
    assert.ok(fnMatch, `expected to isolate clientWantsNotification() in ${name}`);
    const body = fnMatch[0];
    assert.match(body, /if \(!res\.ok\) return true;/);
    assert.match(body, /if \(!rows\.length\) return true;/);
    assert.match(src, new RegExp(`clientWantsNotification\\([a-zA-Z_.]+, "${column}"\\)`));
  });

  test(`${name} returns ok:true with a skipped flag on opt-out, not an error`, () => {
    assert.match(src, /skipped: "client opted out of/);
  });
}

test('notify-work-order-message-email only checks the preference on the internal-to-client branch, never the client-to-internal branch', () => {
  const internalBranch = MESSAGE.match(/if \(msg\.sender_type === "internal"\) \{[\s\S]*?\n    \}\n/);
  assert.ok(internalBranch);
  assert.match(internalBranch[0], /clientWantsNotification\(wo\.client_email, "wants_message_emails"\)/);

  const clientBranch = MESSAGE.match(/\/\/ Client -> internal[\s\S]*?\n  \} catch/);
  assert.ok(clientBranch, 'expected to isolate the client-to-internal branch');
  assert.doesNotMatch(clientBranch[0], /clientWantsNotification/,
    'a client message must always notify the internal team regardless of any preference');
});

// ---- frontend ----

test('the settings page shows three real toggles, defaulting to checked, and loads/saves them on change', () => {
  assert.match(SETTINGS, /<input type="checkbox" id="notifyInvoiceQuote">/);
  assert.match(SETTINGS, /<input type="checkbox" id="notifyWorkOrder">/);
  assert.match(SETTINGS, /<input type="checkbox" id="notifyMessages">/);
  assert.match(SETTINGS, /loadNotificationPreferences\(\);/);
  const wireUp = SETTINGS.match(/\['notifyInvoiceQuote', 'notifyWorkOrder', 'notifyMessages'\]\.forEach\(id => \{[\s\S]*?\}\);/);
  assert.ok(wireUp);
  assert.match(wireUp[0], /addEventListener\('change', saveNotificationPreference\)/);
});

test('a client with no saved preferences yet sees every toggle checked by default, matching the column defaults', () => {
  const fnMatch = SETTINGS.match(/async function loadNotificationPreferences\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate loadNotificationPreferences()');
  const body = fnMatch[0];
  assert.match(body, /data \? data\.wants_invoice_quote_emails !== false : true/);
  assert.match(body, /data \? data\.wants_work_order_emails !== false : true/);
  assert.match(body, /data \? data\.wants_message_emails !== false : true/);
});

test('saving upserts keyed by the caller\'s own session email, redirecting to login if the session is missing', () => {
  const fnMatch = SETTINGS.match(/async function saveNotificationPreference\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate saveNotificationPreference()');
  const body = fnMatch[0];
  assert.match(body, /client_email: session\.user\.email,/);
  assert.match(body, /window\.location\.replace\('\/portal\/login\.html'\)/);
});
