// Supabase Edge Function: create-bulk-payment-intent
//
// "Pay All Outstanding" -- combines several of a client's own unpaid
// invoices into ONE Stripe PaymentIntent, so they aren't paying them
// one at a time. Same structure as create-payment-intent, generalized
// from a single invoice_id to an invoice_ids array.
//
// The webhook (stripe-webhook) is what actually marks every covered
// invoice paid once the payment succeeds -- this function's job ends
// once the PaymentIntent exists and every invoice row has this
// PaymentIntent's id written onto it, exactly the same handoff
// create-payment-intent already does for a single invoice.
//
// Updated 2026-09-04, found during a functional audit: this function
// never attached a Stripe Customer or saved the card used, unlike
// create-payment-intent -- a real inconsistency, not an intentional
// difference. A client paying a single invoice got their card saved
// (with signature capture the first time); the same client paying
// several invoices at once through this function never did, even
// though it's the exact same client, the exact same card, and the
// exact same future benefit (a one-tap saved card next time). Now
// mirrors create-payment-intent's Customer/signature logic exactly.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");

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

// Identical to create-payment-intent's own copy -- see that
// function's header comment for why this is duplicated rather than
// imported (no shared-module system across separately-deployed
// Edge Functions).
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

async function findExistingStripeCustomerId(email: string): Promise<string | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/stripe_customers?client_email=eq.${encodeURIComponent(email)}&select=stripe_customer_id&limit=1`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows.length ? rows[0].stripe_customer_id : null;
}

async function hasSavedCard(customerId: string): Promise<boolean> {
  const res = await fetch(`https://api.stripe.com/v1/payment_methods?customer=${customerId}&type=card&limit=1`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  if (!res.ok) return false;
  const data = await res.json();
  return (data.data || []).length > 0;
}

// Same dispute-protection reasoning as create-payment-intent's own
// copy -- see that function's header comment for the full
// background. context stays "invoice_payment" (not a separate
// "bulk_invoice_payment") since this is the same category of action
// as a single-invoice payment, just covering more than one at once;
// the description field is what actually distinguishes them.
async function recordCardAuthorization(clientEmail: string, signerName: string, authorizationText: string, amount: number, description: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/card_authorizations`, {
    method: "POST",
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify([{
      client_email: clientEmail,
      signer_name: signerName,
      authorization_text: authorizationText,
      context: "invoice_payment",
      amount,
      description,
    }]),
  });
  if (!res.ok) {
    throw new Error(`Could not save the signed authorization: ${(await res.text()).slice(0, 300)}`);
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

    // Client-only, no account_roles check -- same as create-payment-intent.
    // The real authorization check is below: does every invoice being
    // paid actually belong to this specific caller.
    if (claims.role !== "authenticated" || !claims.email) {
      return json({ ok: false, error: "Must be signed in." }, 401);
    }

    if (!STRIPE_SECRET_KEY) {
      return json({ ok: false, error: "STRIPE_SECRET_KEY secret is not set yet -- add it in the Supabase dashboard under Edge Functions -> Secrets." }, 500);
    }

    const { invoice_ids, signer_name } = await req.json();
    if (!Array.isArray(invoice_ids) || invoice_ids.length < 2 || !invoice_ids.every((id: unknown) => typeof id === "number")) {
      return json({ ok: false, error: "invoice_ids must be an array of at least 2 numbers -- use create-payment-intent for a single invoice." }, 400);
    }

    const idList = invoice_ids.join(",");
    const invoicesRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_invoices?id=in.(${idList})&select=id,client_email,total,paid`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    if (!invoicesRes.ok) {
      return json({ ok: false, error: "Could not look up those invoices." }, 502);
    }
    const invoices = await invoicesRes.json();

    if (invoices.length !== invoice_ids.length) {
      return json({ ok: false, error: "One or more invoices were not found." }, 404);
    }
    // The real authorization boundary: every single invoice in the
    // batch must belong to the caller's own verified email -- never
    // trust the id list alone, and never partially authorize a batch.
    const notOwned = invoices.find((inv: any) => inv.client_email.toLowerCase() !== claims.email.toLowerCase());
    if (notOwned) {
      return json({ ok: false, error: "One or more of those invoices doesn't belong to this account." }, 403);
    }
    const alreadyPaid = invoices.find((inv: any) => inv.paid);
    if (alreadyPaid) {
      return json({ ok: false, error: "One or more of those invoices is already paid." }, 400);
    }

    const totalAmount = invoices.reduce((sum: number, inv: any) => sum + Number(inv.total), 0);
    const amountCents = Math.round(totalAmount * 100);

    // Same logic as create-payment-intent: a signature is required
    // only when this client is about to have a NEW card saved. If
    // they already have one on file, Stripe's own Payment Element may
    // offer it as a one-tap option, and no fresh authorization is
    // needed for a card already covered by a prior one.
    const existingCustomerId = await findExistingStripeCustomerId(claims.email);
    const alreadyHasSavedCard = existingCustomerId ? await hasSavedCard(existingCustomerId) : false;
    if (!alreadyHasSavedCard) {
      if (typeof signer_name !== "string" || !signer_name.trim()) {
        return json({ ok: false, needs_signature: true, error: "A signed name is required before saving a new card." }, 400);
      }
      const invoiceCount = invoices.length;
      const authorizationText = `I, ${signer_name.trim()}, authorize Triple H Enterprises to charge $${(amountCents / 100).toFixed(2)} for ${invoiceCount} outstanding invoices, and to securely save this card on file (via Stripe) for future charges I separately approve.`;
      await recordCardAuthorization(claims.email, signer_name.trim(), authorizationText, amountCents / 100, `${invoiceCount} invoices (IDs: ${invoice_ids.join(", ")})`);
    }

    const stripeCustomerId = existingCustomerId || await getOrCreateStripeCustomer(claims.email);

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
        // Comma-separated list, the bulk-pay counterpart to
        // create-payment-intent's singular client_portal_invoice_id --
        // stripe-webhook checks for both metadata shapes.
        "metadata[client_portal_invoice_ids]": invoice_ids.join(","),
      }),
    });

    if (!piRes.ok) {
      const errBody = await piRes.text();
      return json({ ok: false, error: `Stripe error: ${errBody.slice(0, 300)}` }, 502);
    }
    const pi = await piRes.json();

    // Same reasoning as create-payment-intent: store the PaymentIntent
    // id on every covered invoice now, before returning to the client,
    // so the webhook has a reliable way to find ALL of them again --
    // Stripe's own metadata field above is the belt-and-suspenders
    // fallback if this write ever failed for some reason.
    await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_invoices?id=in.(${idList})`,
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
