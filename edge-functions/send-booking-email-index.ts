// Supabase Edge Function: send-booking-email
//
// Sends TWO emails via Resend the instant a new confirmed booking
// lands in th_bookings:
//   1. An internal notification to Steve/Connor (LEAD_EMAIL_TO) --
//      same recipients already configured for the lead pipeline.
//   2. A guest-facing confirmation to whoever just booked (only when
//      they gave an email address -- optional at the DB/API level
//      even though the booking form marks it required, since a direct
//      POST to the insert endpoint bypasses HTML5 validation entirely).
//
// Deliberately its own function, not a branch merged into
// send-lead-email: keeps this notification channel's failure mode
// independent, matching every other notification pathway built this
// session, and keeps booking-specific formatting (date/time ranges,
// service names) out of the lead-email file entirely.
//
// Since 2026-09-22 it ALSO handles the two guest-initiated changes a
// booking can go through afterwards -- rescheduled or cancelled -- fired
// by a separate AFTER UPDATE trigger (on_booking_change_send_email,
// sql/booking/add_booking_change_emails_and_reminder_rearm.sql) that only
// ever fires on those two transitions. Before this, a guest who moved or
// cancelled their visit got nothing: their inbox still showed the OLD
// time. The guest gets "your visit moved" (new time, old time struck
// through, manage link, updated calendar file) or "your visit is
// cancelled" (with a rebook link); staff get an email copy of the same
// change alongside the push they already got -- a missed push on a
// cancellation means driving to an empty house.
//
// Every guest email that confirms a time (new booking, reschedule) now
// carries a calendar (.ics) attachment with day-before and 2-hour
// alarms, plus an "Add to Google Calendar" link. If Resend ever rejects
// the attachment, the same email is re-sent without it -- a calendar
// file is never allowed to cost someone their confirmation.
//
// Auth (2026-09-22): the bearer token must be the service role key, the
// same check Send-Push/uptime-alert/send-payment-reminder use. Both
// callers (the INSERT and UPDATE triggers) send the vault's
// send_push_service_role_key. Before this, anyone holding the public
// anon key could POST a crafted "booking" and have this function send a
// Triple H-branded email to any address they chose.
//
// Deploy with: supabase functions deploy send-booking-email
// Required secrets (all already configured for the lead-email
// pipeline; no new secrets needed):
//   RESEND_API_KEY, LEAD_EMAIL_TO, LEAD_EMAIL_FROM
// Auto-provided: SUPABASE_SERVICE_ROLE_KEY

const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const LEAD_EMAIL_TO = (Deno.env.get("LEAD_EMAIL_TO") || "")
  .split(",")
  .map((addr: string) => addr.trim())
  .filter((addr: string) => addr.length > 0);
const LEAD_EMAIL_FROM = Deno.env.get("LEAD_EMAIL_FROM") || "";

// Same publicly-hosted, email-client-safe logo already used by
// send-lead-email-index.ts -- see that file's own comment for why
// this is a dedicated PNG rather than the site's .webp logo.
const LOGO_URL = "https://www.triplehenterprisesllc.biz/images/logo-signature-email.png";

// The business operates in one timezone -- all display formatting is
// explicit about it rather than trusting the server's own default
// (Deno's runtime environment isn't guaranteed to be Mountain Time),
// since the underlying start_at/end_at values are UTC timestamptz.
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
    year: "numeric",
  }).format(start);
  const timeFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
  });
  const timeLabel = `${timeFmt.format(start)} \u2013 ${timeFmt.format(end)}`;
  return { dateLabel, timeLabel };
}

const SITE_ORIGIN = "https://www.triplehenterprisesllc.biz";

function manageUrl(booking: Record<string, unknown>): string {
  return `${SITE_ORIGIN}/manage-booking.html?token=${encodeURIComponent(String(booking.cancel_token || ""))}`;
}

