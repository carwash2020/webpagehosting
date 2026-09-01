// Supabase Edge Function: schedule-quote-job
//
// Phase 3 of the client-portal roadmap: lets a client schedule the
// job directly from an approved quote, instead of a separate call or
// the anonymous public booking flow. Centralizes the whole operation
// server-side (insert into th_bookings AND mark the quote scheduled)
// rather than having the client insert into th_bookings directly and
// separately ask for the quote to be marked -- one function call is
// one atomic-enough unit of work, and it's the only place that needs
// to know both tables at once.
//
// th_bookings' own INSERT policy already allows anon/authenticated
// with no restriction ("Anyone can submit a booking", matching the
// public booking.html flow) -- this function could rely on that and
// skip the service role for the insert, but uses it anyway so the
// quote_id/scheduled_at write-back can happen as one server-side
// operation instead of two separate client-side calls, and so a
// failure partway through is easier to reason about.
//
// Slot conflicts are NOT re-checked here with application logic --
// th_bookings has a real Postgres EXCLUDE constraint on padded_range
// (confirmed by booking.html's own existing 23P01/"exclusion" error
// handling) that is the actual source of truth for "is this time
// free," the same way booking.html itself relies on it. This function
// just surfaces that same conflict as a friendly message instead of a
// raw Postgres error.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ALLOWED_ORIGIN = "https://www.triplehenterprisesllc.biz";
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Same lead-time floor as booking.html's own MIN_LEAD_HOURS constant
// -- kept in sync manually since this function can't import from an
// HTML file; if that constant ever changes there, change it here too.
const MIN_LEAD_HOURS = 2;

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

    // Client-only, no account_roles check -- same shape as
    // create-payment-intent and respond-to-quote. The real
    // authorization check is below: does this quote actually belong
    // to the caller.
    if (claims.role !== "authenticated" || !claims.email) {
      return json({ ok: false, error: "Must be signed in." }, 401);
    }

    const { quote_id, start_at, end_at } = await req.json();
    if (typeof quote_id !== "number") {
      return json({ ok: false, error: "Missing quote_id." }, 400);
    }
    const startDate = new Date(start_at);
    const endDate = new Date(end_at);
    if (typeof start_at !== "string" || typeof end_at !== "string" || isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return json({ ok: false, error: "Missing or invalid start_at/end_at." }, 400);
    }
    if (endDate.getTime() <= startDate.getTime()) {
      return json({ ok: false, error: "end_at must be after start_at." }, 400);
    }
    const minStart = new Date(Date.now() + MIN_LEAD_HOURS * 60 * 60 * 1000);
    if (startDate.getTime() < minStart.getTime()) {
      return json({ ok: false, error: `Bookings need at least ${MIN_LEAD_HOURS} hours' notice.` }, 400);
    }

    const quoteRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_quotes?id=eq.${quote_id}&select=id,client_email,client_name,client_address,quote_number,description,status,scheduled_at`,
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

    if (quote.client_email.toLowerCase() !== claims.email.toLowerCase()) {
      return json({ ok: false, error: "That quote doesn't belong to this account." }, 403);
    }
    if (quote.status !== "approved") {
      return json({ ok: false, error: "This quote must be approved before scheduling." }, 400);
    }
    if (quote.scheduled_at) {
      return json({ ok: false, error: "This job is already scheduled. Call or text us to reschedule." }, 400);
    }

    const bookingRes = await fetch(`${SUPABASE_URL}/rest/v1/th_bookings`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([{
        service_key: "quote-job",
        service_label: quote.description || ("Quote " + quote.quote_number),
        start_at,
        end_at,
        name: quote.client_name,
        email: quote.client_email,
        address: quote.client_address || null,
        notes: "Scheduled from approved quote #" + quote.quote_number,
        quote_id: quote.id,
      }]),
    });

    if (!bookingRes.ok) {
      const errText = await bookingRes.text();
      const wasConflict = errText.includes("23P01") || errText.includes("exclusion") || bookingRes.status === 409;
      return json({
        ok: false,
        error: wasConflict
          ? "That time was just booked by someone else. Please pick another."
          : `Could not create the booking: ${errText.slice(0, 300)}`,
      }, wasConflict ? 409 : 502);
    }

    await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_quotes?id=eq.${quote_id}`,
      {
        method: "PATCH",
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ scheduled_at: new Date().toISOString() }),
      },
    );

    return json({ ok: true });
  } catch (err: any) {
    return json({ ok: false, error: err.message }, 500);
  }
});
