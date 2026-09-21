// Supabase Edge Function: ensure-my-referral-code
//
// Self-serve companion to send-invite's ensureAccountCode() (direct
// request, 2026-09-21, "refine our code system" -- closes a real
// coverage gap: only a portal account created AFTER the referral-code
// feature shipped gets a code automatically. Anyone invited earlier
// just saw a "call us" message in Settings with no way to get one
// themselves). Called by the portal's own account when it finds no
// existing client_account_codes row for itself.
//
// Also returns a live usage_count -- how many th_leads/th_bookings
// rows were captured with this exact code -- so the portal panel can
// show a client that their link is actually being used, not just
// display the link and leave them guessing. A portal account has no
// read access to either table (both are internal-only, see their own
// RLS), so this count can only be computed here, with the service
// role, same reasoning as resolve-referral-code's public name lookup.
//
// Deliberately does NOT accept an email/name in the request body the
// way send-invite does for staff -- the email is read only from the
// caller's own verified JWT, so this can only ever create or read a
// code for the account actually making the call, never someone
// else's.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

// Same alphabet and retry logic as generateAccountCode()/ensureAccountCode()
// in send-invite/index.ts -- kept in sync deliberately, not shared via an
// import, matching this project's existing convention of small,
// independently-deployable edge functions over a shared library.
const ACCOUNT_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function generateAccountCode(): string {
  let code = "";
  for (let i = 0; i < 7; i++) code += ACCOUNT_CODE_CHARS[Math.floor(Math.random() * ACCOUNT_CODE_CHARS.length)];
  return code;
}

async function lookupDisplayName(email: string): Promise<string> {
  const profileRes = await fetch(
    `${SUPABASE_URL}/rest/v1/client_profiles?client_email=eq.${encodeURIComponent(email)}&select=display_name&limit=1`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  if (profileRes.ok) {
    const rows = await profileRes.json();
    if (rows[0]?.display_name) return rows[0].display_name;
  }
  const invoiceRes = await fetch(
    `${SUPABASE_URL}/rest/v1/client_portal_invoices?client_email=eq.${encodeURIComponent(email)}&select=client_name&limit=1`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  if (invoiceRes.ok) {
    const rows = await invoiceRes.json();
    if (rows[0]?.client_name) return rows[0].client_name;
  }
  return email;
}

async function countUsage(code: string): Promise<number> {
  const [leadsRes, bookingsRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/th_leads?referred_by_code=eq.${encodeURIComponent(code)}&select=id`, {
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, Prefer: "count=exact" },
    }),
    fetch(`${SUPABASE_URL}/rest/v1/th_bookings?referred_by_code=eq.${encodeURIComponent(code)}&select=id`, {
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, Prefer: "count=exact" },
    }),
  ]);
  const leadsCount = parseInt(leadsRes.headers.get("content-range")?.split("/")[1] || "0", 10) || 0;
  const bookingsCount = parseInt(bookingsRes.headers.get("content-range")?.split("/")[1] || "0", 10) || 0;
  return leadsCount + bookingsCount;
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
    const email = claims.email.toLowerCase();

    const existingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_account_codes?email=eq.${encodeURIComponent(email)}&select=code&limit=1`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    if (!existingRes.ok) return json({ ok: false, error: "Could not look up an existing code." }, 502);
    const existingRows = await existingRes.json();

    let code: string;
    if (existingRows[0]?.code) {
      code = existingRows[0].code;
    } else {
      const displayName = await lookupDisplayName(email);
      code = "";
      for (let attempt = 0; attempt < 5 && !code; attempt++) {
        const candidate = generateAccountCode();
        const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/client_account_codes`, {
          method: "POST",
          headers: {
            apikey: SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ email, code: candidate, display_name: displayName }),
        });
        if (insertRes.ok) {
          code = candidate;
        } else {
          const body = await insertRes.text();
          if (!body.includes("23505")) return json({ ok: false, error: "Could not create a referral code." }, 502);
          // A unique violation on email (not code) means a concurrent
          // request already created this account's row -- re-fetch it
          // rather than retrying blind.
          if (body.includes("client_account_codes_email_key")) {
            const raceRes = await fetch(
              `${SUPABASE_URL}/rest/v1/client_account_codes?email=eq.${encodeURIComponent(email)}&select=code&limit=1`,
              { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
            );
            const raceRows = raceRes.ok ? await raceRes.json() : [];
            if (raceRows[0]?.code) code = raceRows[0].code;
          }
        }
      }
      if (!code) return json({ ok: false, error: "Could not generate a unique referral code after several tries." }, 502);
    }

    const usageCount = await countUsage(code);
    return json({ ok: true, code, usage_count: usageCount });
  } catch (err: any) {
    return json({ ok: false, error: err.message }, 500);
  }
});
