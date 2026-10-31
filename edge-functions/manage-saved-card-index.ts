// Supabase Edge Function: manage-saved-card
//
// Client-facing saved card management (2026-09-03), requested
// directly: "Saved card management (view/remove)" -- since we now
// save cards on both invoice payments and POS, a client had no way
// to even know one was on file, let alone remove it.
//
// Extended 2026-09-04, requested directly: "can we add a way for
// them to update their saved card info from the settings?" Stripe
// payment methods are immutable -- there is no way to edit an
// existing card's number or expiration in place, only add a new one
// (and, separately, remove an old one -- already supported below).
// "Update" in practice means "add a replacement," which is what the
// new 'create_setup_intent' mode below actually does.
//
// Three modes:
//   'list'    -- returns this caller's saved card(s) (brand, last4,
//                payment method id). Looks up the caller's OWN Stripe
//                Customer via their verified session email, never a
//                client-supplied email or customer id.
//   'remove'  -- detaches a specific payment method. Before
//                detaching, retrieves the payment method from Stripe
//                and confirms its own `customer` field matches the
//                caller's real Stripe Customer id -- a client must
//                never be able to detach another client's card just
//                by guessing or supplying an arbitrary
//                payment_method_id.
//   'create_setup_intent' -- creates (or reuses) a Stripe Customer
//                and a real SetupIntent for it, returning a
//                client_secret for Stripe Elements to collect and
//                confirm a new card client-side. A SetupIntent, not a
//                PaymentIntent -- this never charges anything, it
//                only saves a payment method for later off-session
//                use. Same dispute-protection signature requirement
//                as every other place a new card gets saved
//                (create-payment-intent, create-bulk-payment-intent,
//                create-pos-charge) -- see recordCardAuthorization()
//                below.
//
// Uses its own dedicated Stripe secret (STRIPE_CLIENT_CARDS_SECRET_KEY),
// matching the "one key one function" practice already established
// for POS. Originally scoped to PaymentMethods Read + Write only;
// the new create_setup_intent mode needs this key's Stripe-side
// permissions WIDENED to also include Customers: Write and
// SetupIntents: Write -- every other resource still needs no access
// at all (this function never touches a charge or reads an invoice).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_CLIENT_CARDS_SECRET_KEY");

// Idempotency-Key on every Stripe POST (Stripe hardening, 2026-10-31;
// docs/stripe-hardening-2026-10-31/README.md). Stripe returns the SAME
// object for a repeated key within 24h instead of creating a second one, so
// a double tap, two tabs, or a retried network call can't create a second
// customer or PaymentIntent. stripePost() also retries a dropped connection
// or a 5xx/409 once or twice WITH THE SAME KEY, which is only safe because
// of the key. Duplicated in create-payment-intent, create-bulk-payment-intent,
// create-pos-charge and manage-saved-card (no shared modules across
// separately deployed Edge Functions).
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// One Stripe Customer per email, whichever function gets there first.
async function customerIdempotencyKey(email: string): Promise<string> {
  return `cust-v1-${await sha256Hex(email.trim().toLowerCase())}`;
}

// A page-generated id for one charge attempt, resent unchanged if the page
// retries that same attempt (see tools/invoice-generator.html). Letters,
// digits and dashes only.
function validRequestId(v: unknown): string | null {
  return typeof v === "string" && /^[A-Za-z0-9-]{16,64}$/.test(v) ? v : null;
}

async function stripePost(path: string, params: URLSearchParams, idempotencyKey: string): Promise<Response> {
  const send = () => fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": idempotencyKey,
    },
    body: params,
  });
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await send();
      if ((res.status >= 500 || res.status === 409) && attempt < 2) {
        await new Promise((r) => setTimeout(r, 300 * 3 ** attempt));
        continue;
      }
      return res;
    } catch (err) {
      if (attempt >= 2) throw err;
      await new Promise((r) => setTimeout(r, 300 * 3 ** attempt));
    }
  }
}


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

