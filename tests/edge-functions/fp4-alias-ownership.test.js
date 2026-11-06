// Fix plan FP4.2 (2026-11-06, D11): the client-facing edge functions that
// check "is this record yours?" accept the caller's sign-in email or one
// they have PROVED they own (a confirmed alias) -- nothing else. Runs the real
// respond-to-quote handler with a fake database, and pins that all six
// functions share the same fail-closed helper. Made-up accounts only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { stripTypeScriptTypes } = require('module');

const EF = (n) => fs.readFileSync(path.join(__dirname, '..', '..', 'edge-functions', n + '-index.ts'), 'utf8');
const SIX = ['cancel-work-order', 'get-job-photo-urls', 'respond-to-quote', 'schedule-checkup-visit', 'schedule-quote-job', 'respond-to-contract'];
const j = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const SAM = { sub: 'u-sam', email: 'sam@example.com', role: 'authenticated' };
const KIM = { sub: 'u-kim', email: 'kim@example.com', role: 'authenticated' };

function respondToQuote({ quoteEmail, aliases = [], aliasesFail = false }) {
  const st = { patched: 0 };
  const fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.pathname === '/rest/v1/client_email_aliases') {
      if (aliasesFail) return j({ message: 'relation does not exist' }, 404);
      const uid = u.searchParams.get('user_id').slice(3);
      assert.equal(u.searchParams.get('status'), 'eq.confirmed', 'confirmed aliases only');
      return j(aliases.filter((a) => a.user_id === uid && a.status === 'confirmed').map((a) => ({ email: a.email })));
    }
    if (u.pathname === '/rest/v1/client_portal_quotes' && (init.method || 'GET') === 'GET') return j([{ id: 7, client_email: quoteEmail, status: 'pending' }]);
    if (u.pathname === '/rest/v1/client_portal_quotes' && init.method === 'PATCH') { st.patched++; return j([]); }
    throw new Error('unexpected ' + u);
  };
  let handler;
  vm.runInContext(stripTypeScriptTypes(EF('respond-to-quote')), vm.createContext({
    Deno: { env: { get: (k) => ({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srk' })[k] }, serve: (h) => { handler = h; } },
    fetch, Response, Request, Headers, URL, URLSearchParams, atob, console: { log() {}, error() {} },
    JSON, Math, Date, Promise, Number, String, Array, Object, encodeURIComponent, decodeURIComponent,
  }));
  const call = async (who) => {
    const res = await handler(new Request('https://example.supabase.co/functions/v1/respond-to-quote', {
      method: 'POST', headers: { Authorization: 'Bearer h.' + b64u(who) + '.s', 'Content-Type': 'application/json' },
      body: JSON.stringify({ quote_id: 7, action: 'approve' }),
    }));
    return res.status;
  };
  return { call, st };
}

test('a quote sent to a confirmed alias can be answered by its owner -- and by no one else', async () => {
  const aliases = [{ user_id: 'u-sam', email: 'sam.work@example.com', status: 'confirmed' }];
  const g = respondToQuote({ quoteEmail: 'Sam.Work@Example.com', aliases });
  assert.equal(await g.call(KIM), 403);
  assert.equal(g.st.patched, 0);
  assert.equal(await g.call(SAM), 200);
  assert.equal(g.st.patched, 1);
});

test('a pending alias, an alias of someone else, or an unreadable alias table counts for nothing', async () => {
  for (const opts of [
    { aliases: [{ user_id: 'u-sam', email: 'sam.work@example.com', status: 'pending' }] },
    { aliases: [{ user_id: 'u-kim', email: 'sam.work@example.com', status: 'confirmed' }] },
    { aliasesFail: true },
  ]) {
    const g = respondToQuote({ quoteEmail: 'sam.work@example.com', ...opts });
    assert.equal(await g.call(SAM), 403);
    assert.equal(g.st.patched, 0);
  }
  const own = respondToQuote({ quoteEmail: 'sam@example.com', aliasesFail: true });
  assert.equal(await own.call(SAM), 200, 'the sign-in email alone still works, before the table exists');
});

test('all nine ownership checks use the same helper, and none still compares to the sign-in email alone', () => {
  const helper = (src) => src.slice(src.indexOf('async function callerEmails('), src.indexOf('\n}\n', src.indexOf('async function callerEmails(')));
  const first = helper(EF(SIX[0]));
  assert.match(first, /status=eq\.confirmed/);
  for (const n of SIX) {
    const src = EF(n);
    assert.equal(helper(src), first, n + ': same helper');
    assert.match(src, /if \(!\(await callerEmails\(claims\)\)\.includes\(String\(\w+\.client_email\)\.toLowerCase\(\)\)\) \{/, n);
    assert.doesNotMatch(src, /client_email\.toLowerCase\(\) !== claims\.email\.toLowerCase\(\)/, n);
  }
  // The money paths: paying an invoice (one or several) and the saved-card gate.
  for (const n of ['create-payment-intent', 'create-bulk-payment-intent', 'manage-saved-card']) {
    const src = EF(n);
    assert.equal(helper(src), first, n + ': same helper');
    assert.doesNotMatch(src, /client_email\.toLowerCase\(\) !== claims\.email\.toLowerCase\(\)/, n);
  }
  assert.match(EF('create-payment-intent'), /if \(!\(await callerEmails\(claims\)\)\.includes\(String\(invoice\.client_email\)\.toLowerCase\(\)\)\) \{/);
  assert.match(EF('create-bulk-payment-intent'), /const notOwned = invoices\.find\(\(inv: any\) => !mine\.includes\(String\(inv\.client_email\)\.toLowerCase\(\)\)\);/);
  assert.match(EF('manage-saved-card'), /for \(const email of await callerEmails\(claims\)\) if \(await accountHasBusinessRecord\(email\)\)/);
  // The card itself stays on the payer's own Stripe customer.
  assert.match(EF('create-payment-intent'), /getOrCreateStripeCustomer\(claims\.email\)/);
});
