// Supabase Edge Function: stripe-webhook
//
// Receives payment_intent.succeeded events from Stripe once a client
// actually completes a payment, and marks the corresponding invoice(s)
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
// Updated 2026-09-02 ("Pay All Outstanding"): a single PaymentIntent
// can now cover MULTIPLE invoices (create-bulk-payment-intent writes
// the same stripe_payment_intent_id onto every invoice in the batch).
// The lookup-by-payment-intent-id below already naturally returns every
// matching row, not just one -- this just needed to stop assuming
// rows[0] was the only one and loop over all of them instead. The
// metadata fallback checks BOTH the singular (client_portal_invoice_id,
// one invoice) and plural (client_portal_invoice_ids, comma-separated
// list, bulk) shapes.
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
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const LEAD_EMAIL_FROM = Deno.env.get("LEAD_EMAIL_FROM") || "";
const LOGO_URL = "https://www.triplehenterprisesllc.biz/images/logo-signature-email.png";

// Partial payments (2026-09-17): `paid` must always be DERIVED from
// paid_amount vs total, using the exact same whole-cents comparison
// tools/sync.js's deriveInvoicePaid() uses (see that function's own
// header comment for the full 2026-09-16 bug this guards against -- a
// merge that let `paid` and `paidAmount` drift independently fired a
// false "invoice overdue" push for an invoice paid in full). This is
// a deliberate duplicate, not an import -- there's no shared-module
// system across edge functions in this project (see e.g. send-push's
// own getPaidAmount()/getRemainingCents(), added for the same reason)
// -- but it must stay byte-for-byte equivalent to deriveInvoicePaid().
function derivePaidFromCents(totalCents: number, paidCents: number): boolean {
  return totalCents > 0 && paidCents >= totalCents;
}

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

  // POS charge (2026-09-03), checked BEFORE any invoice lookup -- a
  // POS sale has no invoice at all, by design, so trying to match one
  // first would just waste a query on every POS event. Idempotent on
  // this PaymentIntent's own id: create-pos-charge's 'charge_saved'
  // path already knows its own outcome synchronously and logs income
  // directly, without waiting for this webhook -- but Stripe still
  // sends payment_intent.succeeded for that charge too, so this must
  // never log it a second time. The 'new_card' path has no synchronous
  // outcome at all (Stripe Elements confirms client-side, later,
  // after create-pos-charge already returned), so THIS is the only
  // place that charge ever gets logged.
  if (pi.metadata?.pos_charge === "true") {
    // Real fix for a real race (closes a gap found in a full-repo
    // audit): this used to be a plain check-then-act against the
    // workspace_sync blob's own th_income_log array -- read the blob,
    // scan the array in JS for this payment_intent_id, append only if
    // absent. Two near-simultaneous webhook deliveries for the same
    // event could both pass that scan before either write landed,
    // double-logging the income and sending two receipt emails for one
    // charge. A JSON array has no unique constraint of its own, so
    // nothing could ever make that check atomic -- this table's real
    // Postgres primary key is what makes the decision atomic instead:
    // only one concurrent INSERT for the same payment_intent_id can
    // ever win, and PostgREST's on_conflict=do-nothing (via the
    // resolution=ignore-duplicates Prefer header) makes the loser a
    // normal 201-with-no-row response rather than a 409 to handle.
    const claimRes = await fetch(
      `${SUPABASE_URL}/rest/v1/stripe_pos_charges_logged?on_conflict=payment_intent_id`,
      {
        method: "POST",
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=ignore-duplicates,return=representation",
        },
        body: JSON.stringify({ payment_intent_id: pi.id }),
      },
    );
    const claimRows = claimRes.ok ? await claimRes.json() : [];
    const wonTheRace = claimRows.length > 0;

    if (wonTheRace) {
      const syncRes = await fetch(
        `${SUPABASE_URL}/rest/v1/workspace_sync?code=eq.tripleh-workspace-2026&select=data`,
        { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
      );
      const syncRows = await syncRes.json();
      if (syncRows.length) {
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
        await fetch(`${SUPABASE_URL}/rest/v1/workspace_sync?code=eq.tripleh-workspace-2026`, {
          method: "PATCH",
          headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ data: blob, updated_at: new Date().toISOString() }),
        });
        // Only sent alongside a genuinely NEW log entry -- the same
        // idempotency guard that stops a double income entry also
        // stops a double receipt email for the exact same charge.
        await sendPosReceiptEmail(
          pi.metadata?.pos_client_email || "",
          pi.metadata?.pos_description || pi.description || "",
          pi.metadata?.pos_amount ? Number(pi.metadata.pos_amount) : pi.amount / 100,
        );
      }
    }
    return new Response(JSON.stringify({ received: true, pos_charge: true }), { status: 200 });
  }

  // Looked up by the PaymentIntent id first (set by create-payment-intent
  // or create-bulk-payment-intent when the intent was originally
  // created) -- naturally returns every invoice sharing this
  // PaymentIntent id, whether that's one (single-invoice pay) or
  // several (Pay All Outstanding). Metadata is the belt-and-suspenders
  // fallback if that earlier write ever failed for some reason, not
  // the primary lookup.
  let invoiceRes = await fetch(
    `${SUPABASE_URL}/rest/v1/client_portal_invoices?stripe_payment_intent_id=eq.${pi.id}&select=id,source_invoice_id,paid,paid_at,total,paid_amount`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  let rows = await invoiceRes.json();
  if (!rows.length) {
    const singleId = pi.metadata?.client_portal_invoice_id;
    const idsCsv = pi.metadata?.client_portal_invoice_ids;
    const fallbackIds = idsCsv ? idsCsv.split(",") : (singleId ? [singleId] : []);
    if (fallbackIds.length) {
      invoiceRes = await fetch(
        `${SUPABASE_URL}/rest/v1/client_portal_invoices?id=in.(${fallbackIds.join(",")})&select=id,source_invoice_id,paid,paid_at,total,paid_amount`,
        { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
      );
      rows = await invoiceRes.json();
    }
  }
  if (!rows.length) {
    // Acknowledge with 200 regardless -- returning an error here would
    // make Stripe retry this same event repeatedly, which won't ever
    // resolve genuinely missing invoices. Logged so this is still
    // visible for manual follow-up rather than silently lost.
    console.error(`payment_intent.succeeded for ${pi.id} but no matching invoice(s) found`);
    return new Response(JSON.stringify({ received: true, warning: "no matching invoice" }), { status: 200 });
  }

  // Partial payments (2026-09-17) broke the old "filter to !paid, PATCH
  // once" idempotency trick: a still-partial invoice never leaves the
  // unpaid bucket, so a redelivered event for the SAME PaymentIntent
  // would have kept re-adding the same amount forever. The real fix is
  // a claim step against client_portal_invoice_payments (unique on
  // invoice_id + stripe_payment_intent_id) -- the exact claim-before-
  // act pattern already proven above for POS charges. Only rows that
  // actually win their claim get processed below; a redelivered event
  // finds every row already claimed and touches nothing.
  //
  // Bulk PaymentIntents (Pay All Outstanding) always pay every covered
  // invoice IN FULL -- create-bulk-payment-intent's own `alreadyPaid`
  // check requires that of every invoice in the batch before it ever
  // creates the PaymentIntent, and partial payments stay single-invoice
  // only for now (see that function's own header comment) -- so each
  // row's attributed amount there is its own total, not a share of
  // pi.amount. A single-invoice PaymentIntent (partial or full)
  // attributes the PaymentIntent's real charged amount directly --
  // never invoice.total -- since that's the one Stripe-confirmed figure
  // for what actually got charged.
  const isBulk = !!pi.metadata?.client_portal_invoice_ids;
  const claims = rows.map((inv: any) => ({
    invoice_id: inv.id,
    stripe_payment_intent_id: pi.id,
    amount_cents: isBulk ? Math.round(Number(inv.total) * 100) : pi.amount,
  }));

  const claimRes = await fetch(
    `${SUPABASE_URL}/rest/v1/client_portal_invoice_payments?on_conflict=invoice_id,stripe_payment_intent_id`,
    {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify(claims),
    },
  );
  if (!claimRes.ok) {
    const errText = await claimRes.text();
    console.error(`Failed to claim payment ledger rows for PaymentIntent ${pi.id}: ${errText.slice(0, 300)}`);
    return new Response(JSON.stringify({ received: false, error: "Failed to record payment ledger" }), { status: 500 });
  }
  const wonClaims: { invoice_id: number; amount_cents: number }[] = await claimRes.json();
  if (!wonClaims.length) {
    return new Response(JSON.stringify({ received: true, already_processed: true }), { status: 200 });
  }

  const paidAt = new Date().toISOString();
  const rowById = new Map(rows.map((inv: any) => [inv.id, inv]));

  // Per-row PATCH, not one blanket update covering every id -- unlike
  // the old all-or-nothing `paid: true`, each row's new paid_amount is
  // a different number (its own prior paid_amount plus its own
  // attributed cents), so there is no single request body that fits
  // every row anymore.
  const patchResults = await Promise.all(wonClaims.map(async (claim) => {
    const inv = rowById.get(claim.invoice_id);
    if (!inv) return { ok: false, id: claim.invoice_id };
    const totalCents = Math.round(Number(inv.total) * 100);
    const newPaidCents = Math.round(Number(inv.paid_amount || 0) * 100) + claim.amount_cents;
    const derivedPaid = derivePaidFromCents(totalCents, newPaidCents);
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_invoices?id=eq.${claim.invoice_id}`,
      {
        method: "PATCH",
        headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          paid_amount: newPaidCents / 100,
          paid: derivedPaid,
          paid_at: derivedPaid ? (inv.paid_at || paidAt) : inv.paid_at,
        }),
      },
    );
    return {
      ok: res.ok, id: claim.invoice_id, sourceInvoiceId: inv.source_invoice_id,
      incrementCents: claim.amount_cents,
    };
  }));

  // A non-2xx here must NOT fall through to the 200 at the end of this
  // handler: Stripe treats any non-2xx response as delivery failure and
  // retries the event for several days, which is exactly the safety net
  // this needs -- a customer who genuinely paid must never be left with
  // a wrong balance and nothing left to retry the write. Only the two
  // early-return cases above (no matching invoice; already processed)
  // are genuinely nothing-to-do and get a real 200.
  const failed = patchResults.filter((r) => !r.ok);
  if (failed.length) {
    console.error(`Failed to update client_portal_invoices for PaymentIntent ${pi.id}, ids: ${failed.map((r) => r.id).join(",")}`);
    return new Response(JSON.stringify({ received: false, error: "Failed to update invoice(s)" }), { status: 500 });
  }

  // Also update workspace_sync's th_invoices, so Connor/Steve's own
  // invoice log reflects the same payment, not just the portal --
  // workspace_sync stores one row per sync "code" as a single JSON
  // blob (confirmed against the real schema before writing this, not
  // assumed), so this reads the current blob, updates every matching
  // invoice entry within its th_invoices array (could be more than one
  // now, with Pay All Outstanding), and writes the whole blob back ONCE
  // -- not once per invoice, to avoid multiple concurrent read-modify-
  // write cycles racing each other within this same webhook call.
  const syncRes = await fetch(
    `${SUPABASE_URL}/rest/v1/workspace_sync?code=eq.tripleh-workspace-2026&select=data`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  if (!syncRes.ok) {
    // Secondary, internal-log-only write -- the client-facing table
    // above already succeeded, so this never fails the whole webhook
    // (Stripe would otherwise keep retrying an event that's already
    // fully handled from the client's perspective). Logged so a mismatch
    // between the portal and Steve/Connor's own invoice log is at least
    // visible for manual reconciliation, instead of silently vanishing.
    console.error(`Failed to read workspace_sync for PaymentIntent ${pi.id}: ${await syncRes.text().catch(() => "")}`);
    return new Response(JSON.stringify({ received: true, invoices_updated: patchResults.length, workspace_sync_warning: "Could not read workspace_sync" }), { status: 200 });
  }
  const syncRows = await syncRes.json();
  if (syncRows.length) {
    const blob = syncRows[0].data;
    const invoices = JSON.parse(blob.th_invoices || "[]");
    // Partial payments (2026-09-17): this used to just set
    // `inv.paid = true` here and never touch paidAmount at all --
    // masked so far because a Stripe payment was always all-or-
    // nothing, so deriveInvoicePaid()'s own legacy fallback
    // (inv.paid ? total : 0) happened to still resolve correctly. Now
    // that a Stripe payment can be partial, this increments paidAmount
    // by the SAME real cents actually charged in this event (never
    // overwrites it from the portal row's own value -- these are two
    // independently-maintained mirrors of the same underlying fact,
    // and applying the identical increment to both is what keeps them
    // from drifting relative to each other) and derives `paid` from
    // the result the same way deriveInvoicePaid() does.
    const resultBySourceId = new Map(patchResults.map((r: any) => [r.sourceInvoiceId, r]));
    let changed = false;
    invoices.forEach((inv: any) => {
      const result = resultBySourceId.get(inv.id);
      if (!result) return;
      const totalCents = Math.round((Number(inv.total) || 0) * 100);
      const priorPaidAmount = (inv.paidAmount !== undefined && inv.paidAmount !== null)
        ? (Number(inv.paidAmount) || 0)
        : (inv.paid ? (Number(inv.total) || 0) : 0);
      const newPaidCents = Math.round(priorPaidAmount * 100) + result.incrementCents;
      inv.paidAmount = newPaidCents / 100;
      inv.paid = derivePaidFromCents(totalCents, newPaidCents);
      changed = true;
    });
    if (changed) {
      blob.th_invoices = JSON.stringify(invoices);
      const workspaceSyncPatchRes = await fetch(
        `${SUPABASE_URL}/rest/v1/workspace_sync?code=eq.tripleh-workspace-2026`,
        {
          method: "PATCH",
          headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ data: blob, updated_at: paidAt }),
        },
      );
      if (!workspaceSyncPatchRes.ok) {
        console.error(`Failed to update workspace_sync th_invoices for PaymentIntent ${pi.id}: ${await workspaceSyncPatchRes.text().catch(() => "")}`);
      }
    }
  }

  return new Response(JSON.stringify({ received: true, invoices_updated: patchResults.length }), { status: 200 });
});