// Added 2026-09-04 for create_setup_intent -- this function
// previously only ever looked up an EXISTING customer (list/remove
// both only make sense for a client who already has one), never
// created one. Identical to create-payment-intent's own copy -- see
// that function's header comment for why this is duplicated rather
// than imported (no shared-module system across separately-deployed
// Edge Functions).
async function getOrCreateStripeCustomer(email: string): Promise<string> {
  const existing = await findExistingStripeCustomerId(email);
  if (existing) return existing;
  const customerRes = await stripePost("customers", new URLSearchParams({ email }), await customerIdempotencyKey(email));
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

// Same dispute-protection reasoning as every other place a new card
// gets saved (create-payment-intent, create-bulk-payment-intent,
// create-pos-charge) -- see any of those for the full background.
// context is "settings_add_card" here specifically: this save isn't
// a side effect of a payment or a POS sale, it's a deliberate,
// dedicated action the client takes from their own Settings page.
async function recordCardAuthorization(clientEmail: string, signerName: string, authorizationText: string, signatureImage: string | null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/card_authorizations`, {
    method: "POST",
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify([{
      client_email: clientEmail,
      signer_name: signerName,
      authorization_text: authorizationText,
      context: "settings_add_card",
      signature_image: signatureImage,
    }]),
  });
  if (!res.ok) {
    throw new Error(`Could not save the signed authorization: ${(await res.text()).slice(0, 300)}`);
  }
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

    const { mode, payment_method_id, signer_name, signature_image, request_id } = await req.json();
    const customerId = await findExistingStripeCustomerId(claims.email.toLowerCase());

    if (mode === "list") {
      if (!customerId) return json({ ok: true, cards: [] });
      const res = await fetch(`https://api.stripe.com/v1/payment_methods?customer=${customerId}&type=card`, {
        headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
      });
      if (!res.ok) return json({ ok: false, error: "Could not load your saved cards right now." }, 502);
      const data = await res.json();
      // Stripe's own List a Customer's PaymentMethods endpoint returns
      // results sorted most-recently-created first (confirmed
      // directly against Stripe's own docs, 2026-09-04, not assumed)
      // -- the same endpoint and the same order create-pos-charge's
      // listSavedCards() and create-payment-intent's hasSavedCard()
      // both already rely on when they grab index 0 for an
      // off-session charge. is_active marks that same first card
      // explicitly here, so the client can see which one will
      // actually be used next, rather than needing to infer it from
      // list order on their own.
      const cards = (data.data || []).map((pm: any, index: number) => ({
        id: pm.id,
        brand: pm.card?.brand || "card",
        last4: pm.card?.last4 || "----",
        exp_month: pm.card?.exp_month || null,
        exp_year: pm.card?.exp_year || null,
        is_active: index === 0,
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

      const detachRes = await stripePost(`payment_methods/${payment_method_id}/detach`, new URLSearchParams(), `pm-detach-v1-${payment_method_id}`);
      if (!detachRes.ok) {
        const errBody = await detachRes.text();
        return json({ ok: false, error: `Stripe error: ${errBody.slice(0, 300)}` }, 502);
      }
      return json({ ok: true, removed: true });
    }

    if (mode === "create_setup_intent") {
      // Same dispute-protection requirement as every other place a
      // new card gets saved -- see recordCardAuthorization()'s own
      // comment for the reasoning. No amount here (a SetupIntent
      // never charges anything), so the authorization text says so
      // plainly rather than implying a charge that isn't happening.
      if (typeof signer_name !== "string" || !signer_name.trim()) {
        return json({ ok: false, needs_signature: true, error: "A signed name is required before adding a new card." }, 400);
      }
      // Physical/drawn signature (2026-09-22) -- see create-pos-charge's
      // own identical check for the full reasoning.
      if (typeof signature_image !== "string" || !signature_image.startsWith("data:image/")) {
        return json({ ok: false, needs_signature: true, error: "A drawn signature is required before adding a new card." }, 400);
      }
      const authorizationText = `I, ${signer_name.trim()}, authorize Triple H Enterprises to securely save this card on file (via Stripe) for future charges I separately approve.`;
      await recordCardAuthorization(claims.email, signer_name.trim(), authorizationText, signature_image);

      const setupCustomerId = customerId || await getOrCreateStripeCustomer(claims.email.toLowerCase());
      // A SetupIntent never charges, so the key only needs to cover this
      // one request and its retries: the page's request_id when it sends
      // one, else a fresh id.
      const setupKey = `seti-v1-${setupCustomerId}-${validRequestId(request_id) || crypto.randomUUID()}`;
      const setupRes = await stripePost("setup_intents", new URLSearchParams({
        customer: setupCustomerId,
        "automatic_payment_methods[enabled]": "true",
      }), setupKey);
      if (!setupRes.ok) {
        const errBody = await setupRes.text();
        return json({ ok: false, error: `Stripe error: ${errBody.slice(0, 300)}` }, 502);
      }
      const setupIntent = await setupRes.json();
      return json({ ok: true, client_secret: setupIntent.client_secret });
    }

    return json({ ok: false, error: "Unknown mode." }, 400);
  } catch (err: any) {
    return json({ ok: false, error: err.message }, 500);
  }
});
