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
//
// Fix plan RP3.8 (2026-11-07): a double tap or a retried request used to
// create a second appointment. Now, copying schedule-quote-job:
//   * a reminder with an UPCOMING confirmed booking from it can't be booked
//     again (moving that visit is what Reschedule is for); a past or
//     cancelled one doesn't block -- the reminder recurs;
//   * client_portal_checkups.scheduled_at is the booked marker, written
//     with an optimistic check against the value read (is.null, or
//     eq.<prior>), so of two racing requests only one wins;
//   * the loser -- or a marker write that still fails after one retry --
//     deletes exactly the booking it just created.
// Needs client_portal_checkups.scheduled_at (timestamptz, nullable):
// sql/security/group5_backend_hardening.sql.

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

function decodeJwtPayload(token: string): { email?: string; role?: string; sub?: string } {
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch {
    return {};
  }
}

// Fix plan FP4.2 (2026-11-06, D11): the caller's sign-in email plus the
// emails they have proved they own (client_email_aliases, confirmed only).
// Any failure -- including the table not existing yet -- means the sign-in
// email alone, never more.
async function callerEmails(claims: { email?: string; sub?: string }): Promise<string[]> {
  const out = [String(claims.email || "").toLowerCase()];
  if (!claims.sub) return out;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/client_email_aliases?user_id=eq.${encodeURIComponent(claims.sub)}&status=eq.confirmed&select=email`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    if (res.ok) for (const r of await res.json()) if (r && typeof r.email === "string") out.push(r.email.toLowerCase());
  } catch { /* the sign-in email alone */ }
  return out;
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
      `${SUPABASE_URL}/rest/v1/client_portal_checkups?id=eq.${checkup_id}&select=id,client_email,client_name,title,scheduled_at`,
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

    if (!(await callerEmails(claims)).includes(String(checkup.client_email).toLowerCase())) {
      return json({ ok: false, error: "That reminder doesn't belong to this account." }, 403);
    }

    // Already booked from this reminder and still to come: refuse. Fails
    // closed -- an unreadable booking list counts as "still booked".
    const priorScheduledAt: string | null = checkup.scheduled_at || null;
    const activeRes = await fetch(
      `${SUPABASE_URL}/rest/v1/th_bookings?checkup_id=eq.${checkup.id}&status=eq.confirmed&end_at=gte.${encodeURIComponent(new Date().toISOString())}&select=id&limit=1`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    ).catch(() => null);
    const active = activeRes && activeRes.ok ? await activeRes.json().catch(() => null) : null;
    if (!Array.isArray(active)) {
      return json({ ok: false, error: "We couldn't check your existing visits just now. Please try again." }, 502);
    }
    if (active.length) {
      return json({ ok: false, error: "You already have a visit booked from this reminder. Use Reschedule on your appointment, or call or text us." }, 409);
    }

    const bookingRes = await fetch(`${SUPABASE_URL}/rest/v1/th_bookings`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        // The new row's id, so an undo removes exactly this booking.
        Prefer: "return=representation",
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
      // Fix plan RP3.22 (2026-11-07): the database's text is logged, not returned.
      if (!wasConflict) console.error(`schedule-checkup-visit: booking insert for checkup ${checkup.id} failed (HTTP ${bookingRes.status}): ${errText.slice(0, 500)}`);
      return json({
        ok: false,
        error: wasConflict
          ? "That time was just booked by someone else. Please pick another."
          : "We couldn't book that time just now. Please try again, or call or text us.",
      }, wasConflict ? 409 : 502);
    }

    const createdRows = await bookingRes.json().catch(() => []);
    const createdBookingId = Array.isArray(createdRows) && createdRows[0] ? createdRows[0].id : null;

    const undoBooking = async () => {
      const undoFilter = createdBookingId
        ? `id=eq.${createdBookingId}`
        : `checkup_id=eq.${checkup.id}&start_at=eq.${encodeURIComponent(start_at)}&status=eq.confirmed`;
      const del = await fetch(`${SUPABASE_URL}/rest/v1/th_bookings?${undoFilter}`, {
        method: "DELETE",
        headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      }).catch(() => null);
      if (!del || !del.ok) console.error(`schedule-checkup-visit: could not undo booking ${createdBookingId ?? `for checkup ${checkup.id} at ${start_at}`} -- remove it by hand`);
    };

    // The booked marker, conditional on the value read above (same
    // optimistic check as schedule-quote-job): a concurrent request that
    // already wrote it makes this match zero rows.
    const scheduledAtFilter = priorScheduledAt
      ? `scheduled_at=eq.${encodeURIComponent(priorScheduledAt)}`
      : "scheduled_at=is.null";
    const markAt = new Date().toISOString();
    const patchMarker = () => fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_checkups?id=eq.${checkup.id}&${scheduledAtFilter}`,
      {
        method: "PATCH",
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({ scheduled_at: markAt }),
      },
    ).catch((err: any) => {
      console.error(`schedule-checkup-visit: marking checkup ${checkup.id} booked failed (${err?.message || err})`);
      return null;
    });

    let markRes = await patchMarker();
    let retried = false;
    if (!markRes || !markRes.ok) {
      if (markRes) console.error(`schedule-checkup-visit: marking checkup ${checkup.id} booked failed (HTTP ${markRes.status}); retrying once`);
      retried = true;
      markRes = await patchMarker();
    }
    if (!markRes || !markRes.ok) {
      await undoBooking();
      return json({ ok: false, error: "We couldn't finish booking this visit, so it wasn't booked. Please try again, or call or text us." }, 502);
    }
    const updated = await markRes.json().catch(() => []);
    if (!Array.isArray(updated) || !updated.length) {
      // After a retry, zero rows may mean our own first try landed.
      let ours = false;
      if (retried) {
        const again = await fetch(
          `${SUPABASE_URL}/rest/v1/client_portal_checkups?id=eq.${checkup.id}&select=scheduled_at`,
          { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
        ).catch(() => null);
        const rowsNow = again && again.ok ? await again.json().catch(() => []) : [];
        ours = Array.isArray(rowsNow) && rowsNow[0] && Date.parse(rowsNow[0].scheduled_at) === Date.parse(markAt);
      }
      if (!ours) {
        // Lost the race: another request booked from this reminder first.
        await undoBooking();
        return json({ ok: false, error: "A visit from this reminder was just booked. Check your appointments, or call or text us." }, 409);
      }
    }

    return json({ ok: true });
  } catch (err: any) {
    // Fix plan RP3.22 (2026-11-07): logged in full, generic to the client.
    console.error("schedule-checkup-visit error:", err?.message || err);
    return json({ ok: false, error: "Something went wrong. Please try again, or call or text us." }, 500);
  }
});
