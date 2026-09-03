// Supabase Edge Function: create-pos-charge
//
// The POS tool (2026-09-03), requested directly: "add a tool to type
// in and charge a client from my phone without creating an invoice
// for other minor jobs." INTERNAL-ONLY -- this charges a client's
// card on Connor/Steve's own initiative, a fundamentally different
// trust model from create-payment-intent (where a CLIENT pays their
// OWN invoice, authorized by their own session matching the
// invoice's own client_email). There is no invoice here at all to
// anchor authorization to, so the real gate is simply: is the caller
// a real internal account.
//
// Three modes, one function:
//   'check'        -- does this email have a saved card on file? Lets
//                      the POS page decide which UI to show, without
//                      creating a Stripe Customer just to check.
//   'charge_saved' -- charge the customer's existing saved card
//                      OFF-SESSION (confirm:true, off_session:true) --
//                      genuinely one-tap, no card entry, resolves
//                      synchronously in this same request. Income is
//                      logged directly here since the real outcome is
//                      already known.
//   'new_card'     -- no saved card (or the client wants to use a
//                      different one) -- creates a normal PaymentIntent
//                      for Stripe Elements to collect and confirm
//                      client-side, same shape as a portal payment.
//                      Tagged with pos_charge metadata so
//                      stripe-webhook recognizes and logs it once
//                      confirmation actually happens (asynchronously,
//                      after this function has already returned).
//
// Every mode also saves whatever card is used (setup_future_usage /
// the card was already saved to charge it) -- a POS sale is exactly
// the kind of interaction that should make the NEXT one for the same
// client faster too.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const LEAD_EMAIL_FROM = Deno.env.get("LEAD_EMAIL_FROM") || "";
const LOGO_URL = "https://www.triplehenterprisesllc.biz/images/logo-signature-email.png";

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

// Same "has a real account_roles row at all" check already used by
// sync-job-to-portal/sync-quote-to-portal -- charging a client from
// the POS tool isn't naturally gated by any one narrow permission
// (can_manage_invoices is about invoices specifically, and this
// deliberately creates no invoice at all), so any recognized internal
// account is the correct, matching gate.
async function callerIsInternalAccount(email: string): Promise<boolean> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/account_roles?email=eq.${encodeURIComponent(email.toLowerCase())}&select=email&limit=1`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  if (!res.ok) return false;
  const rows = await res.json();
  return rows.length > 0;
}

// Duplicated from create-payment-intent/create-bulk-payment-intent --
// see that function's own comment for why (no shared-module system
// across separately-deployed Edge Functions).
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
  if (!customerRes.ok) throw new Error(`Stripe customer creation failed: ${(await customerRes.text()).slice(0, 300)}`);
  const customer = await customerRes.json();
  await fetch(`${SUPABASE_URL}/rest/v1/stripe_customers?on_conflict=client_email`, {
    method: "POST",
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates" },
    body: JSON.stringify([{ client_email: email, stripe_customer_id: customer.id }]),
  });
  return customer.id;
}

// Looks up an EXISTING Customer only -- 'check' mode must never create
// a Stripe Customer just to answer "does this email have a card," or
// simply checking would leave orphaned Customers for emails that
// never actually complete a charge.
async function findExistingStripeCustomerId(email: string): Promise<string | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/stripe_customers?client_email=eq.${encodeURIComponent(email)}&select=stripe_customer_id&limit=1`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows.length ? rows[0].stripe_customer_id : null;
}

