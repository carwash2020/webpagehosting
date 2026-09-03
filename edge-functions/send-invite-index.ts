// Supabase Edge Function: send-invite
//
// Sends a client their account-setup invite -- called automatically
// the first time a new client email appears on an invoice (from
// sync-invoice-to-portal), and manually from Dev Tools for a client
// who says they never got it.
//
// Deliberately does NOT use supabase.auth.admin.inviteUserByEmail()'s
// own automatic email -- that would use Supabase's default auth email
// template (generic, unbranded, a real style mismatch with every other
// email this project sends). Uses admin.generateLink() instead, which
// creates the same real invite link and the underlying user account,
// WITHOUT Supabase sending its own email -- then sends a custom,
// branded email via Resend, matching send-booking-email/send-lead-email's
// established look exactly.
//
// A real, documented Supabase gotcha this design has to account for
// (confirmed via direct research, not assumed): clicking an invite
// link creates a fully authenticated session immediately, BEFORE a
// password is ever set. redirectTo below points at set-password.html
// specifically, never straight at dashboard.html, so the client always
// lands on the "choose a password" step first.
//
// IMPORTANT OPERATIONAL NOTE (2026-09-02): redirectTo only works if
// the URL is on Supabase's own allowlist -- Authentication -> URL
// Configuration -> Redirect URLs must include
// https://www.triplehenterprisesllc.biz/** . If it is not allowlisted,
// Supabase silently ignores redirectTo and sends the client to the
// project's Site URL instead. That produced two confusing real
// symptoms while testing this: first "Safari couldn't connect to the
// server" (Site URL was still Supabase's localhost:3000 default), then
// landing on the marketing homepage (Site URL corrected, but the
// redirect path still not allowlisted). No code change can fix that --
// it is dashboard configuration.
//
// A real repo/production drift caught here (2026-09-02): the file
// that used to live in this repo was missing the isResend/magiclink
// logic below entirely -- an earlier direct deploy had updated the
// live function without the matching repo commit. Found by pulling
// the actual deployed source before making an unrelated wording pass,
// rather than trusting the repo file's own currency. Reconciled here.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const LEAD_EMAIL_FROM = Deno.env.get("LEAD_EMAIL_FROM") || "";

const ALLOWED_ORIGIN = "https://www.triplehenterprisesllc.biz";
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LOGO_URL = "https://www.triplehenterprisesllc.biz/images/logo-signature-email.png";

