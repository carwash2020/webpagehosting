// portal-signup (2026-11-04, handoff §2: "guests can create their own
// account WITHOUT an invite ... signs up with the same email their invoice
// was sent to, verifies it, and the portal matches them to their existing
// invoices, quotes, and jobs by that email"). Connor chose this server-side
// path on 2026-11-04 so Supabase's public sign-up can stay OFF (it was
// switched off on 2026-09-25: with it on, "authenticated" meant "anyone").
//
// Two steps, both public (deploy with --no-verify-jwt; the visitor has no
// session yet):
//   start  {email, password}  makes the account UNCONFIRMED with that
//          password (or updates the password of one still unconfirmed),
//          and emails a 6-digit code. An unconfirmed account can't sign in
//          (Auth refuses it) and, with
//          sql/portal/portal_self_signup_and_confirmed_email_lock.sql,
//          can't read a single client row either.
//   verify {email, code}      the right code within 15 minutes confirms
//          the email. The page then signs in with the password the person
//          just chose, and the existing `auth.email() = client_email` rules
//          show them everything Triple H already sent to that address.
//
// Nothing here can be used to learn whether an address has an account:
// "start" answers the same for a new address, an unconfirmed one, a
// confirmed client (who is emailed "you already have an account" instead of
// a code) and a staff address (sent nothing at all -- staff sign in to the
// Workspace). Codes are kept only as an HMAC, expire in 15 minutes, allow
// 5 wrong tries, and one address gets at most 5 codes an hour; one network
// address at most 10 sign-ups an hour.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const LEAD_EMAIL_FROM = Deno.env.get("LEAD_EMAIL_FROM") || "";
const LOGO_URL = "https://www.triplehenterprisesllc.biz/images/logo-signature-email.png";
const LOGIN_URL = "https://www.triplehenterprisesllc.biz/portal/login.html";

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_SHAPE = /^\d{6}$/;
const CODE_MINUTES = 15;
const MAX_WRONG_TRIES = 5;
const MAX_CODES_PER_HOUR = 5;
const MAX_STARTS_PER_IP_PER_HOUR = 10;

const ALLOWED_ORIGIN = "https://www.triplehenterprisesllc.biz";
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SR_HEADERS = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };

