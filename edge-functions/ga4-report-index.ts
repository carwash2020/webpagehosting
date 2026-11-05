// ga4-report (Phase 5, 2026-11-04). Once a day, reads the public website's
// numbers from Google Analytics (GA4 Data API) and stores them in
// public.ga_report_cache for Dashboard > Insights "The website": visits,
// calls tapped, bookings, where visits come from, top pages. The browser
// never talks to Google and never sees a Google credential; it reads the
// cached copy like any other table, as the signed-in staff member.
//
// Caller: the ga4-report-daily cron, with the service-role key from Vault.
//
// Secrets (Edge Function secrets, set by Connor, never in code or chat):
//   GA4_SERVICE_ACCOUNT_JSON  the Google Cloud service account key (JSON),
//                             whose email is a Viewer on the GA4 property;
//   GA4_PROPERTY_ID           the numeric GA4 property id (not secret, kept
//                             beside the key so the code carries no ids).
//
// Read-only on Google's side (analytics.readonly scope). Writes only the
// cache table. Three periods (30 / 90 / 365 days, through yesterday) in
// three batch calls.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SA_JSON = Deno.env.get("GA4_SERVICE_ACCOUNT_JSON") || "";
const PROPERTY_ID = (Deno.env.get("GA4_PROPERTY_ID") || "").trim();

const PERIODS: Array<[string, number]> = [["30d", 30], ["90d", 90], ["365d", 365]];
// The site's own events (js/analytics-events.js) that the Insights tiles count.
const EVENTS = ["phone_click", "text_click", "email_click", "book_cta_click", "booking_completed", "lead_form_submitted"];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function b64url(bytes: Uint8Array | string): string {
  const bin = typeof bytes === "string" ? bytes : String.fromCharCode(...bytes);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function googleAccessToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const pem = sa.private_key.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (ch) => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." + b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: unsigned + "." + b64url(sig) }).toString(),
  });
  if (!res.ok) throw new Error(`Google sign-in failed (${res.status})`);
  const out = await res.json();
  if (!out.access_token) throw new Error("Google sign-in returned no token");
  return out.access_token;
}

// Same labels, in the same order, as public.insights_channel() in
// sql/infra/phase5_attribution_and_ga4.sql, so both Insights phones agree.
const GBP = ["gbp", "gmb", "google_business", "googlebusiness", "google-business", "google_business_profile"];
const SOCIAL = /(^|\.)(facebook|instagram|nextdoor|tiktok|twitter|x|linkedin|youtube|pinterest)\.com$|^t\.co$|^(facebook|instagram|nextdoor|tiktok|linkedin|youtube|pinterest)$/;
function channelFor(sourceRaw: string, mediumRaw: string, campaignRaw: string): string {
  const s = (sourceRaw || "").toLowerCase().trim();
  const m = (mediumRaw || "").toLowerCase().trim();
  const campaign = (campaignRaw || "").trim();
  const c = campaign.toLowerCase();
  if (GBP.includes(s) || GBP.includes(m) || GBP.includes(c)) return "Google Business";
  if (s === "(direct)") return "Direct";
  if (campaign && !campaign.startsWith("(")) return campaign.slice(0, 60);
  if (s === "google" && ["cpc", "ppc", "paid", "paid_search"].includes(m)) return "Google Ads";
  if (m === "organic" && s.split(".").includes("google")) return "Google search";
  if (SOCIAL.test(s) || m === "social" || m === "organic_social") return "Social";
  if (m === "organic") return "Other search";
  if (m === "referral") return "Other websites";
  return "Other";
}

type Row = { dimensionValues?: Array<{ value: string }>; metricValues?: Array<{ value: string }> };
const dim = (r: Row, i: number) => (r.dimensionValues && r.dimensionValues[i] ? r.dimensionValues[i].value : "");
const met = (r: Row, i: number) => Number(r.metricValues && r.metricValues[i] ? r.metricValues[i].value : 0) || 0;

// "Book online | Triple H Enterprises" and "Triple H Enterprises | Book
// online" both read "Book online".
// Split on the separators without a regex: page titles come from Google, and
// a whitespace-run pattern is slow on hostile input.
function cleanTitle(t: string): string {
  const raw = String(t || "").slice(0, 300);
  let parts = [raw];
  for (const sep of [" | ", " \u2013 ", " \u2014 ", " - "]) parts = parts.flatMap((x) => x.split(sep));
  const own = ["triple h", "triple h enterprises", "triple h enterprises llc", "triple h llc"];
  const kept = parts.map((x) => x.trim()).filter((x) => x && !own.includes(x.toLowerCase()));
  return (kept[0] || raw.trim()).slice(0, 80);
}