function escapeHtml(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function decodeJwtPayload(token: string): { email?: string; role?: string } {
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch {
    return {};
  }
}

// Granular permission expansion (2026-09-02): this function is shared
// by BOTH the invoice/quote sync path (gated on can_manage_invoices)
// AND the job/checkup sync path (no specific gate at all) -- the
// least-restrictive, correct check for a shared utility called from
// multiple contexts is "any recognized internal account."
async function callerIsInternalAccount(email: string): Promise<boolean> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/account_roles?email=eq.${encodeURIComponent(email.toLowerCase())}&select=email&limit=1`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  if (!res.ok) return false;
  const rows = await res.json();
  return rows.length > 0;
}

function buildInviteEmailHtml(clientName: string, inviteUrl: string, isResend: boolean): string {
  const heading = isResend ? "Finish setting up your account" : "You've been invoiced";
  const intro = isResend
    ? "Here's a fresh link to finish setting up your Triple H Enterprises account. The previous one may have expired or not worked."
    : "Triple H Enterprises has set you up with an account to view and pay your invoices online. Set your password to get started:";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Set up your account, Triple H Enterprises</title>
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
            <h1 style="color: #ff8000; font-size: 22px; margin: 0 0 20px; text-align: center;">${heading}</h1>
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 20px;">Hi ${escapeHtml(clientName)},</p>
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 24px;">${intro}</p>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding: 0 28px 28px;">
            <a href="${inviteUrl}" style="display: inline-block; background: #ff8000; color: #ffffff; text-decoration: none; font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 15px; font-weight: 600; padding: 14px 32px; border-radius: 8px;">Set Up My Account</a>
          </td>
        </tr>
        <tr>
          <td style="padding: 0 28px 28px; font-family: -apple-system, Helvetica, Arial, sans-serif;">
            <p style="color: #777; font-size: 13px; line-height: 1.5; margin: 0;">This link is unique to you. Please don't forward this email. If you weren't expecting this, you can safely ignore it.</p>
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

function buildInviteEmailText(clientName: string, inviteUrl: string, isResend: boolean): string {
  return [
    `Hi ${clientName},`,
    "",
    isResend
      ? "Here's a fresh link to finish setting up your Triple H Enterprises account."
      : "Triple H Enterprises has set you up with an account to view and pay your invoices online.",
    "",
    `Set your password to get started: ${inviteUrl}`,
    "",
    "This link is unique to you. Please don't forward this email. If you weren't expecting this, you can safely ignore it.",
    "",
    "Triple H Enterprises",
    "(435) 414-1667, triplehenterprisesllc.biz",
  ].join("\n");
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
    if (!(await callerIsInternalAccount(claims.email))) {
      return json({ ok: false, error: "This account isn't recognized." }, 403);
    }

    const { client_email, client_name } = await req.json();
    if (typeof client_email !== "string" || !client_email.includes("@")) {
      return json({ ok: false, error: "Missing or invalid client_email." }, 400);
    }

    const targetEmail = client_email.toLowerCase().trim();

    // Internal tool accounts are NOT portal clients (2026-09-02). An
    // internal account (account_roles + /tools/ access) and a portal
    // client (/portal/ access to their own invoices) are deliberately
    // different things that happen to share one auth user table.
    // Checked server-side so the rule holds for every caller,
    // including the sync functions that fire invites automatically.
    const internalRes = await fetch(
      `${SUPABASE_URL}/rest/v1/account_roles?email=eq.${encodeURIComponent(targetEmail)}&select=email&limit=1`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    if (internalRes.ok) {
      const internalRows = await internalRes.json();
      if (internalRows.length) {
        return json({
          ok: false,
          is_internal_account: true,
          error: `${targetEmail} is an internal tool account, not a client. Internal accounts sign in at /tools/ and don't need a client portal invite. If this person also needs a separate client portal login, use a different email address for it.`,
        }, 409);
      }
    }

    // "Account exists" and "account is actually set up" are different
    // things (2026-09-02), requested directly after a real dead end:
    // an invite was sent, its link failed to open (the redirect-
    // allowlist issue noted at the top of this file), and then every
    // resend attempt was REFUSED because the auth user already
    // existed -- leaving a client with an account they could never
    // finish setting up and no way for anyone to fix it from the tools.
    //
    // portal_account_status() (SECURITY DEFINER, service_role only)
    // returns none / unconfirmed / confirmed, because auth.users isn't
    // reachable via PostgREST and supabase-js's admin API has no
    // get-user-by-email -- only a paginated listUsers().
    const statusRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/portal_account_status`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_email: targetEmail }),
    });
    const accountStatus = statusRes.ok ? await statusRes.json() : "unknown";

    // Genuinely set up: has confirmed and/or signed in. A fresh invite
    // is the wrong tool -- they need a password reset.
    if (accountStatus === "confirmed") {
      return json({
        ok: true,
        already_has_account: true,
        error: `${targetEmail} already has a working client portal account, so no new invite was sent. If they can't get in, have them use "Forgot password" on the portal login page.`,
      });
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // An 'invite' link can only be generated for an email with no user
    // yet. For a user who exists but never confirmed, 'magiclink' is
    // the correct type: it produces a working sign-in link for the
    // existing user, pointed at the same set-password page, so they
    // land exactly where a first-time invite would have taken them.
    // This is the specific case that was previously impossible to
    // recover from.
    const isResend = accountStatus === "unconfirmed";
    const linkType = isResend ? "magiclink" : "invite";

    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: linkType,
      email: targetEmail,
      options: {
        redirectTo: `${ALLOWED_ORIGIN}/portal/set-password.html`,
      },
    });

    if (linkError) {
      // Kept as a real fallback rather than removed: if the status
      // lookup above ever failed (returning "unknown") and we guessed
      // 'invite' for an email that does have a user, this is where
      // that surfaces. Still ok:true so the automatic callers don't
      // treat normal re-invoicing as a failure.
      if (linkError.message?.includes("already been registered") || linkError.message?.includes("already registered")) {
        return json({
          ok: true,
          already_has_account: true,
          error: `${targetEmail} already has a client portal account, so no new invite was sent. If they can't get in, have them use "Forgot password" on the portal login page.`,
        });
      }
      return json({ ok: false, error: `Could not generate invite link: ${linkError.message}` }, 502);
    }

    const inviteUrl = linkData.properties?.action_link;
    if (!inviteUrl) {
      return json({ ok: false, error: "Invite link generation succeeded but no action_link was returned." }, 502);
    }

    const displayName = (typeof client_name === "string" && client_name.trim()) || client_email;

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: `Triple H Enterprises <${LEAD_EMAIL_FROM}>`,
        to: client_email,
        subject: isResend
          ? "Finish setting up your Triple H Enterprises account"
          : "Set up your Triple H Enterprises account",
        html: buildInviteEmailHtml(displayName, inviteUrl, isResend),
        text: buildInviteEmailText(displayName, inviteUrl, isResend),
      }),
    });

    if (!emailRes.ok) {
      const errBody = await emailRes.text();
      return json({ ok: false, error: `Invite link created but email failed to send: ${errBody.slice(0, 300)}` }, 502);
    }

    return json({ ok: true, was_resend: isResend });
  } catch (err: any) {
    return json({ ok: false, error: err.message }, 500);
  }
});
