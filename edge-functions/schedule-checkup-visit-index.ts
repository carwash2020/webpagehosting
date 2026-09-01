// Supabase Edge Function: schedule-checkup-visit
//
// Self-scheduling from a check-up reminder (2026-09-02) -- the
// natural next step flagged in docs/CLIENT-PORTAL.md's own phase 5
// entry, reusing the scheduling UI already built for
// schedule-quote-job. Genuinely simpler than that function: a
// check-up reminder has no approval workflow to check (unlike a
// quote, which must be 'approved' and not already 'scheduled_at')
// and no "already scheduled" state of its own to guard against --
// a recurring reminder can reasonably be requested again even if a
// visit was already booked from it once, since the interval keeps
// recurring. Steve sees every booking (including which checkup_id it
// came from, if any) in the internal booking views regardless.
//
// Relies on th_bookings' existing Postgres EXCLUDE constraint on
// padded_range for conflict detection, exactly like
// schedule-quote-job and booking.html itself already do -- not
// reimplemented here.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ALLOWED_ORIGIN = "https://www.triplehenterprisesllc.biz";
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Same lead-time floor as booking.html's own MIN_LEAD_HOURS constant
// and schedule-quote-job's copy of it -- kept in sync manually since
// none of these can import from each other.
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

    if (claims.role !== "authenticated" || !claims.email) {
      return json({ ok: false, error: "Must be signed in." }, 401);
    }

    const { checkup_id, start_at, end_at } = await req.json();
    if (typeof checkup_id !== "number") {
      return json({ ok: false, error: "Missing checkup_id." }, 400);
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

    const checkupRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_checkups?id=eq.${checkup_id}&select=id,client_email,client_name,title`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    if (!checkupRes.ok) {
      return json({ ok: false, error: "Could not look up that reminder." }, 502);
    }
    const rows = await checkupRes.json();
    if (!rows.length) {
      return json({ ok: false, error: "Reminder not found." }, 404);
    }
    const checkup = rows[0];

    if (checkup.client_email.toLowerCase() !== claims.email.toLowerCase()) {
      return json({ ok: false, error: "That reminder doesn't belong to this account." }, 403);
    }

    const bookingRes = await fetch(`${SUPABASE_URL}/rest/v1/th_bookings`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([{
        service_key: "checkup-visit",
        service_label: checkup.title,
        start_at,
        end_at,
        name: checkup.client_name,
        email: checkup.client_email,
        notes: "Requested from check-up reminder: " + checkup.title,
        checkup_id: checkup.id,
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

    return json({ ok: true });
  } catch (err: any) {
    return json({ ok: false, error: err.message }, 500);
  }
});
