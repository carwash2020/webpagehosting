// Supabase Edge Function: notify-new-work-order-email
//
// Fires the instant a client submits a Request Work form (2026-09-03),
// requested directly: "when a client requests a work order it needs
// to email Steve@triplehenterprisesllc.biz and connor@triplehenterprisesllc.biz."
//
// Deliberately does NOT hardcode those two addresses. Reads
// notification_recipients instead -- the table behind the new "Email
// list" in Dev Tools, requested in the same message specifically so a
// future hire can be added without a code change: "add an 'Email
// list' In dev tools so that way we can add emails to the
// notification pile in future if we ever hire."
//
// Triggered the same way notify_new_booking_email already is for
// th_bookings -- an AFTER INSERT trigger on client_portal_work_orders
// posting the real Database Webhook payload shape
// ({type, table, record}) via net.http_post from Postgres, using the
// service-role key stored in Vault. Matches the established pattern
// exactly rather than inventing a new one. verify_jwt stays true (the
// same as send-booking-email/send-lead-email) -- the service-role
// bearer token the trigger sends still passes that check, so there is
// no reason to relax it here.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const LEAD_EMAIL_FROM = Deno.env.get("LEAD_EMAIL_FROM") || "";
const WORKSPACE_URL = "https://www.triplehenterprisesllc.biz/tools/workspace.html";

function escapeHtml(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const URGENCY_LABELS: Record<string, string> = { normal: "Whenever (flexible)", soon: "Soon (this week)", urgent: "Urgent (ASAP)" };

function buildInternalEmailHtml(wo: Record<string, unknown>): string {
  const urgency = URGENCY_LABELS[String(wo.urgency)] || String(wo.urgency || "");
  const urgentColor = wo.urgency === "urgent" ? "#e05252" : "#F5811F";
  return `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <h2 style="color: ${urgentColor}; margin-bottom: 4px;">New work request${wo.urgency === "urgent" ? " -- URGENT" : ""}</h2>
      <p style="color: #666; margin-top: 0;">A client submitted a new request through the portal.</p>
      <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold; width: 140px;">Title</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${escapeHtml(wo.title)}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">Client</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${escapeHtml(wo.client_name || wo.client_email)}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">Email</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${escapeHtml(wo.client_email)}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">Urgency</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${escapeHtml(urgency)}</td></tr>
        ${wo.phone ? `<tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">Phone</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${escapeHtml(wo.phone)}</td></tr>` : ""}
        ${wo.address ? `<tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">Address</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${escapeHtml(wo.address)}</td></tr>` : ""}
      </table>
      <p style="margin-top: 16px;"><strong>What they need:</strong><br>${escapeHtml(wo.description).replace(/\n/g, "<br>")}</p>
      ${(wo.photo_storage_paths as unknown[] | null)?.length ? `<p style="color: #666; font-size: 13px;">${(wo.photo_storage_paths as unknown[]).length} photo(s) attached -- view in Dev Tools &gt; Portal &gt; Portal work orders.</p>` : ""}
      <p style="margin-top: 24px;"><a href="${WORKSPACE_URL}" style="color: #F5811F;">Open Workspace</a></p>
    </div>
  `;
}

function buildInternalEmailText(wo: Record<string, unknown>): string {
  const urgency = URGENCY_LABELS[String(wo.urgency)] || String(wo.urgency || "");
  const lines = [
    `New work request${wo.urgency === "urgent" ? " -- URGENT" : ""}`,
    "",
    `Title: ${wo.title}`,
    `Client: ${wo.client_name || wo.client_email}`,
    `Email: ${wo.client_email}`,
    `Urgency: ${urgency}`,
  ];
  if (wo.phone) lines.push(`Phone: ${wo.phone}`);
  if (wo.address) lines.push(`Address: ${wo.address}`);
  lines.push("", "What they need:", String(wo.description));
  if ((wo.photo_storage_paths as unknown[] | null)?.length) {
    lines.push("", `${(wo.photo_storage_paths as unknown[]).length} photo(s) attached -- view in Dev Tools > Portal > Portal work orders.`);
  }
  lines.push("", `Open Workspace: ${WORKSPACE_URL}`);
  return lines.join("\n");
}

Deno.serve(async (req: Request) => {
  try {
    const payload = await req.json();

    if (payload.type !== "INSERT" || payload.table !== "client_portal_work_orders") {
      return new Response(JSON.stringify({ ok: false, error: "Unknown type" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const wo = payload.record || {};

    // Reads the recipient list fresh on every send, never cached --
    // this function has no in-memory state between invocations anyway
    // (a fresh isolate per cold start), and a list that CAN be edited
    // in Dev Tools at any moment must never risk sending to a stale,
    // previously-fetched set of addresses.
    const recipientsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/notification_recipients?select=email&notify_types=cs.%7B%22work_order%22%7D`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    if (!recipientsRes.ok) {
      return new Response(JSON.stringify({ ok: false, error: "Could not load notification_recipients" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
    const recipients: { email: string }[] = await recipientsRes.json();
    if (!recipients.length) {
      // Not an error -- the list is a real, editable setting, and
      // someone could genuinely clear it (e.g. temporarily muting
      // notifications). Logged, not failed.
      console.log("notify-new-work-order-email: notification_recipients is empty, nothing sent");
      return new Response(JSON.stringify({ ok: true, sent_to: 0 }), { headers: { "Content-Type": "application/json" } });
    }

    let sentCount = 0;
    for (const r of recipients) {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
          body: JSON.stringify({
            from: LEAD_EMAIL_FROM,
            to: r.email,
            reply_to: wo.client_email || undefined,
            subject: `New work request${wo.urgency === "urgent" ? " -- URGENT" : ""}: ${wo.title}`,
            html: buildInternalEmailHtml(wo),
            text: buildInternalEmailText(wo),
          }),
        });
        if (res.ok) sentCount++;
        else console.error("notify-new-work-order-email: Resend API error for", r.email, res.status, await res.text());
      } catch (err: any) {
        console.error("notify-new-work-order-email: send failed for", r.email, err.message);
      }
    }

    return new Response(JSON.stringify({ ok: true, sent_to: sentCount }), { headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("notify-new-work-order-email error:", err.message);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
