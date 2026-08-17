// ---------------------------------------------------------------------------
// SHARED DATA-ACCESS LAYER  (structural item #40)
// ---------------------------------------------------------------------------
// Every page currently reaches into localStorage directly and re-implements
// its own load/save pair. That's the root cause of a whole class of problems
// already hit in this project: money() existed 4 separate times, escapeHtml()
// 9 times, and 14 load functions had no try/catch at all until they were
// found and fixed one by one.
//
// This file is the single place that talks to localStorage for business data.
// It is introduced ADDITIVELY -- existing pages keep working exactly as they
// do today, and can be migrated onto it one at a time rather than in one
// risky sweep.
//
// Loaded BEFORE the shared tools-effects.js/tools-dialogs.js/
// tools-media-sharing.js/tools-nav-pwa.js files on every page (see the
// <script> order in each page's <head>), so anything in those files may
// safely depend on it.
// ---------------------------------------------------------------------------

// Canonical key names. Pages currently hardcode these strings in ~40 places;
// centralizing them here is the first step toward the namespacing cleanup
// (structural item #8) without breaking any existing stored data, since the
// VALUES here are exactly the keys already in use.
const TH_KEYS = {
  jobs: 'th_tracker_jobs',
  invoices: 'th_invoices',
  quotes: 'th_quotes',
  expenses: 'th_expense_log',
  income: 'th_income_log',
  contacts: 'th_tracker_contacts',
  contracts: 'th_contracts',
  notes: 'th_tracker_notes',
  clients: 'th_clients',
  clientLinks: 'th_client_links_v1',
};

// --- core read/write -------------------------------------------------------

// One guarded read for everything. Every direct JSON.parse(localStorage...)
// in the app should eventually route through this -- 14 of them had no error
// handling at all before being fixed individually, which is exactly the kind
// of thing a single shared accessor prevents from recurring.
function thRead(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === undefined) return fallback;
    const parsed = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch (e) {
    return fallback;
  }
}

function thWrite(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    // scheduleSync lives in sync.js and may not exist on every page (or may
    // not have loaded yet) -- same defensive check the existing save
    // functions already use.
    if (typeof scheduleSync === 'function') scheduleSync();
    return true;
  } catch (e) {
    // Most likely cause is a full localStorage quota. Surfaced rather than
    // swallowed, since silently failing to save business data is far worse
    // than an interruption.
    if (typeof showToast === 'function') {
      showToast('Could not save -- device storage may be full.', { type: 'error' });
    }
    return false;
  }
}

// --- client identity (structural item #7) ----------------------------------
//
// THE PROBLEM THIS SOLVES
// Today a "client" is just a string retyped into several unrelated places:
//   - jobs[].client
//   - invoices[].clientName
//   - quotes[].clientName
//   - contracts[].fields.clientName
//   - contacts[].name
// Nothing links them except exact spelling. That's why cross-page navigation
// is literally implemented as ?search=<name> URL parameters, and why a
// dedicated near-duplicate detector had to be built -- "Sarah Miller" and
// "sarah miller" silently fragment one real client into two in every report
// that groups by name.
//
// THE APPROACH
// Rather than rewriting all five storage shapes at once (high risk, touches
// live business records), this derives a client REGISTRY from existing data
// and maintains a stable id for each distinct real client. Existing keys are
// never modified. Pages can then be migrated to reference clientId one at a
// time, and the string-matching path keeps working the entire time.
//
// Matching is normalized (lowercase, collapsed whitespace) so the case and
// spacing variants that currently fragment reports resolve to ONE client
// here from day one.

function thNormalizeClientName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function thLoadClients() { return thRead(TH_KEYS.clients, []); }
function thSaveClients(list) { return thWrite(TH_KEYS.clients, list); }

