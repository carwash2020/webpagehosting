// Supabase Edge Function: sync-invoice-to-portal
//
// Server-side proxy so invoice-generator.html can push a client-safe
// subset of an invoice into client_portal_invoices without ever
// exposing the service_role key to the browser. client_portal_invoices
// deliberately has NO insert policy for the authenticated role at all
// (confirmed directly when the table was created) -- an internal
// account's own session token genuinely cannot write here, by design.
// This function bridges the two: verifies the caller is a real
// internal account with invoice-editing permission, THEN uses the
// service role key (safe here, server-side) to do the actual write.
//
// Updated 2026-08-31 (three times): first to trigger send-invite the
// first time a genuinely new client email appears; then to also
// trigger send-invoice-notification for an EXISTING client's new (but
// not first-ever) invoice; now to also accept and store line_items --
// found, while building that, that this function had never actually
// extracted or stored line_items at all, despite both
// invoice-generator.html already sending it and dashboard.html already
// expecting to render it. Whatever the exact history, fixed now:
// line_items flows through to the stored row like every other field.

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

    const body = await req.json();
    const {
      source_invoice_id, client_email, client_name,
      invoice_number, invoice_date, description, total, line_items,
    } = body;

    if (
      typeof source_invoice_id !== "number" ||
      typeof client_email !== "string" || !client_email.includes("@") ||
      typeof client_name !== "string" || !client_name ||
      typeof invoice_number !== "string" || !invoice_number ||
      typeof invoice_date !== "string" || !invoice_date ||
      typeof total !== "number"
    ) {
      return json({ ok: false, error: "Missing or invalid invoice fields." }, 400);
    }
    // line_items is optional (older invoices, or a page that doesn't
    // send it, shouldn't fail this whole call) but if present must
    // actually be an array, not some other JSON shape.
    if (line_items !== undefined && line_items !== null && !Array.isArray(line_items)) {
      return json({ ok: false, error: "line_items must be an array if provided." }, 400);
    }

    const normalizedEmail = client_email.toLowerCase().trim();

    const existingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_invoices?client_email=eq.${encodeURIComponent(normalizedEmail)}&select=id&limit=1`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    const existingRows = existingRes.ok ? await existingRes.json() : [];
    const isNewClient = existingRows.length === 0;

    const existingInvoiceRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_invoices?source_invoice_id=eq.${source_invoice_id}&select=id&limit=1`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    const existingInvoiceRows = existingInvoiceRes.ok ? await existingInvoiceRes.json() : [];
    const isNewInvoice = existingInvoiceRows.length === 0;

    const upsertRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_invoices?on_conflict=source_invoice_id`,
      {
        method: "POST",
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify([{
          source_invoice_id,
          client_email: normalizedEmail,
          client_name,
          invoice_number,
          invoice_date,
          description: description || null,
          total,
          line_items: line_items || null,
          updated_at: new Date().toISOString(),
        }]),
      },
    );

    if (!upsertRes.ok) {
      const errText = await upsertRes.text();
      return json({ ok: false, error: `Database error: ${errText.slice(0, 300)}` }, 502);
    }

    let emailResult: unknown = null;
    try {
      if (isNewClient) {
        const inviteRes = await fetch(`${SUPABASE_URL}/functions/v1/send-invite`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: authHeader },
          body: JSON.stringify({ client_email: normalizedEmail, client_name }),
        });
        emailResult = { type: "invite", ...(await inviteRes.json()) };
      } else if (isNewInvoice) {
        const notifyRes = await fetch(`${SUPABASE_URL}/functions/v1/send-invoice-notification`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: authHeader },
          body: JSON.stringify({ client_email: normalizedEmail, client_name, invoice_number, total, description }),
        });
        emailResult = { type: "notification", ...(await notifyRes.json()) };
      }
    } catch (err: any) {
      emailResult = { ok: false, error: err.message };
    }

    return json({ ok: true, is_new_client: isNewClient, is_new_invoice: isNewInvoice, email: emailResult });
  } catch (err: any) {
    return json({ ok: false, error: err.message }, 500);
  }
});