function escapeHtml(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function hmac(text: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SERVICE_ROLE_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

function sixDigitCode(): string {
  // Rejection sampling: 4294967296 is not a multiple of 1e6.
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / 1_000_000) * 1_000_000;
  do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
  return String(buf[0] % 1_000_000).padStart(6, "0");
}

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...SR_HEADERS, ...(init.headers || {}) } });
}
async function rpc(fn: string, args: Record<string, unknown>): Promise<any> {
  const res = await rest(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
  if (!res.ok) throw new Error(`${fn} failed (HTTP ${res.status})`);
  return res.json();
}

async function isStaff(email: string): Promise<boolean> {
  const res = await rest(`account_roles?email=eq.${encodeURIComponent(email)}&select=email&limit=1`);
  if (!res.ok) throw new Error(`account_roles lookup failed (HTTP ${res.status})`);
  return (await res.json()).length > 0;
}

async function adminUser(method: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${SUPABASE_URL}/auth/v1/admin/users${path}`, { method, headers: SR_HEADERS, body: JSON.stringify(body) });
}

// One row per address-hash per hour. Returns false once over the limit.
async function underIpLimit(req: Request): Promise<boolean> {
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const ipHash = await hmac(`ip:${ip}`);
  const res = await rest(`portal_signup_ip_limits?ip_hash=eq.${ipHash}&select=starts,window_started_at`);
  const rows = res.ok ? await res.json() : [];
  const now = Date.now();
  if (rows.length && now - Date.parse(rows[0].window_started_at) < 3600_000) {
    if (rows[0].starts >= MAX_STARTS_PER_IP_PER_HOUR) return false;
    await rest(`portal_signup_ip_limits?ip_hash=eq.${ipHash}`, { method: "PATCH", body: JSON.stringify({ starts: rows[0].starts + 1 }) });
  } else {
    await rest(`portal_signup_ip_limits?on_conflict=ip_hash`, {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify([{ ip_hash: ipHash, starts: 1, window_started_at: new Date(now).toISOString() }]),
    });
  }
  return true;
}

function shell(heading: string, bodyHtml: string): string {
  const font = "font-family: -apple-system, Helvetica, Arial, sans-serif;";
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="light"><title>${escapeHtml(heading)}, Triple H Enterprises</title></head>
<body style="margin: 0; padding: 0; background-color: #f4f4f4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f4f4f4" style="background: #f4f4f4; padding: 32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="max-width: 480px; background: #ffffff; border-radius: 10px; overflow: hidden; border: 1px solid #e5e5e5;">
      <tr><td align="center" bgcolor="#0a0a0a" style="background: #0a0a0a; padding: 28px 24px;"><img src="${LOGO_URL}" alt="Triple H Enterprises" width="140" style="display: block; border: 0;"></td></tr>
      <tr><td style="padding: 32px 28px 24px; ${font}">
        <h1 style="color: #ff8000; font-size: 22px; margin: 0 0 20px; text-align: center;">${escapeHtml(heading)}</h1>
        ${bodyHtml}
      </td></tr>
      <tr><td style="background: #ff8000; height: 4px; line-height: 4px; font-size: 1px;">&nbsp;</td></tr>
      <tr><td align="center" style="padding: 16px 24px; ${font}"><p style="color: #999; font-size: 12px; margin: 0;">(435) 414-1667 &middot; triplehenterprisesllc.biz</p></td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

async function sendEmail(to: string, subject: string, html: string, text: string): Promise<boolean> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from: `Triple H Enterprises <${LEAD_EMAIL_FROM}>`, to, subject, html, text }),
  });
  if (!res.ok) console.error(`portal-signup: email failed (HTTP ${res.status})`);
  return res.ok;
}

function codeEmail(code: string) {
  const p = (t: string, extra = "") => `<p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 16px; ${extra}">${t}</p>`;
  const html = shell("Your confirmation code",
    p("Enter this code on the Create account page to finish setting up your Triple H client portal account:") +
    `<p style="font-size: 34px; letter-spacing: 8px; font-weight: 700; color: #0a0a0a; text-align: center; margin: 8px 0 20px; font-family: Menlo, Consolas, monospace;">${code}</p>` +
    p(`It works for ${CODE_MINUTES} minutes.`) +
    p("If you didn't ask for this, you can ignore this email. Nothing is shown to anyone until this code is entered.", "color: #777; font-size: 13px;"));
  const text = [
    "Your Triple H confirmation code", "",
    `Enter this code on the Create account page: ${code}`,
    `It works for ${CODE_MINUTES} minutes.`, "",
    "If you didn't ask for this, you can ignore this email. Nothing is shown to anyone until this code is entered.",
  ].join("\n");
  return { subject: `${code} is your Triple H confirmation code`, html, text };
}

function alreadyHaveAccountEmail() {
  const html = shell("You already have an account",
    `<p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 16px;">Someone (probably you) tried to create a Triple H client portal account with this email, but you already have one.</p>` +
    `<p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 24px;">Sign in instead. If you don't remember your password, tap <strong>Forgot password?</strong> on the sign-in page.</p>` +
    `<p style="text-align: center; margin: 0 0 8px;"><a href="${LOGIN_URL}" style="display: inline-block; background: #ff8000; color: #ffffff; text-decoration: none; font-size: 15px; font-weight: 600; padding: 14px 32px; border-radius: 8px;">Sign in</a></p>` +
    `<p style="color: #777; font-size: 13px; line-height: 1.5; margin: 16px 0 0;">If this wasn't you, you can ignore this email. Your account and password are unchanged.</p>`);
  const text = [
    "You already have an account", "",
    "Someone (probably you) tried to create a Triple H client portal account with this email, but you already have one.",
    `Sign in instead: ${LOGIN_URL} (tap "Forgot password?" if you need a new password).`, "",
    "If this wasn't you, you can ignore this email. Your account and password are unchanged.",
  ].join("\n");
  return { subject: "You already have a Triple H portal account", html, text };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: CORS_HEADERS });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  // Every "start" that gets past input checks ends with exactly this.
  const SENT = { ok: true, next: "code" };

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!EMAIL_SHAPE.test(email) || email.length > 254) return json({ ok: false, error: "Enter a valid email address." }, 400);

    if (action === "start") {
      const password = typeof body.password === "string" ? body.password : "";
      if (password.length < 8) return json({ ok: false, error: "Password needs to be at least 8 characters." }, 400);
      if (password.length > 72) return json({ ok: false, error: "Password can be at most 72 characters." }, 400);
      if (!(await underIpLimit(req))) return json({ ok: false, error: "Too many tries from here. Please wait an hour, or call (435) 414-1667." }, 429);

      if (await isStaff(email)) return json(SENT); // staff sign in to the Workspace; nothing is sent

      const status = await rpc("portal_account_status", { p_email: email });
      if (status === "confirmed") {
        const m = alreadyHaveAccountEmail();
        await sendEmail(email, m.subject, m.html, m.text);
        return json(SENT);
      }

      // Per-address limit, counted on the code row.
      const existingRes = await rest(`portal_signup_codes?email=eq.${encodeURIComponent(email)}&select=sends,window_started_at`);
      const existing = existingRes.ok ? (await existingRes.json())[0] : null;
      const now = Date.now();
      const inWindow = existing && now - Date.parse(existing.window_started_at) < 3600_000;
      if (inWindow && existing.sends >= MAX_CODES_PER_HOUR) return json(SENT); // quietly: no more codes this hour

      if (status === "none") {
        const res = await adminUser("POST", "", { email, password, email_confirm: false });
        if (!res.ok) throw new Error(`could not create the account (HTTP ${res.status})`);
      } else {
        const id = await rpc("get_auth_user_id_by_email", { p_email: email });
        if (typeof id !== "string") throw new Error("unconfirmed account not found");
        const res = await adminUser("PUT", `/${encodeURIComponent(id)}`, { password });
        if (!res.ok) throw new Error(`could not update the account (HTTP ${res.status})`);
      }

      const code = sixDigitCode();
      await rest(`portal_signup_codes?on_conflict=email`, {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify([{
          email, code_hash: await hmac(`${email}:${code}`),
          expires_at: new Date(now + CODE_MINUTES * 60_000).toISOString(), attempts: 0,
          sends: inWindow ? existing.sends + 1 : 1,
          window_started_at: inWindow ? existing.window_started_at : new Date(now).toISOString(),
        }]),
      });
      const m = codeEmail(code);
      await sendEmail(email, m.subject, m.html, m.text);
      return json(SENT);
    }

    if (action === "verify") {
      const code = typeof body.code === "string" ? body.code.trim() : "";
      const wrong = (error = "That code didn't work. Check the latest email from us, or send a new code.") => json({ ok: false, error }, 400);
      if (!CODE_SHAPE.test(code)) return wrong();
      const res = await rest(`portal_signup_codes?email=eq.${encodeURIComponent(email)}&select=code_hash,expires_at,attempts`);
      const row = res.ok ? (await res.json())[0] : null;
      if (!row || Date.parse(row.expires_at) < Date.now()) return wrong("That code has expired. Send a new code.");
      if (row.attempts >= MAX_WRONG_TRIES) return wrong("Too many wrong tries. Send a new code.");
      if ((await hmac(`${email}:${code}`)) !== row.code_hash) {
        await rest(`portal_signup_codes?email=eq.${encodeURIComponent(email)}`, { method: "PATCH", body: JSON.stringify({ attempts: row.attempts + 1 }) });
        return wrong();
      }
      const id = await rpc("get_auth_user_id_by_email", { p_email: email });
      if (typeof id !== "string") return wrong("That code has expired. Send a new code.");
      const conf = await adminUser("PUT", `/${encodeURIComponent(id)}`, { email_confirm: true });
      if (!conf.ok) throw new Error(`could not confirm the account (HTTP ${conf.status})`);
      await rest(`portal_signup_codes?email=eq.${encodeURIComponent(email)}`, { method: "DELETE" });
      return json({ ok: true });
    }

    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (err: any) {
    console.error(`portal-signup: ${err.message}`);
    return json({ ok: false, error: "Something went wrong. Please try again, or call (435) 414-1667." }, 500);
  }
});
