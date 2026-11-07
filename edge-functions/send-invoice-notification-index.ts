// Supabase Edge Function: send-invoice-notification
//
// Sends the actual invoice email for every invoice sync, not just
// existing portal clients (2026-10-23 bug fix -- see
// docs/specialist-logs/bugfix.md and send-quote-notification-index.ts's
// identical fix, applied here the same way at the user's explicit
// request). Root cause: sync-invoice-to-portal called send-invite (a
// bare "create your account" email with no mention of the invoice at
// all) for a brand-new client's first-ever invoice, instead of
// delivering the actual invoice -- a client got an account-setup email,
// never anything saying what they owed or why. sync-invoice-to-portal
// now calls this function unconditionally and the actual invoice PDF is
// attached directly via Resend (`pdf_base64`/`pdf_filename`, both
// optional -- resendInvoiceToClient's unchanged-email resend path calls
// this function too, without regenerating the PDF, so the PDF-less
// fallback copy below still exists for that case).
// `has_portal_account` controls whether the "View and Pay" link is
// shown at all -- a brand-new client has no password set (no invite was
// ever sent), so pointing them at a login page they can't get into
// would be a dead end; they can still pay by whatever method Steve
// arranges directly (cash, check, Venmo, Cash App, or a separate
// Stripe-dashboard invoice link), same as before the portal existed.
//
// Same Resend-based, branded-email pattern as send-invite/
// send-booking-email -- no new secrets needed beyond what those
// already use (RESEND_API_KEY, LEAD_EMAIL_FROM). Same authorization
// pattern as every other privileged function in this project too --
// verify_jwt:true alone only proves the caller has SOME validly-
// signed token (which the public anon key itself has); it doesn't
// prove the caller is actually allowed to send arbitrary emails on
// the business's behalf, so that's checked explicitly below.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const LEAD_EMAIL_FROM = Deno.env.get("LEAD_EMAIL_FROM") || "";
const PORTAL_URL = "https://www.triplehenterprisesllc.biz/portal/dashboard.html";
// Steve and Connor get a copy of every invoice email (2026-11-04, handoff
// §3A and the approved "Invoice email" design; this was Steve only, and
// only when a PDF was attached) -- BCC'd on the same send, so it's the
// exact email the client received, not a re-composed copy that could drift.
const STEVE_EMAIL = "steve@triplehenterprisesllc.biz";
const CONNOR_EMAIL = "connor@triplehenterprisesllc.biz";
const LOGO_URL = "https://www.triplehenterprisesllc.biz/images/logo-signature-email.png";

const ALLOWED_ORIGIN = "https://www.triplehenterprisesllc.biz";
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function decodeJwtPayload(token: string): { email?: string; role?: string; sub?: string; aal?: string; session_id?: string } {
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch {
    return {};
  }
}

// Granular permission expansion (2026-09-02): reads can_manage_invoices
// directly off account_roles -- matches invoice-generator.html's own
// gate exactly (Invoices & Quotes both live in that one tool).
// can_manage_business_finances (the old, broader checkbox this used
// to read) no longer exists as a column at all.
async function callerCanManageInvoices(email: string): Promise<boolean> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/account_roles?email=eq.${encodeURIComponent(email.toLowerCase())}&select=can_manage_invoices`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  if (!res.ok) return false;
  const rows = await res.json();
  if (!rows.length) return false;
  return rows[0].can_manage_invoices === true;
}

// Real notification control (2026-09-03), requested directly: "Real
// notification toggles." Defaults to wanting the email (true) if the
// client has never visited Settings and set a preference at all --
// matching this table's own column default, so a client who's never
// touched this setting keeps getting the same transactional emails
// they always did.
// Fix plan RP3.26 (2026-11-07): fails CLOSED. true = send, false = the
// client opted out, null = the preference couldn't be read (database
// error) -- the caller skips the email and says so. Only a MISSING row
// means "wants it" (matching the column default, so a client who never
// opened Settings keeps getting the same transactional emails).
async function clientWantsNotification(email: string, column: string): Promise<boolean | null> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/client_notification_preferences?client_email=eq.${encodeURIComponent(email.toLowerCase())}&select=${column}&limit=1`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    if (!res.ok) {
      console.error(`send-invoice-notification: preferences lookup failed (HTTP ${res.status}); not emailing`);
      return null;
    }
    const rows = await res.json();
    if (!Array.isArray(rows)) return null;
    if (!rows.length) return true;
    return rows[0][column] !== false;
  } catch (err: any) {
    console.error(`send-invoice-notification: preferences lookup failed (${err?.message || err}); not emailing`);
    return null;
  }
}

