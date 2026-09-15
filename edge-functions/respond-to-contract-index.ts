// Supabase Edge Function: respond-to-contract
//
// Same shape as respond-to-quote, adapted for contract signing. Called
// from portal/contracts.html when a client signs or declines one of
// their own contracts. client_portal_contracts has no update policy for
// the authenticated role at all -- this function is the only way that
// status/signature field ever changes.

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

// A signature is expected to be a data: URL (a PNG canvas export, same
// shape tools/contract-generator.html already produces for its two
// in-person pads) -- checked loosely here (real validation is "does it
// decode/render," which only matters when the PDF is actually built;
// this guards against an empty string or an obviously wrong type, not
// against a corrupt-but-plausible data URL).
function looksLikeSignatureDataUrl(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("data:image/") && value.length > 100;
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

    // Any real, authenticated session is enough here -- this caller is
    // a CLIENT, not an internal account, so no account_roles check.
    // The real authorization check is below: does the contract being
    // responded to actually belong to this specific caller.
    if (claims.role !== "authenticated" || !claims.email) {
      return json({ ok: false, error: "Must be signed in." }, 401);
    }

    const { contract_id, action, client_signature_data_url } = await req.json();
    if (typeof contract_id !== "number") {
      return json({ ok: false, error: "Missing contract_id." }, 400);
    }
    if (action !== "sign" && action !== "decline") {
      return json({ ok: false, error: "action must be 'sign' or 'decline'." }, 400);
    }
    if (action === "sign" && !looksLikeSignatureDataUrl(client_signature_data_url)) {
      return json({ ok: false, error: "A signature is required to sign this contract." }, 400);
    }

    const contractRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_contracts?id=eq.${contract_id}&select=id,client_email,status`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    if (!contractRes.ok) {
      return json({ ok: false, error: "Could not look up that contract." }, 502);
    }
    const rows = await contractRes.json();
    if (!rows.length) {
      return json({ ok: false, error: "Contract not found." }, 404);
    }
    const contract = rows[0];

    // The real authorization boundary: the contract being responded to
    // must belong to the exact email on the caller's own verified
    // session -- never trust a contract_id alone to imply the caller is
    // allowed to respond to it.
    if (contract.client_email.toLowerCase() !== claims.email.toLowerCase()) {
      return json({ ok: false, error: "That contract doesn't belong to this account." }, 403);
    }
    if (contract.status !== "pending") {
      return json({ ok: false, error: `This contract was already ${contract.status}.` }, 400);
    }

    const newStatus = action === "sign" ? "signed" : "declined";
    const patchBody: Record<string, unknown> = {
      status: newStatus,
      responded_at: new Date().toISOString(),
    };
    if (action === "sign") patchBody.client_signature_data_url = client_signature_data_url;

    const patchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_contracts?id=eq.${contract_id}`,
      {
        method: "PATCH",
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(patchBody),
      },
    );
    if (!patchRes.ok) {
      const errText = await patchRes.text();
      return json({ ok: false, error: `Database error: ${errText.slice(0, 300)}` }, 502);
    }

    return json({ ok: true, status: newStatus });
  } catch (err: any) {
    return json({ ok: false, error: err.message }, 500);
  }
});