function buildReport(period: string, days: number, reports: Array<{ rows?: Row[] }>) {
  const [totals, sources, pages, events] = reports;
  const t = (totals && totals.rows && totals.rows[0]) || {};
  // Maps, not plain objects: every key here is a string Google sent back.
  const channels = new Map<string, number>();
  for (const r of (sources && sources.rows) || []) {
    const name = channelFor(dim(r, 0), dim(r, 1), dim(r, 2));
    channels.set(name, (channels.get(name) || 0) + met(r, 0));
  }
  const byPath = new Map<string, { path: string; title: string; views: number }>();
  for (const r of (pages && pages.rows) || []) {
    const p = (dim(r, 0) || "/").slice(0, 300);
    const row = byPath.get(p) || { path: p, title: cleanTitle(dim(r, 1)), views: 0 };
    row.views += met(r, 0);
    byPath.set(p, row);
  }
  const evCount = (name: string) => {
    let n = 0;
    for (const r of (events && events.rows) || []) if (dim(r, 0) === name) n += met(r, 0);
    return n;
  };
  return {
    period,
    days,
    sessions: met(t as Row, 0),
    users: met(t as Row, 1),
    calls: evCount("phone_click"),
    texts: evCount("text_click"),
    emails: evCount("email_click"),
    booking_clicks: evCount("book_cta_click"),
    bookings: evCount("booking_completed"),
    lead_forms: evCount("lead_form_submitted"),
    channels: Array.from(channels, ([name, sessions]) => ({ name, sessions })).sort((a, b) => b.sessions - a.sessions),
    pages: Array.from(byPath.values()).sort((a, b) => b.views - a.views).slice(0, 10),
  };
}

function requestsFor(days: number) {
  const dateRanges = [{ startDate: `${days}daysAgo`, endDate: "yesterday" }];
  return [
    { dateRanges, metrics: [{ name: "sessions" }, { name: "totalUsers" }] },
    { dateRanges, dimensions: [{ name: "sessionSource" }, { name: "sessionMedium" }, { name: "sessionCampaignName" }], metrics: [{ name: "sessions" }], limit: 250 },
    { dateRanges, dimensions: [{ name: "pagePath" }, { name: "pageTitle" }], metrics: [{ name: "screenPageViews" }], orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }], limit: 25 },
    { dateRanges, dimensions: [{ name: "eventName" }], metrics: [{ name: "eventCount" }], dimensionFilter: { filter: { fieldName: "eventName", inListFilter: { values: EVENTS } } } },
  ];
}

Deno.serve(async (req: Request) => {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!SERVICE_ROLE_KEY || token !== SERVICE_ROLE_KEY) return json({ ok: false, error: "Unauthorized" }, 401);
  if (!SA_JSON || !/^\d+$/.test(PROPERTY_ID)) {
    return json({ ok: false, error: "GA4_SERVICE_ACCOUNT_JSON or GA4_PROPERTY_ID is not set; nothing fetched" }, 503);
  }
  let sa: { client_email: string; private_key: string };
  try {
    sa = JSON.parse(SA_JSON);
    if (!sa.client_email || !sa.private_key) throw new Error("missing fields");
  } catch (_e) {
    return json({ ok: false, error: "GA4_SERVICE_ACCOUNT_JSON is not a service account key" }, 503);
  }

  let access: string;
  try {
    access = await googleAccessToken(sa);
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 502);
  }

  const saved: string[] = [];
  const failed: Record<string, string> = {};
  for (const [period, days] of PERIODS) {
    try {
      const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY_ID}:batchRunReports`, {
        method: "POST",
        headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
        body: JSON.stringify({ requests: requestsFor(days) }),
      });
      if (!res.ok) { failed[period] = `Google answered ${res.status}`; continue; }
      const out = await res.json();
      const report = buildReport(period, days, out.reports || []);
      const put = await fetch(`${SUPABASE_URL}/rest/v1/ga_report_cache?on_conflict=tenant_id,period`, {
        method: "POST",
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify([{ period, report, fetched_at: new Date().toISOString() }]),
      });
      if (!put.ok) { failed[period] = `save ${put.status}`; continue; }
      saved.push(period);
    } catch (_e) {
      failed[period] = "network";
    }
  }
  // Yesterday's copy stays in place for any period that failed today.
  return json({ ok: saved.length === PERIODS.length, saved, failed }, saved.length ? 200 : 502);
});
