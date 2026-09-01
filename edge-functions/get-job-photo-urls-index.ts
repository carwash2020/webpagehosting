// Supabase Edge Function: get-job-photo-urls
//
// Job photos on the portal. client_portal_jobs stores only
// photo_storage_paths (raw Storage paths, e.g. "job-123/172xxx.jpg"),
// never signed URLs -- those expire, so storing one directly would go
// stale. This function generates fresh signed URLs on demand, AFTER
// verifying the requesting client actually owns this job.
//
// That ownership check is the real reason this function exists at
// all, not just a convenience wrapper around Storage's sign endpoint.
// The job-photos bucket's own RLS policies (confirmed directly
// against pg_policies) only check `bucket_id = 'job-photos'` for the
// `authenticated` role, with NO further scoping by owner or path --
// meaning a client's own session token could otherwise call
// `/storage/v1/object/sign/job-photos/...` directly and potentially
// get a signed URL for ANY job's photos, not just their own, since
// the bucket policy itself doesn't stop them. Routing this through a
// function that checks client_portal_jobs.client_email first, and
// only then signs with the service role (which bypasses Storage RLS
// entirely, safe here specifically because the ownership check
// already happened), closes that gap for this feature. It does not
// fix the underlying bucket policy itself, which predates this
// feature and is out of scope here.

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

async function signPath(path: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/job-photos/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ expiresIn: 3600 }),
  });
  if (!res.ok) return "";
  const data = await res.json();
  return data.signedURL ? `${SUPABASE_URL}/storage/v1${data.signedURL}` : "";
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

    // Client-only, no account_roles check -- same shape as
    // create-payment-intent/respond-to-quote. The real authorization
    // check is below: does this job actually belong to the caller.
    if (claims.role !== "authenticated" || !claims.email) {
      return json({ ok: false, error: "Must be signed in." }, 401);
    }

    const { job_id } = await req.json();
    if (typeof job_id !== "number") {
      return json({ ok: false, error: "Missing job_id." }, 400);
    }

    const jobRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_jobs?id=eq.${job_id}&select=id,client_email,photo_storage_paths`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    if (!jobRes.ok) {
      return json({ ok: false, error: "Could not look up that job." }, 502);
    }
    const rows = await jobRes.json();
    if (!rows.length) {
      return json({ ok: false, error: "Job not found." }, 404);
    }
    const jobRow = rows[0];

    if (jobRow.client_email.toLowerCase() !== claims.email.toLowerCase()) {
      return json({ ok: false, error: "That job doesn't belong to this account." }, 403);
    }

    const paths: string[] = Array.isArray(jobRow.photo_storage_paths) ? jobRow.photo_storage_paths : [];
    if (!paths.length) {
      return json({ ok: true, urls: [] });
    }

    const urls = await Promise.all(paths.map(signPath));
    return json({ ok: true, urls: urls.filter(Boolean) });
  } catch (err: any) {
    return json({ ok: false, error: err.message }, 500);
  }
});
