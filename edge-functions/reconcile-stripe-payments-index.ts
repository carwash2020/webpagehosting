// Supabase Edge Function: reconcile-stripe-payments
//
// Requested directly (2026-09-05): "future proof this... what other
// layers can we add." Webhooks (stripe-webhook) are handled
// correctly -- idempotent, retry-safe -- but nothing previously
// checked for an event MISSED entirely. Stripe retries a failed
// webhook delivery for about 3 days, then stops; after that, a real
// payment could sit forever showing unpaid in the portal with
// nothing to ever catch it, unless someone happened to notice and
// cross-check manually.
//
// This runs daily via pg_cron: lists every succeeded PaymentIntent
// created in roughly the last week (well past Stripe's own 3-day
// retry window, so this only ever looks at events that had every
// real chance to already be reconciled the normal way), cross-checks
// each against client_portal_invoices, and ALERTS if a succeeded
// payment's invoice still shows unpaid. Deliberately alert-only, never
// auto-fixing: financial state changes need a human to actually look
// and confirm what happened (a refund, a dispute, a genuine bug) --
// this is the same principle set-invoice-paid already exists to serve
// as the one, deliberate, human-driven way an invoice's paid status
// ever changes by hand.
//
// Required secret: STRIPE_RECONCILE_SECRET_KEY -- its own dedicated,
// narrowly-scoped Stripe restricted key (PaymentIntents: Read only,
// nothing else), matching the "one key one function" practice
// already established for POS and saved cards. This function never
// creates a charge or touches a customer -- it only ever reads.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_RECONCILE_SECRET_KEY = Deno.env.get("STRIPE_RECONCILE_SECRET_KEY");

// A week of margin past Stripe's own ~3-day webhook retry window --
// generous enough that this only ever looks at payments that had
// every real chance to already be reconciled normally.
const LOOKBACK_DAYS = 8;
// A discrepancy resends daily until it's actually fixed -- the same
// reasoning Send-Push's own "unresponded-lead" check already uses:
// a real, unresolved financial mismatch getting nudged every day
// until someone deals with it is the actual point, not a one-time
// notice that's easy to miss.
const RESEND_DAYS = 1;

async function supabaseRequest(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      ...(init.headers || {}),
    },
  });
}

async function wasRecentlyAlerted(itemKey: string): Promise<boolean> {
  const res = await supabaseRequest(
    `/rest/v1/notification_log?notif_type=eq.stripe-reconciliation-mismatch&item_key=eq.${encodeURIComponent(itemKey)}&select=sent_at`,
  );
  if (!res.ok) return false;
  const rows = await res.json();
  if (!rows.length) return false;
  const daysSince = Math.round((Date.now() - new Date(rows[0].sent_at).getTime()) / (24 * 60 * 60 * 1000));
  return daysSince < RESEND_DAYS;
}

async function markAlerted(itemKey: string) {
  await supabaseRequest("/rest/v1/notification_log", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ notif_type: "stripe-reconciliation-mismatch", item_key: itemKey, sent_at: new Date().toISOString() }),
  });
}

async function sendAlert(title: string, body: string) {
  // Send-Push, exact casing -- Supabase function slugs are
  // case-sensitive; a lowercase call created a genuinely separate,
  // orphaned function during an earlier build this same session. See
  // notify-work-order-message-email-index.ts for that incident's own
  // history.
  await fetch(`${SUPABASE_URL}/functions/v1/Send-Push`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    body: JSON.stringify({ type: "stripe-reconciliation-alert", title, body }),
  });
}

function money(cents: number): string {
  return "$" + (cents / 100).toFixed(2);
}

// Extracts every client_portal_invoices id this PaymentIntent's own
// metadata claims to cover -- both the single-invoice shape
// (create-payment-intent's client_portal_invoice_id) and the bulk
// shape (create-bulk-payment-intent's comma-separated
// client_portal_invoice_ids), since either could be the real source
// of a succeeded payment.
function extractInvoiceIds(metadata: Record<string, string> | undefined): number[] {
  if (!metadata) return [];
  const ids: number[] = [];
  if (metadata.client_portal_invoice_id) {
    const id = parseInt(metadata.client_portal_invoice_id, 10);
    if (!isNaN(id)) ids.push(id);
  }
  if (metadata.client_portal_invoice_ids) {
    for (const part of metadata.client_portal_invoice_ids.split(",")) {
      const id = parseInt(part.trim(), 10);
      if (!isNaN(id)) ids.push(id);
    }
  }
  return ids;
}

Deno.serve(async (req: Request) => {
  try {
    if (!STRIPE_RECONCILE_SECRET_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "STRIPE_RECONCILE_SECRET_KEY secret is not set yet." }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const createdGte = Math.floor((Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000) / 1000);
    // 100 is Stripe's own max page size. A small business's real
    // weekly payment volume is nowhere near this yet; if it ever
    // grows past 100 succeeded payments in the lookback window, this
    // would need real pagination (has_more/starting_after) to stay
    // correct -- worth knowing, not worth building ahead of the need.
    const piRes = await fetch(
      `https://api.stripe.com/v1/payment_intents?created[gte]=${createdGte}&limit=100`,
      { headers: { Authorization: `Bearer ${STRIPE_RECONCILE_SECRET_KEY}` } },
    );
    if (!piRes.ok) {
      const errBody = await piRes.text();
      return new Response(JSON.stringify({ ok: false, error: `Stripe error: ${errBody.slice(0, 300)}` }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
    const piData = await piRes.json();
    const succeeded = (piData.data || []).filter((pi: any) => pi.status === "succeeded");

    // Map invoice id -> the succeeded PaymentIntent that claims to
    // cover it, so a mismatch can be reported with the real amount
    // Stripe actually has on file for it.
    const invoiceIdToPaymentIntent = new Map<number, any>();
    for (const pi of succeeded) {
      for (const invoiceId of extractInvoiceIds(pi.metadata)) {
        invoiceIdToPaymentIntent.set(invoiceId, pi);
      }
    }

    if (invoiceIdToPaymentIntent.size === 0) {
      return new Response(JSON.stringify({ ok: true, checked: 0, mismatches: 0 }), { headers: { "Content-Type": "application/json" } });
    }

    const idList = [...invoiceIdToPaymentIntent.keys()].join(",");
    const invoicesRes = await supabaseRequest(
      `/rest/v1/client_portal_invoices?id=in.(${idList})&select=id,client_email,invoice_number,total,paid`,
    );
    if (!invoicesRes.ok) {
      return new Response(JSON.stringify({ ok: false, error: "Could not look up client_portal_invoices." }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
    const invoices = await invoicesRes.json();

    let mismatchCount = 0;
    for (const invoice of invoices) {
      if (invoice.paid) continue; // already reconciled, nothing to alert about

      const pi = invoiceIdToPaymentIntent.get(invoice.id);
      const itemKey = String(invoice.id);
      if (await wasRecentlyAlerted(itemKey)) continue;

      mismatchCount++;
      await sendAlert(
        "Payment reconciliation mismatch",
        `Invoice #${invoice.invoice_number} (${invoice.client_email}) shows unpaid, but Stripe has a succeeded payment (${money(pi.amount)}) for it. Check Portal invoices.`,
      );
      await markAlerted(itemKey);
    }

    return new Response(JSON.stringify({ ok: true, checked: invoices.length, mismatches: mismatchCount }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
