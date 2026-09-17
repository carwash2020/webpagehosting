// Tests for send-push-index.ts's auth check (2026-09-17 security audit)
// -- same regression class already fixed for uptime-alert-index.ts and
// send-payment-reminder-index.ts/send-quote-followup-index.ts: the
// function had no auth check at all beyond Supabase's platform-level
// verify_jwt, which only validates a JWT's signature, not its role. The
// public anon key (embedded in every page's HTML) is itself a validly-
// signed JWT, so anyone holding it could POST directly to this function
// and either spam arbitrary users via the "client-notification" branch
// (any caller-supplied user_id) or broadcast fake internal alerts to
// Steve/Connor. Every real caller -- the th_leads/th_bookings database
// triggers, the daily-reminder-check and weekly-digest crons,
// uptime-alert-index.ts, and every other Edge Function that fires a
// "client-notification" or internal alert -- already authenticates with
// the service_role key (see sql/security/fix_cron_job_use_vault_secret.sql's
// send_push_service_role_key vault secret and uptime-alert-index.ts's own
// sendPushAlert()), so the function now requires that exact bearer token.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const SRC = fs.readFileSync(repo('edge-functions', 'send-push-index.ts'), 'utf8');

test('send-push-index.ts requires the bearer token to match SERVICE_ROLE_KEY before doing anything else', () => {
  const handlerMatch = SRC.match(/Deno\.serve\(async \(req: Request\) => \{[\s\S]*?\n\}\);/);
  assert.ok(handlerMatch, 'expected to isolate the Deno.serve handler');
  const authCheckIdx = handlerMatch[0].indexOf('token !== SERVICE_ROLE_KEY');
  const payloadReadIdx = handlerMatch[0].indexOf('await req.json()');
  assert.ok(authCheckIdx !== -1, 'expected an explicit SERVICE_ROLE_KEY comparison');
  assert.ok(payloadReadIdx !== -1, 'expected the payload to still be read after the check');
  assert.ok(authCheckIdx < payloadReadIdx, 'the auth check must happen before the payload is trusted/used');
  assert.match(handlerMatch[0], /status: 401/);
});

test('every real caller in this repo already authenticates Send-Push with the service_role key this check now requires', () => {
  const sqlFiles = [
    'sql/leads/notify_new_lead_use_vault_secret.sql',
    'sql/booking/add_booking_notifications.sql',
    'sql/booking/add_booking_cancellation.sql',
    'sql/booking/add_booking_reschedule.sql',
    'sql/security/fix_cron_job_use_vault_secret.sql',
    'sql/infra/add_weekly_digest_and_notification_archive_cron.sql',
    'sql/infra/add_cron_watchdog.sql',
  ];
  for (const file of sqlFiles) {
    const contents = fs.readFileSync(repo(...file.split('/')), 'utf8');
    assert.match(
      contents,
      /'Authorization',\s*'Bearer '\s*\|\|\s*(service_key|\(select decrypted_secret from vault\.decrypted_secrets where name = 'send_push_service_role_key')/,
      `expected ${file} to call Send-Push with the service_role key`,
    );
  }

  const uptimeAlert = fs.readFileSync(repo('edge-functions', 'uptime-alert-index.ts'), 'utf8');
  assert.match(uptimeAlert, /functions\/v1\/Send-Push[\s\S]*?Authorization: `Bearer \$\{SERVICE_ROLE_KEY\}`/);
});
