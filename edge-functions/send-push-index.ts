// Supabase Edge Function: send-push
//
// Handles two trigger sources, distinguished by the request payload:
//
//   { "type": "INSERT", "table": "th_leads", "record": {...} }
//     -- Supabase's own FIXED webhook payload shape, fired instantly by
//     a Database Webhook (or the equivalent SQL trigger) on INSERT to
//     th_leads. Never a custom string -- always this exact shape.
//
//   { "type": "reminder-check" }
//     -- fired once a day by a pg_cron scheduled job. This single call
//     checks ELEVEN separate conditions and sends a SEPARATE notification
//     for each one that's actually true -- these are deliberately not
//     bundled into one digest, per an explicit choice to accept more
//     individual notifications rather than fewer combined ones.
//
//     1. Jobs due tomorrow
//     2. Client follow-ups crossing the 6-month-quiet threshold
//     3. Invoices newly overdue
//     4. Compliance items expiring within 30 days
//     5. High-priority jobs overdue and never started
//     6. Jobs stuck "In Progress" for 7+ days
//     7. Cloud sync hasn't succeeded in 3+ days
//     8. Quotes 14+ days old, linked to a job, never invoiced
//     9. Jobs marked complete with zero photos attached
//     10. Completed jobs whose 30-day warranty ends within 5 days
//     11. Leads sitting 24+ hours with no response (added 2026-08-15 --
//         a new lead gets an instant push via the other trigger above,
//         but until now nothing ever followed up if that lead just sat
//         there unhandled -- this closes that gap using the existing
//         th_leads.handled column, no schema change needed)
//
//   { "type": "weekly-digest" }
//     -- fired once a week (Monday mornings) by its own pg_cron job,
//     separate from daily-reminder-check. This is trend awareness, not
//     task nagging -- deliberately the one exception to "many small
//     notifications instead of one digest" above, since a running
//     count of what happened this week is a genuinely different kind
//     of thing than "here's a specific problem to go fix."
//
//     Only #1 is naturally non-repeating. Everything else is an ONGOING
//     condition (an unpaid invoice stays unpaid for weeks), so the
//     notification_log table de-duplicates -- each category only
//     re-sends after its own resend interval has passed, not on every
//     single run. #9 and #10 are effectively one-time nudges (a very
//     long resend interval rather than a special "never repeat" path).
//     #11 resends daily on purpose -- an unhandled lead getting one
//     daily nudge until it's actually dealt with is the whole point.
//
// Deploy with: supabase functions deploy send-push
// Required secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-provided)

import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;

webpush.setVapidDetails(
  "mailto:contact@triplehenterprisesllc.biz",
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
);

// Matches TERM_DAYS in workspace.html exactly -- keep these in sync if
// invoice terms options ever change there.
const TERM_DAYS: Record<string, number> = { "Due Upon Receipt": 0, "Net 15": 15, "Net 30": 30 };
const FOLLOWUP_THRESHOLD_DAYS = 182; // matches workspace.html's FOLLOWUP_THRESHOLD_DAYS exactly
const COMPLIANCE_WARNING_DAYS = 30; // matches workspace.html's expiring-soon threshold exactly
const STUCK_IN_PROGRESS_DAYS = 7;
const SYNC_STALE_DAYS = 3;
const QUOTE_STALE_DAYS = 14;
const WARRANTY_WARNING_DAYS = 5; // matches job-tracker.html's 30-day warranty window, warns in the last 5 days of it
const UNRESPONDED_LEAD_HOURS = 24;

// Resend intervals -- how long to wait before notifying about the SAME
// still-true item again. Deliberately different per category based on
// how urgent repetition actually is for each. The two "effectively
// once" categories use a very long interval rather than special-casing
// "never resend" as a separate code path.
const RESEND_DAYS: Record<string, number> = {
  followup: 30,
  "invoice-overdue": 7,
  "compliance-expiring": 14,
  "overdue-not-started": 3,
  "stuck-in-progress": 5,
  "sync-stale": 3,
  "quote-unconverted": 14,
  "job-no-photos": 3650,
  "warranty-checkin": 3650,
  "unresponded-lead": 1,
};

