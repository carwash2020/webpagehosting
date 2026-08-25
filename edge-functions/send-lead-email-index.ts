// Supabase Edge Function: send-lead-email
//
// Sends TWO emails via Resend the instant a new row lands in th_leads:
//   1. An internal notification to Steve/Connor (LEAD_EMAIL_TO) -- the
//      in-house replacement for Formspree's email-on-submit behavior.
//   2. A guest-facing confirmation to the person who submitted the form
//      (only when they gave an email address -- optional at the DB/API
//      level even though the form marks it required, since a direct
//      POST to the insert endpoint bypasses HTML5 validation entirely).
//      Reply-To on this one points back to LEAD_EMAIL_TO, so if the
//      guest replies with an added detail, it reaches Steve/Connor.
//
// These two sends are deliberately independent of each other (each in
// its own try/catch) -- if Resend rejects one, the other still goes
// out. The internal notification is the more important of the two
// (Steve/Connor can always follow up manually even if the guest
// confirmation fails), so its failure is logged but never blocks the
// guest send from being attempted.
//
// Deliberately a separate function from send-push (not an added branch
// inside it): if Resend has an outage, push notifications for
// everything else (overdue invoices, stuck jobs, etc.) keep working
// completely unaffected, and vice versa.
//
// Payload shape (fired by a Database Webhook / trigger on INSERT to
// th_leads, same fixed shape Supabase always uses):
//   { "type": "INSERT", "table": "th_leads", "record": {...} }
//
// Deploy with: supabase functions deploy send-lead-email
// Required secrets:
//   RESEND_API_KEY   -- from resend.com, after verifying the sending domain
//   LEAD_EMAIL_TO    -- where new-lead emails should land. Comma-separated
//                       for multiple recipients, e.g.
//                       "steve@triplehenterprisesllc.biz,connor@triplehenterprisesllc.biz"
//   LEAD_EMAIL_FROM  -- must be on the verified Resend domain, e.g. leads@triplehenterprisesllc.biz
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-provided, not needed here)

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const LEAD_EMAIL_TO = Deno.env.get("LEAD_EMAIL_TO")!
  .split(",")
  .map((addr: string) => addr.trim())
  .filter((addr: string) => addr.length > 0);
const LEAD_EMAIL_FROM = Deno.env.get("LEAD_EMAIL_FROM")!;

// Publicly hosted on the live site -- email clients fetch images over
// plain HTTP(S), never from a relative/local path. A palette-quantized
// PNG, not the site's own .webp logo: some email clients (older
// Outlook in particular) have poor or no WebP support, while PNG is
// universally supported.
const LOGO_URL = "https://www.triplehenterprisesllc.biz/images/logo-signature-email.png";

function escapeHtml(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// A blank field is a real, common case (preferred_date/preferred_time
// are optional on the form) -- rendered as an explicit "not given"
// rather than silently disappearing, so the email reads the same
// whether a field was skipped or actually came back empty.
function fieldOrNotGiven(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value).trim();
  return s ? escapeHtml(s) : "<em>not given</em>";
}

