// Supabase Edge Function: send-lead-email
//
// Sends an email via Resend the instant a new row lands in th_leads --
// this is the in-house replacement for Formspree's email-on-submit
// behavior. Deliberately a separate function from send-push (not an
// added branch inside it): if Resend has an outage, push notifications
// for everything else (overdue invoices, stuck jobs, etc.) keep working
// completely unaffected, and vice versa.
//
// Payload shape (fired by a Database Webhook / trigger on INSERT to
// th_leads, same fixed shape Supabase always uses):
//   { "type": "INSERT", "table": "th_leads", "record": {...} }
//
// Deploy with: supabase functions deploy send-lead-email
// Required secrets:
//   RESEND_API_KEY   -- from resend.com, after verifying the sending domain
//   LEAD_EMAIL_TO    -- where new-lead emails should land, e.g. steve@triplehenterprisesllc.biz
//   LEAD_EMAIL_FROM  -- must be on the verified Resend domain, e.g. leads@triplehenterprisesllc.biz
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-provided, not needed here)

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const LEAD_EMAIL_TO = Deno.env.get("LEAD_EMAIL_TO")!;
const LEAD_EMAIL_FROM = Deno.env.get("LEAD_EMAIL_FROM")!;

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

    if (!res.ok) {
      const errBody = await res.text();
      console.error("Resend API error:", res.status, errBody);
      return new Response(JSON.stringify({ ok: false, error: `Resend API returned ${res.status}` }), {
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