function todayAtMidnight(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000));
}

async function supabaseRequest(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      ...(init.headers || {}),
    },
  });
}

async function getAllSubscriptions() {
  const res = await supabaseRequest("/rest/v1/push_subscriptions?select=id,subscription");
  if (!res.ok) return [];
  return res.json();
}

async function deleteSubscription(id: string) {
  await supabaseRequest(`/rest/v1/push_subscriptions?id=eq.${id}`, { method: "DELETE" });
}

// webpush.sendNotification is suspected of hanging indefinitely in this
// Deno runtime rather than failing normally -- this wraps it in a manual
// race against a timeout so ONE stuck call can't consume the entire
// function's resource budget and take everything down with it (which is
// what a 546 WORKER_RESOURCE_LIMIT error actually means: CPU, memory, or
// wall-clock time exceeded).
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

async function sendToAllSubscriptions(payload: { title: string; body: string; url?: string }) {
  const subs = await getAllSubscriptions();
  console.log(`sendToAllSubscriptions: found ${subs.length} subscription(s)`);
  await Promise.allSettled(
    subs.map(async (row: { id: string; subscription: PushSubscriptionJSON }) => {
      try {
        console.log(`Sending to subscription ${row.id}...`);
        await withTimeout(
          webpush.sendNotification(row.subscription as any, JSON.stringify(payload)),
          8000,
          `webpush.sendNotification (subscription ${row.id})`,
        );
        console.log(`Sent successfully to subscription ${row.id}`);
      } catch (err: any) {
        console.error(`Failed to send to subscription ${row.id}:`, err.message, err.statusCode);
        if (err.statusCode === 404 || err.statusCode === 410) await deleteSubscription(row.id);
      }
    }),
  );
}

// --- de-duplication helpers -------------------------------------------

async function wasRecentlyNotified(notifType: string, itemKey: string): Promise<boolean> {
  const res = await supabaseRequest(
    `/rest/v1/notification_log?notif_type=eq.${notifType}&item_key=eq.${encodeURIComponent(itemKey)}&select=sent_at`,
  );
  if (!res.ok) return false;
  const rows = await res.json();
  if (!rows.length) return false;
  const daysSinceSent = daysBetween(new Date(), new Date(rows[0].sent_at));
  return daysSinceSent < (RESEND_DAYS[notifType] ?? 7);
}

async function markNotified(notifType: string, itemKey: string) {
  await supabaseRequest("/rest/v1/notification_log", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ notif_type: notifType, item_key: itemKey, sent_at: new Date().toISOString() }),
  });
}

// --- reading the synced business data -----------------------------------
// Jobs, invoices, and compliance settings all live inside one JSON blob
// per sync code (see sync.js's collectSyncData()), not their own
// tables -- each key is a STRING containing JSON, not a nested object.

async function getSyncedData() {
  const res = await supabaseRequest(`/rest/v1/workspace_sync?select=data,updated_at&limit=1`);
  if (!res.ok) return null;
  const rows = await res.json();
  if (!rows.length) return null;
  return { data: rows[0].data || {}, updatedAt: rows[0].updated_at as string | undefined };
}

function safeParse(jsonString: string | undefined, fallback: any) {
  try { return JSON.parse(jsonString || "null") ?? fallback; } catch (e) { return fallback; }
}

// --- the checks ------------------------------------------------------

