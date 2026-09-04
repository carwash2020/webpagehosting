// Supabase Edge Function: notify-work-order-message-email
//
// Two-way messaging on work orders (2026-09-03), requested directly as
// item 2 of a roadmap: quotes already let a client ask a question;
// work requests didn't. Fires on every new row in
// client_portal_work_order_messages, in EITHER direction:
//   - sender_type 'client'  -> emails the internal team
//     (notification_recipients, the same list new-work-order alerts use)
//   - sender_type 'internal' -> emails the client on that request
//
// One function handling both directions rather than two separate ones:
// the two paths share almost everything (look up the work order, build
// a similar email), and keeping them together makes it obvious at a
// glance that a message always notifies SOMEONE, not just one side.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const LEAD_EMAIL_FROM = Deno.env.get("LEAD_EMAIL_FROM") || "";
const WORKSPACE_URL = "https://www.triplehenterprisesllc.biz/tools/workspace.html";
const PORTAL_URL = "https://www.triplehenterprisesllc.biz/portal/work-orders.html";
const LOGO_URL = "https://www.triplehenterprisesllc.biz/images/logo-signature-email.png";

function escapeHtml(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Real notification control (2026-09-03), requested directly: "Real
// notification toggles." Only checked on the internal-to-client
// branch below -- a message a CLIENT sends always notifies the
// internal team regardless of any client-side preference (that's
// the whole point of the message existing), so this has nothing to
// do with the client->internal direction at all.
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

async function sendResend(to: string, subject: string, html: string, text: string, replyTo?: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from: LEAD_EMAIL_FROM, to, subject, html, text, reply_to: replyTo }),
  });
  return res.ok;
}

