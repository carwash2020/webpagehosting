// Tests for send-payment-reminder-index.ts's auth check (2026-09-16
// security audit) -- same regression class already fixed once for
// uptime-alert-index.ts (see uptime-alert-auth.test.js): the function had
// no auth check at all beyond Supabase's platform-level verify_jwt, which
// only validates a JWT's signature, not its role. The public anon key
// (embedded in every page's HTML) is itself a validly-signed JWT, so
// anyone holding it could POST directly to this function and fire real
// payment-reminder emails at overdue clients on demand. The only real
// caller is the send-payment-reminders-daily cron (see
// sql/infra/add_payment_reminder_emails_cron.sql), which already
// authenticates with the service_role key -- so the function now requires
// that exact bearer token.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const SRC = fs.readFileSync(repo('edge-functions', 'send-payment-reminder-index.ts'), 'utf8');
const CRON = fs.readFileSync(repo('sql', 'infra', 'add_payment_reminder_emails_cron.sql'), 'utf8');

test('send-payment-reminder-index.ts requires the bearer token to match SERVICE_ROLE_KEY before doing anything else', () => {
  const handlerMatch = SRC.match(/Deno\.serve\(async \(req: Request\) => \{[\s\S]*?\n\}\);/);
  assert.ok(handlerMatch, 'expected to isolate the Deno.serve handler');
  const authCheckIdx = handlerMatch[0].indexOf('token !== SERVICE_ROLE_KEY');
  const invoicesReadIdx = handlerMatch[0].indexOf('await getSyncedInvoices()');
  assert.ok(authCheckIdx !== -1, 'expected an explicit SERVICE_ROLE_KEY comparison');
  assert.ok(invoicesReadIdx !== -1, 'expected invoices to still be read after the check');
  assert.ok(authCheckIdx < invoicesReadIdx, 'the auth check must happen before any work is done');
  assert.match(handlerMatch[0], /status: 401/);
});

test('the only real caller (the payment-reminder cron) already authenticates with the service_role key this check now requires', () => {
  assert.match(CRON, /Authorization',\s*'Bearer '\s*\|\|\s*\(select decrypted_secret from vault\.decrypted_secrets where name = 'send_push_service_role_key'/);
});
