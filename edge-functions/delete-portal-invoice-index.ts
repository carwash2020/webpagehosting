// Supabase Edge Function: delete-portal-invoice
//
// Removes an invoice's client-portal copy when the internal invoice is
// deleted (2026-09-02). Requested directly after test invoices left
// phantom records behind: the internal log entry was deleted, but the
// portal row stayed -- so the client could still see (and try to pay)
// an invoice that no longer existed anywhere else.
//
// Needs to be an edge function because client_portal_invoices has NO
// delete policy for the authenticated role at all -- deliberately, so
// a client can never remove their own invoice. Only the service role
// can, which lives only here, server-side.
//
// Gated on can_manage_invoices, matching invoice-generator.html's own
// gate and every other invoice-writing function (set-invoice-paid,
// sync-invoice-to-portal).
//
// REFUSES to delete a PAID invoice. A paid invoice is a financial
// record with a real Stripe payment behind it; deleting its portal
// copy would remove the client's receipt and the paid_at/payment
// reference. If a paid invoice was genuinely a mistake, that's a
// refund in Stripe first, then a delete -- not a silent removal.
//
// Found missing from source control during a functional audit
// (2026-09-04) -- deployed and actively called from
// invoice-generator.html the whole time, just never saved to this
// repo. Added here now so it has a real source of truth: if this
// project were ever redeployed from the repo, this function would
// otherwise have been silently lost.

// Fix plan RP3.29 (2026-11-07): an unpaid invoice can still have a Stripe
// PaymentIntent open (the client opened Pay and stopped). Deleting the
// portal row used to leave that PaymentIntent completable in Stripe, for an
// invoice that no longer exists. Before deleting, the PaymentIntent on the
// row is looked up:
//   * still waiting for the client (requires_payment_method /
//     requires_confirmation / requires_action) -> canceled, then deleted;
//   * processing / succeeded / requires_capture -> 409, nothing deleted (a
//     payment is going through; stripe-webhook will mark it paid);
//   * already canceled, or gone from Stripe (404) -> deleted as before;
//   * Stripe can't be reached, or the cancel fails -> 502, nothing deleted.
// stripe-webhook separately alerts staff to any payment that still lands
// for no invoice. Uses the same STRIPE_SECRET_KEY as create-payment-intent.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";

const CANCELABLE_STATUSES = new Set(["requires_payment_method", "requires_confirmation", "requires_action"]);
const GOING_THROUGH_STATUSES = new Set(["processing", "succeeded", "requires_capture"]);

// "clear" = nothing open any more (canceled now or before, or unknown to
// Stripe); "going_through" = refuse; "error" = Stripe couldn't be asked or
// the cancel failed.
async function settleOpenPaymentIntent(piId: string): Promise<"clear" | "going_through" | "error"> {
  if (!STRIPE_SECRET_KEY) {
    console.error("delete-portal-invoice: STRIPE_SECRET_KEY is not set; can't check the invoice's PaymentIntent");
    return "error";
  }
  try {
    const res = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(piId)}`, {
      headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
    });
    if (res.status === 404) return "clear";
    if (!res.ok) {
      console.error(`delete-portal-invoice: could not retrieve ${piId} (HTTP ${res.status})`);
      return "error";
    }
    const pi = await res.json();
    if (GOING_THROUGH_STATUSES.has(pi.status)) return "going_through";
    if (!CANCELABLE_STATUSES.has(pi.status)) return "clear"; // canceled already
    const cancel = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(piId)}/cancel`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": `pi-cancel-v1-${piId}`,
      },
      body: new URLSearchParams({ cancellation_reason: "abandoned" }),
    });
    if (cancel.ok) return "clear";
    const text = await cancel.text().catch(() => "");
    console.error(`delete-portal-invoice: could not cancel ${piId} (HTTP ${cancel.status}): ${text.slice(0, 300)}`);
    // It moved on while we looked (the client just confirmed): treat it as
    // going through rather than delete under a live payment.
    if (/payment_intent_unexpected_state/.test(text)) return "going_through";
    return "error";
  } catch (err: any) {
    console.error(`delete-portal-invoice: Stripe lookup for ${piId} failed (${err?.message || err})`);
    return "error";
  }
}

const ALLOWED_ORIGIN = "https://www.triplehenterprisesllc.biz";
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function decodeJwtPayload(token: string): { email?: string; role?: string; sub?: string; aal?: string; session_id?: string } {
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch {
    return {};
  }
}

