// Supabase Edge Function: sync-contract-to-portal
//
// Same shape as sync-quote-to-portal, adapted for contracts. Server-side
// proxy so tools/contract-generator.html can push a client-safe copy of
// a generated contract into client_portal_contracts without ever
// exposing the service_role key to the browser. client_portal_contracts
// has NO insert policy for the authenticated role at all -- this
// function bridges that: verifies the caller is a real internal account
// with can_manage_contracts permission, THEN uses the service role key
// (safe here, server-side) to do the actual write.
//
// Deliberately does NOT write anything back into the internal
// th_contracts localStorage/workspace_sync blob -- one-way sync, same
// direction as quotes/invoices. Internal visibility into signing status
// comes from a direct real-time query in the Contract Log
// (tools/contract-generator.html), not a blob write.

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

// Its own permission column (sql/security/granular_permissions_expansion.sql
// already added can_manage_contracts specifically "for
// contract-generator.html") -- distinct from can_manage_invoices, since
// an account could plausibly manage one without the other.
async function callerCanManageContracts(email: string): Promise<boolean> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/account_roles?email=eq.${encodeURIComponent(email.toLowerCase())}&select=can_manage_contracts`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  if (!res.ok) return false;
  const rows = await res.json();
  if (!rows.length) return false;
  return rows[0].can_manage_contracts === true;
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
    if (!(await callerCanManageContracts(claims.email))) {
      return json({ ok: false, error: "This account can't manage contracts." }, 403);
    }

    const body = await req.json();
    const {
      source_contract_id, client_email, client_name,
      contract_type, contract_title, blocks, business_signature_data_url,
    } = body;

    if (
      typeof source_contract_id !== "number" ||
      typeof client_email !== "string" || !client_email.includes("@") ||
      typeof client_name !== "string" || !client_name ||
      typeof contract_type !== "string" || !["pwo", "stpa", "ltsa"].includes(contract_type) ||
      typeof contract_title !== "string" || !contract_title ||
      !Array.isArray(blocks)
    ) {
      return json({ ok: false, error: "Missing or invalid contract fields." }, 400);
    }

    const normalizedEmail = client_email.toLowerCase().trim();

    const existingClientRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_contracts?client_email=eq.${encodeURIComponent(normalizedEmail)}&select=id&limit=1`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    const existingQuoteClientRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_quotes?client_email=eq.${encodeURIComponent(normalizedEmail)}&select=id&limit=1`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    const existingInvoiceClientRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_invoices?client_email=eq.${encodeURIComponent(normalizedEmail)}&select=id&limit=1`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    const existingContractClientRows = existingClientRes.ok ? await existingClientRes.json() : [];
    const existingQuoteClientRows = existingQuoteClientRes.ok ? await existingQuoteClientRes.json() : [];
    const existingInvoiceClientRows = existingInvoiceClientRes.ok ? await existingInvoiceClientRes.json() : [];
    // "New" only if this client has no portal presence at all yet
    // (no prior contract, quote, or invoice) -- a client who's already
    // received a quote or invoice already has a portal account from an
    // earlier send-invite; they just need the notification email now.
    const isNewClient =
      existingContractClientRows.length === 0 &&
      existingQuoteClientRows.length === 0 &&
      existingInvoiceClientRows.length === 0;

    const existingContractRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_contracts?source_contract_id=eq.${source_contract_id}&select=id&limit=1`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    const existingContractRows = existingContractRes.ok ? await existingContractRes.json() : [];
    const isNewContract = existingContractRows.length === 0;

    const upsertRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_contracts?on_conflict=source_contract_id`,
      {
        method: "POST",
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify([{
          source_contract_id,
          client_email: normalizedEmail,
          client_name,
          contract_type,
          contract_title,
          blocks,
          business_signature_data_url: business_signature_data_url || null,
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
      } else if (isNewContract) {
        const notifyRes = await fetch(`${SUPABASE_URL}/functions/v1/send-contract-notification`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: authHeader },
          body: JSON.stringify({ client_email: normalizedEmail, client_name, contract_title }),
        });
        emailResult = { type: "notification", ...(await notifyRes.json()) };
      }
    } catch (err: any) {
      emailResult = { ok: false, error: err.message };
    }

    return json({ ok: true, is_new_client: isNewClient, is_new_contract: isNewContract, email: emailResult });
  } catch (err: any) {
    return json({ ok: false, error: err.message }, 500);
  }
});
