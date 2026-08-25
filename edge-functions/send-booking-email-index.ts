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
// Deploy with: supabase functions deploy send-booking-email
// Required secrets (all already configured for the lead-email
// pipeline; no new secrets needed):
//   RESEND_API_KEY, LEAD_EMAIL_TO, LEAD_EMAIL_FROM

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
<title>You're booked -- Triple H Enterprises</title>
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
            <p style="color: #777; font-size: 13px; line-height: 1.5; margin: 0 0 20px;">This is an estimated time slot -- the actual visit may run longer depending on what we find once we're there.</p>
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
    "This is an estimated time slot -- the actual visit may run longer depending on what we find once we're there.",
    "",
    `Need to reschedule or cancel? Manage your booking here: https://www.triplehenterprisesllc.biz/manage-booking.html?token=${booking.cancel_token}`,
    "",
    "Or just reply to this email or give us a call.",
    "",
    "Talk soon,",
    "Triple H Enterprises",
    "(435) 414-1667 -- triplehenterprisesllc.biz",
  ].join("\n");
}

async function sendGuestConfirmation(booking: Record<string, unknown>): Promise<void> {
  const guestEmail = booking.email ? String(booking.email).trim() : "";
  if (!guestEmail) {
    console.log("sendGuestConfirmation: booking has no email address, skipping guest confirmation");
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
        to: guestEmail,
        reply_to: LEAD_EMAIL_TO,
        subject: "You're booked -- Triple H Enterprises",
        html: buildGuestEmailHtml(booking),
        text: buildGuestEmailText(booking),
      }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.error("sendGuestConfirmation: Resend API error:", res.status, errBody);
    }
  } catch (err: any) {
    console.error("sendGuestConfirmation error:", err.message);
  }
}

Deno.serve(async (req: Request) => {
  try {
    const payload = await req.json();

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
