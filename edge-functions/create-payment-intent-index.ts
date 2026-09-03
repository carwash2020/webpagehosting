// Supabase Edge Function: create-payment-intent
//
// Called from portal/dashboard.html when a client taps "Pay now" on
// one of their own invoices. Creates a real Stripe PaymentIntent
// server-side (the Stripe secret key must never touch the browser)
// and returns its client_secret, which Stripe Elements on the
// frontend needs to actually collect and confirm the card payment.
//
// Required secret (Supabase dashboard -> Edge Functions -> Secrets):
//   STRIPE_SECRET_KEY -- the TEST MODE secret key (sk_test_...) while
//   the payment flow is being proven end to end. The Stripe account
//   itself is fully verified and live-capable as of 2026-09-02;
//   test mode is a deliberate choice for the build, not a
//   restriction. Swapping this one secret to the live sk_live_... key
//   (together with STRIPE_WEBHOOK_SIGNING_SECRET, which is per-mode)
//   is the entire cutover -- nothing in this function needs to change.
//   The frontend's publishable key in portal/dashboard.html swaps at
//   the same time.
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-provided by Supabase.)
//
// Updated 2026-09-03: every payment now goes through a real Stripe
// Customer, requested directly: "We need to start collecting card
// info to each email to make it easy to pay next time." A Customer is
// found or created for the client's own email (never trusting a
// client-supplied stripe_customer_id -- always looked up server-side
// by the caller's own verified session email), and
// setup_future_usage: 'off_session' tells Stripe to vault whatever
// card is used here on that Customer for later off-session charges.
// This project never sees or stores the card itself -- only the
// resulting stripe_customer_id, in the new stripe_customers table.
// A card the client's bank doesn't support saving is silently not
// saved by Stripe; this never blocks or fails the actual payment.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");

// Finds this email's existing Stripe Customer, or creates a new one
// and records the mapping. Shared logic duplicated (not imported)
// across create-payment-intent, create-bulk-payment-intent, and
// create-pos-charge -- each Supabase Edge Function is its own
// isolated deployment with no shared-module system across functions,
// and this is short enough that duplicating it is simpler and safer
// than the alternative (an extra function-to-function HTTP hop just
// to look up a customer id).
async function getOrCreateStripeCustomer(email: string): Promise<string> {
  const lookupRes = await fetch(
    `${SUPABASE_URL}/rest/v1/stripe_customers?client_email=eq.${encodeURIComponent(email)}&select=stripe_customer_id&limit=1`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  if (lookupRes.ok) {
    const rows = await lookupRes.json();
    if (rows.length) return rows[0].stripe_customer_id;
  }

  const customerRes = await fetch("https://api.stripe.com/v1/customers", {
    method: "POST",
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email }),
  });
  if (!customerRes.ok) {
    throw new Error(`Stripe customer creation failed: ${(await customerRes.text()).slice(0, 300)}`);
  }
  const customer = await customerRes.json();

  // Upsert, not a plain insert -- a race between two near-simultaneous
  // requests for the same brand-new email (unlikely, but not
  // impossible) should never produce two Stripe Customers for one
  // person. on_conflict keeps whichever row won the race as the real
  // mapping, harmlessly discarding this one if it lost.
  await fetch(`${SUPABASE_URL}/rest/v1/stripe_customers?on_conflict=client_email`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates",
    },
    body: JSON.stringify([{ client_email: email, stripe_customer_id: customer.id }]),
  });

  return customer.id;
}

// Same CORS pattern as every other browser-callable function in this
// project (trigger-workflow, sync-invoice-to-portal) -- origin
// restricted to the real site, not a wildcard, since this creates a
// real financial object.
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const claims = decodeJwtPayload(token);

    // Any real, authenticated session is enough here -- unlike the
    // internal-tools functions, this caller is a CLIENT, not an
    // internal account, so there's no account_roles check at all.
    // The real authorization check is below: does the invoice being
    // paid actually belong to this specific caller.
    if (claims.role !== "authenticated" || !claims.email) {
      return json({ ok: false, error: "Must be signed in." }, 401);
    }

    if (!STRIPE_SECRET_KEY) {
      return json({ ok: false, error: "STRIPE_SECRET_KEY secret is not set yet -- add it in the Supabase dashboard under Edge Functions -> Secrets." }, 500);
    }

    const { invoice_id } = await req.json();
    if (typeof invoice_id !== "number") {
      return json({ ok: false, error: "Missing invoice_id." }, 400);
    }

    // Looked up with the service role key (bypasses RLS, which is
    // fine here -- this function does its OWN explicit authorization
    // check right below, rather than relying on RLS for this specific
    // operation, since it also needs to write stripe_payment_intent_id
    // back onto the row a moment later regardless).
    const invoiceRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_invoices?id=eq.${invoice_id}&select=id,client_email,total,paid`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    if (!invoiceRes.ok) {
      return json({ ok: false, error: "Could not look up that invoice." }, 502);
    }
    const rows = await invoiceRes.json();
    if (!rows.length) {
      return json({ ok: false, error: "Invoice not found." }, 404);
    }
    const invoice = rows[0];

    // The real authorization boundary for this function: the invoice
    // being paid must belong to the exact email on the caller's own
    // verified session -- never trust an invoice_id alone to imply
    // the caller is allowed to pay it.
    if (invoice.client_email.toLowerCase() !== claims.email.toLowerCase()) {
      return json({ ok: false, error: "That invoice doesn't belong to this account." }, 403);
    }
    if (invoice.paid) {
      return json({ ok: false, error: "This invoice is already paid." }, 400);
    }

    // Stripe amounts are in the smallest currency unit (cents for
    // USD) -- Math.round guards against a floating-point total like
    // 19.999999999998 ever becoming a rejected, non-integer amount.
    const amountCents = Math.round(Number(invoice.total) * 100);

    const stripeCustomerId = await getOrCreateStripeCustomer(claims.email);

    const piRes = await fetch("https://api.stripe.com/v1/payment_intents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        amount: String(amountCents),
        currency: "usd",
        customer: stripeCustomerId,
        "automatic_payment_methods[enabled]": "true",
        setup_future_usage: "off_session",
        "metadata[client_portal_invoice_id]": String(invoice.id),
      }),
    });

    if (!piRes.ok) {
      const errBody = await piRes.text();
      return json({ ok: false, error: `Stripe error: ${errBody.slice(0, 300)}` }, 502);
    }
    const pi = await piRes.json();

    // Store the PaymentIntent id on the invoice now, before returning
    // to the client, so the webhook (which fires once the payment
    // actually completes) has a reliable way to find this exact row
    // again -- Stripe's own metadata field above is the belt-and-
    // suspenders backup if this write ever failed for some reason.
    await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_invoices?id=eq.${invoice.id}`,
      {
        method: "PATCH",
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ stripe_payment_intent_id: pi.id }),
      },
    );

    return json({ ok: true, client_secret: pi.client_secret });
  } catch (err: any) {
    return json({ ok: false, error: err.message }, 500);
  }
});
