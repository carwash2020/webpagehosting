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

    const { invoice_ids } = await req.json();
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

    const piRes = await fetch("https://api.stripe.com/v1/payment_intents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        amount: String(amountCents),
        currency: "usd",
        "automatic_payment_methods[enabled]": "true",
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
