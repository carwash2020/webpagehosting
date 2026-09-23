// Supabase Edge Function: notify-job-message-email
//
// Two-way messaging on a COMPLETED job (2026-09-16), closing the gap
// docs/CLIENT-PORTAL.md flagged: phase 6 built messaging on work
// orders (a not-yet-assessed request); a client with a question about
// a job that's already done had nowhere to ask it. Mirrors
// notify-work-order-message-email closely -- same "one function
// handles both directions" shape, same Resend/push channels -- just
// pointed at client_portal_job_messages/client_portal_jobs instead of
// the work-order tables.
//
// Deploy with: supabase functions deploy notify-job-message-email
// Required secrets (all already configured; no new secrets needed):
//   RESEND_API_KEY, LEAD_EMAIL_FROM
// Auto-provided by the Supabase runtime (no configuration needed):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const LEAD_EMAIL_FROM = Deno.env.get("LEAD_EMAIL_FROM") || "";
const WORKSPACE_URL = "https://www.triplehenterprisesllc.biz/tools/clients.html";
const PORTAL_URL = "https://www.triplehenterprisesllc.biz/portal/jobs.html";
const LOGO_URL = "https://www.triplehenterprisesllc.biz/images/logo-signature-email.png";

function escapeHtml(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Same preference column client_portal_work_order_messages' own
// notify function already checks -- a client who opted out of message
// emails there opted out of this channel of email in general, not
// just the work-order flavor of it.
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

// Same best-effort client push channel notify-work-order-message-email
// already established -- a failure here never blocks the email above.
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
    // Send-Push, exact casing -- see notify-work-order-message-email's
    // identical comment: a lowercase "send-push" is a real, separate,
    // orphaned function, not this one.
    await fetch(`${SUPABASE_URL}/functions/v1/Send-Push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ type: "client-notification", user_id: userId, title, body, url }),
    });
  } catch (err: any) {
    console.error("sendClientPush error (non-fatal):", err.message);
  }
}

function buildClientEmail(clientName: string, title: string, message: string): { html: string; text: string } {
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="light"><title>New reply, Triple H Enterprises</title></head>
<body style="margin:0; padding:0; background:#f4f4f4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f4f4f4" style="padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="max-width:480px; border-radius:10px; overflow:hidden; border:1px solid #e5e5e5;">
<tr><td align="center" bgcolor="#0a0a0a" style="padding:28px 24px;"><img src="${LOGO_URL}" alt="Triple H Enterprises" width="140" style="display:block; border:0;"></td></tr>
<tr><td style="padding:32px 28px 8px; font-family:-apple-system,Helvetica,Arial,sans-serif;">
<h1 style="color:#ff8000; font-size:22px; margin:0 0 20px; text-align:center;">New reply on your job</h1>
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
<h2 style="color: #F5811F; margin-bottom: 4px;">New job message from ${escapeHtml(clientLabel)}</h2>
<p style="color: #666; margin-top: 0;">Re: ${escapeHtml(title)}</p>
<div style="background:#f7f7f7; border-radius:8px; padding:16px; color:#222; font-size:14.5px; line-height:1.5; white-space:pre-wrap; margin-top:16px;">${escapeHtml(message)}</div>
<p style="margin-top: 24px;"><a href="${WORKSPACE_URL}" style="color: #F5811F;">Reply in Dev Tools -&gt; Portal job messages</a></p>
</div>`;
  const text = `New job message from ${clientLabel}\nRe: ${title}\n\n${message}\n\nReply in tools/clients.html (Portal job messages): ${WORKSPACE_URL}`;
  return { html, text };
}

Deno.serve(async (req: Request) => {
  try {
    // Only real caller: the on_job_message_send_email trigger (notify_job_message_email()), which sends the
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
    if (payload.type !== "INSERT" || payload.table !== "client_portal_job_messages") {
      return new Response(JSON.stringify({ ok: false, error: "Unknown type" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const msg = payload.record || {};
    const jobRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_jobs?id=eq.${msg.job_id}&select=title,client_email,client_name`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    if (!jobRes.ok) {
      return new Response(JSON.stringify({ ok: false, error: "Could not load the job." }), { status: 502, headers: { "Content-Type": "application/json" } });
    }
    const [job] = await jobRes.json();
    if (!job) {
      return new Response(JSON.stringify({ ok: false, error: "Job not found." }), { status: 404, headers: { "Content-Type": "application/json" } });
    }

    if (msg.sender_type === "internal") {
      if (!(await clientWantsNotification(job.client_email, "wants_message_emails"))) {
        return new Response(JSON.stringify({ ok: true, skipped: "client opted out of message emails" }), { headers: { "Content-Type": "application/json" } });
      }
      const displayName = (typeof job.client_name === "string" && job.client_name.trim() && job.client_name !== job.client_email) ? job.client_name : job.client_email;
      const { html, text } = buildClientEmail(displayName, job.title || "your job", msg.message);
      const sent = await sendResend(job.client_email, `New reply on your job, Triple H Enterprises`, html, text);
      await sendClientPush(job.client_email, "New reply on your job", `Re: ${job.title || "your job"}`, "/portal/jobs.html");
      return new Response(JSON.stringify({ ok: true, sent_to: sent ? 1 : 0 }), { headers: { "Content-Type": "application/json" } });
    }

    // Client -> internal: same notification_recipients list new-work-
    // order alerts already use ("work_order" notify_type) -- a client
    // message needing a reply is the same category of alert whether it
    // arrives via a work order or a completed job, and there is no UI
    // today to configure a separate recipient list per source.
    const recipientsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/notification_recipients?select=email&notify_types=cs.%5B%22work_order%22%5D`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    if (!recipientsRes.ok) {
      return new Response(JSON.stringify({ ok: false, error: "Could not load notification_recipients" }), { status: 502, headers: { "Content-Type": "application/json" } });
    }
    const recipients: { email: string }[] = await recipientsRes.json();
    const clientLabel = (typeof job.client_name === "string" && job.client_name.trim() && job.client_name !== job.client_email) ? job.client_name : job.client_email;
    const { html, text } = buildInternalEmail(clientLabel, job.title || "a job", msg.message);

    let sentCount = 0;
    for (const r of recipients) {
      const ok = await sendResend(r.email, `New job message from ${clientLabel}`, html, text, job.client_email);
      if (ok) sentCount++;
    }
    return new Response(JSON.stringify({ ok: true, sent_to: sentCount }), { headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("notify-job-message-email error:", err.message);
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
