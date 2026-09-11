// Supabase Edge Function: send-job-confirmation-email
//
// Direct request (2026-09-11): "if a guest asks us to schedule them
// [by phone], and we put the job on the calendar, does that send them
// a confirmation email? Can we add that safely, without accidentally
// sending it multiple times?"
//
// Today, only a guest self-booking through booking.html gets an
// automatic email (an INSERT trigger on th_bookings). A job staff
// create by hand in tools/job-tracker.html writes to public.jobs
// instead, which has no trigger at all -- so it's silent unless staff
// separately call/text the customer. This function is the "send it
// now" button for that gap: staff click "Send confirmation" on a job
// that has a client_email, and this fires the same
// customer-confirmation email booking.html guests get for free.
//
// Double-send protection, requested directly, is the reason this
// isn't just an unguarded email send: jobs.confirmation_sent_at
// (added by sql/infra/add_job_confirmation_email.sql, same nullable
// timestamptz shape as th_bookings.reminder_sent_at) is claimed with
// an ATOMIC conditional UPDATE -- `WHERE confirmation_sent_at IS
// NULL` -- BEFORE the email is sent. That closes the double-click /
// two-staff-at-once race a "check then send then set" version would
// still have (two concurrent requests could both pass the check
// before either wrote the flag). If the claim affects zero rows,
// someone already sent this job's confirmation; the caller gets a
// clear 409 rather than a silent duplicate. If the Resend call itself
// then fails, the claim is rolled back (set back to null) so the job
// isn't permanently locked out over a transient send failure -- staff
// just click the button again.
//
// Auth pattern copied from sync-job-to-portal-index.ts: verifies the
// caller is a real internal account (any account_roles row, no
// specific granular permission needed -- job-tracker.html itself has
// no finer-grained gate for this action either) rather than trusting
// anything the client claims about itself.
//
// Deploy with: supabase functions deploy send-job-confirmation-email
// Required secrets (all already configured for the booking/lead email
// pipeline; no new secrets needed): RESEND_API_KEY, LEAD_EMAIL_FROM,
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const LEAD_EMAIL_FROM = Deno.env.get("LEAD_EMAIL_FROM") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Same publicly-hosted, email-client-safe logo already used by
// send-booking-email/send-lead-email.
const LOGO_URL = "https://www.triplehenterprisesllc.biz/images/logo-signature-email.png";

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

async function callerIsInternalAccount(email: string): Promise<boolean> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/account_roles?email=eq.${encodeURIComponent(email.toLowerCase())}&select=email&limit=1`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  if (!res.ok) return false;
  const rows = await res.json();
  return rows.length > 0;
}

function escapeHtml(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// job_date on public.jobs is a plain YYYY-MM-DD text field (not a
// timestamptz like th_bookings.start_at), since manually-scheduled
// jobs don't carry a precise start/end time the way a self-service
// booking slot does -- staff enter a date, not a time window.
function formatJobDate(jobDate: string): string {
  try {
    return new Date(jobDate + "T00:00:00").toLocaleDateString("en-US", {
      timeZone: "America/Denver",
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return jobDate;
  }
}

function buildGuestEmailHtml(job: Record<string, unknown>): string {
  const dateLabel = formatJobDate(String(job.job_date));
  const firstName = job.client ? String(job.client).trim().split(/\s+/)[0] : "";
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi there,";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>You're booked, Triple H Enterprises</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f4f4f4" style="background: #f4f4f4; padding: 32px 16px;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="max-width: 480px; background: #ffffff; border-radius: 10px; overflow: hidden; border: 1px solid #e5e5e5;">
        <tr>
          <td align="center" bgcolor="#0a0a0a" style="background: #0a0a0a; padding: 28px 24px;">
            <img src="${LOGO_URL}" alt="Triple H Enterprises" width="140" style="display: block; border: 0;">
          </td>
        </tr>
        <tr>
          <td style="padding: 32px 28px 8px; font-family: -apple-system, Helvetica, Arial, sans-serif;">
            <h1 style="color: #ff8000; font-size: 22px; margin: 0 0 20px; text-align: center;">You're booked!</h1>
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 20px;">${greeting}</p>
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 8px;">Thanks for scheduling with Triple H Enterprises. Here's what we've got on the calendar:</p>
          </td>
        </tr>
        <tr>
          <td style="padding: 0 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #777; font-size: 14px; width: 100px;">Job</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 14px; color: #222;">${escapeHtml(job.title)}</td></tr>
              <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #777; font-size: 14px;">Date</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 14px; color: #222;">${escapeHtml(dateLabel)}</td></tr>
              ${job.address ? `<tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #777; font-size: 14px;">Address</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 14px; color: #222;">${escapeHtml(job.address)}</td></tr>` : ""}
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding: 20px 28px 28px; font-family: -apple-system, Helvetica, Arial, sans-serif;">
            <p style="color: #777; font-size: 13px; line-height: 1.5; margin: 0 0 20px;">This is the day we've got you scheduled for. We'll call or text if the timing needs to shift.</p>
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 20px;">Need to reschedule or have a question? Just reply to this email or give us a call.</p>
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0;">Talk soon,<br><strong>Triple H Enterprises</strong></p>
          </td>
        </tr>
        <tr>
          <td style="background: #ff8000; height: 4px; line-height: 4px; font-size: 1px;">&nbsp;</td>
        </tr>
        <tr>
          <td align="center" style="padding: 16px 24px; font-family: -apple-system, Helvetica, Arial, sans-serif;">
            <p style="color: #999; font-size: 12px; margin: 0;">(435) 414-1667 &middot; triplehenterprisesllc.biz</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function buildGuestEmailText(job: Record<string, unknown>): string {
  const dateLabel = formatJobDate(String(job.job_date));
  const firstName = job.client ? String(job.client).trim().split(/\s+/)[0] : "";
  return [
    firstName ? `Hi ${firstName},` : "Hi there,",
    "",
    "Thanks for scheduling with Triple H Enterprises. Here's what we've got on the calendar:",
    "",
    `Job: ${job.title}`,
    `Date: ${dateLabel}`,
    job.address ? `Address: ${job.address}` : "",
    "",
    "This is the day we've got you scheduled for. We'll call or text if the timing needs to shift.",
    "",
    "Need to reschedule or have a question? Just reply to this email or give us a call.",
    "",
    "Talk soon,",
    "Triple H Enterprises",
    "(435) 414-1667, triplehenterprisesllc.biz",
  ].filter((line) => line !== "").join("\n");
}

