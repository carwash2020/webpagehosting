// Supabase Edge Function: stripe-webhook
//
// Receives Stripe events, records each one in the stripe_events ledger,
// and applies it: payments succeeded / failed / canceled, refunds (full and
// partial), and disputes. Invoices are marked paid in client_portal_invoices
// and public.invoices, and the internal th_invoices log is updated too, so
// Connor/Steve see it as paid, not just the portal.
//
// Deployed with verify_jwt: false -- Stripe itself can't send a
// Supabase JWT, so the ONLY thing authenticating an incoming request
// here is the Stripe-Signature header, verified below. This is the
// official, Supabase-documented pattern for this exact situation
// (confirmed directly against supabase/supabase's own stripe-webhooks
// example before writing this): constructEventAsync(), not the sync
// constructEvent() -- the sync version is a real, documented failure
// in Deno's async crypto environment. The raw body is read via
// .text(), never .json() -- signature verification needs the exact
// original bytes Stripe sent, and parsing then re-serializing JSON
// can subtly change them enough to break verification.
//
// Rebuilt 2026-10-31 (Stripe hardening, docs/stripe-hardening-2026-10-31):
// every database write now happens inside ONE Postgres function,
// stripe_record_event(event, refunds)
// (sql/payments/01_stripe_event_ledger_payments_refunds.sql). In one
// transaction it:
//   1. inserts the event into stripe_events (unique event_id). An event
//      already processed returns { duplicate: true } and nothing else runs.
//   2. applies it to payments / payment_allocations / refunds /
//      payment_disputes, client_portal_invoices and public.invoices.
//   3. marks the ledger row processed, or, if anything failed, rolls the
//      changes back, keeps the ledger row with its error, and returns
//      { error }. This function then answers 500 so Stripe retries.
// Before this, public.invoices was a separate best-effort PATCH after the
// portal write: if it failed, the webhook still returned 200, Stripe never
// retried, and the two tables drifted.
//
// What this function still does itself, after the database has recorded
// the event (so a redelivered event never repeats them):
//   - charge.refunded: fetches the charge's refund list from Stripe (read
//     only; API 2024-06-20 doesn't embed it) and passes it in.
//   - staff push: amount mismatch (paid short / overpaid), new dispute.
//   - POS: income-log entry + receipt email, only when this delivery won
//     the stripe_pos_charges_logged claim (now made inside the RPC).
//   - the workspace_sync th_invoices blob (best effort, as before).
//
// Refunds do NOT un-pay an invoice: send-payment-reminder emails any
// client whose invoice shows less paid than its total. A refund sets
// refunded_amount / refund_status instead, the portal shows "Refunded",
// and invoice_payment_status has the true net. See the SQL file's header.
//
// Kept from before: the amount check (security audit 2026-09-25, finding
// #7) -- a short payment leaves the invoice unpaid and alerts staff; an
// overpayment marks it paid and alerts. It now runs inside the RPC.
//
// Events to send to this endpoint (Stripe dashboard -> Developers ->
// Webhooks -> this endpoint -> events): see the list in
// docs/stripe-hardening-2026-10-31/README.md. Anything else that arrives
// is recorded in the ledger as "ignored" and answered 200.
//
// Required secrets (Supabase dashboard -> Edge Functions -> Secrets):
//   STRIPE_SECRET_KEY -- the live key (verified live 2026-10-31); used
//     here only to read a charge's refunds.
//   STRIPE_WEBHOOK_SIGNING_SECRET -- whsec_..., per endpoint and per mode.
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-provided by Supabase.)
//
// NOTE (recorded 2026-09-02, when this file was first backed up into
// the repo): the workspace_sync write-back below is an unconditional
// read-modify-write of the ENTIRE blob for one project ("code" =
// tripleh-workspace-2026), with no merge/version check against a
// concurrent write from an active browser session. That's a real,
// accepted risk specific to this one field (payment status is
// important enough that the team judged the rare-collision risk worth
// it) -- it is NOT the pattern to copy for other internal-blob writes.
// The quote-approval feature (docs/CLIENT-PORTAL.md, phase 2)
// deliberately did NOT do the same thing for that reason, using a live
// read against client_portal_quotes instead of a blob write.

