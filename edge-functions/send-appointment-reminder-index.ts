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
// 2026-09-22 (booking-flow pass):
//   - The reminder now carries a calendar (.ics) attachment and an "Add to
//     Google Calendar" link, same as the confirmation email -- re-sent
//     without the file if Resend ever rejects it.
//   - A client who has the portal installed with push turned on also gets
//     the reminder as a push, on their own device(s) only: the booking's
//     email is matched EXACTLY to a portal account through
//     get_auth_user_id_by_email() (service role only), then sent via
//     Send-Push's per-user "client-notification" branch. No match, no push.
//   - Reschedules now re-arm this reminder: track_booking_changes() clears
//     reminder_sent_at whenever a confirmed booking's start time moves
//     (sql/booking/add_booking_change_emails_and_reminder_rearm.sql).
//     Before, a guest reminded Monday about Tuesday who moved to Friday
//     never heard about Friday.
//   - Auth: the bearer token must be the service role key (the hourly cron
//     sends the vault's send_push_service_role_key), same check as
//     Send-Push/send-payment-reminder. Nothing here is callable with the
//     public anon key anymore.
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

const SITE_ORIGIN = "https://www.triplehenterprisesllc.biz";

function manageUrl(booking: Record<string, unknown>): string {
  return `${SITE_ORIGIN}/manage-booking.html?token=${encodeURIComponent(String(booking.cancel_token || ""))}`;
}

// Same calendar event as send-booking-email-index.ts's buildBookingIcs()
// (same UID), so importing it again updates the one event rather than
// adding a second copy.
function icsEscape(text: unknown): string {
  return String(text ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function icsFold(line: string): string {
  if (line.length <= 73) return line;
  const parts = [line.slice(0, 73)];
  let rest = line.slice(73);
  while (rest.length) {
    parts.push(" " + rest.slice(0, 72));
    rest = rest.slice(72);
  }
  return parts.join("\r\n");
}

function icsUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function buildBookingIcs(booking: Record<string, unknown>): string {
  const desc = [
    "Questions, or running late? Call or text Triple H at (435) 414-1667.",
    `Reschedule or cancel: ${manageUrl(booking)}`,
  ].join("\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Triple H Enterprises//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:th-booking-${icsEscape(booking.id)}@triplehenterprisesllc.biz`,
    `DTSTAMP:${icsUtc(new Date())}`,
    `DTSTART:${icsUtc(new Date(String(booking.start_at)))}`,
    `DTEND:${icsUtc(new Date(String(booking.end_at)))}`,
    `SUMMARY:${icsEscape("Triple H Enterprises: " + (booking.service_label || "Service visit"))}`,
    booking.address ? `LOCATION:${icsEscape(booking.address)}` : "",
    `DESCRIPTION:${icsEscape(desc)}`,
    `URL:${manageUrl(booking)}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Triple H visit in 2 hours",
    "TRIGGER:-PT2H",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return lines.map(icsFold).join("\r\n") + "\r\n";
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function googleCalendarUrl(booking: Record<string, unknown>): string {
  const params = [
    "action=TEMPLATE",
    "text=" + encodeURIComponent("Triple H Enterprises: " + (booking.service_label || "Service visit")),
    "dates=" + icsUtc(new Date(String(booking.start_at))) + "/" + icsUtc(new Date(String(booking.end_at))),
    "details=" + encodeURIComponent(`Questions, or running late? Call or text Triple H at (435) 414-1667.\nReschedule or cancel: ${manageUrl(booking)}`),
  ];
  if (booking.address) params.push("location=" + encodeURIComponent(String(booking.address)));
  return "https://calendar.google.com/calendar/render?" + params.join("&");
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
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 20px;">Not on your calendar yet? Open the attached file, or <a href="${escapeHtml(googleCalendarUrl(booking))}" style="color: #ff8000;">add it to Google Calendar</a>.</p>
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
    `Not on your calendar yet? Open the attached file, or add it to Google Calendar: ${googleCalendarUrl(booking)}`,
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
  const body = {
    from: `Triple H Enterprises <${LEAD_EMAIL_FROM}>`,
    to: guestEmail,
    subject: "Reminder: your appointment tomorrow with Triple H Enterprises",
    html: buildReminderEmailHtml(booking),
    text: buildReminderEmailText(booking),
  };
  async function post(payload: Record<string, unknown>) {
    return await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify(payload),
    });
  }
  try {
    // With the calendar file first; if Resend rejects it, the reminder
    // itself still goes out without the file.
    const withFile = await post({ ...body, attachments: [{ filename: "triple-h-visit.ics", content: toBase64(buildBookingIcs(booking)) }] });
    if (withFile.ok) return true;
    console.error("sendReminder: send with calendar attachment failed, retrying without it:", withFile.status, await withFile.text());
    const res = await post(body);
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

// Push the same reminder to a portal client's own device(s), if -- and
// only if -- the booking's email EXACTLY matches a portal account
// (get_auth_user_id_by_email lower()-compares the whole address; it
// never guesses). Send-Push's client-notification branch then sends only
// to that one user's subscriptions. Never throws; a push is a bonus on
// top of the email, never a reason to fail the run.
async function sendReminderPush(booking: Record<string, unknown>): Promise<boolean> {
  const email = booking.email ? String(booking.email).trim() : "";
  if (!email) return false;
  try {
    const lookup = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_auth_user_id_by_email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ p_email: email }),
    });
    if (!lookup.ok) {
      console.error("sendReminderPush: user lookup failed:", lookup.status, await lookup.text());
      return false;
    }
    const userId = await lookup.json();
    if (typeof userId !== "string" || !userId) return false; // no portal account for this email
    const { timeLabel } = formatDateRange(String(booking.start_at), String(booking.end_at));
    const res = await fetch(`${SUPABASE_URL}/functions/v1/Send-Push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      body: JSON.stringify({
        type: "client-notification",
        user_id: userId,
        title: `Tomorrow: ${booking.service_label || "your Triple H visit"}`,
        body: `${timeLabel}. Need to change it? Tap to reschedule or cancel.`,
        url: "/portal/home.html",
      }),
    });
    if (!res.ok) console.error("sendReminderPush: Send-Push error:", res.status, await res.text());
    return res.ok;
  } catch (err: any) {
    console.error("sendReminderPush error (non-fatal):", err.message);
    return false;
  }
}

Deno.serve(async (req: Request) => {
  try {
    // Service-role callers only: the hourly cron sends the vault's
    // send_push_service_role_key. Checked before anything is read or sent.
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!SERVICE_ROLE_KEY || token !== SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const bookings = await fetchDueBookings();
    let sent = 0;
    let pushed = 0;
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
        // After the mark, so a slow push can never cause a second email.
        if (await sendReminderPush(booking)) pushed++;
      }
    }
    return new Response(JSON.stringify({ ok: true, checked: bookings.length, sent, pushed }), {
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
