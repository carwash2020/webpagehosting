// Supabase Edge Function: respond-to-quote
//
// Called from portal/quotes.html when a client approves or declines
// one of their own quotes. client_portal_quotes has no update policy
// for the authenticated role at all -- this function is the only way
// that status field ever changes, same reasoning as
// create-payment-intent needing its own function to write
// stripe_payment_intent_id back onto an invoice.

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
    // The real authorization check is below: does the quote being
    // responded to actually belong to this specific caller.
    if (claims.role !== "authenticated" || !claims.email) {
      return json({ ok: false, error: "Must be signed in." }, 401);
    }

    const { quote_id, action } = await req.json();
    if (typeof quote_id !== "number") {
      return json({ ok: false, error: "Missing quote_id." }, 400);
    }
    if (action !== "approve" && action !== "decline") {
      return json({ ok: false, error: "action must be 'approve' or 'decline'." }, 400);
    }

    const quoteRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_quotes?id=eq.${quote_id}&select=id,client_email,status`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    if (!quoteRes.ok) {
      return json({ ok: false, error: "Could not look up that quote." }, 502);
    }
    const rows = await quoteRes.json();
    if (!rows.length) {
      return json({ ok: false, error: "Quote not found." }, 404);
    }
    const quote = rows[0];

    // The real authorization boundary: the quote being responded to
    // must belong to the exact email on the caller's own verified
    // session -- never trust a quote_id alone to imply the caller is
    // allowed to respond to it.
    if (quote.client_email.toLowerCase() !== claims.email.toLowerCase()) {
      return json({ ok: false, error: "That quote doesn't belong to this account." }, 403);
    }
    if (quote.status !== "pending") {
      return json({ ok: false, error: `This quote was already ${quote.status}.` }, 400);
    }

    const newStatus = action === "approve" ? "approved" : "declined";
    const patchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_quotes?id=eq.${quote_id}`,
      {
        method: "PATCH",
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: newStatus, responded_at: new Date().toISOString() }),
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
