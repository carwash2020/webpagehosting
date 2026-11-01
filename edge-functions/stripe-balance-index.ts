// Supabase Edge Function: stripe-balance
//
// A read-only Stripe balance card for Home (2026-10-31): what's available,
// what's pending, and the latest payout. Finance roles only.
//
// It only ever reads: GET /v1/balance and GET /v1/payouts?limit=1. It never
// creates a charge, transfer or payout.
//
// Required secret: STRIPE_BALANCE_SECRET_KEY -- its own restricted Stripe key
// with Balance: Read and Payouts: Read and nothing else (the "one key, one
// function" practice the POS, saved-card and reconcile functions already use).
// Without it this answers 503 with code "not_configured" and Home shows
// "Not set up yet".
//
// The same three checks as every internal function: a real signed-in
// session, the caller's can_view_finance on account_roles, and the
// two-factor gate (check_internal_mfa_for_edge_function).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_BALANCE_SECRET_KEY = Deno.env.get("STRIPE_BALANCE_SECRET_KEY");

const ALLOWED_ORIGIN = "https://www.triplehenterprisesllc.biz";
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function decodeJwtPayload(token: string): { email?: string; role?: string; sub?: string; aal?: string; session_id?: string } {
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch {
    return {};
  }
}

async function callerCanViewFinance(email: string): Promise<boolean> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/account_roles?email=eq.${encodeURIComponent(email.toLowerCase())}&select=can_view_finance`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  if (!res.ok) return false;
  const rows = await res.json();
  if (!rows.length) return false;
  return rows[0].can_view_finance === true;
}

const MFA_REQUIRED_ERROR =
  "Two-factor sign-in required: sign out of the Workspace and sign back in with your authenticator code.";
async function callerPassesInternalMfa(
  claims: { sub?: string; email?: string; aal?: string; session_id?: string },
  fn: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_internal_mfa_for_edge_function`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_user_id: claims.sub ?? null,
        p_email: claims.email ?? null,
        p_session_id: claims.session_id ?? null,
        p_aal: claims.aal ?? null,
        p_function: fn,
      }),
    });
    if (!res.ok) return false;
    return (await res.json()) === true;
  } catch {
    return false;
  }
}

// Stripe lists one entry per currency. This business is USD; sum that one.
// Amounts stay in cents -- the page formats them.
function usdCents(entries: Array<{ amount: number; currency: string }> | undefined): number {
  return (entries || []).filter((e) => e.currency === "usd").reduce((sum, e) => sum + (e.amount || 0), 0);
}

async function stripeGet(path: string): Promise<Response> {
  return fetch(`https://api.stripe.com${path}`, {
    headers: { Authorization: `Bearer ${STRIPE_BALANCE_SECRET_KEY}` },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const claims = decodeJwtPayload(token);

    if (claims.role !== "authenticated" || !claims.email) {
      return json({ ok: false, error: "Must be signed in with a real session." }, 401);
    }
    if (!(await callerCanViewFinance(claims.email))) {
      return json({ ok: false, error: "This account can't view finance." }, 403);
    }
    if (!(await callerPassesInternalMfa(claims, "stripe-balance"))) {
      return json({ ok: false, error: MFA_REQUIRED_ERROR, code: "mfa_required" }, 403);
    }
    if (!STRIPE_BALANCE_SECRET_KEY) {
      return json({ ok: false, error: "STRIPE_BALANCE_SECRET_KEY is not set.", code: "not_configured" }, 503);
    }

    const [balanceRes, payoutsRes] = await Promise.all([
      stripeGet("/v1/balance"),
      stripeGet("/v1/payouts?limit=1"),
    ]);
    if (!balanceRes.ok || !payoutsRes.ok) {
      // Stripe's own error text can name the key; keep it out of the response.
      return json({ ok: false, error: "Stripe didn't answer.", code: "stripe_error" }, 502);
    }
    const balance = await balanceRes.json();
    const payouts = await payoutsRes.json();
    const latest = payouts && Array.isArray(payouts.data) ? payouts.data[0] : null;

    return json({
      ok: true,
      currency: "usd",
      available: usdCents(balance.available),
      pending: usdCents(balance.pending),
      // The most recent payout. status says whether it's still coming
      // (pending / in_transit) or already arrived (paid).
      next_payout: latest
        ? { amount: latest.amount, currency: latest.currency, arrival_date: latest.arrival_date, status: latest.status }
        : null,
    });
  } catch (err: any) {
    return json({ ok: false, error: err.message }, 500);
  }
});
