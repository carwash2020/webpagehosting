// Supabase Edge Function: send-quote-followup
//
// Automation pass (2026-09-16), continuing the invoice/review/schedule/
// email/report audit: an unconverted quote already produced an internal
// push notification after 14 days (checkUnconvertedQuotes in
// send-push) -- but exactly like the overdue-invoice gap closed
// earlier the same day, nothing ever told the CLIENT their quote was
// still sitting there waiting on a decision. They see it once in the
// portal when it's created and then nothing follows up if they never
// come back to Approve or Decline it.
//
// Queries client_portal_quotes directly (not the workspace_sync blob
// send-push reads from) -- it's the real client-facing source of
// truth: every row already has client_email, a real 'pending' /
// 'approved' / 'declined' status (set by respond-to-quote), and is
// exactly the population that CAN be reached by email in the first
// place (a quote never portal-synced has no client_email to send to).
//
// One nudge per quote, at 7 days pending (earlier than the internal
// 14-day alert, on purpose -- give the client a chance to act before
// Steve gets told to chase it down himself). Reuses the SAME
// de-duplication mechanism (notification_log) and the SAME
// "wants_invoice_quote_emails" preference already established for
// send-payment-reminder and send-invoice-notification -- a quote is
// the same category of email to a client as an invoice.
//
// Deploy with: supabase functions deploy send-quote-followup
// Required secrets (all already configured; no new secrets needed):
//   RESEND_API_KEY, LEAD_EMAIL_FROM, LEAD_EMAIL_TO
// Auto-provided by the Supabase runtime (no configuration needed):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const LEAD_EMAIL_FROM = Deno.env.get("LEAD_EMAIL_FROM") || "";
const LEAD_EMAIL_TO = (Deno.env.get("LEAD_EMAIL_TO") || "")
  .split(",")
  .map((addr) => addr.trim())
  .filter((addr) => addr.length > 0);
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const LOGO_URL = "https://www.triplehenterprisesllc.biz/images/logo-signature-email.png";

// Earlier than send-push's own 14-day internal "Quote Never Followed
// Up" alert to Steve, on purpose -- see file header.
const FOLLOWUP_DAYS = 7;

function escapeHtml(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(n: number): string {
  return "$" + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
}

async function supabaseRequest(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      ...(init.headers || {}),
    },
  });
}

async function fetchPendingQuotes(): Promise<any[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - FOLLOWUP_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const res = await supabaseRequest(
    `/rest/v1/client_portal_quotes?select=id,source_quote_id,client_email,client_name,quote_number,quote_date,total&status=eq.pending&quote_date=lte.${cutoffStr}`,
  );
  if (!res.ok) return [];
  return res.json();
}

async function alreadySent(itemKey: string): Promise<boolean> {
  const res = await supabaseRequest(
    `/rest/v1/notification_log?notif_type=eq.quote-followup-email&item_key=eq.${encodeURIComponent(itemKey)}&select=id&limit=1`,
  );
  if (!res.ok) return false;
  const rows = await res.json();
  return rows.length > 0;
}

async function markSent(itemKey: string): Promise<void> {
  await supabaseRequest("/rest/v1/notification_log?on_conflict=notif_type,item_key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ notif_type: "quote-followup-email", item_key: itemKey, sent_at: new Date().toISOString() }),
  });
}

// Same preference column/semantics send-invoice-notification and
// send-payment-reminder already established.
async function clientWantsEmail(email: string): Promise<boolean> {
  const res = await supabaseRequest(
    `/rest/v1/client_notification_preferences?client_email=eq.${encodeURIComponent(email.toLowerCase())}&select=wants_invoice_quote_emails&limit=1`,
  );
  if (!res.ok) return true;
  const rows = await res.json();
  if (!rows.length) return true;
  return rows[0].wants_invoice_quote_emails !== false;
}

