// Supabase Edge Function: stripe-webhook
//
// Receives payment_intent.succeeded events from Stripe once a client
// actually completes a payment, and marks the corresponding invoice
// paid in both client_portal_invoices and the internal th_invoices
// log (so Connor/Steve see it as paid too, not just the portal).
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
// Required secrets (Supabase dashboard -> Edge Functions -> Secrets):
//   STRIPE_SECRET_KEY -- same test-mode key create-payment-intent uses.
//   STRIPE_WEBHOOK_SIGNING_SECRET -- a SEPARATE secret from the API
//     key, starting with whsec_..., shown once when the webhook
//     endpoint is registered in the Stripe dashboard (Developers ->
//     Webhooks -> Add endpoint, pointing at this function's own URL).
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

  // Only the one event type this function actually needs to act on --
  // Stripe sends many event types to the same endpoint by default;
  // anything else is acknowledged (200) so Stripe doesn't keep
  // retrying it, but otherwise ignored.
  if (event.type !== "payment_intent.succeeded") {
    return new Response(JSON.stringify({ received: true, ignored: event.type }), { status: 200 });
  }

  const pi = event.data.object as Stripe.PaymentIntent;
  const invoiceIdFromMetadata = pi.metadata?.client_portal_invoice_id;

  // Looked up by the PaymentIntent id first (set by create-payment-intent
  // when the intent was originally created) -- metadata is the belt-
  // and-suspenders fallback if that earlier write ever failed for some
  // reason, not the primary lookup.
  let invoiceRes = await fetch(
    `${SUPABASE_URL}/rest/v1/client_portal_invoices?stripe_payment_intent_id=eq.${pi.id}&select=id,source_invoice_id,paid`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  let rows = await invoiceRes.json();
  if (!rows.length && invoiceIdFromMetadata) {
    invoiceRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_invoices?id=eq.${invoiceIdFromMetadata}&select=id,source_invoice_id,paid`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    rows = await invoiceRes.json();
  }
  if (!rows.length) {
    // Acknowledge with 200 regardless -- returning an error here would
    // make Stripe retry this same event repeatedly, which won't ever
    // resolve a genuinely missing invoice. Logged so this is still
    // visible for manual follow-up rather than silently lost.
    console.error(`payment_intent.succeeded for ${pi.id} but no matching invoice found`);
    return new Response(JSON.stringify({ received: true, warning: "no matching invoice" }), { status: 200 });
  }
  const invoice = rows[0];

  if (invoice.paid) {
    // Already processed -- Stripe can and does redeliver the same
    // event more than once by design; this makes handling it a second
    // time a harmless no-op instead of a duplicate side effect.
    return new Response(JSON.stringify({ received: true, already_processed: true }), { status: 200 });
  }

  const paidAt = new Date().toISOString();

  // Mark paid in the client-facing table -- this is what the client
  // actually sees reflected back on their next dashboard load.
  await fetch(
    `${SUPABASE_URL}/rest/v1/client_portal_invoices?id=eq.${invoice.id}`,
    {
      method: "PATCH",
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ paid: true, paid_at: paidAt }),
    },
  );

  // Also mark paid in workspace_sync's th_invoices, so Connor/Steve's
  // own invoice log reflects this too, not just the portal --
  // workspace_sync stores one row per sync "code" as a single JSON
  // blob (confirmed against the real schema before writing this, not
  // assumed), so this reads the current blob, updates just the one
  // matching invoice entry within its th_invoices array, and writes
  // the whole blob back.
  const syncRes = await fetch(
    `${SUPABASE_URL}/rest/v1/workspace_sync?code=eq.tripleh-workspace-2026&select=data`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  const syncRows = await syncRes.json();
  if (syncRows.length) {
    const blob = syncRows[0].data;
    const invoices = JSON.parse(blob.th_invoices || "[]");
    const idx = invoices.findIndex((inv: any) => inv.id === invoice.source_invoice_id);
    if (idx !== -1 && !invoices[idx].paid) {
      invoices[idx].paid = true;
      blob.th_invoices = JSON.stringify(invoices);
      await fetch(
        `${SUPABASE_URL}/rest/v1/workspace_sync?code=eq.tripleh-workspace-2026`,
        {
          method: "PATCH",
          headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ data: blob, updated_at: paidAt }),
        },
      );
    }
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
});
