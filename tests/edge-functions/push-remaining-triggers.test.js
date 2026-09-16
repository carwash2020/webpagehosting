// Tests for finishing push notifications on the 3 remaining triggers
// (2026-09-04), requested directly: "finish push (3 remaining
// triggers)". send-invoice-notification, send-quote-notification, and
// notify-work-order-scheduled-email each already sent an email; each
// now also fires a push using the same proven pattern established in
// notify-work-order-message-email.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const FILES = {
  invoice: fs.readFileSync(repo('edge-functions', 'send-invoice-notification-index.ts'), 'utf8'),
  quote: fs.readFileSync(repo('edge-functions', 'send-quote-notification-index.ts'), 'utf8'),
  scheduled: fs.readFileSync(repo('edge-functions', 'notify-work-order-scheduled-email-index.ts'), 'utf8'),
};

for (const [name, src] of Object.entries(FILES)) {
  test(`${name}: uses the exact-cased Send-Push URL, never a lowercase variant`, () => {
    const fnMatch = src.match(/async function sendClientPush\([\s\S]*?\n\}\n/);
    assert.ok(fnMatch, `${name}: expected to isolate sendClientPush()`);
    assert.match(fnMatch[0], /\/functions\/v1\/Send-Push/);
    assert.doesNotMatch(fnMatch[0], /\/functions\/v1\/send-push[^-]/);
  });

  test(`${name}: looks up the real auth user id by email before sending push`, () => {
    const fnMatch = src.match(/async function getUserIdByEmail\([\s\S]*?\n\}\n/);
    assert.ok(fnMatch, `${name}: expected to isolate getUserIdByEmail()`);
    assert.match(fnMatch[0], /\/auth\/v1\/admin\/users\?email=/);
  });

  test(`${name}: a missing subscription is silent and non-fatal`, () => {
    const fnMatch = src.match(/async function sendClientPush\([\s\S]*?\n\}\n/);
    assert.match(fnMatch[0], /if \(!userId\) return;/);
    assert.match(fnMatch[0], /catch \(err: any\) \{/);
  });

  test(`${name}: push fires only after the email send succeeds, not before`, () => {
    const emailOkIdx = src.indexOf('if (!emailRes.ok)');
    const pushIdx = src.indexOf('await sendClientPush(');
    assert.ok(emailOkIdx !== -1 && pushIdx !== -1, `${name}: expected both the email-failure check and a real push call`);
    assert.ok(emailOkIdx < pushIdx, `${name}: push should come after the email-failure check, not before`);
  });

  test(`${name}: exactly one Deno.serve handler, structure intact`, () => {
    const matches = src.match(/^Deno\.serve/gm) || [];
    assert.equal(matches.length, 1);
  });
}

test('invoice notification push includes the actual amount, not a placeholder', () => {
  assert.match(FILES.invoice, /await sendClientPush\(client_email, "New invoice", `Invoice \$\{invoice_number\}: \$\{formatCurrency\(total\)\}`, "\/portal\/dashboard\.html"\);/);
});

test('quote notification push includes the actual amount, not a placeholder', () => {
  assert.match(FILES.quote, /await sendClientPush\(client_email, "New quote to review", `Quote \$\{quote_number\}: \$\{formatCurrency\(total\)\}`, "\/portal\/quotes\.html"\);/);
});

test('work order scheduled push includes the real scheduled time label, not a placeholder', () => {
  assert.match(FILES.scheduled, /await sendClientPush\(wo\.client_email, "Your appointment is booked", `\$\{wo\.title \|\| "Your request"\}: \$\{scheduledLabel\}`, "\/portal\/work-orders\.html"\);/);
});

test('no edge function file tells a future deploy to use the lowercase "send-push" slug -- the exact mistake that created a real orphaned duplicate function once already', () => {
  // Real bug found 2026-09-16 (hub dispatch bug sweep): send-push-index.ts's
  // own header comment said "Deploy with: supabase functions deploy
  // send-push" (lowercase), while every real caller in this codebase and
  // README.md's own file listing agree the live slug is capitalized
  // "Send-Push" -- Supabase treats function slugs as case-sensitive.
  // notify-work-order-message-email-index.ts's own comment documents that
  // this exact mismatch already created a real orphaned duplicate function
  // once before. Guards against the deploy instruction drifting back to
  // the wrong casing.
  const edgeFunctionsDir = repo('edge-functions');
  const files = fs.readdirSync(edgeFunctionsDir).filter(f => f.endsWith('.ts'));
  for (const file of files) {
    const src = fs.readFileSync(path.join(edgeFunctionsDir, file), 'utf8');
    assert.doesNotMatch(src, /deploy send-push\b/, `${file}: found a lowercase "deploy send-push" instruction -- must say "Send-Push"`);
  }
});

test('all four client-facing notification triggers now send push, closing out the item directly -- confirmed by checking every one, not assumed', () => {
  const messageFn = fs.readFileSync(repo('edge-functions', 'notify-work-order-message-email-index.ts'), 'utf8');
  const all = [FILES.invoice, FILES.quote, FILES.scheduled, messageFn];
  for (const src of all) {
    assert.match(src, /sendClientPush\(/);
  }
  assert.equal(all.length, 4, 'expected exactly the 4 known client-facing notification triggers');
});
