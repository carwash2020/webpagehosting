// Supabase Edge Function: send-appointment-reminder
//
// Sends a day-before reminder email to anyone with a confirmed,
// upcoming booking -- direct request: automated appointment reminders
// to cut no-shows/last-minute cancellations. Email only (no SMS/Twilio
// account exists for this project) -- reuses the SAME Resend account
// and secrets already configured for send-booking-email/send-lead-email,
// no new signup needed.
//
// Runs hourly via pg_cron (see sql/infra/add_appointment_reminder_emails.sql),
// not once daily at a fixed time: a fixed daily time would give some
// bookings a reminder 25 hours out and others 49 hours out, depending
// on what time of day they're scheduled for. Querying a rolling
// [now+23h, now+25h) window every hour instead means every booking
// gets exactly one reminder, right around 24 hours ahead, regardless
// of what time it's scheduled for. reminder_sent_at is the guard
// against a double-send if a run is ever retried or overlaps the
// window twice.
//
// Deploy with: supabase functions deploy send-appointment-reminder
// Required secrets (all already configured for the lead/booking-email
// pipeline; no new secrets needed):
//   RESEND_API_KEY, LEAD_EMAIL_FROM
// Auto-provided by the Supabase runtime (no configuration needed):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const LEAD_EMAIL_FROM = Deno.env.get("LEAD_EMAIL_FROM") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Same publicly-hosted, email-client-safe logo already used by
// send-booking-email-index.ts / send-lead-email-index.ts.
const LOGO_URL = "https://www.triplehenterprisesllc.biz/images/logo-signature-email.png";

const BUSINESS_TIMEZONE = "America/Denver";

function escapeHtml(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDateRange(startAt: string, endAt: string): { dateLabel: string; timeLabel: string } {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIMEZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(start);
  const timeFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
  });
  const timeLabel = `${timeFmt.format(start)} – ${timeFmt.format(end)}`;
  return { dateLabel, timeLabel };
}

function buildReminderEmailHtml(booking: Record<string, unknown>): string {
  const { dateLabel, timeLabel } = formatDateRange(String(booking.start_at), String(booking.end_at));
  const firstName = booking.name ? String(booking.name).trim().split(/\s+/)[0] : "";
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi there,";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>See you tomorrow, Triple H Enterprises</title>
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
            <h1 style="color: #ff8000; font-size: 22px; margin: 0 0 20px; text-align: center;">See you tomorrow!</h1>
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 20px;">${greeting}</p>
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 8px;">Just a reminder about your upcoming appointment with Triple H Enterprises:</p>
          </td>
        </tr>
        <tr>
          <td style="padding: 0 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #777; font-size: 14px; width: 100px;">Service</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 14px; color: #222;">${escapeHtml(booking.service_label)}</td></tr>
              <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #777; font-size: 14px;">Date</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 14px; color: #222;">${escapeHtml(dateLabel)}</td></tr>
              <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #777; font-size: 14px;">Time</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 14px; color: #222;">${escapeHtml(timeLabel)}</td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding: 20px 28px 28px; font-family: -apple-system, Helvetica, Arial, sans-serif;">
            <p style="color: #777; font-size: 13px; line-height: 1.5; margin: 0 0 20px;">This is an estimated time slot. The actual visit may run longer depending on what we find once we're there.</p>
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 20px;">Need to reschedule or cancel? <a href="https://www.triplehenterprisesllc.biz/manage-booking.html?token=${escapeHtml(booking.cancel_token)}" style="color: #ff8000;">Manage your booking here</a>, or just reply to this email or give us a call.</p>
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0;">See you soon,<br><strong>Triple H Enterprises</strong></p>
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

function buildReminderEmailText(booking: Record<string, unknown>): string {
  const { dateLabel, timeLabel } = formatDateRange(String(booking.start_at), String(booking.end_at));
  const firstName = booking.name ? String(booking.name).trim().split(/\s+/)[0] : "";
  return [
    firstName ? `Hi ${firstName},` : "Hi there,",
    "",
    "Just a reminder about your upcoming appointment with Triple H Enterprises:",
    "",
    `Service: ${booking.service_label}`,
    `Date: ${dateLabel}`,
    `Time: ${timeLabel}`,
    "",
    "This is an estimated time slot. The actual visit may run longer depending on what we find once we're there.",
    "",
    `Need to reschedule or cancel? Manage your booking here: https://www.triplehenterprisesllc.biz/manage-booking.html?token=${booking.cancel_token}`,
    "",
    "Or just reply to this email or give us a call.",
    "",
    "See you soon,",
    "Triple H Enterprises",
    "(435) 414-1667, triplehenterprisesllc.biz",
  ].join("\n");
}

async function fetchDueBookings(): Promise<Array<Record<string, unknown>>> {
  const now = Date.now();
  const windowStart = new Date(now + 23 * 60 * 60 * 1000).toISOString();
  const windowEnd = new Date(now + 25 * 60 * 60 * 1000).toISOString();
  const url =
    `${SUPABASE_URL}/rest/v1/th_bookings?select=*` +
    `&status=eq.confirmed` +
    `&reminder_sent_at=is.null` +
    `&email=not.is.null` +
    `&start_at=gte.${encodeURIComponent(windowStart)}` +
    `&start_at=lt.${encodeURIComponent(windowEnd)}`;
  const res = await fetch(url, {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) {
    throw new Error(`fetchDueBookings: HTTP ${res.status} ${await res.text()}`);
  }
  return await res.json();
}

async function markReminderSent(id: number): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/th_bookings?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ reminder_sent_at: new Date().toISOString() }),
  });
}

async function sendReminder(booking: Record<string, unknown>): Promise<boolean> {
  const guestEmail = booking.email ? String(booking.email).trim() : "";
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
        subject: "Reminder: your appointment tomorrow with Triple H Enterprises",
        html: buildReminderEmailHtml(booking),
        text: buildReminderEmailText(booking),
      }),
    });
    if (!res.ok) {
      console.error("sendReminder: Resend API error:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (err: any) {
    console.error("sendReminder error:", err.message);
    return false;
  }
}

Deno.serve(async (_req: Request) => {
  try {
    const bookings = await fetchDueBookings();
    let sent = 0;
    for (const booking of bookings) {
      const ok = await sendReminder(booking);
      if (ok) {
        // Marked sent even though the DB write itself isn't retried on
        // failure -- a lost mark-as-sent risks one duplicate reminder
        // email on the next hourly run, which is a much smaller problem
        // than the alternative (a bug in this step silently blocking
        // every future reminder for this booking).
        await markReminderSent(Number(booking.id));
        sent++;
      }
    }
    return new Response(JSON.stringify({ ok: true, checked: bookings.length, sent }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("send-appointment-reminder error:", err.message);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
