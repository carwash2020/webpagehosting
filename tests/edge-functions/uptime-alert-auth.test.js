// Tests for uptime-alert-index.ts's auth check (2026-09-15).
//
// The function previously had no auth check at all beyond Supabase's
// platform-level verify_jwt -- which only validates a JWT's signature,
// not its role. The public anon key (embedded in every page's HTML) is
// itself a validly-signed JWT, so anyone holding it could POST directly
// to this function and fire spoofed "site is down"/"back up" push
// notifications and emails to Steve/Connor at will. The only real
// caller is the uptime-check GitHub Actions workflow, which already
// authenticates with the service_role key (see
// .github/workflows/uptime-check.yml) -- so the function now requires
// that exact bearer token.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const UPTIME_ALERT = fs.readFileSync(repo('edge-functions', 'uptime-alert-index.ts'), 'utf8');
const WORKFLOW = fs.readFileSync(repo('.github', 'workflows', 'uptime-check.yml'), 'utf8');

test('uptime-alert-index.ts requires the bearer token to match SERVICE_ROLE_KEY before doing anything else', () => {
  const handlerMatch = UPTIME_ALERT.match(/Deno\.serve\(async \(req: Request\) => \{[\s\S]*?\n\}\);/);
  assert.ok(handlerMatch, 'expected to isolate the Deno.serve handler');
  const authCheckIdx = handlerMatch[0].indexOf('token !== SERVICE_ROLE_KEY');
  const payloadReadIdx = handlerMatch[0].indexOf('await req.json()');
  assert.ok(authCheckIdx !== -1, 'expected an explicit SERVICE_ROLE_KEY comparison');
  assert.ok(payloadReadIdx !== -1, 'expected the payload to still be read after the check');
  assert.ok(authCheckIdx < payloadReadIdx, 'the auth check must happen before the payload is trusted/used');
  assert.match(handlerMatch[0], /status: 401/);
});

test('the only real caller (uptime-check.yml) already authenticates with the service_role key this check now requires', () => {
  const alertCall = WORKFLOW.match(/curl -s -X POST "\$SUPABASE_URL\/functions\/v1\/uptime-alert"[\s\S]*?-o \/dev\/null/)[0];
  assert.match(alertCall, /Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY/);
});
