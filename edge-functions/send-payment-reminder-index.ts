// Supabase Edge Function: send-payment-reminder
//
// Automation pass (2026-09-16): "automation of invoices... look at
// what we currently have and find ways to make it better." Overdue
// invoices already trigger an internal push notification
// (checkOverdueInvoices in send-push) and show up on the Dashboard's
// Outstanding/Overdue cards -- but neither of those ever reaches the
// CLIENT. Steve still has to notice it himself and follow up by hand
// every time. This closes that gap: an automated email straight to
// the client, at escalating checkpoints, reusing the exact same
// Resend account/secrets as every other client-facing email in this
// project (LEAD_EMAIL_FROM, LEAD_EMAIL_TO for Reply-To) -- no new
// signup, no new secret.
//
// Three checkpoints, not one: 3 days overdue (a friendly nudge -- most
// people just forgot), 7 days (a clear restated balance), 14 days (a
// firmer note that mentions calling to check in). Each invoice gets at
// MOST one email per run, at whichever checkpoint is the highest one
// currently crossed that hasn't already been sent -- so a run after a
// gap (e.g. cron was down a week) never fires 3 backlogged emails to
// the same client in one day, and a checkpoint already sent is never
// re-sent by design (this is a fixed 3-rung ladder, not a repeating
// nag -- once "14 days" has gone out, nothing further is automated;
// that's the point where a human should actually call).
//
// Reuses the SAME de-duplication mechanism send-push already
// established for invoice-overdue push notifications
// (notification_log, keyed on notif_type+item_key) rather than adding
// a new table -- notif_type is one of invoice-reminder-3d /
// invoice-reminder-7d / invoice-reminder-14d, item_key is the
// invoice's own id. Existence alone is checked (not a resend
// interval): each of the 3 notif_types is meant to fire exactly once
// per invoice, ever.
//
// Respects the SAME "wants_invoice_quote_emails" preference a client
// already controls in Portal Settings -- reuses
// send-invoice-notification's exact column name/semantics rather than
// inventing a separate opt-out only this feature would respect.
//
// Deploy with: supabase functions deploy send-payment-reminder
// Required secrets (all already configured for the lead/booking/
// appointment-reminder email pipeline; no new secrets needed):
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

// Same publicly-hosted, email-client-safe logo already used by every
// other client-facing email in this project.
const LOGO_URL = "https://www.triplehenterprisesllc.biz/images/logo-signature-email.png";

// Ascending -- iteration order matters below (see pickStage()).
const STAGES = [3, 7, 14] as const;
type Stage = (typeof STAGES)[number];

// Matches TERM_DAYS in workspace.html / send-push-index.ts exactly --
// keep these in sync if invoice terms options ever change.
const TERM_DAYS: Record<string, number> = { "Due Upon Receipt": 0, "Net 15": 15, "Net 30": 30 };