// Gathers every distinct client name currently referenced anywhere, with the
// best contact details available for each. Read-only -- inspects, never writes.
function thCollectClientNamesFromExistingData() {
  const found = {}; // normalizedKey -> { displayName, phone, address, email, sources:Set }

  function note(rawName, extras, source) {
    const key = thNormalizeClientName(rawName);
    if (!key) return;
    if (!found[key]) {
      found[key] = { displayName: String(rawName).trim(), phone: '', address: '', email: '', sources: new Set() };
    }
    const rec = found[key];
    rec.sources.add(source);
    // First non-empty value wins for each detail -- avoids a later blank
    // record wiping details already recovered from an earlier one.
    if (extras) {
      if (!rec.phone && extras.phone) rec.phone = String(extras.phone).trim();
      if (!rec.address && extras.address) rec.address = String(extras.address).trim();
      if (!rec.email && extras.email) rec.email = String(extras.email).trim();
    }
  }

  thRead(TH_KEYS.jobs, []).forEach(j => note(j.client, { phone: j.phone, address: j.address }, 'job'));
  thRead(TH_KEYS.invoices, []).forEach(i => note(i.clientName, { address: i.clientAddress }, 'invoice'));
  thRead(TH_KEYS.quotes, []).forEach(q => note(q.clientName, { address: q.clientAddress }, 'quote'));
  thRead(TH_KEYS.contacts, []).forEach(c => note(c.name, { phone: c.phone, email: c.email }, 'contact'));
  thRead(TH_KEYS.contracts, []).forEach(c => {
    const f = c && c.fields ? c.fields : {};
    note(f.clientName, { phone: f.clientPhone, address: f.clientAddress, email: f.clientEmail }, 'contract');
  });

  return found;
}

// Creates client records for any name found in existing data that doesn't
// have one yet. Safe to run repeatedly -- it only ever ADDS missing records,
// never edits or removes existing ones, so a re-run after new jobs are added
// simply picks up the new names.
//
// Returns { created, total } so the result is observable rather than silent.
function thBackfillClients() {
  const existing = thLoadClients();
  const byKey = {};
  existing.forEach(c => { byKey[thNormalizeClientName(c.name)] = c; });

  const discovered = thCollectClientNamesFromExistingData();
  let created = 0;

  Object.entries(discovered).forEach(([key, info]) => {
    if (byKey[key]) return; // already registered
    const record = {
      // Date.now() alone would collide when creating several in the same
      // millisecond, which is exactly what a bulk backfill does.
      id: 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
      name: info.displayName,
      phone: info.phone || '',
      address: info.address || '',
      email: info.email || '',
      createdAt: new Date().toISOString(),
      source: 'backfill',
    };
    existing.push(record);
    byKey[key] = record;
    created++;
  });

  if (created > 0) thSaveClients(existing);
  return { created, total: existing.length };
}

// Resolves a raw client name to its registry record, normalized -- so
// "Sarah Miller", "sarah miller", and "Sarah  Miller" all return the same
// client instead of three.
function thFindClientByName(name) {
  const key = thNormalizeClientName(name);
  if (!key) return null;
  return thLoadClients().find(c => thNormalizeClientName(c.name) === key) || null;
}

function thFindClientById(id) {
  if (!id) return null;
  return thLoadClients().find(c => c.id === id) || null;
}

// Returns the client record for a name, creating one if it doesn't exist yet.
// This is what new save paths should call so records created from here on
// are linked from birth, rather than needing another backfill later.
function thEnsureClient(name, extras) {
  const existingRecord = thFindClientByName(name);
  if (existingRecord) return existingRecord;
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;

  const list = thLoadClients();
  const record = {
    id: 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
    name: trimmed,
    phone: (extras && extras.phone) || '',
    address: (extras && extras.address) || '',
    email: (extras && extras.email) || '',
    createdAt: new Date().toISOString(),
    source: 'created',
  };
  list.push(record);
  thSaveClients(list);
  return record;
}

// Everything on record for one client, gathered across all five storage
// shapes. This is the query that makes a real Client Detail view possible
// (structural item #17) -- currently impossible without it, since the data
// is scattered and only joinable by string.
//
// Matches on normalized name rather than stored clientId, so it works
// correctly TODAY against existing records that have no clientId yet. Once
// pages start writing clientId, this can prefer that and fall back to name.
function thGetClientBundle(clientId) {
  const client = thFindClientById(clientId);
  if (!client) return null;
  const key = thNormalizeClientName(client.name);
  const match = (n) => thNormalizeClientName(n) === key;

  const jobs = thRead(TH_KEYS.jobs, []).filter(j => (j.clientId && j.clientId === clientId) || match(j.client));
  const invoices = thRead(TH_KEYS.invoices, []).filter(i => (i.clientId && i.clientId === clientId) || match(i.clientName));
  const quotes = thRead(TH_KEYS.quotes, []).filter(q => (q.clientId && q.clientId === clientId) || match(q.clientName));
  const contracts = thRead(TH_KEYS.contracts, []).filter(c => c && c.fields && ((c.clientId && c.clientId === clientId) || match(c.fields.clientName)));

  const revenue = invoices.reduce((sum, i) => sum + (Number(i.total) || 0), 0);
  const lastJobDate = jobs.map(j => j.date).filter(Boolean).sort().pop() || null;

  return { client, jobs, invoices, quotes, contracts, revenue, lastJobDate };
}

