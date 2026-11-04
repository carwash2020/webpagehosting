// Supabase Edge Function: team-admin (Phase 4, 2026-11-04)
//
// The Team screen's server side: invite, resend, revoke an invite,
// deactivate and reactivate a team member. Separate from send-invite,
// which is the client-portal invite and stays as it is.
//
// Who may call: a signed-in internal account that passed the Workspace's
// 2FA gate. Whether the caller may MANAGE THE TEAM is decided by the
// database itself: every change below that touches permissions is an RPC
// made AS THE CALLER (their own JWT), and those RPCs
// (sql/security/phase4_team_roster_and_deactivate.sql) refuse anyone
// without can_manage_roles, refuse self-deactivation, and -- through the
// live last-admin trigger -- refuse deactivating the last person who can
// manage the team. The service role is used only for what the database
// can't do: Auth links, the sign-in ban, deleting an unused invite's login,
// and sending the email.
//
// Deactivate = the RPC moves their account_roles row to the archive (so
// every internal access rule and function treats them as not staff at
// once), then their Auth user is banned so they can't sign in again.
// Reactivate = unban, then the RPC moves the row back exactly as it was.
//
// Invite links land on /tools/reset-password.html, which sets the first
// password (it accepts type=invite as well as type=recovery). The redirect
// URL must be on Supabase's Auth redirect allowlist, as for send-invite.
//
// Never call this from tests against real accounts: it sends real email
// and changes real sign-in.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const LEAD_EMAIL_FROM = Deno.env.get("LEAD_EMAIL_FROM") || "";

const ALLOWED_ORIGIN = "https://www.triplehenterprisesllc.biz";
const SET_PASSWORD_URL = `${ALLOWED_ORIGIN}/tools/reset-password.html`;
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SR_HEADERS: Record<string, string> = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};
// About 100 years: Supabase Auth's way of saying "until unbanned".
const BAN_DURATION = "876000h";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function decodeJwtPayload(token: string): { email?: string; role?: string; sub?: string; aal?: string; session_id?: string } {
  try {
    const payload = token.split(".")[1];
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return {};
  }
}

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...SR_HEADERS, ...(init.headers || {}) } });
}

async function callerIsInternalAccount(email: string): Promise<boolean> {
  const res = await rest(`account_roles?email=eq.${encodeURIComponent(email)}&select=email&limit=1`);
  if (!res.ok) return false;
  return (await res.json()).length > 0;
}

const MFA_REQUIRED_ERROR =
  "Two-factor sign-in required: sign out of the Workspace and sign back in with your authenticator code.";
async function callerPassesInternalMfa(claims: { sub?: string; email?: string; aal?: string; session_id?: string }): Promise<boolean> {
  try {
    const res = await rest("rpc/check_internal_mfa_for_edge_function", {
      method: "POST",
      body: JSON.stringify({
        p_user_id: claims.sub ?? null,
        p_email: claims.email ?? null,
        p_session_id: claims.session_id ?? null,
        p_aal: claims.aal ?? null,
        p_function: "team-admin",
      }),
    });
    if (!res.ok) return false;
    return (await res.json()) === true;
  } catch {
    return false;
  }
}

// An RPC made AS THE CALLER, so the database applies its own checks.
// Returns null on success, or the database's own error message.
async function rpcAsCaller(token: string, fn: string, args: Record<string, unknown>): Promise<string | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (res.ok) return null;
  let message = `${fn} failed (HTTP ${res.status})`;
  try {
    const body = await res.json();
    if (body && typeof body.message === "string") message = body.message;
  } catch { /* keep the generic message */ }
  return message;
}

async function authUserId(email: string): Promise<string | null> {
  const res = await rest("rpc/get_auth_user_id_by_email", { method: "POST", body: JSON.stringify({ p_email: email }) });
  if (!res.ok) return null;
  const id = await res.json();
  return typeof id === "string" && id ? id : null;
}

async function setBan(userId: string, banned: boolean): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "PUT",
    headers: SR_HEADERS,
    body: JSON.stringify({ ban_duration: banned ? BAN_DURATION : "none" }),
  });
  return res.ok;
}

// An invite link for a new login, or a set-password (recovery) link for a
// login that already exists (a resend, or an address that already had an
// Auth user). Supabase sends no email of its own: the link comes back.
async function setPasswordLink(email: string, existing: boolean): Promise<string | null> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: SR_HEADERS,
    body: JSON.stringify({ type: existing ? "recovery" : "invite", email, redirect_to: SET_PASSWORD_URL }),
  });
  if (!res.ok) return null;
  const body = await res.json();
  return body?.action_link || body?.properties?.action_link || null;
}

function inviteEmailHtml(name: string, inviter: string, link: string, isResend: boolean): string {
  const first = escapeHtml((name || "").split(" ")[0] || "there");
  return `<!doctype html><html><body style="margin:0;background:#0a0a0a;font-family:Arial,sans-serif;color:#f2f2f2">
<div style="max-width:520px;margin:0 auto;padding:32px 24px">
<p style="font-size:13px;letter-spacing:2px;color:#ffb347;margin:0 0 12px">TRIPLE H ENTERPRISES</p>
<h1 style="font-size:24px;margin:0 0 16px;color:#ffffff">${isResend ? "Here's a fresh link" : "You're invited to the Triple H Workspace"}</h1>
<p style="font-size:16px;line-height:1.5;margin:0 0 16px">Hi ${first}, ${escapeHtml(inviter)} added you to the team. Set a password to sign in and see the jobs assigned to you.</p>
<p style="margin:24px 0"><a href="${escapeHtml(link)}" style="display:inline-block;background:#ff8000;color:#1a0d02;font-weight:bold;text-decoration:none;padding:14px 22px;border-radius:10px">Set your password</a></p>
<p style="font-size:13px;line-height:1.5;color:#9a9a9a;margin:0">This link is just for you and works once. If it has expired, ask for a new one. If you weren't expecting this, you can ignore it.</p>
</div></body></html>`;
}

