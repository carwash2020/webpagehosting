// Supabase Edge Function: send-invoice-notification
//
// Genuinely different from send-invite: this is for a client who
// ALREADY has a portal account, getting notified about a NEW invoice.
// Called from sync-invoice-to-portal only when a client is NOT new
// (they already have at least one prior invoice on file) but this
// specific invoice is -- the invite flow already covers a client's
// very first invoice, so this only ever fires for their second and
// later ones.
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

function buildEmailHtml(clientName: string, invoiceNumber: string, total: number, description: string | null): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>New invoice, Triple H Enterprises</title>
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
            <h1 style="color: #ff8000; font-size: 22px; margin: 0 0 20px; text-align: center;">You have a new invoice</h1>
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 20px;">Hi ${escapeHtml(clientName)},</p>
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
        <tr>
          <td align="center" style="padding: 24px 28px 28px;">
            <a href="${PORTAL_URL}" style="display: inline-block; background: #ff8000; color: #ffffff; text-decoration: none; font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 15px; font-weight: 600; padding: 14px 32px; border-radius: 8px;">View and Pay</a>
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

function buildEmailText(clientName: string, invoiceNumber: string, total: number, description: string | null): string {
  return [
    `Hi ${clientName},`,
    "",
    "You have a new invoice from Triple H Enterprises.",
    "",
    `Invoice: ${invoiceNumber}`,
    description ? `For: ${description}` : "",
    `Amount: ${formatCurrency(total)}`,
    "",
    `View and pay: ${PORTAL_URL}`,
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

    const { client_email, client_name, invoice_number, total, description } = await req.json();
    if (
      typeof client_email !== "string" || !client_email.includes("@") ||
      typeof invoice_number !== "string" || typeof total !== "number"
    ) {
      return json({ ok: false, error: "Missing or invalid fields." }, 400);
    }

    const displayName = (typeof client_name === "string" && client_name.trim()) || client_email;

    if (!(await clientWantsNotification(client_email, "wants_invoice_quote_emails"))) {
      return json({ ok: true, skipped: "client opted out of invoice/quote emails" });
    }

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: `Triple H Enterprises <${LEAD_EMAIL_FROM}>`,
        to: client_email,
        subject: `New invoice from Triple H Enterprises: ${invoice_number}`,
        html: buildEmailHtml(displayName, invoice_number, total, description || null),
        text: buildEmailText(displayName, invoice_number, total, description || null),
      }),
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