// --- calendar file + Google link (2026-09-22) ---------------------------
// Same RFC 5545 escaping/folding as js/booking-flow.js's bookingBuildIcs()
// (the on-page Add to calendar button), so the file in the email and the
// one from the confirmation screen are the same event: same UID, so a
// calendar app that imports both updates one event instead of doubling it.
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
  const start = new Date(String(booking.start_at));
  const end = new Date(String(booking.end_at));
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
    `DTSTART:${icsUtc(start)}`,
    `DTEND:${icsUtc(end)}`,
    `SUMMARY:${icsEscape("Triple H Enterprises: " + (booking.service_label || "Service visit"))}`,
    booking.address ? `LOCATION:${icsEscape(booking.address)}` : "",
    `DESCRIPTION:${icsEscape(desc)}`,
    `URL:${manageUrl(booking)}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Triple H visit tomorrow",
    "TRIGGER:-P1D",
    "END:VALARM",
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
  const start = new Date(String(booking.start_at));
  const end = new Date(String(booking.end_at));
  const params = [
    "action=TEMPLATE",
    "text=" + encodeURIComponent("Triple H Enterprises: " + (booking.service_label || "Service visit")),
    "dates=" + icsUtc(start) + "/" + icsUtc(end),
    "details=" + encodeURIComponent(`Questions, or running late? Call or text Triple H at (435) 414-1667.\nReschedule or cancel: ${manageUrl(booking)}`),
  ];
  if (booking.address) params.push("location=" + encodeURIComponent(String(booking.address)));
  return "https://calendar.google.com/calendar/render?" + params.join("&");
}

// Sends one email through Resend. With a calendar attachment, a
// rejected send is retried once WITHOUT it -- the confirmation itself
// always matters more than the file.
async function sendEmail(body: Record<string, unknown>, icsContent?: string): Promise<boolean> {
  async function post(payload: Record<string, unknown>) {
    return await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify(payload),
    });
  }
  if (icsContent) {
    const withFile = { ...body, attachments: [{ filename: "triple-h-visit.ics", content: toBase64(icsContent) }] };
    const res = await post(withFile);
    if (res.ok) return true;
    console.error("sendEmail: send with calendar attachment failed, retrying without it:", res.status, await res.text());
  }
  const res = await post(body);
  if (!res.ok) {
    console.error("sendEmail: Resend API error:", res.status, await res.text());
    return false;
  }
  return true;
}

function buildInternalEmailHtml(booking: Record<string, unknown>): string {
  const { dateLabel, timeLabel } = formatDateRange(String(booking.start_at), String(booking.end_at));
  return `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <h2 style="color: #F5811F; margin-bottom: 4px;">New booking</h2>
      <p style="color: #666; margin-top: 0;">Someone just booked an appointment on triplehenterprisesllc.biz.</p>
      <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold; width: 140px;">Service</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${escapeHtml(booking.service_label)}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">Date</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${escapeHtml(dateLabel)}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">Time</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${escapeHtml(timeLabel)}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">Name</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${escapeHtml(booking.name)}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">Phone</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${escapeHtml(booking.phone) || "not given"}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">Email</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${escapeHtml(booking.email) || "not given"}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">Address</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${escapeHtml(booking.address) || "not given"}</td></tr>
      </table>
      ${booking.notes ? `<p style="margin-top: 16px;"><strong>Notes:</strong><br>${escapeHtml(booking.notes).replace(/\n/g, "<br>")}</p>` : ""}
      <p style="margin-top: 24px; color: #999; font-size: 12px;">Booked directly through the site's own scheduling system.</p>
    </div>
  `;
}

function buildInternalEmailText(booking: Record<string, unknown>): string {
  const { dateLabel, timeLabel } = formatDateRange(String(booking.start_at), String(booking.end_at));
  const line = (label: string, value: unknown) => `${label}: ${value || "not given"}`;
  const parts = [
    "New booking",
    "",
    line("Service", booking.service_label),
    line("Date", dateLabel),
    line("Time", timeLabel),
    line("Name", booking.name),
    line("Phone", booking.phone),
    line("Email", booking.email),
    line("Address", booking.address),
  ];
  if (booking.notes) parts.push("", "Notes:", String(booking.notes));
  return parts.join("\n");
}

function buildGuestEmailHtml(booking: Record<string, unknown>): string {
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
          <td align="center" style="padding: 28px 28px 0;">
            <!-- Green success checkmark badge (2026-09-19), requested
                 directly, mirroring booking.html's own on-page checkmark.
                 Plain HTML/CSS (a bgcolor'd table cell forced round with
                 border-radius), not an SVG or animated GIF -- email
                 client support for both is too inconsistent to rely on
                 (this degrades to a green square in classic Outlook
                 desktop, which is an acceptable, common fallback). -->
            <table role="presentation" cellpadding="0" cellspacing="0" width="56" height="56" style="width: 56px; height: 56px;">
              <tr><td align="center" valign="middle" bgcolor="#3ad66b" style="background: #3ad66b; border-radius: 50%; font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 28px; font-weight: 700; color: #0a0a0a; line-height: 56px;">&#10003;</td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding: 16px 28px 8px; font-family: -apple-system, Helvetica, Arial, sans-serif;">
            <h1 style="color: #ff8000; font-size: 22px; margin: 0 0 20px; text-align: center;">You're booked!</h1>
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 20px;">${greeting}</p>
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 8px;">Thanks for booking with Triple H Enterprises. Here's what we've got on the calendar:</p>
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
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 20px;"><strong>Add it to your calendar:</strong> open the attached calendar file, or <a href="${escapeHtml(googleCalendarUrl(booking))}" style="color: #ff8000;">add it to Google Calendar</a>. Either way your phone reminds you the day before and 2 hours before.</p>
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 20px;">Need to reschedule or cancel? <a href="https://www.triplehenterprisesllc.biz/manage-booking.html?token=${escapeHtml(booking.cancel_token)}" style="color: #ff8000;">Manage your booking here</a>, or just reply to this email or give us a call.</p>
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

function buildGuestEmailText(booking: Record<string, unknown>): string {
  const { dateLabel, timeLabel } = formatDateRange(String(booking.start_at), String(booking.end_at));
  const firstName = booking.name ? String(booking.name).trim().split(/\s+/)[0] : "";
  return [
    firstName ? `Hi ${firstName},` : "Hi there,",
    "",
    "Thanks for booking with Triple H Enterprises. Here's what we've got on the calendar:",
    "",
    `Service: ${booking.service_label}`,
    `Date: ${dateLabel}`,
    `Time: ${timeLabel}`,
    "",
    "This is an estimated time slot. The actual visit may run longer depending on what we find once we're there.",
    "",
    `Add it to your calendar: open the attached calendar file, or add it to Google Calendar: ${googleCalendarUrl(booking)}`,
    "",
    `Need to reschedule or cancel? Manage your booking here: https://www.triplehenterprisesllc.biz/manage-booking.html?token=${booking.cancel_token}`,
    "",
    "Or just reply to this email or give us a call.",
    "",
    "Talk soon,",
    "Triple H Enterprises",
    "(435) 414-1667, triplehenterprisesllc.biz",
  ].join("\n");
}

