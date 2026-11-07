// Supabase Edge Function: respond-to-quote
//
// Called from portal/quotes.html when a client approves or declines
// one of their own quotes. client_portal_quotes has no update policy
// for the authenticated role at all -- this function is the only way
// that status field ever changes, same reasoning as
// create-payment-intent needing its own function to write
// stripe_payment_intent_id back onto an invoice.
//
// Fix plan RP3.1 (2026-11-07): Steve and Connor are told on BOTH outcomes
// (an approval is a "schedule it" prompt; a decline carries the client's
// reason), by email -- same recipients and pattern as respond-to-contract's
// tellEveryone -- and by a staff push through Send-Push ("quote-response").
// Best effort: the client's answer is already saved by then, and a failed
// notice never blocks or undoes it.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const LEAD_EMAIL_FROM = Deno.env.get("LEAD_EMAIL_FROM") || "";
const STEVE_EMAIL = "steve@triplehenterprisesllc.biz";
const CONNOR_EMAIL = "connor@triplehenterprisesllc.biz";
const WORKSPACE_QUOTES_URL = "https://www.triplehenterprisesllc.biz/tools/clients.html";

function escapeHtml(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function money(n: unknown): string {
  const v = Number(n);
  return Number.isFinite(v) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v) : "";
}

async function sendEmail(payload: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({ from: `Triple H Enterprises <${LEAD_EMAIL_FROM}>`, ...payload }),
    });
    if (!res.ok) console.error(`respond-to-quote: staff email failed (HTTP ${res.status})`);
    return res.ok;
  } catch (err: any) {
    console.error(`respond-to-quote: staff email failed (${err.message})`);
    return false;
  }
}

