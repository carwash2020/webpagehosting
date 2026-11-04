// ga4-conversion (Phase 5, 2026-11-04). Tells Google Analytics about a paid
// invoice, from the server, so "which source brings money" closes the loop
// in GA too, not just on Insights.
//
// Called two ways, both with the service-role key from Vault:
//   - by the ga_queue_paid_invoice trigger on public.invoices, the moment an
//     invoice turns paid, with { invoice_id } (see
//     sql/infra/phase5_attribution_and_ga4.sql). The trigger has already
//     queued a ga_conversions row, and only did so if the invoice's job came
//     from a lead or booking that carries a GA visit ID, which the website
//     saves only for visitors who accepted analytics cookies;
//   - by the daily ga4-conversion-retry cron with { retry_pending: true },
//     which re-tries anything still pending and gives up on rows older than
//     Google's 72-hour window.
//
// What goes to Google: the anonymous visit ID, the invoice number as the
// transaction id (GA drops a repeat with the same id), the amount and USD.
// Never the client's name, email, phone or address. Ad consent is sent as
// denied: the visitor agreed to analytics, not ads.
//
// Secrets (Edge Function secrets, never in code): GA4_MP_API_SECRET.
// GA4_MEASUREMENT_ID defaults to the public site's stream, G-TMJJMGY2DQ.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const MP_API_SECRET = Deno.env.get("GA4_MP_API_SECRET") || "";
const MEASUREMENT_ID = Deno.env.get("GA4_MEASUREMENT_ID") || "G-TMJJMGY2DQ";

const WINDOW_MS = 72 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;

type Conversion = {
  invoice_id: number;
  ga_client_id: string;
  value: number | string;
  currency: string;
  queued_at: string;
  status: string;
  attempts: number;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function db(pathAndQuery: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
      ...(init.headers || {}),
    },
  });
}

async function update(invoiceId: number, fields: Record<string, unknown>): Promise<void> {
  await db(`ga_conversions?invoice_id=eq.${invoiceId}`, { method: "PATCH", body: JSON.stringify(fields) });
}

function buildPayload(c: Conversion) {
  const queued = Date.parse(c.queued_at);
  return {
    client_id: c.ga_client_id,
    timestamp_micros: String((Number.isFinite(queued) ? queued : Date.now()) * 1000),
    non_personalized_ads: true,
    consent: { ad_user_data: "DENIED", ad_personalization: "DENIED" },
    events: [{
      name: "purchase",
      params: {
        transaction_id: `invoice-${c.invoice_id}`,
        value: Math.round(Number(c.value) * 100) / 100,
        currency: c.currency || "USD",
        source: "invoice_paid",
      },
    }],
  };
}

// Returns the new status for the row.
async function send(c: Conversion): Promise<string> {
  if (c.status === "sent") return "sent";
  const age = Date.now() - Date.parse(c.queued_at);
  if (!(age < WINDOW_MS)) {
    await update(c.invoice_id, { status: "expired", last_error: "older than Google's 72-hour window" });
    return "expired";
  }
  if (!/^[0-9]{1,20}\.[0-9]{1,20}$/.test(c.ga_client_id || "")) {
    await update(c.invoice_id, { status: "failed", last_error: "visit ID not in GA's format" });
    return "failed";
  }
  const attempts = (c.attempts || 0) + 1;
  let ok = false;
  let error = "";
  try {
    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(MEASUREMENT_ID)}&api_secret=${encodeURIComponent(MP_API_SECRET)}`;
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(buildPayload(c)) });
    ok = res.status >= 200 && res.status < 300;
    if (!ok) error = `Google answered ${res.status}`;
  } catch (_e) {
    error = "network";
  }
  if (ok) {
    await update(c.invoice_id, { status: "sent", sent_at: new Date().toISOString(), attempts, last_error: null });
    return "sent";
  }
  const status = attempts >= MAX_ATTEMPTS ? "failed" : "pending";
  await update(c.invoice_id, { status, attempts, last_error: error });
  return status;
}

Deno.serve(async (req: Request) => {
  // Only the trigger and the cron call this, both with the service-role key.
  // The public anon key would pass the platform's verify_jwt, so check here.
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!SERVICE_ROLE_KEY || token !== SERVICE_ROLE_KEY) return json({ ok: false, error: "Unauthorized" }, 401);
  if (!MP_API_SECRET) return json({ ok: false, error: "GA4_MP_API_SECRET is not set; rows stay pending" }, 503);

  let body: { invoice_id?: unknown; retry_pending?: unknown } = {};
  try { body = await req.json(); } catch (_e) { body = {}; }

  const select = "select=invoice_id,ga_client_id,value,currency,queued_at,status,attempts";
  let rows: Conversion[] = [];
  if (body.retry_pending === true) {
    const res = await db(`ga_conversions?${select}&status=eq.pending&order=queued_at.asc&limit=200`);
    if (!res.ok) return json({ ok: false, error: `read ${res.status}` }, 502);
    rows = await res.json();
  } else {
    const id = Number(body.invoice_id);
    if (!Number.isSafeInteger(id) || id <= 0) return json({ ok: false, error: "invoice_id required" }, 400);
    const res = await db(`ga_conversions?${select}&invoice_id=eq.${id}`);
    if (!res.ok) return json({ ok: false, error: `read ${res.status}` }, 502);
    rows = await res.json();
    if (!rows.length) return json({ ok: true, skipped: "nothing queued for this invoice" });
  }

  const results: Record<string, number> = {};
  for (const c of rows) {
    const s = await send(c);
    results[s] = (results[s] || 0) + 1;
  }
  return json({ ok: true, results });
});