// Every client with their rolled-up totals, sorted by lifetime revenue.
// Backs the client leaderboard and, later, the Clients hub page.
function thGetAllClientsWithTotals() {
  return thLoadClients()
    .map(c => {
      const bundle = thGetClientBundle(c.id);
      return {
        ...c,
        jobCount: bundle ? bundle.jobs.length : 0,
        invoiceCount: bundle ? bundle.invoices.length : 0,
        revenue: bundle ? bundle.revenue : 0,
        lastJobDate: bundle ? bundle.lastJobDate : null,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
}

// Runs the backfill once per device, recording that it ran so it doesn't
// repeat on every page load. Deliberately does NOT run automatically on
// import -- pages opt in by calling this, so the first cutover is
// controlled rather than happening everywhere at once.
const TH_CLIENT_BACKFILL_FLAG = 'th_client_backfill_v1';
function thRunClientBackfillOnce() {
  try {
    if (localStorage.getItem(TH_CLIENT_BACKFILL_FLAG) === '1') return null;
  } catch (e) { return null; }
  const result = thBackfillClients();
  try { localStorage.setItem(TH_CLIENT_BACKFILL_FLAG, '1'); } catch (e) { /* ignore */ }
  return result;
}

// --- job margin & bundle (supports Push 3: Job Detail view) ---------------
//
// Moved here from job-tracker.html, which is where this logic lived alone
// until now. The new Job Detail page needs the exact same math the
// Profitability tab and job-card margin badge already use -- duplicating
// it into a second file would recreate the exact problem this whole data
// layer exists to prevent (money() and escapeHtml() both existed multiple
// times before being consolidated the same way).

function thComputeJobMargin(job, invoices, expenses, manualIncome) {
  const linkedInvoices = invoices.filter(inv => String(inv.jobRefId) === String(job.id));
  const linkedManualIncome = manualIncome.filter(e => String(e.jobRefId) === String(job.id));
  const revenue = linkedInvoices.reduce((sum, inv) => sum + (inv.total || 0), 0)
                + linkedManualIncome.reduce((sum, e) => sum + (e.amount || 0), 0);
  const hasInvoice = linkedInvoices.length > 0 || linkedManualIncome.length > 0;

  const linkedExpenses = expenses.filter(e => String(e.jobRefId) === String(job.id));
  const cost = linkedExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  const hasCost = linkedExpenses.length > 0;

  const margin = revenue - cost;
  const marginPct = revenue > 0 ? (margin / revenue * 100) : 0;
  return { revenue, cost, hasInvoice, hasCost, margin, marginPct };
}

// Everything for one job in a single call -- the query that makes a real
// Job Detail view possible, the same way thGetClientBundle() enabled
// Client Detail. Client resolution prefers job.clientId (written on every
// job created since Push 2) and falls back to name-matching for jobs that
// predate that, exactly like thGetClientBundle() already does.
function thGetJobBundle(jobId) {
  const jobs = thRead(TH_KEYS.jobs, []);
  const job = jobs.find(j => String(j.id) === String(jobId));
  if (!job) return null;

  const invoices = thRead(TH_KEYS.invoices, []);
  const quotes = thRead(TH_KEYS.quotes, []);
  const expenses = thRead(TH_KEYS.expenses, []);
  const income = thRead(TH_KEYS.income, []).filter(e => e.origin !== 'invoice');

  const margin = thComputeJobMargin(job, invoices, expenses, income);
  const linkedInvoices = invoices.filter(inv => String(inv.jobRefId) === String(job.id));
  const linkedQuotes = quotes.filter(q => String(q.jobRefId) === String(job.id));
  const linkedExpenses = expenses.filter(e => String(e.jobRefId) === String(job.id));

  let client = null;
  if (job.clientId) client = thFindClientById(job.clientId);
  if (!client && job.client) client = thFindClientByName(job.client);

  return { job, margin, linkedInvoices, linkedQuotes, linkedExpenses, client };
}