async function sendGuestConfirmation(booking: Record<string, unknown>): Promise<void> {
  const guestEmail = booking.email ? String(booking.email).trim() : "";
  if (!guestEmail) {
    console.log("sendGuestConfirmation: booking has no email address, skipping guest confirmation");
    return;
  }
  try {
    await sendEmail({
      from: `Triple H Enterprises <${LEAD_EMAIL_FROM}>`,
      to: guestEmail,
      reply_to: LEAD_EMAIL_TO,
      subject: "You're booked, Triple H Enterprises",
      html: buildGuestEmailHtml(booking),
      text: buildGuestEmailText(booking),
    }, buildBookingIcs(booking));
  } catch (err: any) {
    console.error("sendGuestConfirmation error:", err.message);
  }
}

// --- reschedule / cancellation (2026-09-22) ----------------------------
// Shared outer shell so both change emails look like the confirmation
// they follow up on. `badge` is a plain HTML/CSS table cell, never SVG --
// same email-client reasoning as the confirmation's green check.
function changeEmailShell(title: string, badgeColor: string, badgeGlyph: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(title)}</title>
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
          <td align="center" style="padding: 28px 28px 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="56" height="56" style="width: 56px; height: 56px;">
              <tr><td align="center" valign="middle" bgcolor="${badgeColor}" style="background: ${badgeColor}; border-radius: 50%; font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 26px; font-weight: 700; color: #0a0a0a; line-height: 56px;">${badgeGlyph}</td></tr>
            </table>
          </td>
        </tr>
        ${bodyHtml}
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

