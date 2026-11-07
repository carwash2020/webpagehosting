// guest-pay (2026-11-03, handoff §3A; Connor: pay "right from this email --
// no account needed"). Backs /pay/<invoice number>-<code>: the invoice
// email's Pay button and the link printed on the PDF.
//
// The code (client_portal_invoices.pay_token, sql/payments/02_guest_pay_tokens.sql)
// is the only key: long, random, made when the invoice is sent, good for
// that one invoice. It needs no sign-in, so this function runs with
// verify_jwt OFF and does its own checks instead:
//   * a code that isn't the right shape never reaches the database, and a
//     wrong code, a malformed one and a missing one all get the same
//     "not_found" answer, so nothing can be learned by probing;
//   * "view" returns only what the payer needs: number, date, what it was
//     for, the amount, and the client's initial and surname -- never their
//     email or address;
//   * "view" also gives the due date, worked out from the invoice's terms
//     the same way the Workspace does (data-layer.js thInvoiceDueDate), and
//     "pdf" hands back a five-minute link to the invoice's archived PDF;
//   * "pay" makes a ONE-TIME PaymentIntent for the invoice total. Unlike
//     create-payment-intent it saves no card and makes no Stripe customer,
//     which is why it needs no signed card-on-file authorization. Its
//     metadata (client_portal_invoice_id) and the stripe_payment_intent_id
//     written back are exactly what stripe-webhook already uses to mark a
//     portal payment paid, so the money lands the same way: invoice paid,
//     income logged, Steve told.
//   * The same double-charge guards as create-payment-intent: a payment
//     already through or still processing blocks a new one, an open one for
//     the same amount is handed back instead of making a second.
//   * Fix plan RP3.17 (2026-11-07): if Stripe can't answer the lookup of
//     the earlier PaymentIntent (anything but a 404), "pay" answers 502
//     instead of going ahead without the double-charge check.
//   * Fix plan RP3.18 (2026-11-07): view/pdf and pay are rate limited per
//     IP (rate_limit_take, failing open if the limiter can't be reached),
//     the Stripe receipt only ever goes to the invoice's own client email,
//     and "view" tells the page where, as a masked address.
//   * Fix plan RP4.3 / D15 (2026-11-07): the code stops working 90 days
//     after the invoice was paid. An unpaid invoice's code keeps working. An
//     expired code gets the same not_found answer as a wrong one.
// Deploy: supabase functions deploy guest-pay --no-verify-jwt

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");

// Lower-case letters and digits without the look-alikes (0/o, 1/l/i),
// 10-40 long (the invoice generator makes 10: 31^10, about 8e14, so not
// guessable) -- the shape tools/invoice-generator.html makes.
const TOKEN_SHAPE = /^[a-hjkmnp-z2-9]{10,40}$/;
// Linear-time email shape (fix plan Group 3, 2026-11-06): domain labels are
// separated by single dots, so the pattern can never backtrack polynomially.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

const ALLOWED_ORIGIN = "https://www.triplehenterprisesllc.biz";
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

// Same sets and rule as create-payment-intent.
const PAID_OR_PAYING_STATUSES = new Set(["succeeded", "processing", "requires_capture"]);
const REUSABLE_STATUSES = new Set(["requires_payment_method", "requires_confirmation", "requires_action"]);

function blocksNewPayment(pi: any): boolean {
  if (!PAID_OR_PAYING_STATUSES.has(pi.status)) return false;
  const charge = pi.latest_charge;
  return !(charge && typeof charge === "object" && charge.refunded === true);
}

// Fix plan RP3.17 (2026-11-07): ok:false means Stripe couldn't be asked
// (network error, 5xx, 401/403...), and the caller answers 502 rather than
// risk a second PaymentIntent. A 404 (resource_missing) still means "no
// earlier PaymentIntent": ok:true, pi:null.
async function retrievePaymentIntent(id: string): Promise<{ ok: boolean; pi: any | null }> {
  try {
    const res = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(id)}?expand[]=latest_charge`, {
      headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
    });
    if (res.status === 404) return { ok: true, pi: null };
    if (!res.ok) {
      console.error(`guest-pay: could not retrieve ${id} (HTTP ${res.status}); refusing to start a payment without the double-charge check`);
      return { ok: false, pi: null };
    }
    return { ok: true, pi: await res.json() };
  } catch (err: any) {
    console.error(`guest-pay: could not retrieve ${id} (${err.message}); refusing to start a payment without the double-charge check`);
    return { ok: false, pi: null };
  }
}

// Fix plan RP3.18 (2026-11-07): the client's IP, for the rate limit.
function clientIp(req: Request): string {
  // Cloudflare sets cf-connecting-ip and overwrites any client-sent value
  // (seen on this project's edge logs, 2026-11-07). x-forwarded-for's FIRST
  // entry is whatever the caller wrote, so fall back to its LAST entry.
  const cf = (req.headers.get("cf-connecting-ip") || "").trim();
  if (cf) return cf.slice(0, 64);
  const xff = (req.headers.get("x-forwarded-for") || "").split(",").map((s) => s.trim()).filter(Boolean);
  return (xff[xff.length - 1] || "unknown").slice(0, 64);
}

// One hit against public.rate_limit_take (sql/security/group5_backend_hardening.sql).
// true = allowed. Fails OPEN (logged): this is a customer paying an invoice,
// and a limiter outage must not stop a real payment.
async function rateLimitTake(bucket: string, key: string, max: number, windowSeconds: number): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rate_limit_take`, {
      method: "POST",
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_bucket: bucket, p_key: key, p_max: max, p_window_seconds: windowSeconds }),
    });
    if (!res.ok) {
      console.error(`guest-pay: rate_limit_take ${bucket} failed (HTTP ${res.status}); allowing the request`);
      return true;
    }
    return (await res.json()) !== false;
  } catch (err: any) {
    console.error(`guest-pay: rate_limit_take ${bucket} failed (${err.message}); allowing the request`);
    return true;
  }
}
const VIEW_LIMIT_PER_HOUR = 60;
const PAY_LIMIT_PER_HOUR = 20;