// Fix plan RP3.25 (2026-11-07): a per-caller cap on this staff send path,
// so a compromised staff session can't spam clients. One hit against
// public.rate_limit_take (sql/security/group5_backend_hardening.sql), keyed
// by the caller's email. Fails OPEN (logged) if the limiter can't be
// reached: a real send by staff is worth more than the cap.
const STAFF_SEND_LIMIT_PER_HOUR = 60;
async function staffSendAllowed(callerEmail: string): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rate_limit_take`, {
      method: "POST",
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_bucket: "staff-send:send-invoice-notification", p_key: String(callerEmail || "").toLowerCase(), p_max: STAFF_SEND_LIMIT_PER_HOUR, p_window_seconds: 3600 }),
    });
    if (!res.ok) {
      console.error(`send-invoice-notification: rate_limit_take failed (HTTP ${res.status}); allowing the send`);
      return true;
    }
    return (await res.json()) !== false;
  } catch (err: any) {
    console.error(`send-invoice-notification: rate_limit_take failed (${err?.message || err}); allowing the send`);
    return true;
  }
}
const TOO_MANY_SENDS_ERROR = "Too many emails sent from this account in the last hour. Wait a while and try again.";

function escapeHtml(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Client push (2026-09-04), requested directly: "finish push (3
// remaining triggers)" -- the fourth of four events that already
// send an email now also fires a push, using the exact same pattern
// already proven in notify-work-order-message-email. push_subscriptions
// is keyed to a real auth.users id, not an email, so the client's id
// needs looking up via GoTrue's own admin endpoint first. A missing
// subscription is silent and non-fatal -- push is a best-effort
// additional channel, never a required step.
// Exact, case-insensitive email match (2026-09-22 fix) through
// get_auth_user_id_by_email() -- service role only, see
// sql/security/scope_push_broadcasts_to_internal_accounts.sql. This used
// to call GET /auth/v1/admin/users?email=..., but GoTrue's admin list
// endpoint has no `email` filter (only page/per_page/filter): it ignored
// the parameter and returned the first page of ALL users, newest first,
// so users[0] was whichever account was created most recently -- not
// this client. A client push could have landed on someone else's phone.
// No exact match now means null, and the push is simply skipped.
async function getUserIdByEmail(email: string): Promise<string | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_auth_user_id_by_email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    body: JSON.stringify({ p_email: email }),
  });
  if (!res.ok) return null;
  const id = await res.json();
  return typeof id === "string" && id ? id : null;
}

async function sendClientPush(email: string, title: string, body: string, url: string) {
  try {
    const userId = await getUserIdByEmail(email);
    if (!userId) return;
    // Send-Push, exact casing -- Supabase function slugs are
    // case-sensitive; a lowercase call created a genuinely separate,
    // orphaned function during an earlier build. See that incident's
    // own history in notify-work-order-message-email-index.ts.
    await fetch(`${SUPABASE_URL}/functions/v1/Send-Push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ type: "client-notification", user_id: userId, title, body, url }),
    });
  } catch (err: any) {
    console.error("sendClientPush error (non-fatal):", err.message);
  }
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

// The pay link (2026-11-04, handoff §3A, approved "Invoice email" design):
// /pay/<invoice number>-<code>, the code made by the invoice generator and
// stored on the portal row (pay_token). guest-pay checks it; a code of the
// wrong shape is simply not linked.
const PAY_BASE = "https://www.triplehenterprisesllc.biz/pay/";
const PAY_TOKEN_SHAPE = /^[a-hjkmnp-z2-9]{10,40}$/;
function payUrlFor(invoiceNumber: string, token: unknown): string | null {
  if (typeof token !== "string" || !PAY_TOKEN_SHAPE.test(token)) return null;
  return `${PAY_BASE}${encodeURIComponent(invoiceNumber)}-${token}`;
}

function longDate(iso: string | null): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
}
function shortDate(iso: string | null): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}
function firstName(name: string): string {
  return String(name || "").trim().split(/\s+/)[0] || name;
}

type EmailParts = {
  clientName: string; invoiceNumber: string; total: number; description: string | null;
  hasPdf: boolean; hasPortalAccount: boolean; payUrl: string | null; dueDate: string | null; terms: string | null;
};

function emailSubject(p: EmailParts): string {
  const due = shortDate(p.dueDate);
  return `Invoice ${p.invoiceNumber} from Triple H Enterprises · ${formatCurrency(p.total)}${due ? ` due ${due}` : ""}`;
}

