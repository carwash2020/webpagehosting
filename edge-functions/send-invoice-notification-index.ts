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
// Steve gets a copy whenever the actual invoice PDF goes out (2026-10-23,
// requested directly) -- BCC'd on the same send, so it's the exact email
// the client received, not a separate re-composed copy that could drift.
// Deliberately only when hasPdf: a PDF-less fallback send (the
// resend-to-same-email path, see the header comment) isn't "the invoice
// emailed to the customer" in the sense meant here.
const STEVE_EMAIL = "steve@triplehenterprisesllc.biz";
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

function buildEmailHtml(
  clientName: string, invoiceNumber: string, total: number, description: string | null,
  hasPdf: boolean, hasPortalAccount: boolean,
): string {
  const heading = hasPdf ? "Your invoice is attached" : "You have a new invoice";
  const intro = hasPdf
    ? "Your invoice from Triple H Enterprises is attached to this email as a PDF."
    : "You have a new invoice from Triple H Enterprises.";
  const cta = hasPortalAccount
    ? `<tr>
          <td align="center" style="padding: 24px 28px 28px;">
            <a href="${PORTAL_URL}" style="display: inline-block; background: #ff8000; color: #ffffff; text-decoration: none; font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 15px; font-weight: 600; padding: 14px 32px; border-radius: 8px;">View and Pay</a>
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
          <td style="padding: 32px 28px 8px; font-family: -apple-system, Helvetica, Arial, sans-serif;">
            <h1 style="color: #ff8000; font-size: 22px; margin: 0 0 20px; text-align: center;">${escapeHtml(heading)}</h1>
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 20px;">Hi ${escapeHtml(clientName)},</p>
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 20px;">${escapeHtml(intro)}</p>
          </td>
        </tr>
        <tr>
          <td style="padding: 0 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #777; font-size: 14px; width: 100px;">Invoice</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 14px; color: #222;">${escapeHtml(invoiceNumber)}</td></tr>
              ${description ? `<tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #777; font-size: 14px;">For</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 14px; color: #222;">${escapeHtml(description)}</td></tr>` : ""}
              <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #777; font-size: 14px;">Amount</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 14px; color: #222; font-weight: 600;">${escapeHtml(formatCurrency(total))}</td></tr>
            </table>
          </td>
        </tr>
        ${cta}
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

function buildEmailText(
  clientName: string, invoiceNumber: string, total: number, description: string | null,
  hasPdf: boolean, hasPortalAccount: boolean,
): string {
  return [
    `Hi ${clientName},`,
    "",
    hasPdf
      ? "Your invoice from Triple H Enterprises is attached to this email as a PDF."
      : "You have a new invoice from Triple H Enterprises.",
    "",
    `Invoice: ${invoiceNumber}`,
    description ? `For: ${description}` : "",
    `Amount: ${formatCurrency(total)}`,
    "",
    hasPortalAccount ? `View and pay: ${PORTAL_URL}` : "",
    "",
    "Triple H Enterprises",
    "(435) 414-1667, triplehenterprisesllc.biz",
  ].filter(Boolean).join("\n");
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
      pdf_base64, pdf_filename, has_portal_account,
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

    if (!(await clientWantsNotification(client_email, "wants_invoice_quote_emails"))) {
      return json({ ok: true, skipped: "client opted out of invoice/quote emails" });
    }

    const emailPayload: Record<string, unknown> = {
      from: `Triple H Enterprises <${LEAD_EMAIL_FROM}>`,
      to: client_email,
      subject: hasPdf ? `Your invoice from Triple H Enterprises: ${invoice_number}` : `New invoice from Triple H Enterprises: ${invoice_number}`,
      html: buildEmailHtml(displayName, invoice_number, total, description || null, hasPdf, hasPortalAccount),
      text: buildEmailText(displayName, invoice_number, total, description || null, hasPdf, hasPortalAccount),
    };
    if (hasPdf) {
      emailPayload.attachments = [{
        filename: (typeof pdf_filename === "string" && pdf_filename.trim()) || `${invoice_number}.pdf`,
        content: pdf_base64,
      }];
      emailPayload.bcc = STEVE_EMAIL;
    }

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify(emailPayload),
    });

    if (!emailRes.ok) {
      const errBody = await emailRes.text();
      return json({ ok: false, error: `Email failed to send: ${errBody.slice(0, 300)}` }, 502);
    }

    // Push is an additional channel, checked here rather than in a
    // separate gate above -- a client who opted out of invoice/quote
    // emails already returned early, so reaching this line means
    // they DO want to be notified about this.
    await sendClientPush(client_email, "New invoice", `Invoice ${invoice_number}: ${formatCurrency(total)}`, "/portal/dashboard.html");

    return json({ ok: true });
  } catch (err: any) {
    return json({ ok: false, error: err.message }, 500);
  }
});