import Stripe from "npm:stripe@latest";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SIGNING_SECRET");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const LEAD_EMAIL_FROM = Deno.env.get("LEAD_EMAIL_FROM") || "";
const LOGO_URL = "https://www.triplehenterprisesllc.biz/images/logo-signature-email.png";

// A POS-style receipt (2026-09-03), requested directly: "create a POS
// style reciept that shows what we charged them for sense we are
// collecting the email anyway." Duplicated from create-pos-charge's
// own identical helper -- see that function's header comment for why
// (no shared-module system across separately-deployed Edge
// Functions). This copy specifically covers the 'new_card' POS path,
// where the charge only actually completes HERE, asynchronously,
// after create-pos-charge already returned a client_secret and the
// client-side Stripe Elements confirmed it moments later.
function escapeHtmlPos(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

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

function money(cents: number): string {
  return "$" + (cents / 100).toFixed(2);
}

// Staff push for a payment whose amount doesn't match what the invoice(s)
// still owe -- see the amount check in the handler below. Goes through
// Send-Push's existing stripe-reconciliation-alert type, which only ever
// reaches internal accounts' devices. Never throws: the alert is the
// heads-up, not the record, and a push failure must not turn a real
// payment into a webhook error Stripe retries for days.
async function sendAmountMismatchAlert(piId: string, invoices: any[], receivedCents: number, owedCents: number, underpaid: boolean) {
  const label = `${invoices.length === 1 ? "invoice" : "invoices"} ${invoices.map((inv: any) => `#${inv.invoice_number}`).join(", ")}`;
  const clientEmail = invoices[0]?.client_email || "unknown client";
  const title = underpaid ? "Invoice paid short" : "Invoice overpaid";
  const body = `Stripe payment ${piId} received ${money(receivedCents)} for ${label} (${clientEmail}), which still owed ${money(owedCents)}. ` +
    (underpaid
      ? "It was left unpaid. Collect the difference, then mark it paid by hand."
      : `It was marked paid. Check Stripe: the extra ${money(receivedCents - owedCents)} may need a refund.`);
  try {
    // Send-Push, exact casing -- function slugs are case-sensitive.
    const res = await fetch(`${SUPABASE_URL}/functions/v1/Send-Push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ type: "stripe-reconciliation-alert", title, body }),
    });
    if (!res.ok) console.error(`Amount-mismatch alert for ${piId} failed: HTTP ${res.status}`);
  } catch (err) {
    console.error(`Amount-mismatch alert for ${piId} failed:`, err);
  }
}

async function sendPosReceiptEmail(clientEmail: string, description: string, amount: number) {
  if (!clientEmail) return;
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
    console.error("sendPosReceiptEmail failed:", err);
  }
}

// Staff push for a new dispute: money is already held back by Stripe and
// there's a response deadline. Same channel as the amount alert above.
async function sendDisputeAlert(r: any) {
  const due = r.evidence_due_by
    ? new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric" }).format(new Date(r.evidence_due_by))
    : "soon";
  const body = `A client disputed a ${money(Number(r.amount_cents) || 0)} card payment (${r.client_email || "unknown client"}, reason: ${r.reason || "unknown"}). ` +
    `Stripe is holding the funds. Respond in the Stripe dashboard by ${due}.`;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/Send-Push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ type: "stripe-reconciliation-alert", title: "Payment disputed", body }),
    });
    if (!res.ok) console.error(`Dispute alert for ${r.dispute_id} failed: HTTP ${res.status}`);
  } catch (err) {
    console.error(`Dispute alert for ${r.dispute_id} failed:`, err);
  }
}

// The database half of this webhook. Returns the RPC's JSON, or null if
// the call itself failed (the function isn't deployed yet, the database is
// unreachable): the caller answers 500 so Stripe retries.
async function recordEvent(event: Stripe.Event, refunds: unknown[] | null): Promise<any | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/stripe_record_event`, {
      method: "POST",
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_event: event, p_refunds: refunds }),
    });
    if (!res.ok) {
      console.error(`stripe_record_event failed for ${event.id}: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error(`stripe_record_event failed for ${event.id}:`, err);
    return null;
  }
}

// POS income-log entry for a charge this delivery claimed first. Unchanged
// from before apart from moving into its own function.
async function logPosIncome(pi: Stripe.PaymentIntent) {
  const syncRes = await fetch(
    `${SUPABASE_URL}/rest/v1/workspace_sync?code=eq.tripleh-workspace-2026&select=data`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  if (!syncRes.ok) {
    console.error(`Failed to read workspace_sync for POS charge ${pi.id}: ${await syncRes.text().catch(() => "")}`);
    return;
  }
  const syncRows = await syncRes.json();
  if (!syncRows.length) return;
  const blob = syncRows[0].data;
  const incomeLog = JSON.parse(blob.th_income_log || "[]");
  // toISOString() is always UTC -- the business runs on America/Denver
  // time, so a POS sale after ~6pm local would silently log against
  // tomorrow's date in Finance. Same fix already applied to
  // create-pos-charge-index.ts's own income-log entry.
  const whParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const whDateMap: Record<string, string> = {};
  whParts.forEach((p) => { whDateMap[p.type] = p.value; });
  incomeLog.push({
    id: Date.now(),
    date: `${whDateMap.year}-${whDateMap.month}-${whDateMap.day}`,
    desc: pi.metadata?.pos_description || pi.description || "POS sale",
    amount: pi.metadata?.pos_amount ? Number(pi.metadata.pos_amount) : pi.amount / 100,
    source: pi.metadata?.pos_client_email || "",
    payment: "Stripe (POS)",
    jobRefId: "",
    jobRefTitle: "",
    origin: "pos",
    stripePaymentIntentId: pi.id,
    createdBy: pi.metadata?.internal_account || "",
    lastEditedBy: pi.metadata?.internal_account || "",
  });
  blob.th_income_log = JSON.stringify(incomeLog);
  const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/workspace_sync?code=eq.tripleh-workspace-2026`, {
    method: "PATCH",
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ data: blob, updated_at: new Date().toISOString() }),
  });
  if (!patchRes.ok) console.error(`Failed to log POS income for ${pi.id}: ${await patchRes.text().catch(() => "")}`);
}

