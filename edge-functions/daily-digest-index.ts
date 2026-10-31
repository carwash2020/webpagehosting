// daily-digest -- end-of-day email to the owners (recipients in digest_settings).
//
// Deploy with verify_jwt = true. The handler additionally requires the
// service-role key as the bearer token (same reason as send-payment-reminder:
// the anon key is a validly-signed JWT too).
//
// Ships DISABLED: digest_settings.enabled defaults to false and recipients to
// '{}', so deploying/merging sends nothing. See docs/daily-digest/README.md.
//
// Invoked hourly by pg_cron (sql/infra/add_daily_digest_cron.sql). It sends
// only when the local hour (digest_settings.timezone) is within
// [send_hour_local, send_hour_local + 3] and today's digest_runs row isn't
// already sent/skipped -- that window is the retry mechanism.
//
// Body options: { dry_run: true } returns the rendered HTML/text and sends/
// writes nothing (works even while disabled, for QA). { force: true } skips
// the hour guard (still honors enabled + idempotency).
//
// Edge secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY,
// RESEND_API_KEY, LEAD_EMAIL_FROM (fallback when digest_settings.from_address
// is empty).
//
// Privacy: logs counts/date/status/Resend id only. The email body (owners
// only) uses "First L." names and invoice/quote numbers; no addresses/phones.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const LEAD_EMAIL_FROM = Deno.env.get("LEAD_EMAIL_FROM") || "";

const SITE = "https://www.triplehenterprisesllc.biz";
const DAY_MS = 24 * 60 * 60 * 1000;
// Matches TERM_DAYS in send-payment-reminder-index.ts / workspace.html.
const TERM_DAYS: Record<string, number> = { "Due Upon Receipt": 0, "Net 15": 15, "Net 30": 30 };
const DEFAULT_TERM_DAYS = 15; // same fallback as send-payment-reminder
const MAX_ATTEMPTS = 3;
const CATCH_UP_HOURS = 3;

// ---------------------------------------------------------------- dates

function ymdInZone(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

function hourInZone(ms: number, tz: string): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(new Date(ms));
  return parseInt(h, 10) % 24;
}

function zoneOffsetMs(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const g = (t: string) => parseInt(parts.find((p) => p.type === t)!.value, 10);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second")) - Math.floor(ms / 1000) * 1000;
}

// UTC instant of local 00:00 on the given local date (handles 23/25h days).
function zonedMidnightMs(ymd: string, tz: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - zoneOffsetMs(guess, tz);
  return guess - zoneOffsetMs(first, tz);
}

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// job_date / invoice_date are free text. Accept YYYY-MM-DD (optionally
// followed by a time) or M/D/YYYY; anything else is "unparseable".
function parseLocalDate(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const s = text.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
  if (m) return validYmd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return validYmd(+m[3], +m[1], +m[2]);
  return null;
}