function buildClientEmail(clientName: string, title: string, message: string): { html: string; text: string } {
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="light"><title>New reply, Triple H Enterprises</title></head>
<body style="margin:0; padding:0; background:#f4f4f4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f4f4f4" style="padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="max-width:480px; border-radius:10px; overflow:hidden; border:1px solid #e5e5e5;">
<tr><td align="center" bgcolor="#0a0a0a" style="padding:28px 24px;"><img src="${LOGO_URL}" alt="Triple H Enterprises" width="140" style="display:block; border:0;"></td></tr>
<tr><td style="padding:32px 28px 8px; font-family:-apple-system,Helvetica,Arial,sans-serif;">
<h1 style="color:#ff8000; font-size:22px; margin:0 0 20px; text-align:center;">New reply on your request</h1>
<p style="color:#222; font-size:15px; line-height:1.5; margin:0 0 12px;">Hi ${escapeHtml(clientName)},</p>
<p style="color:#222; font-size:15px; line-height:1.5; margin:0 0 20px;">You have a new message about &ldquo;${escapeHtml(title)}&rdquo;:</p>
</td></tr>
<tr><td style="padding:0 28px;"><div style="background:#f7f7f7; border-radius:8px; padding:16px; color:#222; font-size:14.5px; line-height:1.5; white-space:pre-wrap;">${escapeHtml(message)}</div></td></tr>
<tr><td align="center" style="padding:24px 28px 28px;"><a href="${PORTAL_URL}" style="display:inline-block; background:#ff8000; color:#ffffff; text-decoration:none; font-family:-apple-system,Helvetica,Arial,sans-serif; font-size:15px; font-weight:600; padding:14px 32px; border-radius:8px;">Reply in Your Account</a></td></tr>
<tr><td style="background:#ff8000; height:4px; line-height:4px; font-size:1px;">&nbsp;</td></tr>
<tr><td align="center" style="padding:16px 24px; font-family:-apple-system,Helvetica,Arial,sans-serif;"><p style="color:#999; font-size:12px; margin:0;">(435) 414-1667 &middot; triplehenterprisesllc.biz</p></td></tr>
</table></td></tr></table></body></html>`;
  const text = `Hi ${clientName},\n\nYou have a new message about "${title}":\n\n${message}\n\nReply in your account: ${PORTAL_URL}\n\nTriple H Enterprises\n(435) 414-1667, triplehenterprisesllc.biz`;
  return { html, text };
}

function buildInternalEmail(clientLabel: string, title: string, message: string): { html: string; text: string } {
  const html = `<div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto;">
<h2 style="color: #F5811F; margin-bottom: 4px;">New message from ${escapeHtml(clientLabel)}</h2>
<p style="color: #666; margin-top: 0;">Re: ${escapeHtml(title)}</p>
<div style="background:#f7f7f7; border-radius:8px; padding:16px; color:#222; font-size:14.5px; line-height:1.5; white-space:pre-wrap; margin-top:16px;">${escapeHtml(message)}</div>
<p style="margin-top: 24px;"><a href="${WORKSPACE_URL}" style="color: #F5811F;">Reply in Workspace</a></p>
</div>`;
  const text = `New message from ${clientLabel}\nRe: ${title}\n\n${message}\n\nReply in Workspace: ${WORKSPACE_URL}`;
  return { html, text };
}

Deno.serve(async (req: Request) => {
  try {
    const payload = await req.json();
    if (payload.type !== "INSERT" || payload.table !== "client_portal_work_order_messages") {
      return new Response(JSON.stringify({ ok: false, error: "Unknown type" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const msg = payload.record || {};
    const woRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_work_orders?id=eq.${msg.work_order_id}&select=title,client_email,client_name`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    if (!woRes.ok) {
      return new Response(JSON.stringify({ ok: false, error: "Could not load the work order." }), { status: 502, headers: { "Content-Type": "application/json" } });
    }
    const [wo] = await woRes.json();
    if (!wo) {
      return new Response(JSON.stringify({ ok: false, error: "Work order not found." }), { status: 404, headers: { "Content-Type": "application/json" } });
    }

    if (msg.sender_type === "internal") {
      // Internal -> client: one email, to the one client on this request.
      if (!(await clientWantsNotification(wo.client_email, "wants_message_emails"))) {
        return new Response(JSON.stringify({ ok: true, skipped: "client opted out of message emails" }), { headers: { "Content-Type": "application/json" } });
      }
      const displayName = (typeof wo.client_name === "string" && wo.client_name.trim() && wo.client_name !== wo.client_email) ? wo.client_name : wo.client_email;
      const { html, text } = buildClientEmail(displayName, wo.title || "your request", msg.message);
      const sent = await sendResend(wo.client_email, `New reply on your request, Triple H Enterprises`, html, text);
      return new Response(JSON.stringify({ ok: true, sent_to: sent ? 1 : 0 }), { headers: { "Content-Type": "application/json" } });
    }

    // Client -> internal: every address on the notification list, same
    // as new-work-order alerts -- reused directly rather than a second,
    // separately-maintained recipient list for the same audience.
    const recipientsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/notification_recipients?select=email&notify_types=cs.%7B%22work_order%22%7D`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    if (!recipientsRes.ok) {
      return new Response(JSON.stringify({ ok: false, error: "Could not load notification_recipients" }), { status: 502, headers: { "Content-Type": "application/json" } });
    }
    const recipients: { email: string }[] = await recipientsRes.json();
    const clientLabel = (typeof wo.client_name === "string" && wo.client_name.trim() && wo.client_name !== wo.client_email) ? wo.client_name : wo.client_email;
    const { html, text } = buildInternalEmail(clientLabel, wo.title || "a work order", msg.message);

    let sentCount = 0;
    for (const r of recipients) {
      const ok = await sendResend(r.email, `New message from ${clientLabel}`, html, text, wo.client_email);
      if (ok) sentCount++;
    }
    return new Response(JSON.stringify({ ok: true, sent_to: sentCount }), { headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("notify-work-order-message-email error:", err.message);
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
