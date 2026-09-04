// Supabase Edge Function: manage-saved-card
//
// Client-facing saved card management (2026-09-03), requested
// directly: "Saved card management (view/remove)" -- since we now
// save cards on both invoice payments and POS, a client had no way
// to even know one was on file, let alone remove it.
//
// Two modes:
//   'list'   -- returns this caller's saved card(s) (brand, last4,
//               payment method id). Looks up the caller's OWN Stripe
//               Customer via their verified session email, never a
//               client-supplied email or customer id.
//   'remove' -- detaches a specific payment method. Before detaching,
//               retrieves the payment method from Stripe and confirms
//               its own `customer` field matches the caller's real
//               Stripe Customer id -- a client must never be able to
//               detach another client's card just by guessing or
//               supplying an arbitrary payment_method_id.
//
// Uses its own dedicated Stripe secret (STRIPE_CLIENT_CARDS_SECRET_KEY),
// matching the "one key one function" practice already established
// for POS. Scoped to exactly: PaymentMethods Read + Write. No other
// resource needs any access at all -- this function never creates a
// Customer, never touches a charge, never reads an invoice.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_CLIENT_CARDS_SECRET_KEY");

const ALLOWED_ORIGIN = "https://www.triplehenterprisesllc.biz";
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function decodeJwtPayload(token: string): { email?: string; role?: string } {
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch {
    return {};
  }
}

async function findExistingStripeCustomerId(email: string): Promise<string | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/stripe_customers?client_email=eq.${encodeURIComponent(email)}&select=stripe_customer_id&limit=1`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows.length ? rows[0].stripe_customer_id : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: CORS_HEADERS });

  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const claims = decodeJwtPayload(token);

    // Any real, authenticated session is enough -- this is a client
    // managing their own cards, not an internal-tools function, so
    // there's no account_roles check. The real authorization boundary
    // is below: every lookup is keyed off the caller's own verified
    // session email, and detach additionally re-verifies the payment
    // method's own customer field before ever touching it.
    if (claims.role !== "authenticated" || !claims.email) {
      return json({ ok: false, error: "Must be signed in." }, 401);
    }
    if (!STRIPE_SECRET_KEY) {
      return json({ ok: false, error: "STRIPE_CLIENT_CARDS_SECRET_KEY secret is not set." }, 500);
    }

    const { mode, payment_method_id } = await req.json();
    const customerId = await findExistingStripeCustomerId(claims.email.toLowerCase());

    if (mode === "list") {
      if (!customerId) return json({ ok: true, cards: [] });
      const res = await fetch(`https://api.stripe.com/v1/payment_methods?customer=${customerId}&type=card`, {
        headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
      });
      if (!res.ok) return json({ ok: false, error: "Could not load your saved cards right now." }, 502);
      const data = await res.json();
      const cards = (data.data || []).map((pm: any) => ({
        id: pm.id,
        brand: pm.card?.brand || "card",
        last4: pm.card?.last4 || "----",
      }));
      return json({ ok: true, cards });
    }

    if (mode === "remove") {
      if (typeof payment_method_id !== "string" || !payment_method_id.startsWith("pm_")) {
        return json({ ok: false, error: "A real payment method id is required." }, 400);
      }
      if (!customerId) {
        return json({ ok: false, error: "No saved cards on file." }, 400);
      }

      // Re-verified here, not assumed from the earlier list call --
      // the real security boundary against detaching a card that
      // isn't the caller's own.
      const pmRes = await fetch(`https://api.stripe.com/v1/payment_methods/${payment_method_id}`, {
        headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
      });
      if (!pmRes.ok) return json({ ok: false, error: "Could not find that card." }, 404);
      const pm = await pmRes.json();
      if (pm.customer !== customerId) {
        return json({ ok: false, error: "That card doesn't belong to this account." }, 403);
      }

      const detachRes = await fetch(`https://api.stripe.com/v1/payment_methods/${payment_method_id}/detach`, {
        method: "POST",
        headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
      });
      if (!detachRes.ok) {
        const errBody = await detachRes.text();
        return json({ ok: false, error: `Stripe error: ${errBody.slice(0, 300)}` }, 502);
      }
      return json({ ok: true, removed: true });
    }

    return json({ ok: false, error: "Unknown mode." }, 400);
  } catch (err: any) {
    return json({ ok: false, error: err.message }, 500);
  }
});
