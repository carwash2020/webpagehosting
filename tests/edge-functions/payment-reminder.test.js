// Tests for automated client-facing payment reminder emails
// (2026-09-16), from an audit of invoice/review/schedule/email/report
// automation: overdue invoices already notified STEVE (push + the
// Dashboard's Outstanding/Overdue cards) but never the client -- he
// had to notice and follow up by hand every time. This closes that
// gap with a daily cron that emails the client directly at 3/7/14
// days overdue.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const SRC = fs.readFileSync(repo('edge-functions', 'send-payment-reminder-index.ts'), 'utf8');
const CRON_SQL = fs.readFileSync(repo('sql', 'infra', 'add_payment_reminder_emails_cron.sql'), 'utf8');

test('reuses existing secrets only -- no new secret introduced', () => {
  assert.match(SRC, /RESEND_API_KEY/);
  assert.match(SRC, /LEAD_EMAIL_FROM/);
  assert.match(SRC, /LEAD_EMAIL_TO/);
  assert.doesNotMatch(SRC, /Deno\.env\.get\("(?!RESEND_API_KEY|LEAD_EMAIL_FROM|LEAD_EMAIL_TO|SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)/);
});

test('three ascending escalation checkpoints: 3, 7, 14 days overdue', () => {
  assert.match(SRC, /const STAGES = \[3, 7, 14\] as const;/);
  assert.match(SRC, /invoice-reminder-\$\{stage\}d/);
});

test('pickStage() returns the highest crossed checkpoint, not the first', () => {
  const fnMatch = SRC.match(/function pickStage\(overdueDays: number\): Stage \| null \{[\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate pickStage()');
  const body = fnMatch[0];
  assert.match(body, /if \(overdueDays >= s\) picked = s;/);
  assert.doesNotMatch(body, /break;/, 'must keep scanning to find the HIGHEST match, not stop at the first');
});

test('an invoice under the 3-day checkpoint, or already fully paid, is skipped', () => {
  const handler = SRC.match(/Deno\.serve\(async \(req: Request\) => \{[\s\S]*?\n\}\);/);
  assert.ok(handler);
  assert.match(handler[0], /if \(remainingCents <= 0\) continue; \/\/ paid in full/);
  assert.match(handler[0], /if \(stage === null\) continue; \/\/ not yet at the first/);
});

test('partial payments are handled the same whole-cents-rounded way as workspace.html (getPaidAmount/getRemainingCents)', () => {
  assert.match(SRC, /function getPaidAmount\(invoice: Record<string, unknown>\): number \{/);
  assert.match(SRC, /if \(invoice\.paidAmount !== undefined && invoice\.paidAmount !== null\) return Number\(invoice\.paidAmount\) \|\| 0;/);
  assert.match(SRC, /return invoice\.paid \? Number\(invoice\.total\) \|\| 0 : 0;/);
  assert.match(SRC, /function toCents\(n: unknown\): number \{/);
});

test('each stage is checked against notification_log by existence only, never resent once sent', () => {
  const fnMatch = SRC.match(/async function alreadySent\(notifType: string, itemKey: string\): Promise<boolean> \{[\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate alreadySent()');
  assert.match(fnMatch[0], /notification_log\?notif_type=eq\.\$\{notifType\}&item_key=eq\./);
  assert.match(fnMatch[0], /return rows\.length > 0;/);
});

test('marking sent uses the real (notif_type, item_key) unique constraint via on_conflict, not the default primary key', () => {
  const fnMatch = SRC.match(/async function markSent\(notifType: string, itemKey: string\): Promise<void> \{[\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate markSent()');
  assert.match(fnMatch[0], /on_conflict=notif_type,item_key/);
  assert.match(fnMatch[0], /resolution=merge-duplicates/);
});

test('respects the client\'s existing invoice/quote email preference before sending', () => {
  const fnMatch = SRC.match(/async function clientWantsEmail\(email: string\): Promise<boolean> \{[\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate clientWantsEmail()');
  assert.match(fnMatch[0], /wants_invoice_quote_emails/);
  assert.match(fnMatch[0], /if \(!res\.ok\) return true;/);
  assert.match(fnMatch[0], /if \(!rows\.length\) return true;/);
  assert.match(fnMatch[0], /return rows\[0\]\.wants_invoice_quote_emails !== false;/);

  const handler = SRC.match(/Deno\.serve\(async \(req: Request\) => \{[\s\S]*?\n\}\);/);
  assert.ok(handler);
  assert.match(handler[0], /if \(!\(await clientWantsEmail\(clientEmail\)\)\) continue;/);
});

test('an invoice with no client email on file is silently skipped, never crashes the run', () => {
  const handler = SRC.match(/Deno\.serve\(async \(req: Request\) => \{[\s\S]*?\n\}\);/);
  assert.match(handler[0], /if \(!clientEmail\) continue;/);
});

test('due-date math matches TERM_DAYS used elsewhere in this project exactly', () => {
  assert.match(SRC, /const TERM_DAYS: Record<string, number> = \{ "Due Upon Receipt": 0, "Net 15": 15, "Net 30": 30 \};/);
});

test('email links to the client portal to pay, and sets Reply-To back to the internal team', () => {
  assert.match(SRC, /https:\/\/www\.triplehenterprisesllc\.biz\/portal\/dashboard\.html/);
  assert.match(SRC, /\.\.\.\(LEAD_EMAIL_TO\.length \? \{ reply_to: LEAD_EMAIL_TO \} : \{\}\)/);
});

test('all three stages have distinct subject lines and escalate in tone', () => {
  assert.match(SRC, /3: \{[\s\S]*?subject: "Friendly reminder: invoice from Triple H Enterprises",/);
  assert.match(SRC, /7: \{[\s\S]*?subject: "Reminder: payment due on your Triple H Enterprises invoice",/);
  assert.match(SRC, /14: \{[\s\S]*?subject: "Checking in: your Triple H Enterprises invoice is still open",/);
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

test('registered as a daily (not hourly) pg_cron job, matching the day-level nature of "overdue"', () => {
  assert.match(CRON_SQL, /send-payment-reminders-daily/);
  assert.match(CRON_SQL, /'0 15 \* \* \*'/);
});

test('cron job uses the same vault-secret pattern as every other cron job in this project, no hardcoded key', () => {
  assert.match(CRON_SQL, /vault\.decrypted_secrets where name = 'send_push_service_role_key'/);
  assert.match(CRON_SQL, /functions\/v1\/send-payment-reminder/);
});