function escapeHtml(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(n: number): string {
  return "$" + (Math.round(n * 100) / 100).toFixed(2);
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

function safeParse(jsonString: string | undefined, fallback: any) {
  try {
    return JSON.parse(jsonString || "null") ?? fallback;
  } catch (_e) {
    return fallback;
  }
}

async function getSyncedInvoices(): Promise<any[]> {
  const res = await supabaseRequest(`/rest/v1/workspace_sync?select=data&limit=1`);
  if (!res.ok) return [];
  const rows = await res.json();
  if (!rows.length) return [];
  return safeParse(rows[0].data?.th_invoices, []);
}

// Mirrors workspace.html's getPaidAmount/getRemainingCents exactly --
// same whole-cents rounding, same fallback for invoices predating
// partial-payment tracking (paidAmount didn't exist yet, only a plain
// `paid` boolean).
function toCents(n: unknown): number {
  return Math.round((Number(n) || 0) * 100);
}
function getPaidAmount(invoice: Record<string, unknown>): number {
  if (invoice.paidAmount !== undefined && invoice.paidAmount !== null) return Number(invoice.paidAmount) || 0;
  return invoice.paid ? Number(invoice.total) || 0 : 0;
}
function getRemainingCents(invoice: Record<string, unknown>): number {
  return Math.max(0, toCents(invoice.total) - toCents(getPaidAmount(invoice)));
}

function daysOverdue(invoice: Record<string, unknown>): number | null {
  const base = new Date((invoice.date as string) + "T00:00:00");
  if (isNaN(base.getTime())) return null;
  const termDays = TERM_DAYS[invoice.terms as string] ?? 15;
  const dueDate = new Date(base.getTime() + termDays * 24 * 60 * 60 * 1000);
  const today = new Date(new Date().toDateString());
  return Math.floor((today.getTime() - dueDate.getTime()) / (24 * 60 * 60 * 1000));
}

// Highest checkpoint currently crossed -- see the file header for why
// this is "highest, not every one crossed."
function pickStage(overdueDays: number): Stage | null {
  let picked: Stage | null = null;
  for (const s of STAGES) {
    if (overdueDays >= s) picked = s;
  }
  return picked;
}

async function alreadySent(notifType: string, itemKey: string): Promise<boolean> {
  const res = await supabaseRequest(
    `/rest/v1/notification_log?notif_type=eq.${notifType}&item_key=eq.${encodeURIComponent(itemKey)}&select=id&limit=1`,
  );
  if (!res.ok) return false;
  const rows = await res.json();
  return rows.length > 0;
}

async function markSent(notifType: string, itemKey: string): Promise<void> {
  await supabaseRequest("/rest/v1/notification_log?on_conflict=notif_type,item_key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ notif_type: notifType, item_key: itemKey, sent_at: new Date().toISOString() }),
  });
}

// Same preference column/semantics send-invoice-notification already
// established -- a client who opted out of invoice/quote emails in
// Portal Settings shouldn't get a payment reminder either; it's the
// same category of email to them.
async function clientWantsEmail(email: string): Promise<boolean> {
  const res = await supabaseRequest(
    `/rest/v1/client_notification_preferences?client_email=eq.${encodeURIComponent(email.toLowerCase())}&select=wants_invoice_quote_emails&limit=1`,
  );
  if (!res.ok) return true;
  const rows = await res.json();
  if (!rows.length) return true;
  return rows[0].wants_invoice_quote_emails !== false;
}

const STAGE_COPY: Record<Stage, { subject: string; heading: string; body: string }> = {
  3: {
    subject: "Friendly reminder: invoice from Triple H Enterprises",
    heading: "Just a friendly reminder",
    body: "This is a quick reminder that the invoice below is now past its due date. If you've already sent payment, thank you -- please disregard this note.",
  },
  7: {
    subject: "Reminder: payment due on your Triple H Enterprises invoice",
    heading: "A reminder on your balance",
    body: "The invoice below is still showing as unpaid. If something's holding it up or you have a question about the charge, just reply to this email or give us a call -- happy to help sort it out.",
  },
  14: {
    subject: "Checking in: your Triple H Enterprises invoice is still open",
    heading: "Checking in on your balance",
    body: "This invoice has been open for a couple weeks now. We'll likely give you a call to check in, but wanted to send one more reminder in the meantime in case it slipped through the cracks.",
  },
};

function buildReminderEmailHtml(invoice: Record<string, unknown>, stage: Stage, remaining: number): string {
  const copy = STAGE_COPY[stage];
  const firstName = invoice.clientName ? String(invoice.clientName).trim().split(/\s+/)[0] : "";
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi there,";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(copy.subject)}</title>
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
            <h1 style="color: #ff8000; font-size: 22px; margin: 0 0 20px; text-align: center;">${escapeHtml(copy.heading)}</h1>
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 20px;">${greeting}</p>
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 8px;">${escapeHtml(copy.body)}</p>
          </td>
        </tr>
        <tr>
          <td style="padding: 0 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #777; font-size: 14px; width: 130px;">Invoice #</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 14px; color: #222;">${escapeHtml(invoice.invoiceNumber || invoice.id)}</td></tr>
              <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #777; font-size: 14px;">Amount due</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 14px; color: #222; font-weight: bold;">${escapeHtml(money(remaining))}</td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding: 20px 28px 28px; font-family: -apple-system, Helvetica, Arial, sans-serif;">
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 20px;"><a href="https://www.triplehenterprisesllc.biz/portal/dashboard.html" style="color: #ff8000;">View and pay this invoice in your client portal</a>, or reply to this email if you have any questions.</p>
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

function buildReminderEmailText(invoice: Record<string, unknown>, stage: Stage, remaining: number): string {
  const copy = STAGE_COPY[stage];
  const firstName = invoice.clientName ? String(invoice.clientName).trim().split(/\s+/)[0] : "";
  return [
    firstName ? `Hi ${firstName},` : "Hi there,",
    "",
    copy.body,
    "",
    `Invoice #: ${invoice.invoiceNumber || invoice.id}`,
    `Amount due: ${money(remaining)}`,
    "",
    "View and pay this invoice in your client portal: https://www.triplehenterprisesllc.biz/portal/dashboard.html",
    "Or reply to this email if you have any questions.",
    "",
    "Thanks,",
    "Triple H Enterprises",
    "(435) 414-1667, triplehenterprisesllc.biz",
  ].join("\n");
}

async function sendReminder(invoice: Record<string, unknown>, stage: Stage, remaining: number): Promise<boolean> {
  const clientEmail = invoice.clientEmail ? String(invoice.clientEmail).trim() : "";
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
        subject: STAGE_COPY[stage].subject,
        html: buildReminderEmailHtml(invoice, stage, remaining),
        text: buildReminderEmailText(invoice, stage, remaining),
      }),
    });
    if (!res.ok) {
      console.error("sendReminder: Resend API error:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (err: any) {
    console.error("sendReminder error:", err.message);
    return false;
  }
}

Deno.serve(async (_req: Request) => {
  try {
    const invoices = await getSyncedInvoices();
    let sent = 0;
    let checked = 0;

    for (const invoice of invoices) {
      const remainingCents = getRemainingCents(invoice);
      if (remainingCents <= 0) continue; // paid in full -- nothing to remind about
      const overdue = daysOverdue(invoice);
      if (overdue === null) continue;
      const stage = pickStage(overdue);
      if (stage === null) continue; // not yet at the first (3-day) checkpoint

      checked++;
      const clientEmail = invoice.clientEmail ? String(invoice.clientEmail).trim() : "";
      if (!clientEmail) continue;

      const notifType = `invoice-reminder-${stage}d`;
      const itemKey = String(invoice.id);
      if (await alreadySent(notifType, itemKey)) continue;
      if (!(await clientWantsEmail(clientEmail))) continue;

      const ok = await sendReminder(invoice, stage, remainingCents / 100);
      if (ok) {
        await markSent(notifType, itemKey);
        sent++;
      }
    }

    return new Response(JSON.stringify({ ok: true, checked, sent }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("send-payment-reminder error:", err.message);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