async function listSavedCards(customerId: string): Promise<any[]> {
  const res = await fetch(`https://api.stripe.com/v1/payment_methods?customer=${customerId}&type=card&limit=1`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.data || [];
}

// A POS-style receipt (2026-09-03), requested directly: "create a POS
// style reciept that shows what we charged them for sense we are
// collecting the email anyway." A POS sale has no invoice and no
// portal record at all -- this receipt email is the ONLY record the
// client ever gets of the charge, so it goes out on every successful
// POS sale, not as an optional extra step.
function buildPosReceiptEmail(description: string, amount: number, dateLabel: string): { html: string; text: string } {
  const amountLabel = "$" + amount.toFixed(2);
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="light"><title>Receipt, Triple H Enterprises</title></head>
<body style="margin:0; padding:0; background:#f4f4f4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f4f4f4" style="padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="max-width:480px; border-radius:10px; overflow:hidden; border:1px solid #e5e5e5;">
<tr><td align="center" bgcolor="#0a0a0a" style="padding:28px 24px;"><img src="${LOGO_URL}" alt="Triple H Enterprises" width="140" style="display:block; border:0;"></td></tr>
<tr><td style="padding:32px 28px 8px; font-family:-apple-system,Helvetica,Arial,sans-serif;">
<h1 style="color:#ff8000; font-size:22px; margin:0 0 20px; text-align:center;">Receipt</h1>
<p style="color:#222; font-size:15px; line-height:1.5; margin:0 0 20px;">Thanks for your business! Here's a record of what was charged today.</p>
</td></tr>
<tr><td style="padding:0 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding:8px 0; border-bottom:1px solid #eee; color:#777; font-size:14px; width:110px;">Date</td><td style="padding:8px 0; border-bottom:1px solid #eee; font-size:14px; color:#222;">${dateLabel}</td></tr>
<tr><td style="padding:8px 0; border-bottom:1px solid #eee; color:#777; font-size:14px;">For</td><td style="padding:8px 0; border-bottom:1px solid #eee; font-size:14px; color:#222;">${escapeHtmlPos(description || "Service call")}</td></tr>
<tr><td style="padding:8px 0; color:#777; font-size:14px;">Amount</td><td style="padding:8px 0; font-size:16px; color:#222; font-weight:700;">${amountLabel}</td></tr>
</table>
</td></tr>
<tr><td style="padding:20px 28px 28px; font-family:-apple-system,Helvetica,Arial,sans-serif;"><p style="color:#222; font-size:14px; line-height:1.5; margin:0;">Questions about this charge? Just reply to this email.</p></td></tr>
<tr><td style="background:#ff8000; height:4px; line-height:4px; font-size:1px;">&nbsp;</td></tr>
<tr><td align="center" style="padding:16px 24px; font-family:-apple-system,Helvetica,Arial,sans-serif;"><p style="color:#999; font-size:12px; margin:0;">(435) 414-1667 &middot; triplehenterprisesllc.biz</p></td></tr>
</table></td></tr></table></body></html>`;
  const text = `Receipt -- Triple H Enterprises\n\nThanks for your business! Here's a record of what was charged today.\n\nDate: ${dateLabel}\nFor: ${description || "Service call"}\nAmount: ${amountLabel}\n\nQuestions about this charge? Just reply to this email.\n\nTriple H Enterprises\n(435) 414-1667, triplehenterprisesllc.biz`;
  return { html, text };
}

// escapeHtml under a Pos-specific name -- this function is duplicated
// (not imported) across separately-deployed Edge Functions, same
// reasoning as getOrCreateStripeCustomer above; named distinctly here
// only to avoid any confusion with tools/pos.html's own client-side
// escapeHtmlPos(), which is a completely separate piece of code in a
// completely separate runtime.
function escapeHtmlPos(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function sendPosReceiptEmail(clientEmail: string, description: string, amount: number) {
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver", weekday: "long", month: "long", day: "numeric", year: "numeric",
  }).format(new Date());
  const { html, text } = buildPosReceiptEmail(description, amount, dateLabel);
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({ from: LEAD_EMAIL_FROM, to: clientEmail, subject: "Your receipt, Triple H Enterprises", html, text }),
    });
  } catch (err) {
    // Best-effort -- a receipt email failing to send must never undo
    // or block a charge that already genuinely succeeded. The charge
    // and the income log entry are the real record either way.
    console.error("sendPosReceiptEmail failed:", err);
  }
}

