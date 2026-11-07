// Supabase Edge Function: send-contract-notification
//
// Same shape as send-quote-notification: the "Please sign" email for a NEW
// contract. Called from sync-contract-to-portal.
//
// 2026-11-04 (handoff §3D, Connor's choices that day):
//   * It now goes to a brand-new client too. Their first contract used to
//     send only the "You've been invoiced" account invite, which never said
//     a contract was waiting and landed on the home screen. The email says
//     how to get in: Review & Sign, then Create account with this address.
//   * The button opens that exact contract (#contract-card-<id>); a visitor
//     who isn't signed in is brought back to it after sign-in.
//   * Steve and Connor are bcc'd on every one. It used to reach Connor's
//     inbox only by chance and never Steve's; the handoff asked for this to
//     be decided, not changed silently -- decided with Connor, 2026-11-04.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const LEAD_EMAIL_FROM = Deno.env.get("LEAD_EMAIL_FROM") || "";
const PORTAL_URL = "https://www.triplehenterprisesllc.biz/portal/contracts.html";
const LOGO_URL = "https://www.triplehenterprisesllc.biz/images/logo-signature-email.png";
const STEVE_EMAIL = "steve@triplehenterprisesllc.biz";
const CONNOR_EMAIL = "connor@triplehenterprisesllc.biz";
function contractUrl(portalContractId: unknown): string {
  return typeof portalContractId === "number" && Number.isInteger(portalContractId) && portalContractId > 0
    ? `${PORTAL_URL}#contract-card-${portalContractId}`
    : PORTAL_URL;
}
const NEW_CLIENT_LINE = "New to the Triple H portal? Tap Review & Sign, then Create account with this email address. It takes a minute, and the contract opens right after.";

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

async function callerCanManageContracts(email: string): Promise<boolean> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/account_roles?email=eq.${encodeURIComponent(email.toLowerCase())}&select=can_manage_contracts`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  if (!res.ok) return false;
  const rows = await res.json();
  if (!rows.length) return false;
  return rows[0].can_manage_contracts === true;
}

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
      console.error(`send-contract-notification: preferences lookup failed (HTTP ${res.status}); not emailing`);
      return null;
    }
    const rows = await res.json();
    if (!Array.isArray(rows)) return null;
    if (!rows.length) return true;
    return rows[0][column] !== false;
  } catch (err: any) {
    console.error(`send-contract-notification: preferences lookup failed (${err?.message || err}); not emailing`);
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
      body: JSON.stringify({ p_bucket: "staff-send:send-contract-notification", p_key: String(callerEmail || "").toLowerCase(), p_max: STAFF_SEND_LIMIT_PER_HOUR, p_window_seconds: 3600 }),
    });
    if (!res.ok) {
      console.error(`send-contract-notification: rate_limit_take failed (HTTP ${res.status}); allowing the send`);
      return true;
    }
    return (await res.json()) !== false;
  } catch (err: any) {
    console.error(`send-contract-notification: rate_limit_take failed (${err?.message || err}); allowing the send`);
    return true;
  }
}
const TOO_MANY_SENDS_ERROR = "Too many emails sent from this account in the last hour. Wait a while and try again.";

function escapeHtml(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

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
    await fetch(`${SUPABASE_URL}/functions/v1/Send-Push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ type: "client-notification", user_id: userId, title, body, url }),
    });
  } catch (err: any) {
    console.error("sendClientPush error (non-fatal):", err.message);
  }
}

function buildEmailHtml(clientName: string, contractTitle: string, url: string, newClient: boolean): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>A contract is ready for your signature, Triple H Enterprises</title>
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
            <h1 style="color: #ff8000; font-size: 22px; margin: 0 0 20px; text-align: center;">A contract is ready for your signature</h1>
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 20px;">Hi ${escapeHtml(clientName)},</p>
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 20px;">Please review and sign: <strong>${escapeHtml(contractTitle)}</strong>.</p>
            ${newClient ? `<p style="color: #555; font-size: 14px; line-height: 1.5; margin: 0 0 12px;">${escapeHtml(NEW_CLIENT_LINE)}</p>` : ""}
          </td>
        </tr>
        <tr>
          <td align="center" style="padding: 8px 28px 28px;">
            <a href="${url}" style="display: inline-block; background: #ff8000; color: #ffffff; text-decoration: none; font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 15px; font-weight: 600; padding: 14px 32px; border-radius: 8px;">Review &amp; Sign</a>
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

function buildEmailText(clientName: string, contractTitle: string, url: string, newClient: boolean): string {
  return [
    `Hi ${clientName},`,
    "",
    `A contract is ready for your review and signature: ${contractTitle}.`,
    "",
    `Review and sign it here: ${url}`,
    newClient ? NEW_CLIENT_LINE : "",
    "",
    "Triple H Enterprises",
    "(435) 414-1667, triplehenterprisesllc.biz",
  ].join("\n");
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
    if (!(await callerCanManageContracts(claims.email))) {
      return json({ ok: false, error: "This account can't manage contracts." }, 403);
    }
    if (!(await callerPassesInternalMfa(claims, "send-contract-notification"))) {
      return json({ ok: false, error: MFA_REQUIRED_ERROR, code: "mfa_required" }, 403);
    }

    const { client_email, client_name, contract_title, portal_contract_id, has_portal_account } = await req.json();
    if (
      typeof client_email !== "string" || !client_email.includes("@") ||
      typeof contract_title !== "string" || !contract_title
    ) {
      return json({ ok: false, error: "Missing or invalid fields." }, 400);
    }

    const displayName = (typeof client_name === "string" && client_name.trim()) || client_email;

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

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: `Triple H Enterprises <${LEAD_EMAIL_FROM}>`,
        to: client_email,
        bcc: [STEVE_EMAIL, CONNOR_EMAIL],
        subject: `Please sign: ${contract_title}`,
        html: buildEmailHtml(displayName, contract_title, contractUrl(portal_contract_id), has_portal_account === false),
        text: buildEmailText(displayName, contract_title, contractUrl(portal_contract_id), has_portal_account === false),
      }),
    });

    if (!emailRes.ok) {
      // Fix plan RP3.22 (2026-11-07): Resend's text is logged, not returned.
      console.error(`send-contract-notification: Resend refused the email (HTTP ${emailRes.status}): ${(await emailRes.text()).slice(0, 500)}`);
      return json({ ok: false, error: "The email didn't send. Try again in a minute." }, 502);
    }

    await sendClientPush(client_email, "Contract ready to sign", contract_title, contractUrl(portal_contract_id).replace("https://www.triplehenterprisesllc.biz", ""));

    return json({ ok: true });
  } catch (err: any) {
    // RP3.22: logged in full, generic to the caller.
    console.error("send-contract-notification error:", err?.message || err);
    return json({ ok: false, error: "Something went wrong sending the email. Try again in a minute." }, 500);
  }
});
