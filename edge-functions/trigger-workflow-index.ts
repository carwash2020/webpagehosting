// Supabase Edge Function: trigger-workflow
//
// Server-side proxy so Dev Tools can trigger a GitHub Actions
// workflow_dispatch without ever exposing a GitHub token to the
// browser. Mirrors the pattern already used for Supabase's own
// service_role key throughout this project: the browser calls this
// function with its own real Supabase auth session; this function
// alone holds the actual GitHub credential (a Supabase Edge Function
// secret, never in git, never in client-side JS) and makes the
// privileged call server-side.
//
// Required secret (Supabase dashboard -> Edge Functions -> Secrets):
//   GITHUB_PAT -- a fine-grained GitHub PAT scoped to ONLY
//                 "Actions: Read and write" on carwash2020/webpagehosting,
//                 no other repository or account permissions.
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-provided by Supabase.)

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GITHUB_PAT = Deno.env.get("GITHUB_PAT");

const REPO_OWNER = "carwash2020";
const REPO_NAME = "webpagehosting";

// Only these exact workflow filenames can ever be dispatched --
// prevents this endpoint being usable to trigger anything unexpected,
// even if some other check here were ever weakened by accident.
const ALLOWED_WORKFLOWS = new Set([
  "backup-cms-content.yml",
  "backup-business-data.yml",
  "check-links.yml",
  "lighthouse.yml",
  "cleanup-artifacts.yml",
]);

// Reads the caller's JWT claims WITHOUT verifying the signature --
// signature verification already happened before this function even
// ran, since the function is deployed with verify_jwt: true. This is
// only reading the role claim to tell "anon key only" apart from "a
// real logged-in user" -- verify_jwt alone can't make that
// distinction, since the public anon key is itself a validly-signed
// JWT for this project, just with role: "anon" instead of
// role: "authenticated".
function decodeJwtPayload(token: string): { email?: string; role?: string } {
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch {
    return {};
  }
}

// Same trust boundary Dev Tools itself uses -- a real account with a
// row in account_roles, not just "logged in".
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
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const claims = decodeJwtPayload(token);

    if (claims.role !== "authenticated" || !claims.email) {
      return new Response(JSON.stringify({ ok: false, error: "Must be signed in with a real session." }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!(await callerHasAssignedRole(claims.email))) {
      return new Response(JSON.stringify({ ok: false, error: "This account has no assigned role." }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!GITHUB_PAT) {
      return new Response(
        JSON.stringify({ ok: false, error: "GITHUB_PAT secret is not set yet -- add it in the Supabase dashboard under Edge Functions -> Secrets." }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    const { workflow } = await req.json();
    if (typeof workflow !== "string" || !ALLOWED_WORKFLOWS.has(workflow)) {
      return new Response(JSON.stringify({ ok: false, error: "Unknown or disallowed workflow." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const ghRes = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${workflow}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GITHUB_PAT}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ ref: "main" }),
      },
    );

    if (ghRes.status === 204) {
      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
    }
    const errText = await ghRes.text();
    return new Response(
      JSON.stringify({ ok: false, error: `GitHub API HTTP ${ghRes.status}: ${errText.slice(0, 300)}` }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
