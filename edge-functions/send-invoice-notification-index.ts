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

function escapeHtml(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
<title>New invoice -- Triple H Enterprises</title>
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
    "(435) 414-1667 -- triplehenterprisesllc.biz",
  ].filter(Boolean).join("\n");
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

    const { client_email, client_name, invoice_number, total, description } = await req.json();
    if (
      typeof client_email !== "string" || !client_email.includes("@") ||
      typeof invoice_number !== "string" || typeof total !== "number"
    ) {
      return json({ ok: false, error: "Missing or invalid fields." }, 400);
    }

    const displayName = (typeof client_name === "string" && client_name.trim()) || client_email;

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: `Triple H Enterprises <${LEAD_EMAIL_FROM}>`,
        to: client_email,
        subject: `New invoice from Triple H Enterprises -- ${invoice_number}`,
        html: buildEmailHtml(displayName, invoice_number, total, description || null),
        text: buildEmailText(displayName, invoice_number, total, description || null),
      }),
    });

    if (!emailRes.ok) {
      const errBody = await emailRes.text();
      return json({ ok: false, error: `Email failed to send: ${errBody.slice(0, 300)}` }, 502);
    }

    return json({ ok: true });
  } catch (err: any) {
    return json({ ok: false, error: err.message }, 500);
  }
});
