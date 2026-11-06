// portal-email-alias (fix plan FP4.2, 2026-11-06; D11; approved design
// EmailAliases). Verified email aliases for the client portal: invoices,
// quotes and jobs Triple H sent to any of a client's confirmed emails show up
// in their portal (sql/security/fp4_email_aliases.sql does the showing).
//
// Proof of ownership, never a guess (D11):
//   * A client adds an email; we send a 6-digit code to it (15 minutes, 5
//     wrong tries, 5 codes an hour). Only the right code links it.
//   * "add" answers the same for every address, so typing someone else's
//     email reveals nothing. What happens to a staff address, an address that
//     has its own portal account, or one already linked elsewhere is only
//     said AFTER the right code (the person has proved they own it), and none
//     of those is ever linked: an email with its own account is a
//     staff-assisted merge.
//   * Staff (Workspace account, two-factor, Clients) can start an add from
//     the client record: we email a link to that address, and it links only
//     when someone opens it while signed in to that client's portal account.
//   * Staff can merge two portal accounts when a client asks (B into A):
//     B is locked (can't sign in or refresh a session), B's saved cards are detached from B's
//     Stripe customer (a card can't move between Stripe customers; A adds a
//     card at the next payment), and B's email becomes a confirmed email of
//     A, so A sees B's history. Nothing is deleted. Each step is safe to retry.
//
// Deployed with verify_jwt on: every caller has a session. Codes and link
// tokens are stored only as an HMAC. Never names or phone numbers.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const LEAD_EMAIL_FROM = Deno.env.get("LEAD_EMAIL_FROM") || "";
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_CLIENT_CARDS_SECRET_KEY") || "";
const LOGO_URL = "https://www.triplehenterprisesllc.biz/images/logo-signature-email.png";
const PORTAL_SETTINGS_URL = "https://www.triplehenterprisesllc.biz/portal/settings.html";

// Linear-time: domain labels are separated by single dots, so no two
// repeats can match the same characters (no polynomial backtracking).
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
const CODE_SHAPE = /^\d{6}$/;
const TOKEN_SHAPE = /^[a-f0-9]{48}$/;
const CODE_MINUTES = 15;
const LINK_DAYS = 7;
const MAX_WRONG_TRIES = 5;
const MAX_CODES_PER_HOUR = 5;
const MAX_PENDING = 5;
const MAX_CONFIRMED = 10;
const BAN_DURATION = "876000h"; // the same lock team-admin uses
const RECORD_TABLES: Array<[string, string]> = [
  ["client_portal_invoices", "invoice"], ["client_portal_quotes", "quote"], ["client_portal_jobs", "job"],
  ["client_portal_contracts", "contract"], ["client_portal_checkups", "checkup"],
];

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
function decodeJwtPayload(token: string): { email?: string; role?: string; sub?: string; aal?: string; session_id?: string } {
  try {
    const payload = token.split(".")[1];
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return {};
  }
}
async function hmac(text: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SERVICE_ROLE_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}
function sixDigitCode(): string {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / 1_000_000) * 1_000_000;
  do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
  return String(buf[0] % 1_000_000).padStart(6, "0");
}
function linkToken(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  return (user.length <= 1 ? user : user[0] + "***") + "@" + domain;
}

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...SR_HEADERS, ...(init.headers || {}) } });
}
async function rows(path: string): Promise<any[]> {
  const res = await rest(path);
  if (!res.ok) throw new Error(`read failed (HTTP ${res.status})`);
  return res.json();
}
async function isStaff(email: string): Promise<boolean> {
  return (await rows(`account_roles?email=eq.${encodeURIComponent(email)}&select=email&limit=1`)).length > 0;
}
async function authUserId(email: string): Promise<string | null> {
  const res = await rest("rpc/get_auth_user_id_by_email", { method: "POST", body: JSON.stringify({ p_email: email }) });
  if (!res.ok) throw new Error(`user lookup failed (HTTP ${res.status})`);
  const id = await res.json();
  return typeof id === "string" && id ? id : null;
}
async function callerPassesInternalMfa(claims: { sub?: string; email?: string; aal?: string; session_id?: string }): Promise<boolean> {
  try {
    const res = await rest("rpc/check_internal_mfa_for_edge_function", {
      method: "POST",
      body: JSON.stringify({ p_user_id: claims.sub ?? null, p_email: claims.email ?? null, p_session_id: claims.session_id ?? null, p_aal: claims.aal ?? null, p_function: "portal-email-alias" }),
    });
    return res.ok && (await res.json()) === true;
  } catch {
    return false;
  }
}
async function callerCanManageClients(email: string): Promise<boolean> {
  const r = await rows(`account_roles?email=eq.${encodeURIComponent(email)}&select=can_manage_clients&limit=1`);
  return r.length === 1 && r[0].can_manage_clients === true;
}