// Mark the invoices this payment just paid as paid in the workspace_sync
// th_invoices blob too, so Connor/Steve's own invoice log matches.
// Best effort, as before: the database already has the payment, and
// failing the webhook here would make Stripe redeliver an event the ledger
// will now (correctly) skip as a duplicate anyway.
async function markPaidInWorkspaceBlob(piId: string, marked: any[]) {
  const syncRes = await fetch(
    `${SUPABASE_URL}/rest/v1/workspace_sync?code=eq.tripleh-workspace-2026&select=data`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  if (!syncRes.ok) {
    console.error(`Failed to read workspace_sync for PaymentIntent ${piId}: ${await syncRes.text().catch(() => "")}`);
    return;
  }
  const syncRows = await syncRes.json();
  if (!syncRows.length) return;
  const blob = syncRows[0].data;
  const invoices = JSON.parse(blob.th_invoices || "[]");
  const portalTotal = new Map(marked.map((inv: any) => [inv.source_invoice_id, Number(inv.total) || 0]));
  let changed = false;
  invoices.forEach((inv: any) => {
    if (!portalTotal.has(inv.id)) return;
    // Paid in full means paidAmount = total, the same as Mark paid in the
    // app (workspace.html togglePaid, invoice-generator.html). Setting only
    // `paid` flipped back to unpaid on the next sync, because every device
    // recomputes `paid` from paidAmount (sync.js deriveInvoicePaid).
    const total = Number(inv.total ?? portalTotal.get(inv.id)) || 0;
    const paidCents = Math.round((Number(inv.paidAmount) || 0) * 100);
    const fullyRecorded = inv.paid === true && inv.paidAmount != null && paidCents >= Math.round(total * 100);
    if (fullyRecorded) return;
    inv.paid = true;
    inv.paidAmount = total;
    changed = true;
  });
  if (!changed) return;
  blob.th_invoices = JSON.stringify(invoices);
  const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/workspace_sync?code=eq.tripleh-workspace-2026`, {
    method: "PATCH",
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ data: blob, updated_at: new Date().toISOString() }),
  });
  if (!patchRes.ok) console.error(`Failed to mark workspace_sync th_invoices paid for ${piId}: ${await patchRes.text().catch(() => "")}`);
}

Deno.serve(async (req: Request) => {
  if (!STRIPE_SECRET_KEY || !WEBHOOK_SECRET) {
    return new Response("STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SIGNING_SECRET secret is not set yet.", { status: 500 });
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20", httpClient: Stripe.createFetchHttpClient() });
  const cryptoProvider = Stripe.createSubtleCryptoProvider();

  const signature = req.headers.get("Stripe-Signature");
  if (!signature) {
    return new Response("Missing Stripe-Signature header.", { status: 400 });
  }

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, WEBHOOK_SECRET, undefined, cryptoProvider);
  } catch (err: any) {
    return new Response(`Webhook signature verification failed: ${err.message}`, { status: 400 });
  }

  // charge.refunded: the RPC needs every refund on the charge. API
  // 2024-06-20 doesn't embed them, so read them (a GET; nothing in Stripe
  // changes). If this fails, answer 500 and let Stripe retry rather than
  // record a refund total we can't itemize.
  let refunds: unknown[] | null = null;
  if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    const embedded = (charge as any).refunds;
    if (embedded && Array.isArray(embedded.data) && !embedded.has_more) {
      refunds = embedded.data;
    } else {
      try {
        refunds = [];
        for await (const refund of stripe.refunds.list({ charge: charge.id, limit: 100 })) refunds.push(refund);
      } catch (err: any) {
        console.error(`Could not list refunds for ${charge.id}: ${err.message}`);
        return new Response(JSON.stringify({ received: false, error: "Could not read the charge's refunds" }), { status: 500 });
      }
    }
  }

  // Ledger + database changes, in one transaction (see the header).
  const result = await recordEvent(event, refunds);
  if (!result || result.error) {
    if (result?.error) console.error(`Stripe event ${event.id} (${event.type}) failed: ${String(result.error).slice(0, 300)}`);
    return new Response(JSON.stringify({ received: false, event_id: event.id, error: "Could not record the event" }), { status: 500 });
  }
  if (result.duplicate) {
    return new Response(JSON.stringify({ received: true, event_id: event.id, duplicate: true }), { status: 200 });
  }

  // Side effects, once per event (a redelivery is a duplicate above).
  if (result.action === "pos_charge") {
    const pi = event.data.object as Stripe.PaymentIntent;
    // Only the delivery that won the stripe_pos_charges_logged claim logs
    // the income and sends the receipt. create-pos-charge's charge_saved
    // path claims the same row first, so its own synchronous log wins and
    // this one does nothing.
    if (result.pos_first) {
      await logPosIncome(pi);
      await sendPosReceiptEmail(
        pi.metadata?.pos_client_email || "",
        pi.metadata?.pos_description || pi.description || "",
        pi.metadata?.pos_amount ? Number(pi.metadata.pos_amount) : pi.amount / 100,
      );
    }
    return new Response(JSON.stringify({ received: true, pos_charge: true }), { status: 200 });
  }

  if (result.action === "invoice_payment") {
    const pi = event.data.object as Stripe.PaymentIntent;
    if (result.warning) console.error(`payment_intent.succeeded for ${pi.id}: ${result.warning}`);
    if (result.amount_mismatch) {
      const invoices = Array.isArray(result.invoices) ? result.invoices : [];
      await sendAmountMismatchAlert(pi.id, invoices, Number(result.received_cents), Number(result.owed_cents), result.amount_mismatch === "underpaid");
    }
    const marked = Array.isArray(result.invoices_marked_paid) ? result.invoices_marked_paid : [];
    if (marked.length) await markPaidInWorkspaceBlob(pi.id, marked);
    return new Response(JSON.stringify({
      received: true,
      invoices_marked_paid: marked.length,
      amount_mismatch: result.amount_mismatch || undefined,
      already_processed: result.already_processed || undefined,
      warning: result.warning || undefined,
    }), { status: 200 });
  }

  if (result.action === "dispute" && result.first_seen) {
    await sendDisputeAlert(result);
  }

  return new Response(JSON.stringify({ received: true, event_id: event.id, action: result.action }), { status: 200 });
});
