// Supabase Edge Function: resolve-referral-code
//
// Public lookup for a "?ref=CODE" link on booking.html or the
// homepage's estimate form: turns a short account code into the
// referrer's display name, so the visitor's "Who referred you?"
// field can be filled in reliably instead of relying on someone
// typing (and possibly misspelling) a name into a URL by hand.
//
// Deliberately NOT a direct anon SELECT against
// client_account_codes (that table has no anon policy at all,
// see create_client_account_codes.sql) -- a booking-page visitor is
// never authenticated, so resolution has to go through a function
// using the service role, and this one returns ONLY the referrer's
// name, never their email/phone or the row's internal id.
//
// verify_jwt stays true (this project's own convention -- every
// public-facing function still requires *a* valid Supabase JWT in
// the Authorization header, which the anon/publishable key itself
// satisfies; it does not require role === "authenticated"). Booking
// and homepage callers already send `apikey`/`Authorization: Bearer
// <anon key>` on every other request, so this needs no new wiring
// on their side.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ALLOWED_ORIGIN = "https://www.triplehenterprisesllc.biz";
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

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
    const code = new URL(req.url).searchParams.get("code") || "";
    // Matches generateAccountCode() in send-invite/index.ts -- reject
    // anything else before it ever reaches a query, both as a cheap
    // abuse guard and so a stray old-style "?ref=John Smith" link
    // (raw text, predating this feature) fails fast here rather than
    // wasting a database round trip on something that was never a
    // code to begin with.
    if (!/^[A-Z2-9]{4,12}$/.test(code)) {
      return json({ ok: false, error: "not_found" }, 404);
    }

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/client_account_codes?code=eq.${encodeURIComponent(code)}&select=display_name&limit=1`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    if (!res.ok) return json({ ok: false, error: "lookup_failed" }, 502);

    const rows = await res.json();
    if (!rows.length) return json({ ok: false, error: "not_found" }, 404);

    return json({ ok: true, referrer_name: rows[0].display_name || null });
  } catch (err: any) {
    return json({ ok: false, error: err.message }, 500);
  }
});