async function checkTomorrowsJobs(jobs: any[]) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = tomorrow.getFullYear() + "-" +
    String(tomorrow.getMonth() + 1).padStart(2, "0") + "-" +
    String(tomorrow.getDate()).padStart(2, "0");

  const dueTomorrow = jobs.filter((j) => j.date === tomorrowKey && j.status !== "done");
  if (dueTomorrow.length === 0) return;

  const body = dueTomorrow.length === 1
    ? `"${dueTomorrow[0].title}" is scheduled for tomorrow.`
    : `${dueTomorrow.length} jobs are scheduled for tomorrow.`;
  await sendToAllSubscriptions({ title: "Tomorrow's Schedule", body, url: "/tools/workspace.html" });
}

async function checkFollowups(jobs: any[]) {
  const lastJobByClient: Record<string, Date> = {};
  for (const j of jobs) {
    if (!j.client || !j.client.trim() || !j.date) continue;
    const key = j.client.trim();
    const d = new Date(j.date + "T00:00:00");
    if (isNaN(d.getTime())) continue;
    if (!lastJobByClient[key] || d > lastJobByClient[key]) lastJobByClient[key] = d;
  }

  const today = todayAtMidnight();
  for (const [client, lastDate] of Object.entries(lastJobByClient)) {
    const daysSince = daysBetween(today, lastDate);
    if (daysSince < FOLLOWUP_THRESHOLD_DAYS) continue;
    if (await wasRecentlyNotified("followup", client)) continue;

    await sendToAllSubscriptions({
      title: "Client Follow-Up",
      body: `It's been ${Math.round(daysSince / 30)} months since ${client}'s last job.`,
      url: "/tools/workspace.html",
    });
    await markNotified("followup", client);
  }
}

async function checkOverdueInvoices(invoices: any[]) {
  const today = todayAtMidnight();
  for (const inv of invoices) {
    if (inv.paid) continue;
    const base = new Date((inv.date || "") + "T00:00:00");
    if (isNaN(base.getTime())) continue;
    const termDays = TERM_DAYS[inv.terms] ?? 15;
    const dueDate = new Date(base.getTime() + termDays * 24 * 60 * 60 * 1000);
    if (dueDate >= today) continue; // not overdue yet

    const itemKey = String(inv.id);
    if (await wasRecentlyNotified("invoice-overdue", itemKey)) continue;

    await sendToAllSubscriptions({
      title: "Invoice Overdue",
      body: `${inv.clientName || "A client"}'s invoice (#${inv.invoiceNumber || inv.id}) is overdue.`,
      url: "/tools/workspace.html",
    });
    await markNotified("invoice-overdue", itemKey);
  }
}

async function checkCompliance(compliance: any) {
  if (!compliance) return;
  const today = todayAtMidnight();
  const items: { key: string; label: string; expirationDate: string }[] = [];

  if (compliance.insurance?.expirationDate) {
    items.push({ key: "insurance", label: "Your insurance policy", expirationDate: compliance.insurance.expirationDate });
  }
  for (const lic of compliance.licenses || []) {
    if (lic.expirationDate) {
      items.push({ key: "license-" + (lic.name || lic.id || lic.expirationDate), label: lic.name || "A license", expirationDate: lic.expirationDate });
    }
  }

  for (const item of items) {
    const expDate = new Date(item.expirationDate + "T00:00:00");
    if (isNaN(expDate.getTime())) continue;
    const days = daysBetween(expDate, today);
    if (days > COMPLIANCE_WARNING_DAYS) continue; // not expiring soon yet
    if (await wasRecentlyNotified("compliance-expiring", item.key)) continue;

    const body = days < 0
      ? `${item.label} has expired.`
      : `${item.label} expires in ${days} day${days === 1 ? "" : "s"}.`;
    await sendToAllSubscriptions({ title: "Compliance Alert", body, url: "/tools/workspace.html" });
    await markNotified("compliance-expiring", item.key);
  }
}

