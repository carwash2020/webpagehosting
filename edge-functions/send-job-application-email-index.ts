// Supabase Edge Function: send-job-application-email
//
// Sends TWO emails via Resend the instant a new row lands in
// th_job_applications (the /careers.html apply form):
//   1. An internal notification to Steve/Connor (LEAD_EMAIL_TO,
//      reused from the lead-form setup -- same people, same inbox).
//   2. A short confirmation to the applicant (only when they gave an
//      email address). Reply-To points back to LEAD_EMAIL_TO, so a
//      reply from the applicant reaches Steve/Connor.
//
// Same independent-try/catch shape as send-lead-email: a Resend
// outage or a missing applicant email never blocks the other send.
//
// Payload shape (fired by the on_new_job_application_send_email
// trigger, sql/careers/create_th_job_applications.sql):
//   { "type": "INSERT", "table": "th_job_applications", "record": {...} }
//
// Deploy with: supabase functions deploy send-job-application-email
// Reuses existing secrets, no new ones needed:
//   RESEND_API_KEY, LEAD_EMAIL_TO, LEAD_EMAIL_FROM

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const LEAD_EMAIL_TO = Deno.env.get("LEAD_EMAIL_TO")!
  .split(",")
  .map((addr: string) => addr.trim())
  .filter((addr: string) => addr.length > 0);
const LEAD_EMAIL_FROM = Deno.env.get("LEAD_EMAIL_FROM")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const LOGO_URL = "https://www.triplehenterprisesllc.biz/images/logo-signature-email.png";

function escapeHtml(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fieldOrNotGiven(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value).trim();
  return s ? escapeHtml(s) : "<em>not given</em>";
}

function buildEmailHtml(app: Record<string, unknown>): string {
  return `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <h2 style="color: #F5811F; margin-bottom: 4px;">New job application</h2>
      <p style="color: #666; margin-top: 0;">Someone just applied for the Part-Time Handyman Helper posting on triplehenterprisesllc.biz.</p>
      <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold; width: 140px;">Name</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${fieldOrNotGiven(app.name)}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">Phone</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${fieldOrNotGiven(app.phone)}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">Email</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${fieldOrNotGiven(app.email)}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">City</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${fieldOrNotGiven(app.city)}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">Availability</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${fieldOrNotGiven(app.availability)}</td></tr>
      </table>
      ${app.experience ? `<p style="margin-top: 16px;"><strong>Repair experience:</strong><br>${escapeHtml(app.experience).replace(/\n/g, "<br>")}</p>` : ""}
      ${app.message ? `<p style="margin-top: 16px;"><strong>Message:</strong><br>${escapeHtml(app.message).replace(/\n/g, "<br>")}</p>` : ""}
      <p style="margin-top: 24px; color: #999; font-size: 12px;">This application is also saved in your database (th_job_applications) if you need to look it up again.</p>
    </div>
  `;
}

function buildEmailText(app: Record<string, unknown>): string {
  const line = (label: string, value: unknown) => {
    const s = value === null || value === undefined ? "" : String(value).trim();
    return `${label}: ${s || "not given"}`;
  };
  const parts = [
    "New job application",
    "",
    line("Name", app.name),
    line("Phone", app.phone),
    line("Email", app.email),
    line("City", app.city),
    line("Availability", app.availability),
  ];
  if (app.experience) parts.push("", "Repair experience:", String(app.experience));
  if (app.message) parts.push("", "Message:", String(app.message));
  return parts.join("\n");
}

function buildGuestEmailHtml(app: Record<string, unknown>): string {
  const firstName = app.name ? String(app.name).trim().split(/\s+/)[0] : "";
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi there,";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>We got your application, Triple H Enterprises</title>
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
          <td bgcolor="#ffffff" style="background: #ffffff; padding: 32px 28px 28px; font-family: -apple-system, Helvetica, Arial, sans-serif;">
            <h1 style="color: #ff8000; font-size: 22px; margin: 0 0 20px; text-align: center;">Got your application!</h1>
            <p style="color: #222222; font-size: 15px; line-height: 1.5; margin: 0 0 12px;">${greeting}</p>
            <p style="color: #222222; font-size: 15px; line-height: 1.5; margin: 0 0 12px;">Thanks for applying for the part-time handyman helper position at Triple H Enterprises. Steven will reach out directly if it looks like a good fit.</p>
            <p style="color: #222222; font-size: 15px; line-height: 1.5; margin: 0;">If anything comes up in the meantime, just reply directly to this email.</p>
          </td>
        </tr>
        <tr>
          <td bgcolor="#ff8000" style="background: #ff8000; height: 4px; line-height: 4px; font-size: 1px;">&nbsp;</td>
        </tr>
        <tr>
          <td align="center" bgcolor="#ffffff" style="background: #ffffff; padding: 16px 24px; font-family: -apple-system, Helvetica, Arial, sans-serif;">
            <p style="color: #999999; font-size: 12px; margin: 0;">(435) 414-1667 &middot; triplehenterprisesllc.biz</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>
  `;
}

function buildGuestEmailText(app: Record<string, unknown>): string {
  const firstName = app.name ? String(app.name).trim().split(/\s+/)[0] : "";
  return [
    firstName ? `Hi ${firstName},` : "Hi there,",
    "",
    "Thanks for applying for the part-time handyman helper position at Triple H Enterprises. Steven will reach out directly if it looks like a good fit.",
    "",
    "If anything comes up in the meantime, just reply directly to this email.",
    "",
    "Triple H Enterprises",
    "(435) 414-1667, triplehenterprisesllc.biz",
  ].join("\n");
}

async function sendApplicantConfirmation(app: Record<string, unknown>): Promise<void> {
  const applicantEmail = app.email ? String(app.email).trim() : "";
  if (!applicantEmail) {
    console.log("sendApplicantConfirmation: application has no email address, skipping");
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
        to: applicantEmail,
        reply_to: LEAD_EMAIL_TO,
        subject: "We got your application, Triple H Enterprises",
        html: buildGuestEmailHtml(app),
        text: buildGuestEmailText(app),
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error("sendApplicantConfirmation: Resend API error:", res.status, errBody);
    }
  } catch (err: any) {
    console.error("sendApplicantConfirmation error:", err.message);
  }
}

Deno.serve(async (req: Request) => {
  try {
    // Only real caller: the notify_new_job_application_email() trigger (sql/careers/create_th_job_applications.sql), which sends the
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

    if (payload.type !== "INSERT" || payload.table !== "th_job_applications") {
      return new Response(JSON.stringify({ ok: false, error: "Unknown type" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const app = payload.record || {};
    const subjectName = app.name ? String(app.name).trim() : "Someone";

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
          reply_to: app.email || undefined,
          subject: `New job application: ${subjectName}`,
          html: buildEmailHtml(app),
          text: buildEmailText(app),
        }),
      });

      if (res.ok) {
        internalOk = true;
      } else {
        const errBody = await res.text();
        console.error("Internal notification: Resend API error:", res.status, errBody);
      }
    } catch (err: any) {
      console.error("Internal notification error:", err.message);
    }

    await sendApplicantConfirmation(app);

    if (!internalOk) {
      return new Response(JSON.stringify({ ok: false, error: "internal notification failed, see function logs" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("send-job-application-email error:", err.message);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
