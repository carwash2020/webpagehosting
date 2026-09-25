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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
      `${SUPABASE_URL}/rest/v1/client_portal_invoices?source_invoice_id=eq.${source_invoice_id}&select=id,paid,invoice_number`,
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
      const errText = await delRes.text();
      return json({ ok: false, error: `Database error: ${errText.slice(0, 300)}` }, 502);
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
    return json({ ok: false, error: err.message }, 500);
  }
});