function buildEmailHtml(lead: Record<string, unknown>): string {
  return `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <h2 style="color: #F5811F; margin-bottom: 4px;">New website lead</h2>
      <p style="color: #666; margin-top: 0;">Someone just submitted the contact form on triplehenterprisesllc.biz.</p>
      <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold; width: 140px;">Name</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${fieldOrNotGiven(lead.name)}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">Phone</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${fieldOrNotGiven(lead.phone)}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">Email</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${fieldOrNotGiven(lead.email)}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">Service</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${fieldOrNotGiven(lead.service)}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">Preferred date</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${fieldOrNotGiven(lead.preferred_date)}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">Preferred time</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${fieldOrNotGiven(lead.preferred_time)}</td></tr>
      </table>
      ${lead.details ? `<p style="margin-top: 16px;"><strong>What's going on:</strong><br>${escapeHtml(lead.details).replace(/\n/g, "<br>")}</p>` : ""}
      <p style="margin-top: 24px; color: #999; font-size: 12px;">This lead is also saved in your Leads panel in the Workspace tools app.</p>
    </div>
  `;
}

function buildEmailText(lead: Record<string, unknown>): string {
  const line = (label: string, value: unknown) => {
    const s = value === null || value === undefined ? "" : String(value).trim();
    return `${label}: ${s || "not given"}`;
  };
  const parts = [
    "New website lead",
    "",
    line("Name", lead.name),
    line("Phone", lead.phone),
    line("Email", lead.email),
    line("Service", lead.service),
    line("Preferred date", lead.preferred_date),
    line("Preferred time", lead.preferred_time),
  ];
  if (lead.details) parts.push("", "What's going on:", String(lead.details));
  return parts.join("\n");
}

function buildGuestEmailHtml(lead: Record<string, unknown>): string {
  const firstName = lead.name ? String(lead.name).trim().split(/\s+/)[0] : "";
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi there,";

  // Only shown when actually given -- an empty "Preferred date: not
  // given" line reads as clutter in a short, friendly guest email in a
  // way it doesn't in the fuller internal notification above.
  const detailRows = [
    lead.service ? `<tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #777; font-size: 14px; width: 140px;">Service</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 14px; color: #222;">${escapeHtml(lead.service)}</td></tr>` : "",
    lead.preferred_date ? `<tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #777; font-size: 14px;">Preferred date</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 14px; color: #222;">${escapeHtml(lead.preferred_date)}</td></tr>` : "",
    lead.preferred_time ? `<tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #777; font-size: 14px;">Preferred time</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 14px; color: #222;">${escapeHtml(lead.preferred_time)}</td></tr>` : "",
  ].filter(Boolean).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>We got your request -- Triple H Enterprises</title>
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
          <td bgcolor="#ffffff" style="background: #ffffff; padding: 32px 28px 8px; font-family: -apple-system, Helvetica, Arial, sans-serif;">
            <h1 style="color: #ff8000; font-size: 22px; margin: 0 0 20px; text-align: center;">We got your request!</h1>
            <p style="color: #222222; font-size: 15px; line-height: 1.5; margin: 0 0 12px;">${greeting}</p>
            <p style="color: #222222; font-size: 15px; line-height: 1.5; margin: 0 0 8px;">Thanks for reaching out to Triple H Enterprises. We've received your request and will follow up by phone or email shortly to confirm the details.</p>
          </td>
        </tr>
        ${detailRows ? `
        <tr>
          <td bgcolor="#ffffff" style="background: #ffffff; padding: 0 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family: -apple-system, Helvetica, Arial, sans-serif;">
              ${detailRows}
            </table>
          </td>
        </tr>` : ""}
        <tr>
          <td bgcolor="#ffffff" style="background: #ffffff; padding: 20px 28px 28px; font-family: -apple-system, Helvetica, Arial, sans-serif;">
            <p style="color: #222222; font-size: 15px; line-height: 1.5; margin: 0 0 20px;">If anything changes or you think of another detail worth mentioning before we call, just reply directly to this email.</p>
            <p style="color: #222222; font-size: 15px; line-height: 1.5; margin: 0;">Talk soon,<br><strong>Triple H Enterprises</strong></p>
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

function buildGuestEmailText(lead: Record<string, unknown>): string {
  const firstName = lead.name ? String(lead.name).trim().split(/\s+/)[0] : "";
  const parts = [
    firstName ? `Hi ${firstName},` : "Hi there,",
    "",
    "Thanks for reaching out to Triple H Enterprises. We've received your request and will follow up by phone or email shortly to confirm the details.",
  ];
  if (lead.service) parts.push("", `Service: ${lead.service}`);
  if (lead.preferred_date) parts.push(`Preferred date: ${lead.preferred_date}`);
  if (lead.preferred_time) parts.push(`Preferred time: ${lead.preferred_time}`);
  parts.push(
    "",
    "If anything changes or you think of another detail worth mentioning before we call, just reply directly to this email.",
    "",
    "Talk soon,",
    "Triple H Enterprises",
    "(435) 414-1667 -- triplehenterprisesllc.biz",
  );
  return parts.join("\n");
}

// Sends the guest-facing confirmation. Deliberately its own function
// with its own try/catch, called independently of the internal
// notification -- a failure here (or a lead with no email at all) is
// logged but never affects whether Steve/Connor's notification sends.
async function sendGuestConfirmation(lead: Record<string, unknown>): Promise<void> {
  const guestEmail = lead.email ? String(lead.email).trim() : "";
  if (!guestEmail) {
    console.log("sendGuestConfirmation: lead has no email address, skipping guest confirmation");
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
        reply_to: LEAD_EMAIL_TO, // a guest reply reaches Steve/Connor, not an unmonitored address
        subject: "We got your request -- Triple H Enterprises",
        html: buildGuestEmailHtml(lead),
        text: buildGuestEmailText(lead),
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

    // Same real, fixed webhook shape send-push already relies on --
    // never a custom string.
    if (payload.type !== "INSERT" || payload.table !== "th_leads") {
      return new Response(JSON.stringify({ ok: false, error: "Unknown type" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const lead = payload.record || {};
    const subjectName = lead.name ? String(lead.name).trim() : "Someone";

    // Internal notification to Steve/Connor. Its own try/catch, tracking
    // success/failure without returning early -- a failure here must
    // never prevent the guest confirmation below from being attempted,
    // since the two are deliberately independent.
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
          reply_to: lead.email || undefined, // one click to reply straight to the lead, when they gave an email
          subject: `New lead: ${subjectName}${lead.service ? " -- " + lead.service : ""}`,
          html: buildEmailHtml(lead),
          text: buildEmailText(lead),
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

    // Guest confirmation. Already has its own internal try/catch and
    // its own "no email given" skip -- safe to call unconditionally.
    await sendGuestConfirmation(lead);

    if (!internalOk) {
      return new Response(JSON.stringify({ ok: false, error: "internal notification failed, see function logs" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("send-lead-email error:", err.message);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
