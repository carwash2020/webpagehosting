// Supabase Edge Function: send-job-status-change-email
//
// Direct follow-up (2026-09-11): "do the reschedule/cancel link" for
// manually-scheduled jobs, matching the cancel/reschedule links
// self-service booking.html guests already get via manage-booking.html.
//
// Fires from a DB trigger (notify_job_status_change, in
// sql/infra/add_job_cancel_reschedule.sql) on UPDATE of public.jobs,
// gated the same way notify_booking_status_change already gates
// th_bookings updates -- only on the two real customer-initiated
// transitions (cancelled_at or reschedule_requested_at newly set),
// never on an ordinary edit staff make themselves. The OLD/NEW
// comparison is re-checked here too (not just trusted from the
// trigger's own gate), same defensive pattern send-push-index.ts uses
// for th_bookings' cancel/reschedule push.
//
// Staff-facing only -- there is no guest-facing email here. The
// customer already sees the outcome directly on manage-job.html
// (this repo's counterpart to manage-booking.html); this function
// exists purely so staff learn about it without having to have that
// page open.
//
// Reschedule for a job is REQUEST-ONLY (see the SQL file's header
// comment for why: job_date has no time-slot exclusion constraint the
// way th_bookings does, so an unattended instant move could silently
// double-book a day already committed to another job). This email is
// the entire mechanism by which staff learn a request exists --
// there's no other notification surface for it yet.
//
// Deploy with: supabase functions deploy send-job-status-change-email
// Required secrets (already configured for the booking/lead email
// pipeline; no new secrets needed): RESEND_API_KEY, LEAD_EMAIL_FROM,
// LEAD_EMAIL_TO

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const LEAD_EMAIL_FROM = Deno.env.get("LEAD_EMAIL_FROM") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const LEAD_EMAIL_TO = (Deno.env.get("LEAD_EMAIL_TO") || "")
  .split(",")
  .map((addr: string) => addr.trim())
  .filter((addr: string) => addr.length > 0);

function escapeHtml(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function sendInternalEmail(subject: string, html: string, text: string): Promise<void> {
  if (!LEAD_EMAIL_TO.length) {
    console.log("send-job-status-change-email: no LEAD_EMAIL_TO configured, skipping");
    return;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: `Triple H Enterprises <${LEAD_EMAIL_FROM}>`,
        to: LEAD_EMAIL_TO,
        subject,
        html,
        text,
      }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.error("send-job-status-change-email: Resend API error:", res.status, errBody);
    }
  } catch (err: any) {
    console.error("send-job-status-change-email: Resend request failed:", err.message);
  }
}

Deno.serve(async (req: Request) => {
  try {
    // Only real caller: the notify_job_status_change() trigger (sql/infra/add_job_cancel_reschedule.sql), which sends the
    // service_role key from Vault as its bearer token. verify_jwt alone
    // accepts the public anon key (it checks the signature, not the
    // role), so without this anyone could POST a fake trigger payload
    // here. Security audit, 2026-09-23.
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!SERVICE_ROLE_KEY || token !== SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const payload = await req.json();

    if (payload.type !== "UPDATE" || payload.table !== "jobs") {
      return new Response(JSON.stringify({ ok: false, error: "Unknown type" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const job = payload.record || {};
    const oldJob = payload.old_record || {};

    const isCancellation = !oldJob.cancelled_at && !!job.cancelled_at;
    const isRescheduleRequest = !oldJob.reschedule_requested_at && !!job.reschedule_requested_at;

    if (!isCancellation && !isRescheduleRequest) {
      return new Response(JSON.stringify({ ok: true, skipped: "no relevant transition" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const title = escapeHtml(job.title || "A job");
    const client = job.client ? escapeHtml(job.client) : "a customer";
    const jobDate = job.job_date ? escapeHtml(job.job_date) : "an unset date";

    if (isCancellation) {
      await sendInternalEmail(
        `Job cancelled: ${job.title || "Untitled"}`,
        `<p><strong>${title}</strong> for ${client} (scheduled ${jobDate}) was just cancelled via their manage-job link.</p>`,
        `${title} for ${client} (scheduled ${jobDate}) was just cancelled via their manage-job link.`,
      );
    } else {
      const requestedDate = escapeHtml(job.reschedule_requested_date || "an unspecified date");
      await sendInternalEmail(
        `Reschedule requested: ${job.title || "Untitled"}`,
        `<p><strong>${title}</strong> for ${client} (currently ${jobDate}) has a reschedule request to <strong>${requestedDate}</strong>. This has NOT been applied automatically -- review and update the job date in Job Tracker if you can accommodate it.</p>`,
        `${title} for ${client} (currently ${jobDate}) has a reschedule request to ${requestedDate}. This has NOT been applied automatically -- review and update the job date in Job Tracker if you can accommodate it.`,
      );
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("send-job-status-change-email error:", err.message);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
