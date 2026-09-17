// Supabase Edge Function: set-invoice-paid
//
// Lets an internal account mark a portal invoice paid/unpaid by hand
// (2026-09-02). Closes a real gap: an occasional cash or check
// payment gets marked paid manually in the Invoice Log, never
// touching Stripe. Before this, that only updated the
// internal record, so the client's portal kept showing the invoice as
// UNPAID and they could pay it a second time through Stripe.
//
// INTERNAL-only, unlike the client-facing payment functions: this
// takes the same account_roles + can_manage_invoices check
// invoice-generator.html itself is gated on. A client must never be
// able to mark their own invoice paid.
//
// Keyed by source_invoice_id (the internal th_invoices id), not the
// portal row's own id -- the caller is the internal Invoice Log,
// which only knows its own ids.
//
// Deliberately does NOT touch stripe_payment_intent_id: a manually-
// paid invoice has no PaymentIntent, and an invoice that DID go
// through Stripe should keep its reference even if someone toggles
// the status by hand afterwards. paid_at is set on marking paid and
// cleared on marking unpaid, so a receipt PDF never shows a paid date
// for an invoice currently marked unpaid.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

// Granular permission expansion (2026-09-02): reads can_manage_invoices
// directly off account_roles -- matches invoice-generator.html's own
// gate exactly (Invoices & Quotes both live in that one tool).
// can_manage_business_finances (the old, broader checkbox this used
// to read) no longer exists as a column at all.
async function callerCanManageInvoices(email: string): Promise<boolean> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/account_roles?email=eq.${encodeURIComponent(email.toLowerCase())}&select=can_manage_invoices`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  if (!res.ok) return false;
  const rows = await res.json();
  if (!rows.length) return false;
  return rows[0].can_manage_invoices === true;
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

    const { source_invoice_id, paid } = await req.json();
    if (typeof source_invoice_id !== "number") {
      return json({ ok: false, error: "Missing source_invoice_id." }, 400);
    }
    if (typeof paid !== "boolean") {
      return json({ ok: false, error: "paid must be true or false." }, 400);
    }

    // Partial payments (2026-09-17): this manual toggle is a THIRD
    // write path into (paid, paid_amount) alongside Stripe and
    // sync-invoice-to-portal -- without this, a human marking an
    // invoice "Paid" by hand after a client already partially paid
    // via Stripe would leave paid: true but paid_amount stuck at the
    // old partial figure, the exact shape of the 2026-09-16 bug this
    // whole feature is built around not repeating. Look up the
    // invoice's own total first so "Paid" can set paid_amount to
    // match it exactly, and "Unpaid" resets it to 0 -- the same
    // "start over" semantic tools/workspace.html's own togglePaid()
    // "Mark this invoice as unpaid again?" flow already uses (not a
    // partial fallback).
    const lookupRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_invoices?source_invoice_id=eq.${source_invoice_id}&select=total`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    const lookupRows = lookupRes.ok ? await lookupRes.json() : [];
    // Not an error if this comes back empty -- same "never synced to
    // the portal" case the final response below already accounts for;
    // the PATCH just naturally updates zero rows a moment later.
    const total = lookupRows.length ? Number(lookupRows[0].total) || 0 : 0;

    const patchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_invoices?source_invoice_id=eq.${source_invoice_id}`,
      {
        method: "PATCH",
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          paid,
          paid_at: paid ? new Date().toISOString() : null,
          paid_amount: paid ? total : 0,
        }),
      },
    );

    if (!patchRes.ok) {
      const errText = await patchRes.text();
      return json({ ok: false, error: `Database error: ${errText.slice(0, 300)}` }, 502);
    }

    const updated = await patchRes.json();
    // Not an error: an invoice that was never synced to the portal
    // (no client email on file at the time) simply has no row here.
    return json({ ok: true, rows_updated: Array.isArray(updated) ? updated.length : 0 });
  } catch (err: any) {
    return json({ ok: false, error: err.message }, 500);
  }
});