async function checkOverdueNotStarted(jobs: any[]) {
  const today = todayAtMidnight();
  for (const job of jobs) {
    if (job.priority !== "high" || job.status !== "not-started" || !job.date) continue;
    const jobDate = new Date(job.date + "T00:00:00");
    if (isNaN(jobDate.getTime()) || jobDate >= today) continue; // not overdue yet

    const itemKey = String(job.id);
    if (await wasRecentlyNotified("overdue-not-started", itemKey)) continue;

    await sendToAllSubscriptions({
      title: "Overdue: Never Started",
      body: `"${job.title}" was a high-priority job due ${job.date} and hasn't been started.`,
      url: "/tools/workspace.html",
    });
    await markNotified("overdue-not-started", itemKey);
  }
}

async function checkStuckInProgress(jobs: any[]) {
  const today = new Date();
  for (const job of jobs) {
    // statusChangedAt only exists on jobs whose status has changed since
    // this field was added -- older in-progress jobs that haven't had a
    // status change since are silently skipped rather than guessed at.
    if (job.status !== "in-progress" || !job.statusChangedAt) continue;
    const changedAt = new Date(job.statusChangedAt);
    if (isNaN(changedAt.getTime())) continue;
    const daysSince = daysBetween(today, changedAt);
    if (daysSince < STUCK_IN_PROGRESS_DAYS) continue;

    const itemKey = String(job.id);
    if (await wasRecentlyNotified("stuck-in-progress", itemKey)) continue;

    await sendToAllSubscriptions({
      title: "Job Stuck In Progress",
      body: `"${job.title}" has been In Progress for ${daysSince} days.`,
      url: "/tools/workspace.html",
    });
    await markNotified("stuck-in-progress", itemKey);
  }
}

async function checkStaleSync(syncUpdatedAt: string | undefined) {
  if (!syncUpdatedAt) return;
  const lastSync = new Date(syncUpdatedAt);
  if (isNaN(lastSync.getTime())) return;
  const daysSince = daysBetween(new Date(), lastSync);
  if (daysSince < SYNC_STALE_DAYS) return;

  // A single ongoing condition, not per-item -- fixed key rather than
  // one per sync attempt.
  if (await wasRecentlyNotified("sync-stale", "sync")) return;

  await sendToAllSubscriptions({
    title: "Sync Hasn't Run Recently",
    body: `Your data hasn't synced to the cloud in ${daysSince} days. Open the app with a connection to back it up.`,
    url: "/tools/workspace.html",
  });
  await markNotified("sync-stale", "sync");
}

async function checkUnconvertedQuotes(quotes: any[], invoices: any[]) {
  const today = todayAtMidnight();
  const invoicedJobRefIds = new Set(invoices.map((inv: any) => inv.jobRefId).filter(Boolean));

  for (const quote of quotes) {
    // Quotes without a job link can't be reliably matched to a later
    // invoice at all -- skipped rather than guessed at, same principle
    // as the statusChangedAt gap above.
    if (!quote.jobRefId || !quote.date) continue;
    if (invoicedJobRefIds.has(quote.jobRefId)) continue; // already converted

    const quoteDate = new Date(quote.date + "T00:00:00");
    if (isNaN(quoteDate.getTime())) continue;
    const daysSince = daysBetween(today, quoteDate);
    if (daysSince < QUOTE_STALE_DAYS) continue;

    const itemKey = String(quote.id);
    if (await wasRecentlyNotified("quote-unconverted", itemKey)) continue;

    await sendToAllSubscriptions({
      title: "Quote Never Followed Up",
      body: `${quote.clientName || "A client"}'s quote from ${quote.date} was never converted to an invoice.`,
      url: "/tools/workspace.html",
    });
    await markNotified("quote-unconverted", itemKey);
  }
}

async function checkPhotolessCompletedJobs(jobs: any[]) {
  for (const job of jobs) {
    if (job.status !== "done") continue;
    const itemKey = String(job.id);
    if (await wasRecentlyNotified("job-no-photos", itemKey)) continue;

    const res = await supabaseRequest(`/rest/v1/th_job_photos?job_id=eq.${job.id}&select=id&limit=1`);
    if (!res.ok) continue;
    const rows = await res.json();
    if (rows.length > 0) continue; // has at least one photo, nothing to flag

    await sendToAllSubscriptions({
      title: "Completed Job Has No Photos",
      body: `"${job.title}" was marked complete with no photos attached.`,
      url: "/tools/workspace.html",
    });
    await markNotified("job-no-photos", itemKey);
  }
}