// "tony@example.com" -> "t•••@example.com": enough for the payer to
// recognise their own address, not enough to read someone else's.
function maskEmail(email: unknown): string | null {
  const e = String(email || "").trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1 || at === e.length - 1) return null;
  return `${e.charAt(0)}•••${e.slice(at)}`;
}

// D15: a paid invoice's code works for 90 days after paid_at. No paid_at on
// a paid invoice (none recorded) leaves the code working, as before: there
// is nothing to count from.
const PAID_TOKEN_DAYS = 90;
function tokenExpired(invoice: { paid?: unknown; paid_at?: unknown }, now = Date.now()): boolean {
  if (!invoice.paid || !invoice.paid_at) return false;
  const paidAt = new Date(String(invoice.paid_at)).getTime();
  if (isNaN(paidAt)) return false;
  return now > paidAt + PAID_TOKEN_DAYS * 24 * 60 * 60 * 1000;
}

// "Tony Perides" -> "T. Perides"; one word stays as it is.
function billedTo(name: string | null): string {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0];
  return `${parts[0].charAt(0).toUpperCase()}. ${parts[parts.length - 1]}`;
}

async function findInvoice(token: string): Promise<any | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/client_portal_invoices?pay_token=eq.${encodeURIComponent(token)}` +
      `&select=id,source_invoice_id,invoice_number,invoice_date,description,client_name,client_email,total,paid,paid_amount,paid_at,stripe_payment_intent_id&limit=1`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  if (!res.ok) throw new Error(`invoice lookup failed (HTTP ${res.status})`);
  const rows = await res.json();
  return rows.length ? rows[0] : null;
}

// Same days as data-layer.js TH_TERM_DAYS; unknown terms count as Net 15
// there too. The terms live on the Workspace's own invoice row (the
// relational mirror, public.invoices, id = source_invoice_id). No row, no
// due date: the page simply doesn't show one.
const TERM_DAYS: Record<string, number> = { "Due Upon Receipt": 0, "Net 15": 15, "Net 30": 30 };
async function dueDateFor(invoice: any): Promise<string | null> {
  if (!invoice.source_invoice_id || !/^\d{4}-\d{2}-\d{2}$/.test(String(invoice.invoice_date || ""))) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/invoices?id=eq.${encodeURIComponent(String(invoice.source_invoice_id))}&select=terms&limit=1`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    if (!rows.length) return null;
    const days = TERM_DAYS[rows[0].terms] !== undefined ? TERM_DAYS[rows[0].terms] : 15;
    const [y, m, d] = String(invoice.invoice_date).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