async function sendStaffPush(title: string, body: string): Promise<void> {
  try {
    // Send-Push, exact casing -- function slugs are case-sensitive.
    const res = await fetch(`${SUPABASE_URL}/functions/v1/Send-Push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ type: "quote-response", title, body }),
    });
    if (!res.ok) console.error(`respond-to-quote: staff push failed (HTTP ${res.status})`);
  } catch (err: any) {
    console.error(`respond-to-quote: staff push failed (${err.message})`);
  }
}

// RP3.1: email + push to staff. Never throws.
async function tellStaff(quote: any, status: "approved" | "declined", declineReason: string | null): Promise<void> {
  const who = String(quote.client_name || quote.client_email || "A client");
  const label = quote.quote_number ? `quote #${quote.quote_number}` : "a quote";
  const total = money(quote.total);
  const what = `${label}${quote.description ? ` (${quote.description})` : ""}${total ? `, ${total}` : ""}`;
  const p = (t: string) => `<p style="font-family: -apple-system, Helvetica, Arial, sans-serif; color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 14px;">${t}</p>`;
  const link = p(`<a href="${WORKSPACE_QUOTES_URL}" style="color: #c96400;">Open Clients in the Workspace</a>`);
  const subject = status === "approved" ? `Approved: ${label} (${who})` : `Declined: ${label} (${who})`;
  const html = status === "approved"
    ? p(`<strong>${escapeHtml(who)}</strong> (${escapeHtml(quote.client_email)}) approved ${escapeHtml(what)}. It's ready to schedule.`) + link
    : p(`<strong>${escapeHtml(who)}</strong> (${escapeHtml(quote.client_email)}) declined ${escapeHtml(what)}.`) +
      p(declineReason ? `Their reason: &ldquo;${escapeHtml(declineReason)}&rdquo;` : "They didn't give a reason.") + link;
  const text = (status === "approved"
    ? [`${who} (${quote.client_email}) approved ${what}. It's ready to schedule.`]
    : [`${who} (${quote.client_email}) declined ${what}.`, declineReason ? `Their reason: "${declineReason}"` : "They didn't give a reason."]
  ).concat([`Workspace: ${WORKSPACE_QUOTES_URL}`]).join("\n");
  const pushBody = status === "approved"
    ? `${who} approved ${label}. Ready to schedule.`
    : `${who} declined ${label}.${declineReason ? ` Reason: ${declineReason.slice(0, 140)}` : ""}`;
  await Promise.all([
    sendEmail({ to: [STEVE_EMAIL, CONNOR_EMAIL], reply_to: quote.client_email || undefined, subject, html, text }),
    sendStaffPush(status === "approved" ? "Quote approved" : "Quote declined", pushBody),
  ]);
}

const ALLOWED_ORIGIN = "https://www.triplehenterprisesllc.biz";
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function decodeJwtPayload(token: string): { email?: string; role?: string; sub?: string } {
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch {
    return {};
  }
}

// Fix plan FP4.2 (2026-11-06, D11): the caller's sign-in email plus the
// emails they have proved they own (client_email_aliases, confirmed only).
// Any failure -- including the table not existing yet -- means the sign-in
// email alone, never more.
async function callerEmails(claims: { email?: string; sub?: string }): Promise<string[]> {
  const out = [String(claims.email || "").toLowerCase()];
  if (!claims.sub) return out;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/client_email_aliases?user_id=eq.${encodeURIComponent(claims.sub)}&status=eq.confirmed&select=email`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    if (res.ok) for (const r of await res.json()) if (r && typeof r.email === "string") out.push(r.email.toLowerCase());
  } catch { /* the sign-in email alone */ }
  return out;
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

    // Any real, authenticated session is enough here -- this caller is
    // a CLIENT, not an internal account, so no account_roles check.
    // The real authorization check is below: does the quote being
    // responded to actually belong to this specific caller.
    if (claims.role !== "authenticated" || !claims.email) {
      return json({ ok: false, error: "Must be signed in." }, 401);
    }

    const { quote_id, action, decline_reason } = await req.json();
    if (typeof quote_id !== "number") {
      return json({ ok: false, error: "Missing quote_id." }, 400);
    }
    if (action !== "approve" && action !== "decline") {
      return json({ ok: false, error: "action must be 'approve' or 'decline'." }, 400);
    }
    // Optional -- a client can decline without giving a reason. Capped
    // well above what a UI would ever reasonably need, just to stop an
    // absurdly long payload rather than to enforce a "real" limit.
    const declineReason = action === "decline" && typeof decline_reason === "string"
      ? decline_reason.trim().slice(0, 2000) || null
      : null;

    const quoteRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_quotes?id=eq.${quote_id}&select=id,client_email,client_name,quote_number,description,total,status`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    if (!quoteRes.ok) {
      return json({ ok: false, error: "Could not look up that quote." }, 502);
    }
    const rows = await quoteRes.json();
    if (!rows.length) {
      return json({ ok: false, error: "Quote not found." }, 404);
    }
    const quote = rows[0];

    // The real authorization boundary: the quote being responded to
    // must belong to the exact email on the caller's own verified
    // session -- never trust a quote_id alone to imply the caller is
    // allowed to respond to it.
    if (!(await callerEmails(claims)).includes(String(quote.client_email).toLowerCase())) {
      return json({ ok: false, error: "That quote doesn't belong to this account." }, 403);
    }
    if (quote.status !== "pending") {
      return json({ ok: false, error: `This quote was already ${quote.status}.` }, 400);
    }

    const newStatus = action === "approve" ? "approved" : "declined";
    const patchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_quotes?id=eq.${quote_id}`,
      {
        method: "PATCH",
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: newStatus, responded_at: new Date().toISOString(), decline_reason: declineReason }),
      },
    );
    if (!patchRes.ok) {
      // Fix plan RP3.22 (2026-11-07): logged, not returned.
      console.error(`respond-to-quote: PATCH of quote ${quote_id} failed (HTTP ${patchRes.status}): ${(await patchRes.text()).slice(0, 500)}`);
      return json({ ok: false, error: "Your answer couldn't be saved just now. Please try again." }, 502);
    }

    await tellStaff(quote, newStatus, declineReason).catch((err: any) => {
      console.error(`respond-to-quote: notices failed (${err?.message || err})`);
    });

    return json({ ok: true, status: newStatus });
  } catch (err: any) {
    console.error("respond-to-quote error:", err?.message || err);
    return json({ ok: false, error: "Something went wrong. Please try again." }, 500);
  }
});