async function checkWarrantyCheckIn(jobs: any[]) {
  const today = todayAtMidnight();
  for (const job of jobs) {
    if (job.status !== "done" || !job.date) continue;
    const completionDate = new Date(job.date + "T00:00:00");
    if (isNaN(completionDate.getTime())) continue;
    const daysSince = daysBetween(today, completionDate);
    const daysLeft = 30 - daysSince; // matches job-tracker.html's warrantyBadgeHtml() exactly
    if (daysLeft < 0 || daysLeft > WARRANTY_WARNING_DAYS) continue;

    const itemKey = String(job.id);
    if (await wasRecentlyNotified("warranty-checkin", itemKey)) continue;

    await sendToAllSubscriptions({
      title: "Warranty Ending Soon",
      body: `${job.client ? job.client + "'s" : "A"} 30-day warranty on "${job.title}" ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"} -- worth a check-in call.`,
      url: "/tools/workspace.html",
    });
    await markNotified("warranty-checkin", itemKey);
  }
}

// Added 2026-08-15. Reads th_leads directly (a real table, unlike jobs/
// invoices/quotes which live inside workspace_sync's JSON blob) since
// leads already have their own table and their own `handled` column --
// no schema change needed to build this. Resends daily (see RESEND_DAYS
// above) rather than once, since an unhandled lead getting nudged every
// day until it's actually dealt with is the actual point here, unlike
// the mostly-one-time nudges above.
async function checkUnrespondedLeads() {
  const cutoff = new Date(Date.now() - UNRESPONDED_LEAD_HOURS * 60 * 60 * 1000).toISOString();
  const res = await supabaseRequest(
    `/rest/v1/th_leads?handled=eq.false&created_at=lt.${encodeURIComponent(cutoff)}&select=id,name,created_at`,
  );
  if (!res.ok) return;
  const leads = await res.json();

  for (const lead of leads) {
    const itemKey = String(lead.id);
    if (await wasRecentlyNotified("unresponded-lead", itemKey)) continue;

    const hoursWaiting = Math.round((Date.now() - new Date(lead.created_at).getTime()) / (60 * 60 * 1000));
    const daysWaiting = Math.floor(hoursWaiting / 24);
    const waitLabel = daysWaiting >= 1 ? `${daysWaiting} day${daysWaiting === 1 ? "" : "s"}` : `${hoursWaiting} hours`;

    await sendToAllSubscriptions({
      title: "Lead Still Unanswered",
      body: `${lead.name || "A lead"} has been waiting ${waitLabel} with no response.`,
      url: "/tools/workspace.html",
    });
    await markNotified("unresponded-lead", itemKey);
  }
}

function money(v: number): string {
  return "$" + v.toFixed(2).replace(/\d(?=(\d{3})+\.)/g, "$&,");
}