// The PDF the invoice generator archived when it made the invoice
// (storeInvoicePdf: invoice-pdfs/invoices/<number>.pdf), as a link that
// works for five minutes. The bucket stays private.
async function signedPdfUrl(invoiceNumber: string): Promise<string | null> {
  const objectPath = `invoices/${encodeURIComponent(invoiceNumber)}.pdf`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/invoice-pdfs/${objectPath}`, {
    method: "POST",
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 300 }),
  });
  if (!res.ok) return null;
  const body = await res.json().catch(() => ({}));
  const signed = body.signedURL || body.signedUrl;
  return typeof signed === "string" ? `${SUPABASE_URL}/storage/v1${signed.startsWith("/") ? "" : "/"}${signed}` : null;
}

// Fix plan RP1.3 (2026-11-07): what is still owed on a portal invoice, in
// cents -- the total less anything already paid (a part payment recorded in
// the Workspace). client_portal_invoices.paid_amount is kept in step by the
// database (sql/payments/03_portal_balance_and_sent.sql).
// In dollars, rounded to cents once at the end -- the same way the webhook
// rounds what is owed, so the two always agree; with nothing paid it is
// exactly the old Math.round(total * 100).
function balanceDollars(inv: { total: unknown; paid_amount?: unknown }): number {
  return Math.max(0, (Number(inv.total) || 0) - (Number(inv.paid_amount) || 0));
}
function balanceCents(inv: { total: unknown; paid_amount?: unknown }): number {
  return Math.round(balanceDollars(inv) * 100);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: CORS_HEADERS });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  const notFound = () => json({ ok: false, error: "not_found" }, 404);

  try {
    const { action, token, receipt_email } = await req.json().catch(() => ({}));
    // Counted before the code is even looked at, so probing for codes is
    // throttled too (RP3.18). pdf shares the view budget.
    const isPay = action === "pay";
    const allowed = await rateLimitTake(
      isPay ? "guest-pay:pay" : "guest-pay:view",
      clientIp(req),
      isPay ? PAY_LIMIT_PER_HOUR : VIEW_LIMIT_PER_HOUR,
      3600,
    );
    if (!allowed) {
      return json({ ok: false, code: "too_many_requests", error: "Too many tries from this connection. Please wait a while and try again, or call (435) 414-1667." }, 429);
    }
    if (typeof token !== "string" || !TOKEN_SHAPE.test(token)) return notFound();
    const invoice = await findInvoice(token);
    if (!invoice || tokenExpired(invoice)) return notFound();

    if (action === "view") {
      return json({
        ok: true,
        invoice_number: invoice.invoice_number,
        invoice_date: invoice.invoice_date,
        description: invoice.description,
        billed_to: billedTo(invoice.client_name),
        amount_due: invoice.paid ? 0 : balanceCents(invoice) / 100,
        due_date: await dueDateFor(invoice),
        paid: !!invoice.paid,
        paid_at: invoice.paid_at || null,
        // Where Stripe will send the receipt (RP3.18), masked.
        receipt_to: maskEmail(invoice.client_email),
      });
    }
    if (action === "pdf") {
      const url = await signedPdfUrl(String(invoice.invoice_number));
      return url ? json({ ok: true, url }) : json({ ok: false, error: "no_pdf" }, 404);
    }
    if (action !== "pay") return json({ ok: false, error: "unknown_action" }, 400);

    if (invoice.paid) return json({ ok: false, already_paid: true, error: "This invoice is already paid." }, 409);
    let earlierPi: any = null;
    if (invoice.stripe_payment_intent_id) {
      const lookup = await retrievePaymentIntent(invoice.stripe_payment_intent_id);
      if (!lookup.ok) {
        return json({ ok: false, error: "We couldn't check this invoice's earlier payment just now. Please try again in a minute, or call (435) 414-1667." }, 502);
      }
      earlierPi = lookup.pi;
    }
    if (earlierPi && blocksNewPayment(earlierPi)) {
      return json({ ok: false, already_paying: true, error: "A payment for this invoice has already gone through or is still processing. It can take a minute to show as paid." }, 409);
    }

    const amountCents = balanceCents(invoice);
    if (amountCents <= 0) return json({ ok: false, already_paid: true, error: "Nothing is owed on this invoice." }, 409);
    if (
      earlierPi && REUSABLE_STATUSES.has(earlierPi.status) &&
      earlierPi.amount === amountCents && earlierPi.currency === "usd" && !earlierPi.customer &&
      earlierPi.metadata?.client_portal_invoice_id === String(invoice.id) &&
      typeof earlierPi.client_secret === "string"
    ) {
      return json({ ok: true, client_secret: earlierPi.client_secret, reused: true });
    }

    // RP3.18: the receipt goes to the invoice's own client email, never to
    // an address the caller names. A typed address that IS the client's
    // (any case) is the same address; anything else is ignored.
    const onFile = String(invoice.client_email || "").trim().toLowerCase();
    const typed = typeof receipt_email === "string" ? receipt_email.trim().toLowerCase() : "";
    if (typed && typed !== onFile) console.log(`guest-pay: ignored a receipt_email that isn't the client's for invoice ${invoice.id}`);
    const receiptTo = onFile.length <= 254 && EMAIL_SHAPE.test(onFile) ? onFile : null;
    const params = new URLSearchParams({
      amount: String(amountCents),
      currency: "usd",
      "automatic_payment_methods[enabled]": "true",
      "metadata[client_portal_invoice_id]": String(invoice.id),
      "metadata[paid_via]": "guest_link",
    });
    if (receiptTo) params.set("receipt_email", receiptTo);
    const piRes = await stripePost("payment_intents", params, `pi-guest-v1-${invoice.id}-${amountCents}-${invoice.stripe_payment_intent_id || "none"}`);
    if (!piRes.ok) {
      console.error(`guest-pay: Stripe refused a PaymentIntent for ${invoice.id}: ${(await piRes.text()).slice(0, 300)}`);
      return json({ ok: false, error: "The payment could not be started. Please try again, or call (435) 414-1667." }, 502);
    }
    const pi = await piRes.json();
    await fetch(`${SUPABASE_URL}/rest/v1/client_portal_invoices?id=eq.${invoice.id}`, {
      method: "PATCH",
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ stripe_payment_intent_id: pi.id }),
    });
    return json({ ok: true, client_secret: pi.client_secret });
  } catch (err: any) {
    console.error(`guest-pay: ${err.message}`);
    return json({ ok: false, error: "Something went wrong. Please try again, or call (435) 414-1667." }, 500);
  }
});
