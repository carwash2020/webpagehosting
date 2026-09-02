// Supabase Edge Function: sync-quote-to-portal
//
// Same shape as sync-invoice-to-portal, adapted for quotes. Server-side
// proxy so invoice-generator.html's Quote tab can push a client-safe
// subset of a quote into client_portal_quotes without ever exposing
// the service_role key to the browser. client_portal_quotes has NO
// insert policy for the authenticated role at all -- this function
// bridges that: verifies the caller is a real internal account with
// invoice-editing permission, THEN uses the service role key
// (safe here, server-side) to do the actual write.
//
// Deliberately does NOT write anything back into the internal
// th_quotes localStorage/workspace_sync blob -- that's a one-way
// sync, same direction as invoices. See docs/CLIENT-PORTAL.md for why
// the reverse direction (approval status) goes through a direct
// real-time query in the Quote Log (invoice-generator.html) instead
// of a blob write.
//
// Updated 2026-09-02 (phase 3): now also accepts and stores
// client_address -- needed once a client can schedule a job straight
// from an approved quote (schedule-quote-job), so the visit address
// doesn't have to be re-typed during scheduling.

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

// Permission model redesign (2026-09-02): reads can_manage_business_finances
// directly off account_roles now -- no join to role_definitions. Each
// account's permissions are its own, individually toggleable in Dev
// Tools -> Access, not inherited from a shared role tier.
async function callerCanManageInvoices(email: string): Promise<boolean> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/account_roles?email=eq.${encodeURIComponent(email.toLowerCase())}&select=can_manage_business_finances`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  if (!res.ok) return false;
  const rows = await res.json();
  if (!rows.length) return false;
  return rows[0].can_manage_business_finances === true;
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
      return json({ ok: false, error: "This account can't manage quotes." }, 403);
    }

    const body = await req.json();
    const {
      source_quote_id, client_email, client_name, client_address,
      quote_number, quote_date, description, total, line_items,
    } = body;

    if (
      typeof source_quote_id !== "number" ||
      typeof client_email !== "string" || !client_email.includes("@") ||
      typeof client_name !== "string" || !client_name ||
      typeof quote_number !== "string" || !quote_number ||
      typeof quote_date !== "string" || !quote_date ||
      typeof total !== "number"
    ) {
      return json({ ok: false, error: "Missing or invalid quote fields." }, 400);
    }
    if (line_items !== undefined && line_items !== null && !Array.isArray(line_items)) {
      return json({ ok: false, error: "line_items must be an array if provided." }, 400);
    }

    const normalizedEmail = client_email.toLowerCase().trim();

    const existingClientRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_quotes?client_email=eq.${encodeURIComponent(normalizedEmail)}&select=id&limit=1`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    const existingInvoiceClientRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_invoices?client_email=eq.${encodeURIComponent(normalizedEmail)}&select=id&limit=1`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    const existingQuoteClientRows = existingClientRes.ok ? await existingClientRes.json() : [];
    const existingInvoiceClientRows = existingInvoiceClientRes.ok ? await existingInvoiceClientRes.json() : [];
    // A client counts as "new" only if they have no portal presence at
    // all yet -- neither a prior quote nor a prior invoice. A client
    // who's only ever received invoices before, and is now getting
    // their first quote, already has a portal account from send-invite
    // firing on that first invoice; they just need the notification
    // email, not a second invite.
    const isNewClient = existingQuoteClientRows.length === 0 && existingInvoiceClientRows.length === 0;

    const existingQuoteRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_quotes?source_quote_id=eq.${source_quote_id}&select=id&limit=1`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    const existingQuoteRows = existingQuoteRes.ok ? await existingQuoteRes.json() : [];
    const isNewQuote = existingQuoteRows.length === 0;

    const upsertRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_quotes?on_conflict=source_quote_id`,
      {
        method: "POST",
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify([{
          source_quote_id,
          client_email: normalizedEmail,
          client_name,
          client_address: client_address || null,
          quote_number,
          quote_date,
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
      } else if (isNewQuote) {
        const notifyRes = await fetch(`${SUPABASE_URL}/functions/v1/send-quote-notification`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: authHeader },
          body: JSON.stringify({ client_email: normalizedEmail, client_name, quote_number, total, description }),
        });
        emailResult = { type: "notification", ...(await notifyRes.json()) };
      }
    } catch (err: any) {
      emailResult = { ok: false, error: err.message };
    }

    return json({ ok: true, is_new_client: isNewClient, is_new_quote: isNewQuote, email: emailResult });
  } catch (err: any) {
    return json({ ok: false, error: err.message }, 500);
  }
});