function greetingFor(booking: Record<string, unknown>): string {
  const firstName = booking.name ? String(booking.name).trim().split(/\s+/)[0] : "";
  return firstName ? `Hi ${firstName},` : "Hi there,";
}

function buildRescheduledGuestEmailHtml(booking: Record<string, unknown>, oldBooking: Record<string, unknown>): string {
  const now = formatDateRange(String(booking.start_at), String(booking.end_at));
  const was = formatDateRange(String(oldBooking.start_at), String(oldBooking.end_at));
  const body = `
        <tr>
          <td style="padding: 16px 28px 8px; font-family: -apple-system, Helvetica, Arial, sans-serif;">
            <h1 style="color: #ff8000; font-size: 22px; margin: 0 0 20px; text-align: center;">Your visit has moved</h1>
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 20px;">${escapeHtml(greetingFor(booking))}</p>
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 8px;">You're all set for the new time. Here's what's on the calendar now:</p>
          </td>
        </tr>
        <tr>
          <td style="padding: 0 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #777; font-size: 14px; width: 100px;">Service</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 14px; color: #222;">${escapeHtml(booking.service_label)}</td></tr>
              <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #777; font-size: 14px;">New date</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 14px; color: #222;"><strong>${escapeHtml(now.dateLabel)}</strong></td></tr>
              <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #777; font-size: 14px;">New time</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 14px; color: #222;"><strong>${escapeHtml(now.timeLabel)}</strong></td></tr>
              <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #777; font-size: 14px;">Was</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 14px; color: #999;"><s>${escapeHtml(was.dateLabel)}, ${escapeHtml(was.timeLabel)}</s></td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding: 20px 28px 28px; font-family: -apple-system, Helvetica, Arial, sans-serif;">
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 20px;"><strong>Update your calendar:</strong> open the attached file, or <a href="${escapeHtml(googleCalendarUrl(booking))}" style="color: #ff8000;">add the new time to Google Calendar</a>.</p>
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 20px;">Need to change it again? <a href="${escapeHtml(manageUrl(booking))}" style="color: #ff8000;">Manage your booking here</a>, or just reply to this email or give us a call.</p>
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0;">See you then,<br><strong>Triple H Enterprises</strong></p>
          </td>
        </tr>`;
  return changeEmailShell("Your visit has moved, Triple H Enterprises", "#3ad66b", "&#10003;", body);
}

function buildRescheduledGuestEmailText(booking: Record<string, unknown>, oldBooking: Record<string, unknown>): string {
  const now = formatDateRange(String(booking.start_at), String(booking.end_at));
  const was = formatDateRange(String(oldBooking.start_at), String(oldBooking.end_at));
  return [
    greetingFor(booking),
    "",
    "You're all set for the new time. Here's what's on the calendar now:",
    "",
    `Service: ${booking.service_label}`,
    `New date: ${now.dateLabel}`,
    `New time: ${now.timeLabel}`,
    `(Was: ${was.dateLabel}, ${was.timeLabel})`,
    "",
    `Update your calendar: open the attached file, or add the new time to Google Calendar: ${googleCalendarUrl(booking)}`,
    "",
    `Need to change it again? Manage your booking here: ${manageUrl(booking)}`,
    "",
    "See you then,",
    "Triple H Enterprises",
    "(435) 414-1667, triplehenterprisesllc.biz",
  ].join("\n");
}