// Appends one entry to workspace_sync's th_income_log, matching the
// exact shape logInvoiceToIncomeLog() already writes in
// invoice-generator.html -- so a POS sale shows up in Connor's real
// Income tab the same way any other income does, not as some
// separate, differently-shaped record. origin:'pos' distinguishes it
// from 'invoice'-origin entries (which link back to a real invoice
// row) -- a POS sale deliberately has neither an invoiceId nor a
// jobRefId, since the whole point is skipping the invoice step.
async function logPosIncomeToWorkspaceSync(description: string, amount: number, clientLabel: string, internalAccountEmail: string, stripePaymentIntentId: string) {
  const syncRes = await fetch(
    `${SUPABASE_URL}/rest/v1/workspace_sync?code=eq.tripleh-workspace-2026&select=data`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  const syncRows = await syncRes.json();
  if (!syncRows.length) return;
  const blob = syncRows[0].data;
  const incomeLog = JSON.parse(blob.th_income_log || "[]");
  // Idempotent on the PaymentIntent id -- Stripe sends
  // payment_intent.succeeded to stripe-webhook for EVERY successful
  // charge regardless of how it was confirmed, including one already
  // confirmed synchronously right here (the 'charge_saved' path knows
  // the real outcome immediately and logs it directly, without
  // waiting on the webhook at all). Without this check, that same
  // charge would be logged twice -- once here, once again when the
  // webhook's own pos_charge handling sees the same event.
  if (incomeLog.some((entry: any) => entry.stripePaymentIntentId === stripePaymentIntentId)) return;
  incomeLog.push({
    id: Date.now(),
    date: new Date().toISOString().slice(0, 10),
    desc: description || "POS sale",
    amount,
    source: clientLabel,
    payment: "Stripe (POS)",
    jobRefId: "",
    jobRefTitle: "",
    origin: "pos",
    stripePaymentIntentId,
    createdBy: internalAccountEmail,
    lastEditedBy: internalAccountEmail,
  });
  blob.th_income_log = JSON.stringify(incomeLog);
  await fetch(`${SUPABASE_URL}/rest/v1/workspace_sync?code=eq.tripleh-workspace-2026`, {
    method: "PATCH",
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ data: blob, updated_at: new Date().toISOString() }),
  });
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

    if (claims.role !== "authenticated" || !claims.email) {
      return json({ ok: false, error: "Must be signed in with a real session." }, 401);
    }
    if (!(await callerIsInternalAccount(claims.email))) {
      return json({ ok: false, error: "This account isn't recognized." }, 403);
    }
    if (!STRIPE_SECRET_KEY) {
      return json({ ok: false, error: "STRIPE_SECRET_KEY secret is not set." }, 500);
    }

    const { mode, client_email, amount, description } = await req.json();

    if (typeof client_email !== "string" || !client_email.includes("@")) {
      return json({ ok: false, error: "A real client email is required." }, 400);
    }
    const normalizedEmail = client_email.toLowerCase().trim();

    if (mode === "check") {
      const customerId = await findExistingStripeCustomerId(normalizedEmail);
      if (!customerId) return json({ ok: true, has_saved_card: false });
      const cards = await listSavedCards(customerId);
      if (!cards.length) return json({ ok: true, has_saved_card: false });
      const card = cards[0].card || {};
      return json({ ok: true, has_saved_card: true, brand: card.brand, last4: card.last4 });
    }

    if (typeof amount !== "number" || !(amount > 0)) {
      return json({ ok: false, error: "Enter a real amount greater than $0." }, 400);
    }
    const amountCents = Math.round(amount * 100);

    if (mode === "charge_saved") {
      const customerId = await findExistingStripeCustomerId(normalizedEmail);
      if (!customerId) return json({ ok: false, error: "No saved card on file for this email." }, 400);
      const cards = await listSavedCards(customerId);
      if (!cards.length) return json({ ok: false, error: "No saved card on file for this email." }, 400);

      const piRes = await fetch("https://api.stripe.com/v1/payment_intents", {
        method: "POST",
        headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          amount: String(amountCents),
          currency: "usd",
          customer: customerId,
          payment_method: cards[0].id,
          off_session: "true",
          confirm: "true",
          description: description || "POS sale",
          "metadata[pos_charge]": "true",
          "metadata[internal_account]": claims.email,
        }),
      });
      const pi = await piRes.json();
      if (!piRes.ok || pi.status !== "succeeded") {
        // A real, specific decline reason (Stripe's own message), not a
        // generic failure -- an off-session charge can be declined for
        // reasons a client paying their own invoice never hits (the
        // card issuer requiring fresh authentication for an unattended
        // charge, for instance), and Connor needs to know which.
        const reason = pi?.error?.message || pi?.last_payment_error?.message || "Charge was not approved.";
        return json({ ok: false, error: reason }, 402);
      }
      // Resolved synchronously -- the real outcome is already known, so
      // income is logged right here rather than waiting on the webhook
      // (which stripe-webhook still receives, but its own pos_charge
      // handling is idempotent on this same PaymentIntent id, so it
      // safely no-ops rather than double-logging).
      await logPosIncomeToWorkspaceSync(description, amount, normalizedEmail, claims.email, pi.id);
      await sendPosReceiptEmail(normalizedEmail, description, amount);
      return json({ ok: true, charged: true });
    }

    // mode === 'new_card' (or unrecognized -- defaults to the safest,
    // most general path rather than silently doing nothing)
    const customerId = await getOrCreateStripeCustomer(normalizedEmail);
    const piRes = await fetch("https://api.stripe.com/v1/payment_intents", {
      method: "POST",
      headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        amount: String(amountCents),
        currency: "usd",
        customer: customerId,
        "automatic_payment_methods[enabled]": "true",
        setup_future_usage: "off_session",
        description: description || "POS sale",
        "metadata[pos_charge]": "true",
        "metadata[pos_client_email]": normalizedEmail,
        "metadata[pos_description]": description || "POS sale",
        "metadata[pos_amount]": String(amount),
        "metadata[internal_account]": claims.email,
      }),
    });
    if (!piRes.ok) {
      const errBody = await piRes.text();
      return json({ ok: false, error: `Stripe error: ${errBody.slice(0, 300)}` }, 502);
    }
    const pi = await piRes.json();
    return json({ ok: true, client_secret: pi.client_secret });
  } catch (err: any) {
    return json({ ok: false, error: err.message }, 500);
  }
});