async function sendGuestConfirmation(job: Record<string, unknown>): Promise<boolean> {
  const guestEmail = job.client_email ? String(job.client_email).trim() : "";
  if (!guestEmail) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: `Triple H Enterprises <${LEAD_EMAIL_FROM}>`,
        to: guestEmail,
        subject: "You're booked, Triple H Enterprises",
        html: buildGuestEmailHtml(job),
        text: buildGuestEmailText(job),
      }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.error("send-job-confirmation-email: Resend API error:", res.status, errBody);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error("send-job-confirmation-email: Resend request failed:", err.message);
    return false;
  }
}

// The atomic claim: only succeeds (returns the row) if
// confirmation_sent_at is still null at the moment of the write. Two
// concurrent requests for the same job_id can both reach this line,
// but Postgres serializes the two UPDATEs -- only one of them can
// actually match the WHERE clause and come back with a row, since the
// first one to commit already flips confirmation_sent_at away from
// null for the second.
async function claimConfirmation(jobId: number): Promise<Record<string, unknown> | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/jobs?id=eq.${jobId}&confirmation_sent_at=is.null`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        Prefer: "return=representation",
      },
      body: JSON.stringify({ confirmation_sent_at: new Date().toISOString() }),
    },
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows.length ? rows[0] : null;
}

async function releaseConfirmationClaim(jobId: number): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${jobId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ confirmation_sent_at: null }),
  }).catch((err) => console.error("send-job-confirmation-email: failed to release claim:", err.message));
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

    const { job_id } = await req.json();
    if (typeof job_id !== "number") {
      return json({ ok: false, error: "job_id (number) is required." }, 400);
    }

    const claimedJob = await claimConfirmation(job_id);
    if (!claimedJob) {
      return json({ ok: false, error: "Confirmation already sent for this job (or the job doesn't exist)." }, 409);
    }

    if (!claimedJob.client_email) {
      // Nothing to send to -- release the claim so this isn't
      // permanently marked "sent" over a job that just never had an
      // email on file.
      await releaseConfirmationClaim(job_id);
      return json({ ok: false, error: "This job has no client email on file." }, 400);
    }

    const sent = await sendGuestConfirmation(claimedJob);
    if (!sent) {
      await releaseConfirmationClaim(job_id);
      return json({ ok: false, error: "Email send failed -- nothing was marked sent. Try again." }, 502);
    }

    return json({ ok: true, confirmation_sent_at: claimedJob.confirmation_sent_at });
  } catch (err: any) {
    console.error("send-job-confirmation-email error:", err.message);
    return json({ ok: false, error: err.message }, 500);
  }
});
