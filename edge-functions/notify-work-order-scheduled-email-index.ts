// Supabase Edge Function: notify-work-order-scheduled-email
//
// Sent to the CLIENT the moment an internal account approves and
// schedules their request (2026-09-03), requested directly: "for 3
// should we build an 'Approve work order' So which would pop up on
// their portal and send them an email that appointment is booked?"
//
// Deliberately its own function, not folded into
// notify-new-work-order-email -- that one goes to the internal team
// about a NEW submission; this one goes to the CLIENT about their
// OWN request being confirmed. Different audience, different content,
// different trigger condition (an UPDATE transition, not an INSERT).

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const LEAD_EMAIL_FROM = Deno.env.get("LEAD_EMAIL_FROM") || "";
const PORTAL_URL = "https://www.triplehenterprisesllc.biz/portal/work-orders.html";
const LOGO_URL = "https://www.triplehenterprisesllc.biz/images/logo-signature-email.png";
const BUSINESS_TIMEZONE = "America/Denver";
// Added 2026-09-03 -- needed for the new notification-preference
// check below (clientWantsNotification). This function previously
// never touched Supabase's REST API at all, since everything it
// needed already arrived in the trigger's own payload.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Real notification control (2026-09-03), requested directly: "Real
// notification toggles." Defaults to wanting the email (true) if the
// client has never visited Settings and set a preference at all --
// matching this table's own column default.
async function clientWantsNotification(email: string, column: string): Promise<boolean> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/client_notification_preferences?client_email=eq.${encodeURIComponent(email.toLowerCase())}&select=${column}&limit=1`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  if (!res.ok) return true;
  const rows = await res.json();
  if (!rows.length) return true;
  return rows[0][column] !== false;
}

function escapeHtml(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Client push (2026-09-04), requested directly: "finish push (3
// remaining triggers)" -- same proven pattern as
// notify-work-order-message-email.
async function getUserIdByEmail(email: string): Promise<string | null> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email.toLowerCase())}`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const users = Array.isArray(data) ? data : data.users || [];
  return users.length ? users[0].id : null;
}

async function sendClientPush(email: string, title: string, body: string, url: string) {
  try {
    const userId = await getUserIdByEmail(email);
    if (!userId) return;
    await fetch(`${SUPABASE_URL}/functions/v1/Send-Push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ type: "client-notification", user_id: userId, title, body, url }),
    });
  } catch (err: any) {
    console.error("sendClientPush error (non-fatal):", err.message);
  }
}

function formatScheduledAt(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIMEZONE, weekday: "long", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit",
  }).format(new Date(iso));
}

function buildEmailHtml(clientName: string, title: string, scheduledLabel: string): string {
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
            <h1 style="color: #ff8000; font-size: 22px; margin: 0 0 20px; text-align: center;">Your appointment is booked!</h1>
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 20px;">Hi ${escapeHtml(clientName)},</p>
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 20px;">We've confirmed a time for your request:</p>
          </td>
        </tr>
        <tr>
          <td style="padding: 0 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #777; font-size: 14px; width: 100px;">Job</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 14px; color: #222;">${escapeHtml(title)}</td></tr>
              <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #777; font-size: 14px;">When</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 14px; color: #222; font-weight: 600;">${escapeHtml(scheduledLabel)}</td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding: 20px 28px 28px; font-family: -apple-system, Helvetica, Arial, sans-serif;">
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 20px;">Need to change anything? Just reply to this email or call/text us.</p>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding: 0 28px 28px;">
            <a href="${PORTAL_URL}" style="display: inline-block; background: #ff8000; color: #ffffff; text-decoration: none; font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 15px; font-weight: 600; padding: 14px 32px; border-radius: 8px;">View in Your Account</a>
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

function buildEmailText(clientName: string, title: string, scheduledLabel: string): string {
  return [
    `Hi ${clientName},`,
    "",
    "We've confirmed a time for your request:",
    "",
    `Job: ${title}`,
    `When: ${scheduledLabel}`,
    "",
    "Need to change anything? Just reply to this email or call/text us.",
    "",
    `View in your account: ${PORTAL_URL}`,
    "",
    "Triple H Enterprises",
    "(435) 414-1667, triplehenterprisesllc.biz",
  ].join("\n");
}

Deno.serve(async (req: Request) => {
  try {
    const payload = await req.json();

    if (payload.type !== "UPDATE" || payload.table !== "client_portal_work_orders") {
      return new Response(JSON.stringify({ ok: false, error: "Unknown type" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const wo = payload.record || {};
    if (!wo.client_email || !wo.scheduled_at) {
      return new Response(JSON.stringify({ ok: false, error: "Missing client_email or scheduled_at." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const displayName = (typeof wo.client_name === "string" && wo.client_name.trim() && wo.client_name !== wo.client_email)
      ? wo.client_name
      : wo.client_email;
    const scheduledLabel = formatScheduledAt(wo.scheduled_at);

    if (!(await clientWantsNotification(wo.client_email, "wants_work_order_emails"))) {
      return new Response(JSON.stringify({ ok: true, skipped: "client opted out of work order emails" }), { headers: { "Content-Type": "application/json" } });
    }

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: `Triple H Enterprises <${LEAD_EMAIL_FROM}>`,
        to: wo.client_email,
        subject: "Your appointment is booked, Triple H Enterprises",
        html: buildEmailHtml(displayName, wo.title || "your request", scheduledLabel),
        text: buildEmailText(displayName, wo.title || "your request", scheduledLabel),
      }),
    });

    if (!emailRes.ok) {
      const errBody = await emailRes.text();
      return new Response(JSON.stringify({ ok: false, error: `Email failed to send: ${errBody.slice(0, 300)}` }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    await sendClientPush(wo.client_email, "Your appointment is booked", `${wo.title || "Your request"}: ${scheduledLabel}`, "/portal/work-orders.html");

    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("notify-work-order-scheduled-email error:", err.message);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