async function aliasesOf(userId: string): Promise<any[]> {
  return rows(`client_email_aliases?user_id=eq.${encodeURIComponent(userId)}&select=email,status,added_by,created_at,confirmed_at,expires_at,attempts,code_hash,sends,window_started_at&order=created_at.asc`);
}
function publicView(list: any[]) {
  const now = Date.now();
  return list
    .filter((a) => a.status === "confirmed" || (a.expires_at && Date.parse(a.expires_at) > now))
    .map((a) => ({ email: a.email, status: a.status, added_by: a.added_by, added_at: a.created_at, confirmed_at: a.confirmed_at || null }));
}
async function recordCounts(email: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [table, kind] of RECORD_TABLES) {
    const res = await rest(`${table}?client_email=eq.${encodeURIComponent(email)}&select=id`, { headers: { Prefer: "count=exact", Range: "0-0" } });
    const range = res.headers.get("content-range") || "";
    out[kind] = Number(range.split("/")[1]) || 0;
  }
  return out;
}

// After proof of ownership: may this email be linked to this account?
// Returns null when it may, or the outcome to report.
async function blockedOutcome(email: string, userId: string): Promise<string | null> {
  if (await isStaff(email)) return "not_allowed";
  const owner = await authUserId(email);
  if (owner && owner !== userId) return "own_account";
  const taken = await rows(`client_email_aliases?email=eq.${encodeURIComponent(email)}&status=eq.confirmed&select=user_id`);
  if (taken.some((t) => t.user_id !== userId)) return "linked_elsewhere";
  return null;
}
async function confirmRow(userId: string, email: string): Promise<void> {
  const res = await rest(`client_email_aliases?user_id=eq.${encodeURIComponent(userId)}&email=eq.${encodeURIComponent(email)}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "confirmed", code_hash: null, expires_at: null, attempts: 0, confirmed_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`could not confirm (HTTP ${res.status})`);
}
async function deleteRow(userId: string, email: string): Promise<void> {
  await rest(`client_email_aliases?user_id=eq.${encodeURIComponent(userId)}&email=eq.${encodeURIComponent(email)}`, { method: "DELETE" });
}
async function upsertPending(row: Record<string, unknown>): Promise<void> {
  const res = await rest("client_email_aliases?on_conflict=user_id,email", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify([row]),
  });
  if (!res.ok) throw new Error(`could not save (HTTP ${res.status})`);
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
const para = (t: string, extra = "") => `<p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 16px; ${extra}">${t}</p>`;
async function sendEmail(to: string, subject: string, html: string, text: string): Promise<boolean> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from: `Triple H Enterprises <${LEAD_EMAIL_FROM}>`, to, subject, html, text }),
  });
  if (!res.ok) console.error(`portal-email-alias: email failed (HTTP ${res.status})`);
  return res.ok;
}
function codeEmail(code: string) {
  const html = shell("Confirm this email",
    para("Enter this code in your Triple H client portal to add this email to your account:") +
    `<p style="font-size: 34px; letter-spacing: 8px; font-weight: 700; color: #0a0a0a; text-align: center; margin: 8px 0 20px; font-family: Menlo, Consolas, monospace;">${code}</p>` +
    para(`It works for ${CODE_MINUTES} minutes.`) +
    para("If you didn't ask for this, you can ignore this email. Nothing is linked until this code is entered.", "color: #777; font-size: 13px;"));
  const text = [
    "Confirm this email for your Triple H client portal", "",
    `Enter this code in the portal: ${code}`, `It works for ${CODE_MINUTES} minutes.`, "",
    "If you didn't ask for this, you can ignore this email. Nothing is linked until this code is entered.",
  ].join("\n");
  return { subject: `${code} is your Triple H confirmation code`, html, text };
}
function linkEmail(accountEmail: string, url: string) {
  const masked = maskEmail(accountEmail);
  const html = shell("Add this email to your portal",
    para(`Triple H is adding this email to your client portal account (${escapeHtml(masked)}), so invoices, quotes and jobs sent here show up there too.`) +
    para(`Open this link while signed in to that account. It works for ${LINK_DAYS} days.`) +
    `<p style="text-align: center; margin: 0 0 8px;"><a href="${url}" style="display: inline-block; background: #ff8000; color: #ffffff; text-decoration: none; font-size: 15px; font-weight: 600; padding: 14px 32px; border-radius: 8px;">Confirm this email</a></p>` +
    para("If you didn't ask Triple H for this, ignore this email. Nothing is linked until the link is opened.", "color: #777; font-size: 13px; margin-top: 16px;"));
  const text = [
    "Add this email to your Triple H client portal", "",
    `Triple H is adding this email to your client portal account (${masked}).`,
    `Open this link while signed in to that account (works for ${LINK_DAYS} days): ${url}`, "",
    "If you didn't ask Triple H for this, ignore this email. Nothing is linked until the link is opened.",
  ].join("\n");
  return { subject: "Confirm this email for your Triple H portal", html, text };
}

