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
//   - by the same trigger with { invoice_id, refund: true } when money goes
//     back on a sale Google already has (fix plan RP2.8, 2026-11-07): one
//     "refund" event for the amount not yet reported;
//   - by the daily ga4-conversion-retry cron with { retry_pending: true },
//     which re-tries any sale or refund still pending and gives up on sales
//     older than Google's 72-hour window.
//
// What goes to Google: the anonymous visit ID, "invoice-<database id>" as
// the transaction id (the invoice's internal id, not its INV- number; GA
// drops a repeat with the same id), the amount and USD. Never the client's
// name, email, phone or address. Ad consent is sent as denied: the visitor
// agreed to analytics, not ads.
//
// "Sent" means Google accepted it (fix plan RP2.20): /mp/collect answers 2xx
// even for a malformed event, so each event is first checked on Google's
// validation endpoint (/debug/mp/collect); one it rejects is marked failed
// with Google's reason and never counted as sent.
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
  refund_value?: number | string;
  refund_sent_value?: number | string;
  refund_status?: string | null;
  refund_attempts?: number;
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

function refundPayload(c: Conversion, amount: number) {
  return {
    client_id: c.ga_client_id,
    non_personalized_ads: true,
    consent: { ad_user_data: "DENIED", ad_personalization: "DENIED" },
    events: [{
      name: "refund",
      params: { transaction_id: `invoice-${c.invoice_id}`, value: amount, currency: c.currency || "USD", source: "invoice_refunded" },
    }],
  };
}

const cents = (v: unknown) => Math.round((Number(v) || 0) * 100);

// Google's validation endpoint first, then the real one. Returns "" when
// Google took it, else the reason.
async function deliver(payload: unknown): Promise<{ ok: boolean; error: string; invalid: boolean }> {
  const qs = `measurement_id=${encodeURIComponent(MEASUREMENT_ID)}&api_secret=${encodeURIComponent(MP_API_SECRET)}`;
  const body = JSON.stringify(payload);
  try {
    const check = await fetch(`https://www.google-analytics.com/debug/mp/collect?${qs}`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    if (!(check.status >= 200 && check.status < 300)) return { ok: false, error: `Google's check answered ${check.status}`, invalid: false };
    const out = await check.json().catch(() => ({}));
    const msgs = Array.isArray(out && out.validationMessages) ? out.validationMessages : [];
    if (msgs.length) {
      const first = msgs[0] || {};
      return { ok: false, error: ("Google rejected it: " + String(first.description || first.validationCode || "invalid event")).slice(0, 300), invalid: true };
    }
    const res = await fetch(`https://www.google-analytics.com/mp/collect?${qs}`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    if (res.status >= 200 && res.status < 300) return { ok: true, error: "", invalid: false };
    return { ok: false, error: `Google answered ${res.status}`, invalid: false };
  } catch (_e) {
    return { ok: false, error: "network", invalid: false };
  }
}

// A refund for a sale Google already has. Returns the new refund status.
async function sendRefund(c: Conversion): Promise<string> {
  if (c.status !== "sent" || c.refund_status !== "pending") return c.refund_status || "none";
  const amount = (cents(c.refund_value) - cents(c.refund_sent_value)) / 100;
  if (!(amount > 0)) {
    await update(c.invoice_id, { refund_status: "sent", refund_error: null });
    return "sent";
  }
  const attempts = (c.refund_attempts || 0) + 1;
  const r = await deliver(refundPayload(c, amount));
  if (r.ok) {
    await update(c.invoice_id, { refund_status: "sent", refund_sent_value: Number(c.refund_value), refund_sent_at: new Date().toISOString(), refund_attempts: attempts, refund_error: null });
    return "sent";
  }
  const status = r.invalid || attempts >= MAX_ATTEMPTS ? "failed" : "pending";
  await update(c.invoice_id, { refund_status: status, refund_attempts: attempts, refund_error: r.error });
  return status;
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
  const r = await deliver(buildPayload(c));
  if (r.ok) {
    await update(c.invoice_id, { status: "sent", sent_at: new Date().toISOString(), attempts, last_error: null });
    return "sent";
  }
  const status = r.invalid || attempts >= MAX_ATTEMPTS ? "failed" : "pending";
  await update(c.invoice_id, { status, attempts, last_error: r.error });
  return status;
}

Deno.serve(async (req: Request) => {
  // Only the trigger and the cron call this, both with the service-role key.
  // The public anon key would pass the platform's verify_jwt, so check here.
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!SERVICE_ROLE_KEY || token !== SERVICE_ROLE_KEY) return json({ ok: false, error: "Unauthorized" }, 401);
  if (!MP_API_SECRET) return json({ ok: false, error: "GA4_MP_API_SECRET is not set; rows stay pending" }, 503);

  let body: { invoice_id?: unknown; retry_pending?: unknown; refund?: unknown } = {};
  try { body = await req.json(); } catch (_e) { body = {}; }

  const select = "select=invoice_id,ga_client_id,value,currency,queued_at,status,attempts,refund_value,refund_sent_value,refund_status,refund_attempts";
  let rows: Conversion[] = [];
  if (body.retry_pending === true) {
    const res = await db(`ga_conversions?${select}&status=eq.pending&order=queued_at.asc&limit=200`);
    if (!res.ok) return json({ ok: false, error: `read ${res.status}` }, 502);
    rows = await res.json();
    const ref = await db(`ga_conversions?${select}&status=eq.sent&refund_status=eq.pending&order=queued_at.asc&limit=200`);
    if (!ref.ok) return json({ ok: false, error: `read ${ref.status}` }, 502);
    const refunds: Conversion[] = await ref.json();
    const results: Record<string, number> = {};
    for (const c of rows) { const st = await send(c); results[st] = (results[st] || 0) + 1; }
    for (const c of refunds) { const st = "refund_" + await sendRefund(c); results[st] = (results[st] || 0) + 1; }
    return json({ ok: true, results });
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
    const st = body.refund === true ? "refund_" + await sendRefund(c) : await send(c);
    results[st] = (results[st] || 0) + 1;
  }
  return json({ ok: true, results });
});