function buildEmailHtml(p: EmailParts): string {
  const heading = "Your invoice from Triple H";
  const intro = `Hi ${firstName(p.clientName)}, thanks for choosing us. Your invoice is below` +
    (p.hasPdf ? " and attached as a PDF." : ".") +
    (p.payUrl ? " You can pay it right from this email, no account needed." : "");
  const font = "font-family: -apple-system, Helvetica, Arial, sans-serif;";
  const row = (label: string, value: string, strong = false) =>
    `<tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #777; font-size: 14px; width: 110px; ${font}">${label}</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 14px; color: #222; ${strong ? "font-weight: 600;" : ""} ${font}">${value}</td></tr>`;
  const due = longDate(p.dueDate);
  const payText = p.payUrl ? p.payUrl.replace(/^https:\/\/www\./, "") : "";
  const cta = p.payUrl
    ? `<tr>
          <td align="center" style="padding: 24px 28px 8px;">
            <a href="${escapeHtml(p.payUrl)}" style="display: inline-block; background: #ff8000; color: #ffffff; text-decoration: none; ${font} font-size: 15px; font-weight: 600; padding: 14px 32px; border-radius: 8px;">Pay this invoice &middot; ${escapeHtml(formatCurrency(p.total))}</a>
          </td>
        </tr>
        <tr>
          <td style="padding: 8px 28px 0; ${font}">
            <p style="color: #555; font-size: 13px; line-height: 1.5; margin: 0 0 10px; text-align: center;">Or copy this link into your browser: <a href="${escapeHtml(p.payUrl)}" style="color: #1a6fd1; text-decoration: underline; word-break: break-all;">${escapeHtml(payText)}</a></p>
            <p style="color: #777; font-size: 12px; line-height: 1.5; margin: 0 0 4px; text-align: center;">No account needed: card or bank, secure checkout by Stripe. The last part of the link is this invoice's own code, so only you can open it.</p>
          </td>
        </tr>`
    : p.hasPortalAccount
    ? `<tr>
          <td align="center" style="padding: 24px 28px 8px;">
            <a href="${PORTAL_URL}" style="display: inline-block; background: #ff8000; color: #ffffff; text-decoration: none; ${font} font-size: 15px; font-weight: 600; padding: 14px 32px; border-radius: 8px;">View and Pay</a>
          </td>
        </tr>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(heading)}, Triple H Enterprises</title>
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
          <td style="padding: 32px 28px 8px; ${font}">
            <h1 style="color: #ff8000; font-size: 22px; margin: 0 0 20px; text-align: center;">${escapeHtml(heading)}</h1>
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 20px;">${escapeHtml(intro)}</p>
          </td>
        </tr>
        <tr>
          <td style="padding: 0 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              ${row("Invoice", escapeHtml(p.invoiceNumber))}
              ${p.description ? row("For", escapeHtml(p.description)) : ""}
              ${due ? row("Due", escapeHtml(due + (p.terms ? ` (${p.terms})` : ""))) : ""}
              ${row("Amount due", escapeHtml(formatCurrency(p.total)), true)}
            </table>
          </td>
        </tr>
        ${cta}
        <tr>
          <td style="padding: 16px 28px 24px; ${font}">
            <p style="color: #555; font-size: 13px; line-height: 1.5; margin: 0;">Prefer cash or check? Pay Steve in person and mention invoice ${escapeHtml(p.invoiceNumber)}. Questions? Call or text (435) 414-1667.</p>
          </td>
        </tr>
        <tr>
          <td style="background: #ff8000; height: 4px; line-height: 4px; font-size: 1px;">&nbsp;</td>
        </tr>
        <tr>
          <td align="center" style="padding: 16px 24px; ${font}">
            <p style="color: #999; font-size: 12px; margin: 0;">Triple H Enterprises LLC &middot; St. George, Utah</p>
            <p style="color: #999; font-size: 12px; margin: 4px 0 0;">(435) 414-1667 &middot; triplehenterprisesllc.biz</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function buildEmailText(p: EmailParts): string {
  const due = longDate(p.dueDate);
  return [
    "Your invoice from Triple H Enterprises",
    "",
    `Hi ${firstName(p.clientName)},`,
    p.hasPdf ? "Your invoice is attached to this email as a PDF." : "",
    "",
    `Invoice ${p.invoiceNumber}${p.description ? ` · ${p.description}` : ""}`,
    `Amount due: ${formatCurrency(p.total)}${due ? ` · Due ${due}` : ""}`,
    "",
    p.payUrl ? `Pay this invoice (no account needed): ${p.payUrl}` : (p.hasPortalAccount ? `View and pay: ${PORTAL_URL}` : ""),
    `Prefer cash or check? Pay Steve in person and mention invoice ${p.invoiceNumber}.`,
    "",
    "(435) 414-1667 · triplehenterprisesllc.biz",
  ].filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== "")).join("\n");
}

// Two-factor gate (2026-09-25, docs/ACTION-ITEMS.md #13). An internal
// account that has an authenticator enrolled must call with a session that
// passed it (aal2); its password alone (aal1) is not enough. The rule and
// its dry-run/enforce switch live in the database, in
// check_internal_mfa_for_edge_function()
// (sql/security/enforce_internal_mfa_server_side.sql). The claims come from
// the caller's JWT, which the gateway has already verified (verify_jwt).
// Fails closed if the check itself can't be made.
const MFA_REQUIRED_ERROR =
  "Two-factor sign-in required: sign out of the Workspace and sign back in with your authenticator code.";
async function callerPassesInternalMfa(
  claims: { sub?: string; email?: string; aal?: string; session_id?: string },
  fn: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_internal_mfa_for_edge_function`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_user_id: claims.sub ?? null,
        p_email: claims.email ?? null,
        p_session_id: claims.session_id ?? null,
        p_aal: claims.aal ?? null,
        p_function: fn,
      }),
    });
    if (!res.ok) return false;
    return (await res.json()) === true;
  } catch {
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const claims = decodeJwtPayload(token);

    if (claims.role !== "authenticated" || !claims.email) {
      return json({ ok: false, error: "Must be signed in with a real session." }, 401);
    }
    if (!(await callerCanManageInvoices(claims.email))) {
      return json({ ok: false, error: "This account can't manage invoices." }, 403);
    }
    if (!(await callerPassesInternalMfa(claims, "send-invoice-notification"))) {
      return json({ ok: false, error: MFA_REQUIRED_ERROR, code: "mfa_required" }, 403);
    }

    const {
      client_email, client_name, invoice_number, total, description,
      pdf_base64, pdf_filename, has_portal_account, pay_token, due_date, terms,
    } = await req.json();
    if (
      typeof client_email !== "string" || !client_email.includes("@") ||
      typeof invoice_number !== "string" || typeof total !== "number"
    ) {
      return json({ ok: false, error: "Missing or invalid fields." }, 400);
    }
    if (pdf_base64 !== undefined && pdf_base64 !== null && typeof pdf_base64 !== "string") {
      return json({ ok: false, error: "pdf_base64 must be a string if provided." }, 400);
    }

    const displayName = (typeof client_name === "string" && client_name.trim()) || client_email;
    const hasPdf = typeof pdf_base64 === "string" && pdf_base64.length > 0;
    // A brand-new client (no invite was ever sent, see the header
    // comment) has no password set -- pointing them at a portal login
    // they can't get into would be a dead end, so the CTA only shows
    // when the caller confirms a real account already exists.
    const hasPortalAccount = has_portal_account === true;

    const wants = await clientWantsNotification(client_email, "wants_invoice_quote_emails");
    if (wants === null) {
      // RP3.26: couldn't tell whether they opted out, so nothing was sent.
      return json({ ok: false, skipped: "preferences unavailable", error: "The client's email preferences couldn't be checked, so nothing was sent. Try again in a minute." }, 503);
    }
    if (!wants) {
      return json({ ok: true, skipped: "client opted out of invoice/quote emails" });
    }
    if (!(await staffSendAllowed(claims.email))) {
      return json({ ok: false, error: TOO_MANY_SENDS_ERROR, code: "rate_limited" }, 429);
    }

    const parts: EmailParts = {
      clientName: displayName, invoiceNumber: invoice_number, total, description: description || null,
      hasPdf, hasPortalAccount, payUrl: payUrlFor(invoice_number, pay_token),
      dueDate: typeof due_date === "string" ? due_date : null,
      terms: typeof terms === "string" && terms.trim() ? terms.trim().slice(0, 40) : null,
    };
    const emailPayload: Record<string, unknown> = {
      from: `Triple H Enterprises <${LEAD_EMAIL_FROM}>`,
      to: client_email,
      bcc: [STEVE_EMAIL, CONNOR_EMAIL],
      subject: emailSubject(parts),
      html: buildEmailHtml(parts),
      text: buildEmailText(parts),
    };
    if (hasPdf) {
      emailPayload.attachments = [{
        filename: (typeof pdf_filename === "string" && pdf_filename.trim()) || `${invoice_number}.pdf`,
        content: pdf_base64,
      }];
    }

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify(emailPayload),
    });

    if (!emailRes.ok) {
      // Fix plan RP3.22 (2026-11-07): Resend's text is logged, not returned.
      console.error(`send-invoice-notification: Resend refused the email (HTTP ${emailRes.status}): ${(await emailRes.text()).slice(0, 500)}`);
      return json({ ok: false, error: "The email didn't send. Try again in a minute." }, 502);
    }

    // Push is an additional channel, checked here rather than in a
    // separate gate above -- a client who opted out of invoice/quote
    // emails already returned early, so reaching this line means
    // they DO want to be notified about this.
    await sendClientPush(client_email, "New invoice", `Invoice ${invoice_number}: ${formatCurrency(total)}`, "/portal/dashboard.html");

    return json({ ok: true });
  } catch (err: any) {
    // RP3.22: logged in full, generic to the caller.
    console.error("send-invoice-notification error:", err?.message || err);
    return json({ ok: false, error: "Something went wrong sending the email. Try again in a minute." }, 500);
  }
});