function buildCancelledGuestEmailHtml(booking: Record<string, unknown>): string {
  const { dateLabel, timeLabel } = formatDateRange(String(booking.start_at), String(booking.end_at));
  const body = `
        <tr>
          <td style="padding: 16px 28px 8px; font-family: -apple-system, Helvetica, Arial, sans-serif;">
            <h1 style="color: #222; font-size: 22px; margin: 0 0 20px; text-align: center;">Your visit is cancelled</h1>
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 20px;">${escapeHtml(greetingFor(booking))}</p>
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 8px;">We've cancelled this appointment and released the time:</p>
          </td>
        </tr>
        <tr>
          <td style="padding: 0 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #777; font-size: 14px; width: 100px;">Service</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 14px; color: #999;"><s>${escapeHtml(booking.service_label)}</s></td></tr>
              <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #777; font-size: 14px;">Was</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 14px; color: #999;"><s>${escapeHtml(dateLabel)}, ${escapeHtml(timeLabel)}</s></td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding: 20px 28px 28px; font-family: -apple-system, Helvetica, Arial, sans-serif;">
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 20px;">If it's still on your calendar, you can delete it there. Whenever you need us again, <a href="${SITE_ORIGIN}/booking.html" style="color: #ff8000;">booking a new time</a> takes about a minute, or just reply to this email or give us a call.</p>
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0;">Thanks,<br><strong>Triple H Enterprises</strong></p>
          </td>
        </tr>`;
  return changeEmailShell("Your visit is cancelled, Triple H Enterprises", "#e5e5e5", "&times;", body);
}

function buildCancelledGuestEmailText(booking: Record<string, unknown>): string {
  const { dateLabel, timeLabel } = formatDateRange(String(booking.start_at), String(booking.end_at));
  return [
    greetingFor(booking),
    "",
    "We've cancelled this appointment and released the time:",
    "",
    `Service: ${booking.service_label}`,
    `Was: ${dateLabel}, ${timeLabel}`,
    "",
    "If it's still on your calendar, you can delete it there.",
    `Whenever you need us again, booking a new time takes about a minute: ${SITE_ORIGIN}/booking.html`,
    "Or just reply to this email or give us a call.",
    "",
    "Thanks,",
    "Triple H Enterprises",
    "(435) 414-1667, triplehenterprisesllc.biz",
  ].join("\n");
}

