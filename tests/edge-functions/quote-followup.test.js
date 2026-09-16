// Tests for automated client-facing quote follow-up emails (2026-09-16),
// same audit pass as payment-reminder: an unconverted quote already
// notified STEVE internally after 14 days, but never the client, who
// saw the quote once and then nothing ever followed up if they didn't
// come back on their own.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const SRC = fs.readFileSync(repo('edge-functions', 'send-quote-followup-index.ts'), 'utf8');
const CRON_SQL = fs.readFileSync(repo('sql', 'infra', 'add_quote_followup_email_cron.sql'), 'utf8');

test('reuses existing secrets only -- no new secret introduced', () => {
  assert.match(SRC, /RESEND_API_KEY/);
  assert.match(SRC, /LEAD_EMAIL_FROM/);
  assert.match(SRC, /LEAD_EMAIL_TO/);
  assert.doesNotMatch(SRC, /Deno\.env\.get\("(?!RESEND_API_KEY|LEAD_EMAIL_FROM|LEAD_EMAIL_TO|SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)/);
});

test('queries client_portal_quotes directly -- the real client-facing source of truth, not the internal workspace_sync blob', () => {
  assert.match(SRC, /client_portal_quotes\?select=/);
  assert.match(SRC, /status=eq\.pending/);
});

test('follows up at 7 days, earlier than send-push\'s own 14-day internal alert to Steve', () => {
  assert.match(SRC, /const FOLLOWUP_DAYS = 7;/);
  assert.match(SRC, /quote_date=lte\.\$\{cutoffStr\}/);
});

test('a quote with no client email on file is silently skipped, never crashes the run', () => {
  const handler = SRC.match(/Deno\.serve\(async \(req: Request\) => \{[\s\S]*?\n\}\);/);
  assert.ok(handler);
  assert.match(handler[0], /if \(!clientEmail\) continue;/);
});

test('dedupes per quote via notification_log, keyed on the real quote id', () => {
  const alreadySentFn = SRC.match(/async function alreadySent\(itemKey: string\): Promise<boolean> \{[\s\S]*?\n\}\n/);
  assert.ok(alreadySentFn, 'expected to isolate alreadySent()');
  assert.match(alreadySentFn[0], /notification_log\?notif_type=eq\.quote-followup-email&item_key=eq\./);

  const markSentFn = SRC.match(/async function markSent\(itemKey: string\): Promise<void> \{[\s\S]*?\n\}\n/);
  assert.ok(markSentFn, 'expected to isolate markSent()');
  assert.match(markSentFn[0], /on_conflict=notif_type,item_key/);
  assert.match(markSentFn[0], /resolution=merge-duplicates/);

  const handler = SRC.match(/Deno\.serve\(async \(req: Request\) => \{[\s\S]*?\n\}\);/);
  assert.match(handler[0], /const itemKey = String\(quote\.source_quote_id\);/);
});

test('respects the client\'s existing invoice/quote email preference before sending -- same column as send-payment-reminder/send-invoice-notification', () => {
  const fnMatch = SRC.match(/async function clientWantsEmail\(email: string\): Promise<boolean> \{[\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate clientWantsEmail()');
  assert.match(fnMatch[0], /wants_invoice_quote_emails/);
  assert.match(fnMatch[0], /if \(!res\.ok\) return true;/);
  assert.match(fnMatch[0], /if \(!rows\.length\) return true;/);
  assert.match(fnMatch[0], /return rows\[0\]\.wants_invoice_quote_emails !== false;/);

  const handler = SRC.match(/Deno\.serve\(async \(req: Request\) => \{[\s\S]*?\n\}\);/);
  assert.match(handler[0], /if \(!\(await clientWantsEmail\(clientEmail\)\)\) continue;/);
});

test('email links to the client portal quotes page to respond, and sets Reply-To back to the internal team', () => {
  assert.match(SRC, /https:\/\/www\.triplehenterprisesllc\.biz\/portal\/quotes\.html/);
  assert.match(SRC, /\.\.\.\(LEAD_EMAIL_TO\.length \? \{ reply_to: LEAD_EMAIL_TO \} : \{\}\)/);
});

test('exactly one Deno.serve handler, structure intact', () => {
  const matches = SRC.match(/^Deno\.serve/gm) || [];
  assert.equal(matches.length, 1);
});

test('the run always returns ok:true with checked/sent counts on success, and a real error shape on failure', () => {
  assert.match(SRC, /return new Response\(JSON\.stringify\(\{ ok: true, checked, sent \}\)/);
  assert.match(SRC, /return new Response\(JSON\.stringify\(\{ ok: false, error: err\.message \}\)/);
  assert.match(SRC, /status: 500,/);
});

// ---- cron registration ----

test('registered as a daily pg_cron job, offset an hour from the payment-reminder cron', () => {
  assert.match(CRON_SQL, /send-quote-followup-daily/);
  assert.match(CRON_SQL, /'0 16 \* \* \*'/);
});

test('cron job uses the same vault-secret pattern as every other cron job in this project, no hardcoded key', () => {
  assert.match(CRON_SQL, /vault\.decrypted_secrets where name = 'send_push_service_role_key'/);
  assert.match(CRON_SQL, /functions\/v1\/send-quote-followup/);
});