// Weekly digest -- added 2026-08-15. Trend awareness rather than task
// nagging, so this one is intentionally sent even when every number is
// zero (a quiet week is itself useful to know), unlike every check
// above which only ever sends when something needs attention.
async function sendWeeklyDigest() {
  const synced = await getSyncedData();
  const jobs: any[] = synced ? safeParse(synced.data.th_tracker_jobs, []) : [];
  const invoices: any[] = synced ? safeParse(synced.data.th_invoices, []) : [];
  const quotes: any[] = synced ? safeParse(synced.data.th_quotes, []) : [];

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const jobsCompleted = jobs.filter((j) => {
    if (j.status !== "done" || !j.date) return false;
    const d = new Date(j.date + "T00:00:00");
    return !isNaN(d.getTime()) && d >= weekAgo;
  }).length;

  const invoicedThisWeek = invoices
    .filter((inv) => {
      if (!inv.date || typeof inv.total !== "number") return false;
      const d = new Date(inv.date + "T00:00:00");
      return !isNaN(d.getTime()) && d >= weekAgo;
    })
    .reduce((sum, inv) => sum + inv.total, 0);

  const outstandingTotal = invoices
    .filter((inv) => !inv.paid && typeof inv.total === "number")
    .reduce((sum, inv) => sum + inv.total, 0);

  // Same "unconverted" definition as checkUnconvertedQuotes -- a quote
  // linked to a job that has no matching invoice yet.
  const invoicedJobRefIds = new Set(invoices.map((inv: any) => inv.jobRefId).filter(Boolean));
  const quotesOutstanding = quotes.filter((q) => q.jobRefId && !invoicedJobRefIds.has(q.jobRefId)).length;

  // th_leads is its own real table -- read directly rather than through
  // the workspace_sync blob, same as checkUnrespondedLeads does.
  const leadsRes = await supabaseRequest(
    `/rest/v1/th_leads?created_at=gte.${encodeURIComponent(weekAgo.toISOString())}&select=id`,
  );
  const newLeads = leadsRes.ok ? (await leadsRes.json()).length : 0;

  const parts = [
    `${jobsCompleted} job${jobsCompleted === 1 ? "" : "s"} completed`,
    `${money(invoicedThisWeek)} invoiced`,
    `${newLeads} new lead${newLeads === 1 ? "" : "s"}`,
  ];
  if (outstandingTotal > 0) parts.push(`${money(outstandingTotal)} outstanding`);
  if (quotesOutstanding > 0) parts.push(`${quotesOutstanding} quote${quotesOutstanding === 1 ? "" : "s"} awaiting conversion`);

  await sendToAllSubscriptions({
    title: "Weekly Summary",
    body: parts.join(" \u00b7 "),
    url: "/tools/workspace.html",
  });
}

Deno.serve(async (req: Request) => {
  try {
    const payload = await req.json();

    // Supabase's actual webhook payload is a fixed shape --
    // { type: 'INSERT'|'UPDATE'|'DELETE', table, schema, record, old_record }
    // -- never a custom string. Checking for the real shape, not an
    // invented one.
    if (payload.type === "INSERT" && payload.table === "th_leads") {
      const name = payload.record?.name || "Someone";
      await sendToAllSubscriptions({
        title: "New Lead",
        body: `${name} just submitted the contact form.`,
        url: "/tools/workspace.html",
      });
      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
    }

    if (payload.type === "reminder-check") {
      const synced = await getSyncedData();

      const jobs = synced ? safeParse(synced.data.th_tracker_jobs, []) : [];
      const invoices = synced ? safeParse(synced.data.th_invoices, []) : [];
      const quotes = synced ? safeParse(synced.data.th_quotes, []) : [];
      const compliance = synced ? safeParse(synced.data.th_compliance, null) : null;

      if (synced) {
        await checkTomorrowsJobs(jobs);
        await checkFollowups(jobs);
        await checkOverdueInvoices(invoices);
        await checkCompliance(compliance);
        await checkOverdueNotStarted(jobs);
        await checkStuckInProgress(jobs);
        await checkStaleSync(synced.updatedAt);
        await checkUnconvertedQuotes(quotes, invoices);
        await checkPhotolessCompletedJobs(jobs);
        await checkWarrantyCheckIn(jobs);
      }

      // Independent of workspace_sync -- th_leads is its own table, so
      // this check runs regardless of whether synced data was found.
      await checkUnrespondedLeads();

      return new Response(JSON.stringify({ ok: true, ran: true, syncedDataFound: !!synced }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (payload.type === "weekly-digest") {
      await sendWeeklyDigest();
      return new Response(JSON.stringify({ ok: true, ran: true }), { headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ ok: false, error: "Unknown type" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
