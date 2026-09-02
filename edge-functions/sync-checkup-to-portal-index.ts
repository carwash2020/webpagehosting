// Supabase Edge Function: sync-checkup-to-portal
//
// Phase 5 of the client-portal roadmap. Same shape as
// sync-job-to-portal, adapted for Recurring Job Templates
// (th_job_templates in tools/job-tracker.html). Server-side proxy so
// the browser never needs the service_role key to write into
// client_portal_checkups, which has no insert/delete policy for the
// authenticated role at all.
//
// Deliberately does NOT write anything back into the internal
// th_job_templates localStorage/workspace_sync blob -- one-way sync,
// same direction as every other portal sync function. Also no
// email-notification branch, same reasoning as sync-job-to-portal: a
// check-up reminder appearing in the portal isn't worth a dedicated
// notification. Doesn't fire send-invite for a new client either --
// unlike invoices/quotes/completed jobs, a template that's merely due
// someday isn't a strong enough signal to create a portal account for
// a client who may not have one yet; this only ever syncs for clients
// who already have SOME portal presence (checked below).
//
// Also handles deletion: { source_template_id, delete: true } removes
// the row instead of upserting -- called when a recurring template is
// deleted internally, so a stale "due soon" reminder never lingers in
// the portal for a template that no longer exists.

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

async function clientHasPortalPresence(normalizedEmail: string): Promise<boolean> {
  const tables = ["client_portal_invoices", "client_portal_quotes", "client_portal_jobs"];
  for (const table of tables) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${table}?client_email=eq.${encodeURIComponent(normalizedEmail)}&select=id&limit=1`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    const rows = res.ok ? await res.json() : [];
    if (rows.length) return true;
  }
  return false;
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
      return json({ ok: false, error: "This account can't manage checkup reminders." }, 403);
    }

    const body = await req.json();
    const { source_template_id } = body;
    if (typeof source_template_id !== "number") {
      return json({ ok: false, error: "Missing source_template_id." }, 400);
    }

    if (body.delete === true) {
      const deleteRes = await fetch(
        `${SUPABASE_URL}/rest/v1/client_portal_checkups?source_template_id=eq.${source_template_id}`,
        { method: "DELETE", headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
      );
      if (!deleteRes.ok) {
        const errText = await deleteRes.text();
        return json({ ok: false, error: `Database error: ${errText.slice(0, 300)}` }, 502);
      }
      return json({ ok: true, deleted: true });
    }

    const { client_email, client_name, title, interval_months, last_created_date } = body;

    if (
      typeof client_email !== "string" || !client_email.includes("@") ||
      typeof client_name !== "string" || !client_name ||
      typeof title !== "string" || !title ||
      typeof interval_months !== "number" || interval_months < 1
    ) {
      return json({ ok: false, error: "Missing or invalid checkup fields." }, 400);
    }
    if (last_created_date !== undefined && last_created_date !== null && typeof last_created_date !== "string") {
      return json({ ok: false, error: "last_created_date must be a string date if provided." }, 400);
    }

    const normalizedEmail = client_email.toLowerCase().trim();

    // Only sync for a client who already has some portal presence --
    // a template being due someday isn't a strong enough signal to
    // create a brand-new portal account for someone who's never been
    // invoiced, quoted, or invoiced for a completed job.
    if (!(await clientHasPortalPresence(normalizedEmail))) {
      return json({ ok: true, skipped: "client has no existing portal presence" });
    }

    const upsertRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_checkups?on_conflict=source_template_id`,
      {
        method: "POST",
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify([{
          source_template_id,
          client_email: normalizedEmail,
          client_name,
          title,
          interval_months,
          last_created_date: last_created_date || null,
          updated_at: new Date().toISOString(),
        }]),
      },
    );

    if (!upsertRes.ok) {
      const errText = await upsertRes.text();
      return json({ ok: false, error: `Database error: ${errText.slice(0, 300)}` }, 502);
    }

    return json({ ok: true });
  } catch (err: any) {
    return json({ ok: false, error: err.message }, 500);
  }
});
