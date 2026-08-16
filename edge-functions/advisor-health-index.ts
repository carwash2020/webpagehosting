// Supabase Edge Function: advisor-health
//
// Same secure-proxy pattern as trigger-workflow: the Supabase
// Management API (which is where the real security/performance
// advisor data lives) needs a Supabase Personal Access Token -- a
// different, more privileged credential than the anon/service_role
// keys the rest of this project uses, and one that must never be
// exposed to the browser. This function alone holds it (as a Supabase
// Edge Function secret, never in git, never in client-side JS) and
// proxies the two advisor endpoints server-side.
//
// Required secret (Supabase dashboard -> Edge Functions -> Secrets):
//   SUPABASE_PAT -- a Supabase Personal Access Token, generated from
//                   account settings (not project settings). This
//                   token can read advisor data for every project the
//                   account has access to -- there's no way to scope
//                   a Supabase PAT to a single project the way the
//                   GitHub PAT was scoped to a single repo, so treat
//                   it as sensitive account-wide access, not
//                   project-limited the way GITHUB_PAT is.
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-provided by Supabase.)

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_PAT = Deno.env.get("SUPABASE_PAT");

const PROJECT_REF = "csvfqdjuobylgafgolho";

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

async function callerHasAssignedRole(email: string): Promise<boolean> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/account_roles?email=eq.${encodeURIComponent(email.toLowerCase())}&select=role_name`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  if (!res.ok) return false;
  const rows = await res.json();
  return rows.length > 0;
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
    if (!(await callerHasAssignedRole(claims.email))) {
      return json({ ok: false, error: "This account has no assigned role." }, 403);
    }

    if (!SUPABASE_PAT) {
      return json({ ok: false, error: "SUPABASE_PAT secret is not set yet -- add it in the Supabase dashboard under Edge Functions -> Secrets." }, 500);
    }

    const [secRes, perfRes] = await Promise.all([
      fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/advisors/security`, {
        headers: { Authorization: `Bearer ${SUPABASE_PAT}` },
      }),
      fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/advisors/performance`, {
        headers: { Authorization: `Bearer ${SUPABASE_PAT}` },
      }),
    ]);

    if (!secRes.ok || !perfRes.ok) {
      const failedRes = !secRes.ok ? secRes : perfRes;
      const errText = await failedRes.text();
      return json({ ok: false, error: `Supabase Management API HTTP ${failedRes.status}: ${errText.slice(0, 300)}` }, 502);
    }

    const security = await secRes.json();
    const performance = await perfRes.json();

    return json({
      ok: true,
      security: security.lints || [],
      performance: performance.lints || [],
    });
  } catch (err: any) {
    return json({ ok: false, error: err.message }, 500);
  }
});