function buildFollowupEmailHtml(quote: Record<string, unknown>): string {
  const firstName = quote.client_name ? String(quote.client_name).trim().split(/\s+/)[0] : "";
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi there,";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Still deciding on your Triple H Enterprises quote?</title>
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
            <h1 style="color: #ff8000; font-size: 22px; margin: 0 0 20px; text-align: center;">Still interested?</h1>
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 20px;">${greeting}</p>
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 8px;">We sent over a quote a little while back and haven't heard back yet. No rush -- just wanted to check in and see if you have any questions, or if you're ready to move forward.</p>
          </td>
        </tr>
        <tr>
          <td style="padding: 0 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #777; font-size: 14px; width: 130px;">Quote #</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 14px; color: #222;">${escapeHtml(quote.quote_number || quote.source_quote_id)}</td></tr>
              <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #777; font-size: 14px;">Estimated total</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 14px; color: #222; font-weight: bold;">${escapeHtml(money(Number(quote.total)))}</td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding: 20px 28px 28px; font-family: -apple-system, Helvetica, Arial, sans-serif;">
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 20px;"><a href="https://www.triplehenterprisesllc.biz/portal/quotes.html" style="color: #ff8000;">View and respond to your quote in your client portal</a>, or reply to this email if you have any questions.</p>
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0;">Thanks,<br><strong>Triple H Enterprises</strong></p>
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

function buildFollowupEmailText(quote: Record<string, unknown>): string {
  const firstName = quote.client_name ? String(quote.client_name).trim().split(/\s+/)[0] : "";
  return [
    firstName ? `Hi ${firstName},` : "Hi there,",
    "",
    "We sent over a quote a little while back and haven't heard back yet. No rush -- just wanted to check in and see if you have any questions, or if you're ready to move forward.",
    "",
    `Quote #: ${quote.quote_number || quote.source_quote_id}`,
    `Estimated total: ${money(Number(quote.total))}`,
    "",
    "View and respond to your quote in your client portal: https://www.triplehenterprisesllc.biz/portal/quotes.html",
    "Or reply to this email if you have any questions.",
    "",
    "Thanks,",
    "Triple H Enterprises",
    "(435) 414-1667, triplehenterprisesllc.biz",
  ].join("\n");
}

async function sendFollowup(quote: Record<string, unknown>): Promise<boolean> {
  const clientEmail = quote.client_email ? String(quote.client_email).trim() : "";
  if (!clientEmail) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: `Triple H Enterprises <${LEAD_EMAIL_FROM}>`,
        to: clientEmail,
        ...(LEAD_EMAIL_TO.length ? { reply_to: LEAD_EMAIL_TO } : {}),
        subject: "Still deciding on your Triple H Enterprises quote?",
        html: buildFollowupEmailHtml(quote),
        text: buildFollowupEmailText(quote),
      }),
    });
    if (!res.ok) {
      console.error("sendFollowup: Resend API error:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (err: any) {
    console.error("sendFollowup error:", err.message);
    return false;
  }
}

Deno.serve(async (req: Request) => {
  try {
    // This function has no per-user auth model -- its only real caller is
    // the send-quote-followup-daily cron (see
    // sql/infra/add_quote_followup_email_cron.sql), which already
    // authenticates with the service_role key. Without this check, the
    // public anon key embedded in every page's HTML would validly pass
    // Supabase's platform-level verify_jwt (it only checks a JWT's
    // signature, not its role) and let anyone POST here directly, firing
    // real quote-followup emails at pending clients on demand -- the same
    // auth-check regression already fixed once for uptime-alert (see
    // uptime-alert-auth.test.js).
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (token !== SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const quotes = await fetchPendingQuotes();
    let sent = 0;
    let checked = 0;

    for (const quote of quotes) {
      const clientEmail = quote.client_email ? String(quote.client_email).trim() : "";
      if (!clientEmail) continue;
      checked++;

      const itemKey = String(quote.source_quote_id);
      if (await alreadySent(itemKey)) continue;
      if (!(await clientWantsEmail(clientEmail))) continue;

      const ok = await sendFollowup(quote);
      if (ok) {
        await markSent(itemKey);
        sent++;
      }
    }

    return new Response(JSON.stringify({ ok: true, checked, sent }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("send-quote-followup error:", err.message);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