function validYmd(y: number, mo: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

function mtTime(iso: string, tz: string): string {
  const t = new Date(iso);
  if (isNaN(t.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(t)
    .replace("GMT-6", "MDT").replace("GMT-7", "MST");
}

// ---------------------------------------------------------------- format

function esc(v: unknown): string {
  return (v === null || v === undefined ? "" : String(v))
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function money(n: unknown): string {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const cents = (c: number) => money(c / 100);

// "Jane Doe" -> "Jane D."; single word stays; empty -> "Client".
function shortName(name: unknown): string {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Client";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

function prettyDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

// ---------------------------------------------------------------- data

type Section<T> = { ok: true; data: T } | { ok: false };

async function section<T>(name: string, fn: () => Promise<T>): Promise<Section<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (_e) {
    console.error(`daily-digest section failed: ${name}`); // name only, never the error body
    return { ok: false };
  }
}

async function sb(path: string): Promise<any[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`supabase ${res.status}`);
  return await res.json();
}

async function stripe(path: string): Promise<any> {
  if (!STRIPE_SECRET_KEY) throw new Error("no stripe key");
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`stripe ${res.status}`);
  return await res.json();
}

async function stripeList(path: string): Promise<any[]> {
  const out: any[] = [];
  let after = "";
  for (let page = 0; page < 10; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const body = await stripe(`${path}${sep}limit=100${after ? `&starting_after=${after}` : ""}`);
    out.push(...(body.data || []));
    if (!body.has_more || !body.data?.length) break;
    after = body.data[body.data.length - 1].id;
  }
  return out;
}

const inRange = (iso: unknown, a: string, b: string) => typeof iso === "string" && iso >= a && iso < b;
const pick = (o: any, ...keys: string[]) => { for (const k of keys) if (o?.[k] !== undefined && o?.[k] !== null) return o[k]; return null; };

interface Win { date: string; startIso: string; endIso: string; startSec: number; endSec: number; }

function windowFor(ymd: string, tz: string): Win {
  const s = zonedMidnightMs(ymd, tz);
  const e = zonedMidnightMs(addDays(ymd, 1), tz);
  return { date: ymd, startIso: new Date(s).toISOString(), endIso: new Date(e).toISOString(), startSec: s / 1000, endSec: e / 1000 };
}

async function gatherDigest(settings: any, today: Win, tomorrow: Win) {
  const tenant = settings.tenant_id ? `&or=(tenant_id.eq.${settings.tenant_id},tenant_id.is.null)` : "";

  const jobsRaw = section("jobs", async () => {
    const rows = await sb(`jobs?select=id,title,client,job_date,status,client_id,reschedule_requested_at,reschedule_requested_date&cancelled_at=is.null&job_date=neq.&limit=5000${tenant}`);
    let unparsed = 0;
    const todayJobs: any[] = [], tomorrowJobs: any[] = [], reschedule: any[] = [];
    for (const r of rows) {
      const d = parseLocalDate(r.job_date);
      if (!d) { unparsed++; continue; }
      if (d === today.date) todayJobs.push(r);
      else if (d === tomorrow.date) tomorrowJobs.push(r);
      if (r.reschedule_requested_at && d >= today.date) reschedule.push(r);
    }
    return { todayJobs, tomorrowJobs, reschedule, unparsed, noClient: todayJobs.filter((j) => !j.client_id) };
  });

  const workOrders = section("work_orders", async () => {
    const rows = await sb(`client_portal_work_orders?select=id,title,status,scheduled_at,linked_job_id&or=(status.in.(submitted,reviewing),and(scheduled_at.gte.${today.startIso},scheduled_at.lt.${tomorrow.endIso}))&limit=1000`);
    return {
      open: rows.filter((r) => r.status === "submitted" || r.status === "reviewing"),
      today: rows.filter((r) => inRange(r.scheduled_at, today.startIso, today.endIso)),
      tomorrow: rows.filter((r) => inRange(r.scheduled_at, tomorrow.startIso, tomorrow.endIso)),
    };
  });

  const quotes = section("quotes", async () => {
    const rows = await sb(`client_portal_quotes?select=*&or=(created_at.gte.${today.startIso},responded_at.gte.${today.startIso})&limit=1000`);
    const sent = rows.filter((r) => inRange(r.created_at, today.startIso, today.endIso));
    const responded = rows.filter((r) => inRange(r.responded_at, today.startIso, today.endIso));
    return {
      sent,
      approved: responded.filter((r) => r.status === "approved"),
      declined: responded.filter((r) => r.status === "declined"),
    };
  });

  const invoices = section("invoices", async () => {
    const rows = await sb(`client_portal_invoices?select=invoice_number,client_name,total,created_at,paid_at&or=(created_at.gte.${today.startIso},paid_at.gte.${today.startIso})&limit=1000`);
    return {
      sent: rows.filter((r) => inRange(r.created_at, today.startIso, today.endIso)),
      paid: rows.filter((r) => inRange(r.paid_at, today.startIso, today.endIso)),
    };
  });

  const overdue = section("overdue", async () => {
    const rows = await sb(`invoices?select=invoice_number,client_name,invoice_date,terms,total,paid_amount&paid=eq.false&limit=5000${tenant}`);
    const list: any[] = [];
    for (const r of rows) {
      const base = parseLocalDate(r.invoice_date);
      if (!base) continue;
      const due = addDays(base, TERM_DAYS[r.terms as string] ?? DEFAULT_TERM_DAYS);
      const remaining = (Number(r.total) || 0) - (Number(r.paid_amount) || 0);
      if (due < today.date && remaining > 0) {
        list.push({ ...r, due, remaining, daysLate: Math.round((Date.parse(today.date) - Date.parse(due)) / DAY_MS) });
      }
    }
    list.sort((a, b) => (a.due < b.due ? -1 : 1));
    return { count: list.length, total: list.reduce((s, r) => s + r.remaining, 0), oldest: list.slice(0, 5) };
  });

  const payments = section("stripe_payments", async () => {
    const created = `created[gte]=${today.startSec}&created[lt]=${today.endSec}`;
    const intents = await stripeList(`payment_intents?${created}`);
    const succeeded = intents.filter((p) => p.status === "succeeded");
    const failed = intents.filter((p) => p.status === "canceled" || (p.status === "requires_payment_method" && p.last_payment_error));
    const refunds = await stripeList(`refunds?${created}`);
    const disputes = await stripeList(`disputes?${created}`);
    let pos = 0;
    try {
      const logged = await sb(`stripe_pos_charges_logged?select=payment_intent_id&logged_at=gte.${today.startIso}&logged_at=lt.${today.endIso}`);
      const ids = new Set(logged.map((l) => l.payment_intent_id));
      pos = succeeded.filter((p) => ids.has(p.id)).length;
    } catch (_e) { /* POS breakdown is optional */ }
    return {
      succeededCount: succeeded.length,
      succeededTotal: succeeded.reduce((s, p) => s + (p.amount_received ?? p.amount ?? 0), 0),
      pos, failed: failed.length, refunds: refunds.length,
      refundTotal: refunds.reduce((s, r) => s + (r.amount || 0), 0),
      disputes: disputes.length,
    };
  });

  const balance = section("stripe_balance", async () => {
    const b = await stripe("balance");
    const usd = (arr: any[]) => (arr || []).filter((x) => x.currency === "usd").reduce((s, x) => s + x.amount, 0);
    return { available: usd(b.available), pending: usd(b.pending), livemode: b.livemode !== false };
  });

  const payouts = section("stripe_payouts", async () => {
    const pending = (await stripe("payouts?limit=3&status=pending")).data || [];
    const transit = (await stripe("payouts?limit=3&status=in_transit")).data || [];
    const upcoming = [...transit, ...pending].sort((a: any, b: any) => a.arrival_date - b.arrival_date);
    let lastPaid: any = null;
    if (!upcoming.length) lastPaid = ((await stripe("payouts?limit=1&status=paid")).data || [])[0] || null;
    const fmt = (p: any) => p && ({ amount: p.amount, arrival: ymdInZone(p.arrival_date * 1000, "UTC"), status: p.status });
    return { upcoming: upcoming.map(fmt), lastPaid: fmt(lastPaid) };
  });

  const [j, wo, q, inv, od, pay, bal, po] = await Promise.all([jobsRaw, workOrders, quotes, invoices, overdue, payments, balance, payouts]);
  return { jobs: j, workOrders: wo, quotes: q, invoices: inv, overdue: od, payments: pay, balance: bal, payouts: po };
}

type Digest = Awaited<ReturnType<typeof gatherDigest>>;

// Collapse linked work orders against jobs: a work order whose linked_job_id is
// already in the jobs list is not shown twice.
function scheduleFor(d: Digest, which: "today" | "tomorrow", tz: string) {
  if (!d.jobs.ok && !d.workOrders.ok) return null;
  const jobs = d.jobs.ok ? (which === "today" ? d.jobs.data.todayJobs : d.jobs.data.tomorrowJobs) : [];
  const jobIds = new Set(jobs.map((x: any) => x.id));
  const wos = d.workOrders.ok ? (d.workOrders.data[which] as any[]).filter((w) => !w.linked_job_id || !jobIds.has(w.linked_job_id)) : [];
  return [
    ...jobs.map((x: any) => ({ label: x.title || "Job", who: shortName(x.client), when: "", sort: "" })),
    ...wos.map((w: any) => ({ label: w.title || "Work order", who: "", when: mtTime(w.scheduled_at, tz), sort: w.scheduled_at })),
  ];
}

function actionItems(d: Digest): string[] {
  const out: string[] = [];
  if (d.overdue.ok && d.overdue.data.count) out.push(`${d.overdue.data.count} overdue invoice${d.overdue.data.count === 1 ? "" : "s"} (${money(d.overdue.data.total)})`);
  if (d.quotes.ok) for (const x of d.quotes.data.declined) out.push(`Quote ${pick(x, "quote_number") ?? ""} declined by ${shortName(pick(x, "client_name"))}`.replace("  ", " "));
  if (d.jobs.ok) {
    if (d.jobs.data.reschedule.length) out.push(`${d.jobs.data.reschedule.length} job reschedule request${d.jobs.data.reschedule.length === 1 ? "" : "s"} waiting`);
    if (d.jobs.data.noClient.length) out.push(`${d.jobs.data.noClient.length} job${d.jobs.data.noClient.length === 1 ? "" : "s"} today with no client attached`);
  }
  if (d.workOrders.ok && d.workOrders.data.open.length) out.push(`${d.workOrders.data.open.length} work request${d.workOrders.data.open.length === 1 ? "" : "s"} awaiting review`);
  if (d.payments.ok) {
    const p = d.payments.data;
    if (p.failed) out.push(`${p.failed} failed payment${p.failed === 1 ? "" : "s"}`);
    if (p.disputes) out.push(`${p.disputes} new dispute${p.disputes === 1 ? "" : "s"}`);
    if (p.refunds) out.push(`${p.refunds} refund${p.refunds === 1 ? "" : "s"} (${cents(p.refundTotal)})`);
  }
  return out;
}

function digestCounts(d: Digest) {
  return {
    jobs_today: d.jobs.ok ? d.jobs.data.todayJobs.length : null,
    jobs_tomorrow: d.jobs.ok ? d.jobs.data.tomorrowJobs.length : null,
    jobs_unparsed: d.jobs.ok ? d.jobs.data.unparsed : null,
    quotes_sent: d.quotes.ok ? d.quotes.data.sent.length : null,
    invoices_sent: d.invoices.ok ? d.invoices.data.sent.length : null,
    invoices_paid: d.invoices.ok ? d.invoices.data.paid.length : null,
    overdue: d.overdue.ok ? d.overdue.data.count : null,
    payments: d.payments.ok ? d.payments.data.succeededCount : null,
    action_items: actionItems(d).length,
  };
}

function isQuiet(d: Digest): boolean {
  const c = digestCounts(d);
  const todayActivity = (c.jobs_today || 0) + (c.quotes_sent || 0) + (c.invoices_sent || 0) + (c.invoices_paid || 0) + (c.payments || 0)
    + (d.quotes.ok ? d.quotes.data.approved.length + d.quotes.data.declined.length : 0)
    + (d.workOrders.ok ? d.workOrders.data.today.length : 0);
  const tomorrowSched = scheduleFor(d, "tomorrow", "UTC");
  return todayActivity === 0 && !(tomorrowSched && tomorrowSched.length) && c.action_items === 0;
}

// ---------------------------------------------------------------- render

const C = { ink: "#1f2933", mute: "#6b7280", line: "#e5e7eb", brand: "#1f4e79", bg: "#f3f4f6", warn: "#b45309", warnBg: "#fef3c7", bad: "#b91c1c" };

// Each section is built as PLAIN text (with **bold** markers); the HTML is generated from it
// by escaping, and the text part by dropping the markers. No HTML is ever parsed or stripped.
type Para = { text: string; kind?: "mute" | "bad" };
type Block = { title: string; paras: Para[]; items: string[]; note?: string };

const fmtHtml = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
const fmtText = (s: string) => s.replace(/\*\*/g, "");

function blockHtml(b: Block): string {
  const color = (k?: string) => (k === "mute" ? C.mute : k === "bad" ? C.bad : C.ink);
  const paras = b.paras.map((p) => `<div style="color:${color(p.kind)}">${fmtHtml(p.text)}</div>`).join("");
  const items = b.items.length ? `<ul style="margin:0;padding-left:18px">${b.items.map((i) => `<li style="margin:2px 0">${fmtHtml(i)}</li>`).join("")}</ul>` : "";
  const note = b.note ? `<div style="color:${C.mute};font-size:12px;margin-top:4px">${esc(b.note)}</div>` : "";
  return `<tr><td style="padding:18px 24px 4px"><div style="font:700 13px Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:${C.brand}">${esc(b.title)}</div>`
    + `<div style="border-top:1px solid ${C.line};margin-top:6px;padding-top:8px;font:14px/1.5 Arial,sans-serif;color:${C.ink}">${paras}${items}${note}</div></td></tr>`;
}

function blockText(b: Block): string {
  return [b.title.toUpperCase(), ...b.paras.map((p) => fmtText(p.text)), ...b.items.map((i) => `- ${fmtText(i)}`), ...(b.note ? [b.note] : [])].join("\n");
}

const UNAVAILABLE: Para = { text: "Unavailable (could not load this section).", kind: "mute" };
const STRIPE_DOWN: Para = { text: "Stripe unavailable.", kind: "mute" };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function renderDigest(d: Digest, opts: { date: string; tz: string; quiet: boolean }) {
  const { date, tz, quiet } = opts;
  const tomorrow = addDays(date, 1);
  const blocks: Block[] = [];
  const add = (title: string, paras: Para[], items: string[] = [], note?: string) => blocks.push({ title, paras, items, note });

  const actions = actionItems(d);
  if (d.jobs.ok || d.overdue.ok || d.payments.ok || d.quotes.ok) {
    add("Action needed", actions.length ? [] : [{ text: "Nothing needs attention.", kind: "mute" }], actions);
  }

  const moneyParas: Para[] = [];
  if (d.balance.ok) moneyParas.push({ text: `Available **${cents(d.balance.data.available)}** · Pending **${cents(d.balance.data.pending)}**` });
  else moneyParas.push({ text: "Balance: Stripe unavailable.", kind: "mute" });
  if (d.payouts.ok) {
    const p = d.payouts.data;
    if (p.upcoming.length) moneyParas.push({ text: `Next payout: **${cents(p.upcoming[0].amount)}** arriving ${p.upcoming[0].arrival} (${p.upcoming[0].status.replace("_", " ")})` });
    else {
      moneyParas.push({ text: `No payout scheduled yet — the next automatic daily payout is roughly the pending balance becoming available.${p.lastPaid ? ` Last paid payout: ${cents(p.lastPaid.amount)} on ${p.lastPaid.arrival}.` : ""}` });
    }
  } else moneyParas.push({ text: "Payouts: Stripe unavailable.", kind: "mute" });
  add("Money", moneyParas);

  if (d.payments.ok) {
    const p = d.payments.data;
    const paras: Para[] = [{ text: `${plural(p.succeededCount, "payment")} received, **${cents(p.succeededTotal)}**${p.pos ? ` (${p.pos} at POS)` : ""}` }];
    if (p.refunds) paras.push({ text: `Refunds: ${p.refunds} (${cents(p.refundTotal)})` });
    if (p.failed) paras.push({ text: `Failed: ${p.failed}`, kind: "bad" });
    if (p.disputes) paras.push({ text: `Disputes: ${p.disputes}`, kind: "bad" });
    add("Payments today", paras);
  } else add("Payments today", [STRIPE_DOWN]);

  const sched = (which: "today" | "tomorrow", title: string) => {
    const rows = scheduleFor(d, which, tz);
    if (rows === null) return add(title, [UNAVAILABLE]);
    if (!rows.length) return add(title, [{ text: "Nothing scheduled.", kind: "mute" }]);
    rows.sort((a, b) => (a.sort < b.sort ? -1 : 1));
    const note = which === "today" && d.jobs.ok && d.jobs.data.unparsed ? `${d.jobs.data.unparsed} job(s) skipped: date not readable.` : undefined;
    add(title, [], rows.map((r) => `${r.label}${r.who ? ` — ${r.who}` : ""}${r.when ? ` — ${r.when}` : ""}`), note);
  };
  sched("today", "Today's jobs & appointments");
  sched("tomorrow", `Tomorrow (${prettyDate(tomorrow).split(",")[0]})`);

  if (d.quotes.ok) {
    const q = d.quotes.data;
    const line = (x: any) => `${pick(x, "quote_number") ?? "Quote"} — ${shortName(pick(x, "client_name"))}${pick(x, "total") !== null ? ` (${money(pick(x, "total"))})` : ""}`;
    add("Quotes", [{ text: `Sent: **${q.sent.length}** · Approved: **${q.approved.length}** · Declined: **${q.declined.length}**` }],
      [...q.sent.map((x: any) => "Sent " + line(x)), ...q.approved.map((x: any) => "Approved " + line(x)), ...q.declined.map((x: any) => "Declined " + line(x))]);
  } else add("Quotes", [UNAVAILABLE]);

  if (d.invoices.ok) {
    const i = d.invoices.data;
    const line = (x: any) => `${x.invoice_number} — ${shortName(x.client_name)} (${money(x.total)})`;
    const paidTotal = i.paid.reduce((s: number, x: any) => s + (Number(x.total) || 0), 0);
    add("Invoices", [{ text: `Sent: **${i.sent.length}** · Paid: **${i.paid.length}** (${money(paidTotal)})` }],
      [...i.sent.map((x: any) => "Sent " + line(x)), ...i.paid.map((x: any) => "Paid " + line(x))]);
  } else add("Invoices", [UNAVAILABLE]);

  if (d.overdue.ok) {
    const o = d.overdue.data;
    if (!o.count) add("Overdue invoices", [{ text: "None overdue.", kind: "mute" }]);
    else add("Overdue invoices", [{ text: `**${o.count}** overdue, **${money(o.total)}** outstanding. Oldest:` }],
      o.oldest.map((x: any) => `${x.invoice_number} — ${shortName(x.client_name)} — ${money(x.remaining)}, ${plural(x.daysLate, "day")} late`));
  } else add("Overdue invoices", [UNAVAILABLE]);

  const testMode = d.balance.ok && !d.balance.data.livemode;
  const testMsg = "Stripe mode: TEST — balance and payout figures are not real.";
  const banner = testMode ? `<tr><td style="padding:10px 24px;background:${C.warnBg};color:${C.warn};font:700 13px Arial,sans-serif">${esc(testMsg)}</td></tr>` : "";

  const dow = prettyDate(date);
  const title = quiet ? "Quiet day" : "End-of-day digest";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Triple H ${esc(title)}</title></head>`
    + `<body style="margin:0;background:${C.bg}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:16px">`
    + `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border:1px solid ${C.line};border-radius:8px">`
    + `<tr><td style="padding:20px 24px;background:${C.brand};color:#fff;border-radius:8px 8px 0 0"><div style="font:700 20px Arial,sans-serif">Triple H — ${esc(title)}</div><div style="font:14px Arial,sans-serif;opacity:.9">${esc(dow)}</div></td></tr>`
    + banner
    + blocks.map(blockHtml).join("")
    + `<tr><td style="padding:18px 24px;font:12px/1.5 Arial,sans-serif;color:${C.mute}">Times shown in Mountain Time. <a href="${SITE}/portal/" style="color:${C.brand}">Open the portal</a> to act on anything above. Sent to the owners only.</td></tr>`
    + `</table></td></tr></table></body></html>`;

  const text = [`Triple H - ${title} - ${dow}`, ...(testMode ? [testMsg] : []), ...blocks.map(blockText), `Open the portal: ${SITE}/portal/`].join("\n\n");
  const subject = `Triple H ${quiet ? "quiet day" : "digest"}: ${new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(date + "T00:00:00Z"))}`
    + (actions.length ? ` (${actions.length} to review)` : "");
  return { html, text, subject };
}

// ---------------------------------------------------------------- runs

async function sbWrite(path: string, method: string, body: unknown, prefer = "return=representation"): Promise<any[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json", Prefer: prefer },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`supabase write ${res.status}`);
  const t = await res.text();
  return t ? JSON.parse(t) : [];
}

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

async function raiseAlert(date: string) {
  try {
    // alert_type is constrained to two values; job_run_failed is the right one.
    await sbWrite("cron_alerts", "POST", { alert_type: "job_run_failed", detail: `daily-digest for ${date} failed ${MAX_ATTEMPTS} times; no digest email was sent.` });
  } catch (_e) { console.error("daily-digest: could not write cron_alerts"); }
}

Deno.serve(async (req: Request) => {
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!SERVICE_ROLE_KEY || token !== SERVICE_ROLE_KEY) return json({ ok: false, error: "Unauthorized" }, 401);

    let opts: any = {};
    try { opts = await req.json(); } catch (_e) { /* empty body is fine */ }
    const dryRun = opts?.dry_run === true;
    const force = opts?.force === true;

    const rows = await sb("digest_settings?select=*&id=eq.1");
    const settings = rows[0];
    if (!settings) return json({ ok: true, skipped: "no_settings_row" });
    if (!settings.enabled && !dryRun) return json({ ok: true, skipped: "disabled" });

    const tz = settings.timezone || "America/Denver";
    const now = Date.now();
    const date = ymdInZone(now, tz);
    const hour = hourInZone(now, tz);
    const sendHour = settings.send_hour_local ?? 20;
    if (!dryRun && !force && (hour < sendHour || hour > sendHour + CATCH_UP_HOURS)) return new Response(null, { status: 204 });

    const recipients: string[] = (settings.recipients || []).filter((e: string) => typeof e === "string" && e.includes("@"));
    if (!dryRun && !recipients.length) return json({ ok: true, skipped: "no_recipients" });
    const from = settings.from_address || LEAD_EMAIL_FROM;
    if (!dryRun && (!RESEND_API_KEY || !from)) return json({ ok: false, error: "RESEND_API_KEY / from address not configured" }, 500);

    // Idempotency (skipped for dry runs).
    let runId: number | null = null;
    let attempts = 0;
    if (!dryRun) {
      const inserted = await sbWrite("digest_runs?on_conflict=digest_date", "POST", { digest_date: date, tenant_id: settings.tenant_id ?? null },
        "resolution=ignore-duplicates,return=representation");
      if (inserted.length) { runId = inserted[0].id; }
      else {
        const existing = (await sb(`digest_runs?select=*&digest_date=eq.${date}`))[0];
        if (!existing) return json({ ok: false, error: "run row missing" }, 500);
        if (existing.status === "sent" || existing.status === "skipped") return json({ ok: true, skipped: existing.status, digest_date: date });
        if (existing.status === "failed" && existing.attempts >= MAX_ATTEMPTS) return json({ ok: true, skipped: "max_attempts", digest_date: date });
        if (existing.status === "pending" && now - Date.parse(existing.created_at) < 10 * 60 * 1000) return json({ ok: true, skipped: "in_flight", digest_date: date });
        runId = existing.id; attempts = existing.attempts;
        await sbWrite(`digest_runs?id=eq.${runId}`, "PATCH", { status: "pending", created_at: new Date().toISOString() });
      }
    }

    const today = windowFor(date, tz);
    const tomorrow = windowFor(addDays(date, 1), tz);
    const digest = await gatherDigest(settings, today, tomorrow);
    const counts = digestCounts(digest);
    const quiet = isQuiet(digest);
    const out = renderDigest(digest, { date, tz, quiet });

    if (dryRun) return json({ ok: true, dry_run: true, digest_date: date, quiet, counts, subject: out.subject, html: out.html, text: out.text });

    if (quiet && settings.send_on_empty_day === false) {
      await sbWrite(`digest_runs?id=eq.${runId}`, "PATCH", { status: "skipped", counts });
      console.log(`daily-digest ${date} skipped (empty day)`);
      return json({ ok: true, skipped: "empty_day", digest_date: date });
    }

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}`, "Idempotency-Key": `daily-digest-${date}` },
        body: JSON.stringify({
          from: from.includes("<") ? from : `Triple H Enterprises <${from}>`,
          to: recipients, subject: out.subject, html: out.html, text: out.text,
          tags: [{ name: "type", value: "daily_digest" }],
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`resend ${res.status}`);
      const sent = await res.json();
      await sbWrite(`digest_runs?id=eq.${runId}`, "PATCH", {
        status: "sent", attempts: attempts + 1, resend_message_id: sent.id ?? null, counts, error: null, sent_at: new Date().toISOString(),
      });
      console.log(`daily-digest ${date} sent id=${sent.id} counts=${JSON.stringify(counts)}`);
      return json({ ok: true, digest_date: date, resend_message_id: sent.id ?? null });
    } catch (e) {
      const n = attempts + 1;
      const msg = String((e as Error).message || "send failed").slice(0, 100); // status text only, no bodies
      await sbWrite(`digest_runs?id=eq.${runId}`, "PATCH", { status: "failed", attempts: n, counts, error: msg });
      console.error(`daily-digest ${date} failed attempt=${n}: ${msg}`);
      if (n >= MAX_ATTEMPTS) await raiseAlert(date);
      return json({ ok: false, error: "send failed" }, 500);
    }
  } catch (_e) {
    console.error("daily-digest unexpected error");
    return json({ ok: false, error: "internal error" }, 500);
  }
});