async function callerCanManageInvoices(email: string): Promise<boolean> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/account_roles?email=eq.${encodeURIComponent(email.toLowerCase())}&select=can_manage_invoices`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  if (!res.ok) return false;
  const rows = await res.json();
  return rows.length > 0 && rows[0].can_manage_invoices === true;
}

// Two-factor gate (2026-09-25, docs/ACTION-ITEMS.md #13). An internal
// account that has an authenticator enrolled must call with a session that
// passed it (aal2); its password alone (aal1) is not enough. The rule and
// its dry-run/enforce switch live in the database, in
// check_internal_mfa_for_edge_function()
// (sql/security/enforce_internal_mfa_server_side.sql). The claims come from
// the caller's JWT, which the gateway has already verified (verify_jwt).
// Fails closed if the check itself can't be made.
const MFA_REQUIRED_ERROR =
  "Two-factor sign-in required: sign out of the Workspace and sign back in with your authenticator code.";
async function callerPassesInternalMfa(
  claims: { sub?: string; email?: string; aal?: string; session_id?: string },
  fn: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_internal_mfa_for_edge_function`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_user_id: claims.sub ?? null,
        p_email: claims.email ?? null,
        p_session_id: claims.session_id ?? null,
        p_aal: claims.aal ?? null,
        p_function: fn,
      }),
    });
    if (!res.ok) return false;
    return (await res.json()) === true;
  } catch {
    return false;
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

    if (claims.role !== "authenticated" || !claims.email) {
      return json({ ok: false, error: "Must be signed in with a real session." }, 401);
    }
    if (!(await callerCanManageInvoices(claims.email))) {
      return json({ ok: false, error: "This account can't manage invoices." }, 403);
    }
    if (!(await callerPassesInternalMfa(claims, "delete-portal-invoice"))) {
      return json({ ok: false, error: MFA_REQUIRED_ERROR, code: "mfa_required" }, 403);
    }

    const { source_invoice_id } = await req.json();
    if (typeof source_invoice_id !== "number") {
      return json({ ok: false, error: "Missing source_invoice_id." }, 400);
    }

    const lookupRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_invoices?source_invoice_id=eq.${source_invoice_id}&select=id,paid,invoice_number,stripe_payment_intent_id`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    if (!lookupRes.ok) return json({ ok: false, error: "Could not look up that invoice." }, 502);
    const rows = await lookupRes.json();
    if (!rows.length) {
      // Never synced to the portal in the first place -- nothing to
      // remove. Not an error.
      return json({ ok: true, rows_deleted: 0 });
    }
    if (rows.some((r: { paid: boolean }) => r.paid)) {
      return json({
        ok: false,
        is_paid: true,
        error: `Invoice #${rows[0].invoice_number} has been PAID and its portal record was kept. A paid invoice is a financial record -- if it was a mistake, refund it in Stripe first.`,
      }, 409);
    }

    // RP3.29: no open PaymentIntent may outlive the row.
    const piIds = [...new Set(rows.map((r: { stripe_payment_intent_id?: string | null }) => r.stripe_payment_intent_id).filter(Boolean))] as string[];
    for (const piId of piIds) {
      const outcome = await settleOpenPaymentIntent(piId);
      if (outcome === "going_through") {
        return json({
          ok: false,
          payment_in_progress: true,
          error: `A payment for invoice #${rows[0].invoice_number} is going through right now, so its portal record was kept. Check Stripe; once it shows paid, it's a financial record.`,
        }, 409);
      }
      if (outcome === "error") {
        return json({ ok: false, error: `Couldn't check Stripe for an open payment on invoice #${rows[0].invoice_number}, so nothing was deleted. Try again in a minute.` }, 502);
      }
    }

    // Conditional on paid=eq.false -- a TOCTOU race otherwise: if the
    // invoice were marked paid (e.g. a client completing a Stripe
    // payment) in the window between the lookup above and this delete,
    // an unconditional DELETE would remove the now-paid invoice's
    // portal record anyway, bypassing the whole point of the paid
    // check above.
    const delRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_invoices?source_invoice_id=eq.${source_invoice_id}&paid=eq.false`,
      { method: "DELETE", headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, Prefer: "return=representation" } },
    );
    if (!delRes.ok) {
      // Fix plan RP3.22 (2026-11-07): the database's text is logged, not returned.
      console.error(`delete-portal-invoice: DELETE failed (HTTP ${delRes.status}): ${(await delRes.text()).slice(0, 500)}`);
      return json({ ok: false, error: "The portal copy couldn't be deleted just now. Try again in a minute." }, 502);
    }
    const deleted = await delRes.json();
    if (deleted.length === 0) {
      // Lost the race -- it was marked paid between the lookup and
      // here. Same friendly message as the up-front paid check.
      return json({
        ok: false,
        is_paid: true,
        error: `Invoice #${rows[0].invoice_number} was marked PAID just now, so its portal record was kept. A paid invoice is a financial record -- if it was a mistake, refund it in Stripe first.`,
      }, 409);
    }
    return json({ ok: true, rows_deleted: Array.isArray(deleted) ? deleted.length : 0 });
  } catch (err: any) {
    // RP3.22: logged in full, generic to the caller.
    console.error("delete-portal-invoice error:", err?.message || err);
    return json({ ok: false, error: "Something went wrong deleting the portal copy. Try again in a minute." }, 500);
  }
});