// Saved cards on an account's own Stripe customer (merge).
async function stripeCustomerId(email: string): Promise<string | null> {
  const r = await rows(`stripe_customers?client_email=eq.${encodeURIComponent(email)}&select=stripe_customer_id&limit=1`);
  return r.length ? r[0].stripe_customer_id : null;
}
async function savedCards(email: string): Promise<string[]> {
  const customer = await stripeCustomerId(email);
  if (!customer) return [];
  if (!STRIPE_SECRET_KEY) throw new Error("STRIPE_CLIENT_CARDS_SECRET_KEY is not set");
  const res = await fetch(`https://api.stripe.com/v1/payment_methods?customer=${encodeURIComponent(customer)}&type=card&limit=100`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  if (!res.ok) throw new Error(`could not list saved cards (HTTP ${res.status})`);
  const body = await res.json();
  return (body.data || []).map((pm: any) => pm.id);
}
async function detachCard(id: string): Promise<boolean> {
  const res = await fetch(`https://api.stripe.com/v1/payment_methods/${encodeURIComponent(id)}/detach`, {
    method: "POST",
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": `merge-detach-v1-${id}` },
  });
  return res.ok;
}
async function setBan(userId: string): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "PUT", headers: SR_HEADERS, body: JSON.stringify({ ban_duration: BAN_DURATION }),
  });
  return res.ok;
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: CORS_HEADERS });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  const fail = (error: string, status = 400, extra: Record<string, unknown> = {}) => json({ ok: false, error, ...extra }, status);

  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const claims = decodeJwtPayload(token);
    if (claims.role !== "authenticated" || !claims.email || !claims.sub) return fail("Must be signed in.", 401);
    const me = String(claims.email).toLowerCase();
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    const cleanEmail = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");

    // ---- staff ---------------------------------------------------------------
    if (action.startsWith("staff_") || action === "merge_preview" || action === "merge") {
      if (!(await isStaff(me))) return fail("Not allowed.", 403);
      if (!(await callerPassesInternalMfa(claims))) return fail("Two-factor sign-in required: sign out of the Workspace and sign back in with your authenticator code.", 403);
      if (!(await callerCanManageClients(me))) return fail("Your account can't manage clients.", 403);

      const accountEmail = cleanEmail(body.account_email);
      if (!EMAIL_SHAPE.test(accountEmail)) return fail("Missing the client's portal email.");
      if (await isStaff(accountEmail)) return fail("That is a Workspace account, not a client portal account.");
      const accountId = await authUserId(accountEmail);
      if (!accountId) return fail("That client has no portal account yet.", 404);

      if (action === "staff_list") return json({ ok: true, signin: accountEmail, emails: publicView(await aliasesOf(accountId)) });

      if (action === "staff_remove") {
        await deleteRow(accountId, cleanEmail(body.email));
        return json({ ok: true, emails: publicView(await aliasesOf(accountId)) });
      }

      if (action === "staff_add") {
        const email = cleanEmail(body.email);
        if (email.length > 254 || !EMAIL_SHAPE.test(email)) return fail("Enter a valid email address.");
        if (email === accountEmail) return fail("That is already this client's sign-in email.");
        const blocked = await blockedOutcome(email, accountId);
        if (blocked === "own_account") return fail("That email has its own portal account. Merge the two accounts instead.", 409, { outcome: "own_account" });
        if (blocked === "linked_elsewhere") return fail("That email is already linked to another portal account.", 409, { outcome: "linked_elsewhere" });
        if (blocked) return fail("That email can't be added to a client account.", 409, { outcome: blocked });
        const existing = (await aliasesOf(accountId)).find((a) => a.email === email);
        if (existing && existing.status === "confirmed") return fail("That email is already confirmed for this client.");
        const t = linkToken();
        await upsertPending({
          user_id: accountId, email, status: "pending", code_hash: await hmac(`link:${t}`),
          expires_at: new Date(Date.now() + LINK_DAYS * 86400_000).toISOString(), attempts: 0, sends: 1,
          window_started_at: new Date().toISOString(), added_by: "staff", added_by_email: me,
        });
        const m = linkEmail(accountEmail, `${PORTAL_SETTINGS_URL}?confirm_email=${t}`);
        await sendEmail(email, m.subject, m.html, m.text);
        return json({ ok: true, emails: publicView(await aliasesOf(accountId)) });
      }

      // Merge B (merge_email) into A (account_email).
      const mergeEmail = cleanEmail(body.merge_email);
      if (!EMAIL_SHAPE.test(mergeEmail) || mergeEmail === accountEmail) return fail("Pick a different portal account to merge in.");
      if (await isStaff(mergeEmail)) return fail("That is a Workspace account, not a client portal account.");
      const mergeId = await authUserId(mergeEmail);
      if (!mergeId) return fail("There is no portal account for that email.", 404);
      const cards = await savedCards(mergeEmail);
      const theirAliases = (await aliasesOf(mergeId)).filter((a) => a.status === "confirmed").map((a) => a.email);

      if (action === "merge_preview") {
        return json({ ok: true, keep: accountEmail, merge: mergeEmail, saved_cards: cards.length, their_emails: theirAliases, records: await recordCounts(mergeEmail) });
      }
      if (action === "merge") {
        if (body.confirm !== true) return fail("Confirm the merge first.");
        // 1. B can't sign in any more (the same lock team-admin uses to deactivate).
        if (!(await setBan(mergeId))) throw new Error("could not lock the merged account");
        // 2. B's saved cards can't move to A's Stripe customer: detach them so nothing stays chargeable.
        let detached = 0;
        for (const id of cards) if (await detachCard(id)) detached++;
        // 3. B's confirmed emails move to A, then B's own email joins them.
        for (const email of theirAliases) {
          await rest(`client_email_aliases?user_id=eq.${encodeURIComponent(mergeId)}&email=eq.${encodeURIComponent(email)}`, {
            method: "PATCH", body: JSON.stringify({ user_id: accountId, added_by: "merge", added_by_email: me }),
          });
        }
        await upsertPending({ user_id: accountId, email: mergeEmail, status: "confirmed", code_hash: null, expires_at: null, attempts: 0, added_by: "merge", added_by_email: me, confirmed_at: new Date().toISOString() });
        console.log(`portal-email-alias: merged ${maskEmail(mergeEmail)} into ${maskEmail(accountEmail)} by ${maskEmail(me)}; detached ${detached}/${cards.length} cards`);
        return json({ ok: true, detached_cards: detached, saved_cards: cards.length, emails: publicView(await aliasesOf(accountId)) });
      }
      return fail("unknown_action");
    }

    // ---- the signed-in client ---------------------------------------------
    if (await isStaff(me)) return fail("Workspace accounts don't have portal emails.", 403);
    const userId = String(claims.sub);

    if (action === "list") return json({ ok: true, signin: me, emails: publicView(await aliasesOf(userId)) });

    if (action === "remove") {
      await deleteRow(userId, cleanEmail(body.email));
      return json({ ok: true, emails: publicView(await aliasesOf(userId)) });
    }

    if (action === "add") {
      const email = cleanEmail(body.email);
      if (email.length > 254 || !EMAIL_SHAPE.test(email)) return fail("Enter a valid email address.");
      if (email === me) return fail("That's the email you sign in with. It's already yours.");
      const mine = await aliasesOf(userId);
      const existing = mine.find((a) => a.email === email);
      if (existing && existing.status === "confirmed") return fail("That email is already on your account.");
      if (mine.filter((a) => a.status === "confirmed").length >= MAX_CONFIRMED) return fail("That's as many emails as one account can have. Remove one first.");
      const now = Date.now();
      const livePending = mine.filter((a) => a.status === "pending" && a.email !== email && a.expires_at && Date.parse(a.expires_at) > now);
      if (livePending.length >= MAX_PENDING) return fail("Finish or remove the emails you've already started first.");
      const inWindow = existing && now - Date.parse(existing.window_started_at) < 3600_000;
      // Quietly: no more codes this hour, and the answer reads the same.
      if (inWindow && existing.sends >= MAX_CODES_PER_HOUR) return json({ ok: true, next: "code" });
      const code = sixDigitCode();
      await upsertPending({
        user_id: userId, email, status: "pending", code_hash: await hmac(`code:${userId}:${email}:${code}`),
        expires_at: new Date(now + CODE_MINUTES * 60_000).toISOString(), attempts: 0,
        sends: inWindow ? existing.sends + 1 : 1,
        window_started_at: inWindow ? existing.window_started_at : new Date(now).toISOString(),
        added_by: "client", added_by_email: me,
      });
      const m = codeEmail(code);
      await sendEmail(email, m.subject, m.html, m.text);
      return json({ ok: true, next: "code" });
    }

    // After proof: link it, or say why not (nothing moved either way).
    const finish = async (email: string) => {
      const blocked = await blockedOutcome(email, userId);
      if (blocked) {
        await deleteRow(userId, email);
        return json({ ok: true, outcome: blocked, email });
      }
      await confirmRow(userId, email);
      return json({ ok: true, outcome: "confirmed", email, records: await recordCounts(email), emails: publicView(await aliasesOf(userId)) });
    };

    if (action === "verify") {
      const email = cleanEmail(body.email);
      const code = typeof body.code === "string" ? body.code.trim() : "";
      const wrong = (error = "That code didn't work. Check the latest email from us, or send a new code.") => fail(error);
      if (!CODE_SHAPE.test(code)) return wrong();
      const row = (await aliasesOf(userId)).find((a) => a.email === email && a.status === "pending" && a.added_by === "client");
      if (!row || !row.expires_at || Date.parse(row.expires_at) < Date.now()) return wrong("That code has expired. Send a new code.");
      if (row.attempts >= MAX_WRONG_TRIES) return wrong("Too many wrong tries. Send a new code.");
      if ((await hmac(`code:${userId}:${email}:${code}`)) !== row.code_hash) {
        await rest(`client_email_aliases?user_id=eq.${encodeURIComponent(userId)}&email=eq.${encodeURIComponent(email)}`, { method: "PATCH", body: JSON.stringify({ attempts: row.attempts + 1 }) });
        return wrong();
      }
      return finish(email);
    }

    if (action === "confirm_link") {
      const t = typeof body.token === "string" ? body.token.trim().toLowerCase() : "";
      if (!TOKEN_SHAPE.test(t)) return fail("That link doesn't work. Ask Triple H to send a new one.");
      const hash = await hmac(`link:${t}`);
      const match = await rows(`client_email_aliases?code_hash=eq.${hash}&status=eq.pending&select=user_id,email,expires_at`);
      if (!match.length || Date.parse(match[0].expires_at) < Date.now()) return fail("That link has expired or was already used. Ask Triple H to send a new one.");
      if (match[0].user_id !== userId) return fail("This link is for a different portal account. Sign in with the account Triple H added it to.", 403);
      return finish(match[0].email);
    }

    return fail("unknown_action");
  } catch (err: any) {
    console.error(`portal-email-alias: ${err.message}`);
    return json({ ok: false, error: "Something went wrong. Please try again, or call (435) 414-1667." }, 500);
  }
});