function buildInternalChangeEmail(kind: "rescheduled" | "cancelled", booking: Record<string, unknown>, oldBooking: Record<string, unknown>) {
  const now = formatDateRange(String(booking.start_at), String(booking.end_at));
  const was = formatDateRange(String(oldBooking.start_at), String(oldBooking.end_at));
  const jobNote = booking.job_id ? "Already added to Jobs -- update or remove that job too." : "";
  const heading = kind === "cancelled" ? "Booking cancelled" : "Booking rescheduled";
  const rows = kind === "cancelled"
    ? [["Service", booking.service_label], ["Was", `${was.dateLabel}, ${was.timeLabel}`]]
    : [["Service", booking.service_label], ["New time", `${now.dateLabel}, ${now.timeLabel}`], ["Was", `${was.dateLabel}, ${was.timeLabel}`]];
  rows.push(["Name", booking.name], ["Phone", booking.phone || "not given"], ["Email", booking.email || "not given"], ["Address", booking.address || "not given"]);
  const html = `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <h2 style="color: #F5811F; margin-bottom: 4px;">${heading}</h2>
      <p style="color: #666; margin-top: 0;">The guest changed this themselves from their manage-booking link.</p>
      <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
        ${rows.map(([label, value]) => `<tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold; width: 140px;">${escapeHtml(label)}</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${escapeHtml(value)}</td></tr>`).join("")}
      </table>
      ${jobNote ? `<p style="margin-top: 16px;"><strong>${escapeHtml(jobNote)}</strong></p>` : ""}
    </div>`;
  const text = [heading, "", ...rows.map(([label, value]) => `${label}: ${value}`), jobNote ? `\n${jobNote}` : ""].join("\n");
  const subject = `${kind === "cancelled" ? "Booking cancelled" : "Booking moved"}: ${booking.name || "Someone"} -- ${booking.service_label || "Service"}`;
  return { html, text, subject };
}

// Handles the two guest-initiated changes. Re-derives the transition from
// old_record/record itself rather than trusting that the trigger's own
// WHEN clause did its job -- the same double-check Send-Push already does
// for its booking push.
async function handleBookingChange(booking: Record<string, unknown>, oldBooking: Record<string, unknown>): Promise<Response> {
  const isCancellation = oldBooking.status === "confirmed" && booking.status === "cancelled";
  const isReschedule = oldBooking.status === "confirmed" && booking.status === "confirmed" && oldBooking.start_at !== booking.start_at;
  if (!isCancellation && !isReschedule) {
    return new Response(JSON.stringify({ ok: true, skipped: true }), { headers: { "Content-Type": "application/json" } });
  }
  const kind = isCancellation ? "cancelled" : "rescheduled";

  const internal = buildInternalChangeEmail(kind, booking, oldBooking);
  let internalOk = false;
  try {
    internalOk = await sendEmail({
      from: LEAD_EMAIL_FROM,
      to: LEAD_EMAIL_TO,
      reply_to: booking.email || undefined,
      subject: internal.subject,
      html: internal.html,
      text: internal.text,
    });
  } catch (err: any) {
    console.error("Internal booking change email error:", err.message);
  }

  const guestEmail = booking.email ? String(booking.email).trim() : "";
  if (guestEmail) {
    try {
      if (isReschedule) {
        await sendEmail({
          from: `Triple H Enterprises <${LEAD_EMAIL_FROM}>`,
          to: guestEmail,
          reply_to: LEAD_EMAIL_TO,
          subject: "Your visit has moved, Triple H Enterprises",
          html: buildRescheduledGuestEmailHtml(booking, oldBooking),
          text: buildRescheduledGuestEmailText(booking, oldBooking),
        }, buildBookingIcs(booking));
      } else {
        await sendEmail({
          from: `Triple H Enterprises <${LEAD_EMAIL_FROM}>`,
          to: guestEmail,
          reply_to: LEAD_EMAIL_TO,
          subject: "Your visit is cancelled, Triple H Enterprises",
          html: buildCancelledGuestEmailHtml(booking),
          text: buildCancelledGuestEmailText(booking),
        });
      }
    } catch (err: any) {
      console.error("Guest booking change email error:", err.message);
    }
  } else {
    console.log("handleBookingChange: booking has no email address, skipping guest email");
  }

  if (!internalOk) {
    return new Response(JSON.stringify({ ok: false, error: "internal notification failed, see function logs" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ ok: true, kind }), { headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  try {
    // Service-role callers only (see the header comment) -- checked before
    // the payload is read or trusted at all.
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!SERVICE_ROLE_KEY || token !== SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const payload = await req.json();

    if (payload.type === "UPDATE" && payload.table === "th_bookings") {
      return await handleBookingChange(payload.record || {}, payload.old_record || {});
    }

    if (payload.type !== "INSERT" || payload.table !== "th_bookings") {
      return new Response(JSON.stringify({ ok: false, error: "Unknown type" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const booking = payload.record || {};

    let internalOk = false;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: LEAD_EMAIL_FROM,
          to: LEAD_EMAIL_TO,
          reply_to: booking.email || undefined,
          subject: `New booking: ${booking.name || "Someone"} -- ${booking.service_label || "Service"}`,
          html: buildInternalEmailHtml(booking),
          text: buildInternalEmailText(booking),
        }),
      });
      if (res.ok) {
        internalOk = true;
      } else {
        const errBody = await res.text();
        console.error("Internal booking notification: Resend API error:", res.status, errBody);
      }
    } catch (err: any) {
      console.error("Internal booking notification error:", err.message);
    }

    await sendGuestConfirmation(booking);

    if (!internalOk) {
      return new Response(JSON.stringify({ ok: false, error: "internal notification failed, see function logs" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("send-booking-email error:", err.message);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