function inviteEmailText(name: string, inviter: string, link: string, isResend: boolean): string {
  const first = (name || "").split(" ")[0] || "there";
  return [
    `Hi ${first},`,
    "",
    isResend ? "Here's a fresh link to finish joining the Triple H Workspace." : `${inviter} added you to the Triple H Workspace team.`,
    "",
    `Set your password: ${link}`,
    "",
    "This link is just for you and works once. If you weren't expecting this, you can ignore it.",
    "",
    "Triple H Enterprises",
  ].join("\n");
}

async function sendInviteEmail(to: string, name: string, inviter: string, link: string, isResend: boolean): Promise<boolean> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from: `Triple H Enterprises <${LEAD_EMAIL_FROM}>`,
      to,
      subject: isResend ? "Your Triple H Workspace link" : "You're invited to the Triple H Workspace",
      html: inviteEmailHtml(name, inviter, link, isResend),
      text: inviteEmailText(name, inviter, link, isResend),
    }),
  });
  return res.ok;
}

// The pending-invite row for an email (service role read), or null.
async function pendingInvite(email: string): Promise<{ display_name: string | null } | null> {
  const res = await rest(`account_roles?email=eq.${encodeURIComponent(email)}&invited_at=not.is.null&select=display_name&limit=1`);
  if (!res.ok) return null;
  const rows = await res.json();
  return rows.length ? rows[0] : null;
}

async function callerCanManageTeam(email: string): Promise<boolean> {
  const res = await rest(`account_roles?email=eq.${encodeURIComponent(email)}&select=can_manage_roles&limit=1`);
  if (!res.ok) return false;
  const rows = await res.json();
  return rows.length === 1 && rows[0].can_manage_roles === true;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: CORS_HEADERS });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const claims = decodeJwtPayload(token);
    if (claims.role !== "authenticated" || !claims.email) {
      return json({ ok: false, error: "Must be signed in with a real session." }, 401);
    }
    if (!(await callerIsInternalAccount(claims.email))) {
      return json({ ok: false, error: "This account isn't recognized." }, 403);
    }
    if (!(await callerPassesInternalMfa(claims))) {
      return json({ ok: false, error: MFA_REQUIRED_ERROR, code: "mfa_required" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = typeof body.action === "string" ? body.action : "";
    const email = typeof body.email === "string" ? body.email.toLowerCase().trim() : "";
    if (!EMAIL_RE.test(email)) return json({ ok: false, error: "Missing or invalid email." }, 400);
    const inviter = claims.email;

    if (action === "invite") {
      const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
      const err = await rpcAsCaller(token, "team_add_invited", { p_email: email, p_name: name });
      if (err) return json({ ok: false, error: err }, 400);
      const existing = (await authUserId(email)) !== null;
      const link = await setPasswordLink(email, existing);
      if (!link) return json({ ok: false, invited: true, error: "They're on the team as Invite pending, but the link couldn't be made. Use Resend." }, 502);
      if (!(await sendInviteEmail(email, name, inviter, link, false))) {
        return json({ ok: false, invited: true, error: "They're on the team as Invite pending, but the email didn't send. Use Resend." }, 502);
      }
      return json({ ok: true });
    }

    if (action === "resend") {
      if (!(await callerCanManageTeam(inviter))) return json({ ok: false, error: "Not allowed: you can't manage the team." }, 403);
      const pending = await pendingInvite(email);
      if (!pending) return json({ ok: false, error: "No pending invite for that email." }, 404);
      const existing = (await authUserId(email)) !== null;
      const link = await setPasswordLink(email, existing);
      if (!link || !(await sendInviteEmail(email, pending.display_name || "", inviter, link, true))) {
        return json({ ok: false, error: "The new link couldn't be sent. Try again in a minute." }, 502);
      }
      return json({ ok: true });
    }

    if (action === "revoke") {
      const err = await rpcAsCaller(token, "team_revoke_invite", { p_email: email });
      if (err) return json({ ok: false, error: err }, 400);
      // Their unused invite link stops working with the login it was for.
      // Only reached when the database confirmed they never signed in.
      const userId = await authUserId(email);
      if (userId) {
        await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE", headers: SR_HEADERS });
      }
      return json({ ok: true });
    }

    if (action === "deactivate") {
      const err = await rpcAsCaller(token, "team_deactivate", { p_email: email });
      if (err) return json({ ok: false, error: err }, 400);
      const userId = await authUserId(email);
      const banned = userId ? await setBan(userId, true) : true;
      if (!banned) {
        return json({ ok: false, deactivated: true, error: "Deactivated (no access), but the sign-in block didn't save. Try Deactivate again." }, 502);
      }
      return json({ ok: true });
    }

    if (action === "reactivate") {
      if (!(await callerCanManageTeam(inviter))) return json({ ok: false, error: "Not allowed: you can't manage the team." }, 403);
      const userId = await authUserId(email);
      if (userId && !(await setBan(userId, false))) {
        return json({ ok: false, error: "Their sign-in couldn't be unblocked. Nothing was changed; try again." }, 502);
      }
      const err = await rpcAsCaller(token, "team_reactivate", { p_email: email });
      if (err) {
        if (userId) await setBan(userId, true);
        return json({ ok: false, error: err }, 400);
      }
      return json({ ok: true });
    }

    return json({ ok: false, error: "Unknown action." }, 400);
  } catch (err: any) {
    return json({ ok: false, error: err?.message || "Something went wrong." }, 500);
  }
});
