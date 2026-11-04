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
// Deploy: supabase functions deploy guest-pay --no-verify-jwt

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");

// Lower-case letters and digits without the look-alikes (0/o, 1/l/i),
// 10-40 long (the invoice generator makes 10: 31^10, about 8e14, so not
// guessable) -- the shape tools/invoice-generator.html makes.
const TOKEN_SHAPE = /^[a-hjkmnp-z2-9]{10,40}$/;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

async function retrievePaymentIntent(id: string): Promise<any | null> {
  try {
    const res = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(id)}?expand[]=latest_charge`, {
      headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
    });
    if (!res.ok) {
      if (res.status !== 404) console.error(`guest-pay: could not retrieve ${id} (HTTP ${res.status}); continuing without the double-charge check`);
      return null;
    }
    return await res.json();
  } catch (err: any) {
    console.error(`guest-pay: could not retrieve ${id} (${err.message}); continuing without the double-charge check`);
    return null;
  }
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
      `&select=id,source_invoice_id,invoice_number,invoice_date,description,client_name,client_email,total,paid,paid_at,stripe_payment_intent_id&limit=1`,
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: CORS_HEADERS });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  const notFound = () => json({ ok: false, error: "not_found" }, 404);

  try {
    const { action, token, receipt_email } = await req.json().catch(() => ({}));
    if (typeof token !== "string" || !TOKEN_SHAPE.test(token)) return notFound();
    const invoice = await findInvoice(token);
    if (!invoice) return notFound();

    if (action === "view") {
      return json({
        ok: true,
        invoice_number: invoice.invoice_number,
        invoice_date: invoice.invoice_date,
        description: invoice.description,
        billed_to: billedTo(invoice.client_name),
        amount_due: invoice.paid ? 0 : Number(invoice.total),
        due_date: await dueDateFor(invoice),
        paid: !!invoice.paid,
        paid_at: invoice.paid_at || null,
      });
    }
    if (action === "pdf") {
      const url = await signedPdfUrl(String(invoice.invoice_number));
      return url ? json({ ok: true, url }) : json({ ok: false, error: "no_pdf" }, 404);
    }
    if (action !== "pay") return json({ ok: false, error: "unknown_action" }, 400);

    if (invoice.paid) return json({ ok: false, already_paid: true, error: "This invoice is already paid." }, 409);
    const earlierPi = invoice.stripe_payment_intent_id ? await retrievePaymentIntent(invoice.stripe_payment_intent_id) : null;
    if (earlierPi && blocksNewPayment(earlierPi)) {
      return json({ ok: false, already_paying: true, error: "A payment for this invoice has already gone through or is still processing. It can take a minute to show as paid." }, 409);
    }

    const amountCents = Math.round(Number(invoice.total) * 100);
    if (
      earlierPi && REUSABLE_STATUSES.has(earlierPi.status) &&
      earlierPi.amount === amountCents && earlierPi.currency === "usd" && !earlierPi.customer &&
      earlierPi.metadata?.client_portal_invoice_id === String(invoice.id) &&
      typeof earlierPi.client_secret === "string"
    ) {
      return json({ ok: true, client_secret: earlierPi.client_secret, reused: true });
    }

    const typed = typeof receipt_email === "string" ? receipt_email.trim().toLowerCase() : "";
    const receiptTo = EMAIL_SHAPE.test(typed) ? typed : invoice.client_email;
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
