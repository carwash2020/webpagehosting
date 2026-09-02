// Supabase Edge Function: send-invite
//
// Sends a client their account-setup invite -- called automatically
// the first time a new client email appears on an invoice (from
// sync-invoice-to-portal), and manually via a "resend invite" button
// for a client who says they never got it.
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
// Uses the official @supabase/supabase-js SDK for generateLink()
// specifically, rather than hand-rolling the raw REST call -- a real
// mistake caught earlier the same day building the client portal's
// login page: a hand-rolled magic-link request put the redirect
// parameter in the wrong place entirely (body instead of a URL query
// param), only caught by testing the real SDK's actual network
// request directly. Not worth risking the same mistake twice on
// another auth-related call when the SDK is safely importable here
// (this runs server-side, unlike the browser-side login page).
//
// A real, documented Supabase gotcha this design has to account for
// (confirmed via direct research, not assumed): clicking an invite
// link creates a fully authenticated session immediately, BEFORE a
// password is ever set. redirectTo below points at set-password.html
// specifically, never straight at dashboard.html, so the client always
// lands on the "choose a password" step first.

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

// Permission model redesign (2026-09-02): reads can_manage_business_finances
// directly off account_roles now -- no join to role_definitions. Each
// account's permissions are its own, individually toggleable in Dev
// Tools -> Access, not inherited from a shared role tier.
async function callerCanManageInvoices(email: string): Promise<boolean> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/account_roles?email=eq.${encodeURIComponent(email.toLowerCase())}&select=can_manage_business_finances`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  if (!res.ok) return false;
  const rows = await res.json();
  if (!rows.length) return false;
  return rows[0].can_manage_business_finances === true;
}

function buildInviteEmailHtml(clientName: string, inviteUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Set up your account -- Triple H Enterprises</title>
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
            <h1 style="color: #ff8000; font-size: 22px; margin: 0 0 20px; text-align: center;">You've been invoiced</h1>
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 20px;">Hi ${escapeHtml(clientName)},</p>
            <p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 24px;">Triple H Enterprises has set you up with an account to view and pay your invoices online. Set your password to get started:</p>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding: 0 28px 28px;">
            <a href="${inviteUrl}" style="display: inline-block; background: #ff8000; color: #ffffff; text-decoration: none; font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 15px; font-weight: 600; padding: 14px 32px; border-radius: 8px;">Set Up My Account</a>
          </td>
        </tr>
        <tr>
          <td style="padding: 0 28px 28px; font-family: -apple-system, Helvetica, Arial, sans-serif;">
            <p style="color: #777; font-size: 13px; line-height: 1.5; margin: 0;">This link is unique to you -- please don't forward this email. If you weren't expecting this, you can safely ignore it.</p>
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

function buildInviteEmailText(clientName: string, inviteUrl: string): string {
  return [
    `Hi ${clientName},`,
    "",
    "Triple H Enterprises has set you up with an account to view and pay your invoices online.",
    "",
    `Set your password to get started: ${inviteUrl}`,
    "",
    "This link is unique to you -- please don't forward this email. If you weren't expecting this, you can safely ignore it.",
    "",
    "Triple H Enterprises",
    "(435) 414-1667 -- triplehenterprisesllc.biz",
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
    if (!(await callerCanManageInvoices(claims.email))) {
      return json({ ok: false, error: "This account can't manage invoices." }, 403);
    }

    const { client_email, client_name } = await req.json();
    if (typeof client_email !== "string" || !client_email.includes("@")) {
      return json({ ok: false, error: "Missing or invalid client_email." }, 400);
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: "invite",
      email: client_email.toLowerCase().trim(),
      options: {
        redirectTo: `${ALLOWED_ORIGIN}/portal/set-password.html`,
      },
    });

    if (linkError) {
      // A real, expected case, not just an error path: this email
      // already has an account (e.g. re-invoicing an existing client).
      // Treated as success from the caller's perspective -- there's
      // nothing wrong, the client just already has a way in.
      if (linkError.message?.includes("already been registered") || linkError.message?.includes("already registered")) {
        return json({ ok: true, already_has_account: true });
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
        subject: "Set up your Triple H Enterprises account",
        html: buildInviteEmailHtml(displayName, inviteUrl),
        text: buildInviteEmailText(displayName, inviteUrl),
      }),
    });

    if (!emailRes.ok) {
      const errBody = await emailRes.text();
      return json({ ok: false, error: `Invite link created but email failed to send: ${errBody.slice(0, 300)}` }, 502);
    }

    return json({ ok: true });
  } catch (err: any) {
    return json({ ok: false, error: err.message }, 500);
  }
});
