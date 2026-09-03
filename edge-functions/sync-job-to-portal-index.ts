// Supabase Edge Function: sync-job-to-portal
//
// Phase 4 of the client-portal roadmap. Same shape as
// sync-invoice-to-portal/sync-quote-to-portal, adapted for completed
// jobs. Server-side proxy so tools/job-tracker.html can push a
// client-safe subset of a completed job into client_portal_jobs
// without ever exposing the service_role key to the browser.
// client_portal_jobs has NO insert policy for the authenticated role
// at all -- this function bridges that: verifies the caller is a real
// internal account with invoice-editing permission, THEN uses the
// service role key (safe here, server-side) to do the actual write.
//
// Deliberately does NOT write anything back into the internal
// th_jobs localStorage/workspace_sync blob -- one-way sync, same
// direction as invoices/quotes. Also deliberately does NOT accept or
// store the internal jobNotes field at all -- that's for internal use
// only, never something a client should see.
//
// No "send an email" branch here unlike the invoice/quote sync
// functions -- a completed job showing up in job history isn't
// something worth a dedicated notification the way a new invoice or
// quote to review is. If the client is brand new (no prior portal
// presence at all), send-invite still fires so they have a way in.
//
// Updated 2026-09-02: now also accepts and stores photo_storage_paths
// -- raw Storage paths only, never signed URLs (those expire). See
// get-job-photo-urls for how those paths turn into something the
// client can actually view, and why that has to be its own function
// with its own ownership check rather than a public URL stored here.
//
// Updated 2026-09-03: also accepts an optional linked_invoice_number,
// requested directly as item 6 of a roadmap ("no downloadable receipt
// per job"). Sourced from the internal Invoice Log's own jobRefId
// link (an invoice already tracks which job it was for) -- passed
// through here as a plain text value, not validated against
// client_portal_invoices, since the two tables sync independently and
// this function has no reason to depend on invoice-portal internals.
// portal/jobs.html only shows a receipt link when this is present,
// and portal/dashboard.html simply shows nothing if the referenced
// invoice never made it to the portal for some reason -- a dead link
// is a much smaller problem than a hard failure here would be.

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

// Granular permission expansion (2026-09-02): job-tracker.html (the
// caller here, via a completed job or a recurring template) has no
// specific permission gate of its own -- any recognized internal
// account can use it. "Has a real account_roles row at all" is the
// correct matching check here, not any one specific granular
// permission that wouldn't actually fit. can_manage_business_finances
// (the old, broader checkbox this used to read) no longer exists as a
// column at all.
async function callerIsInternalAccount(email: string): Promise<boolean> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/account_roles?email=eq.${encodeURIComponent(email.toLowerCase())}&select=email&limit=1`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  if (!res.ok) return false;
  const rows = await res.json();
  return rows.length > 0;
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
    if (!(await callerIsInternalAccount(claims.email))) {
      return json({ ok: false, error: "This account isn't recognized." }, 403);
    }

    const { source_job_id, client_email, client_name, title, job_date, photo_storage_paths, linked_invoice_number } = await req.json();

    if (
      typeof source_job_id !== "number" ||
      typeof client_email !== "string" || !client_email.includes("@") ||
      typeof client_name !== "string" || !client_name ||
      typeof title !== "string" || !title ||
      typeof job_date !== "string" || !job_date
    ) {
      return json({ ok: false, error: "Missing or invalid job fields." }, 400);
    }
    if (photo_storage_paths !== undefined && photo_storage_paths !== null && !Array.isArray(photo_storage_paths)) {
      return json({ ok: false, error: "photo_storage_paths must be an array if provided." }, 400);
    }
    if (linked_invoice_number !== undefined && linked_invoice_number !== null && typeof linked_invoice_number !== "string") {
      return json({ ok: false, error: "linked_invoice_number must be a string if provided." }, 400);
    }

    const normalizedEmail = client_email.toLowerCase().trim();

    const existingClientRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_jobs?client_email=eq.${encodeURIComponent(normalizedEmail)}&select=id&limit=1`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    const existingInvoiceClientRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_invoices?client_email=eq.${encodeURIComponent(normalizedEmail)}&select=id&limit=1`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    const existingQuoteClientRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_quotes?client_email=eq.${encodeURIComponent(normalizedEmail)}&select=id&limit=1`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    const existingJobRows = existingClientRes.ok ? await existingClientRes.json() : [];
    const existingInvoiceRows = existingInvoiceClientRes.ok ? await existingInvoiceClientRes.json() : [];
    const existingQuoteRows = existingQuoteClientRes.ok ? await existingQuoteClientRes.json() : [];
    const isNewClient = existingJobRows.length === 0 && existingInvoiceRows.length === 0 && existingQuoteRows.length === 0;

    const upsertRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_jobs?on_conflict=source_job_id`,
      {
        method: "POST",
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify([{
          source_job_id,
          client_email: normalizedEmail,
          client_name,
          title,
          job_date,
          photo_storage_paths: photo_storage_paths || null,
          linked_invoice_number: linked_invoice_number || null,
          updated_at: new Date().toISOString(),
        }]),
      },
    );

    if (!upsertRes.ok) {
      const errText = await upsertRes.text();
      return json({ ok: false, error: `Database error: ${errText.slice(0, 300)}` }, 502);
    }

    let emailResult: unknown = null;
    if (isNewClient) {
      try {
        const inviteRes = await fetch(`${SUPABASE_URL}/functions/v1/send-invite`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: authHeader },
          body: JSON.stringify({ client_email: normalizedEmail, client_name }),
        });
        emailResult = { type: "invite", ...(await inviteRes.json()) };
      } catch (err: any) {
        emailResult = { ok: false, error: err.message };
      }
    }

    return json({ ok: true, is_new_client: isNewClient, email: emailResult });
  } catch (err: any) {
    return json({ ok: false, error: err.message }, 500);
  }
});
