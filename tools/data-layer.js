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
// This registry deliberately does NOT cover every localStorage key in
// the tool suite -- just the ones read/written through thRead/thWrite
// below. A few things worth knowing if you're ever tempted to rename
// keys wholesale for the sake of a consistent namespace (structural
// item flagged repeatedly, never attempted): it would touch nearly
// every file in the suite for a purely organizational benefit, while
// investigating that exact idea (2026-08-20) surfaced two REAL bugs
// instead, fixed alongside this comment:
//   - th_clients (this whole registry) was never in sync.js's
//     SYNC_DATA_KEYS list, meaning the client identity system built in
//     Push 1/2 never actually synced across devices -- a client
//     created on one device could silently never appear on another, or
//     worse, get a second, different clientId on the other device for
//     the same person. Fixed by adding it to both SYNC_DATA_KEYS and
//     MERGE_KEY_FIELD in sync.js (the second one matters just as much
//     as the first -- without it, one device's whole client list would
//     have silently overwritten the other's on sync instead of merging).
//   - TH_KEYS.notes pointed at th_tracker_notes, a legacy migration-only
//     key, instead of th_tracker_notes_v2, the real one job-tracker.html
//     actually uses. Zero current callers of TH_KEYS.notes existed, so
//     this was a latent bug rather than a live one -- caught before it
//     could bite anyone.
// Also worth knowing: Runway Dashboard's own synced keys use a
// DIFFERENT naming convention entirely (rd_kebab-case, not
// th_snake_case -- see sync.js's SYNC_DATA_KEYS), and th_leads isn't a
// localStorage key at all -- it's a real Supabase table with its own
// direct REST calls and realtime subscription (see sync.js and
// dev-tools.html), a genuinely different and already-working sync
// mechanism, not a gap.
const TH_KEYS = {
  jobs: 'th_tracker_jobs',
  invoices: 'th_invoices',
  quotes: 'th_quotes',
  expenses: 'th_expense_log',
  income: 'th_income_log',
  contacts: 'th_tracker_contacts',
  contracts: 'th_contracts',
  notes: 'th_tracker_notes_v2', // bug fix (2026-08-20): was 'th_tracker_notes', the LEGACY migration-only key -- see the comment above this block
  clients: 'th_clients',
  inventory: 'th_inventory',
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

// Appliance Wiki's own write helper (2026-08-27), mirroring thWrite()
// exactly -- same try/catch protection, same failure toast -- but
// routed through scheduleWikiSync() instead of scheduleSync(). Added
// after a real test run caught a genuine gap: the Wiki write call
// sites below originally called localStorage.setItem() +
// scheduleWikiSync() directly with no try/catch at all, unlike
// thWrite(). An uncaught exception from scheduleWikiSync() (confirmed
// via that same test run -- isSyncConfigured() throws a real
// ReferenceError if SUPABASE_URL isn't defined yet) would propagate
// up and break whichever function called it, rather than failing
// gracefully the way every other save in this app already does.
function thWriteWiki(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    if (typeof scheduleWikiSync === 'function') scheduleWikiSync();
    return true;
  } catch (e) {
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

// Tombstones for deleted clients (2026-08-25) -- fixes a real, reported
// bug: deleting a client silently re-added it. thDeleteClient only ever
// removes the registry entry, by design leaving the client's jobs/
// invoices untouched (see its own confirm dialog text) -- which means
// thBackfillClients, seeing that name still referenced with no matching
// registry record, would recreate it the next time it ran. A cross-
// device sync could resurrect it even sooner, since a union merge (see
// sync.js's mergeRecordArrays) brings back any record still present on
// a stale remote copy -- it has no way to tell "never existed" apart
// from "existed and was deleted." Recording BOTH the id (consulted by
// the sync-merge path, since a stale copy carries the same original id)
// and the normalized name (consulted by the backfill path, since that's
// the only thing it has to go on) closes both resurrection routes.
// Tombstone retention (2026-09-05), requested directly: "Should we
// clean up the blob?" Every th_*_tombstones array below grew forever,
// one entry per deletion, across the entire lifetime of the business
// -- but each entry only needs to survive long enough for every
// device to have synced the deletion at least once, not indefinitely.
// 90 days is a generous margin for an app used daily; a device that
// hasn't synced in that long has bigger problems than a resurrected
// old record, and even then the actual worst case is a deleted item
// reappearing (easily re-deleted again), never lost data -- the
// tombstone's whole job is preventing exactly that resurrection, and
// pruning one that's already done its job for every real device
// costs nothing. Malformed or missing deletedAt values are kept
// rather than risk dropping something real over a parsing edge case.
const TOMBSTONE_RETENTION_DAYS = 90;
function thPruneTombstones(list) {
  const cutoffMs = Date.now() - TOMBSTONE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return list.filter((t) => {
    const deletedAtMs = new Date(t.deletedAt).getTime();
    return isNaN(deletedAtMs) || deletedAtMs >= cutoffMs;
  });
}

const TH_CLIENT_TOMBSTONES_KEY = 'th_client_tombstones';
function thLoadClientTombstones() { return thRead(TH_CLIENT_TOMBSTONES_KEY, []); }
function thAddClientTombstone(id, name) {
  let list = thLoadClientTombstones();
  list = thPruneTombstones(list);
  list.push({ id, normalizedName: thNormalizeClientName(name), deletedAt: new Date().toISOString() });
  thWrite(TH_CLIENT_TOMBSTONES_KEY, list);
}

// Same fix, extended to jobs (2026-08-26): found while adding live sync
// to job-detail.html and directly testing the "job deleted by someone
// else while this page is open" case -- deleteJob() in job-tracker.html
// removed the job locally but recorded nothing, so the exact same union-
// merge resurrection bug already fixed for clients above was still live
// for jobs. No normalized-name tracking needed here (unlike clients,
// nothing backfills a job from other data by name), just the id, since
// that's the only thing the sync-merge path in applySyncData needs.
const TH_JOB_TOMBSTONES_KEY = 'th_job_tombstones';
function thLoadJobTombstones() { return thRead(TH_JOB_TOMBSTONES_KEY, []); }
function thAddJobTombstone(id) {
  let list = thLoadJobTombstones();
  list = thPruneTombstones(list);
  list.push({ id, deletedAt: new Date().toISOString() });
  thWrite(TH_JOB_TOMBSTONES_KEY, list);
}

// Extended 2026-08-26 to the remaining record types with a real delete
// action, after finding the same union-merge resurrection bug (already
// fixed for clients and jobs above) was still open for all of these.
// Same shape each time: id-only, no normalized-name tracking, since
// nothing backfills any of these from other data by name the way
// clients do.
const TH_EXPENSE_TOMBSTONES_KEY = 'th_expense_tombstones';
function thLoadExpenseTombstones() { return thRead(TH_EXPENSE_TOMBSTONES_KEY, []); }
function thAddExpenseTombstone(id) {
  let list = thLoadExpenseTombstones();
  list = thPruneTombstones(list);
  list.push({ id, deletedAt: new Date().toISOString() });
  thWrite(TH_EXPENSE_TOMBSTONES_KEY, list);
}

const TH_INCOME_TOMBSTONES_KEY = 'th_income_tombstones';
function thLoadIncomeTombstones() { return thRead(TH_INCOME_TOMBSTONES_KEY, []); }
function thAddIncomeTombstone(id) {
  let list = thLoadIncomeTombstones();
  list = thPruneTombstones(list);
  list.push({ id, deletedAt: new Date().toISOString() });
  thWrite(TH_INCOME_TOMBSTONES_KEY, list);
}

const TH_CONTACT_TOMBSTONES_KEY = 'th_contact_tombstones';
function thLoadContactTombstones() { return thRead(TH_CONTACT_TOMBSTONES_KEY, []); }
function thAddContactTombstone(id) {
  let list = thLoadContactTombstones();
  list = thPruneTombstones(list);
  list.push({ id, deletedAt: new Date().toISOString() });
  thWrite(TH_CONTACT_TOMBSTONES_KEY, list);
}

const TH_CONTRACT_TOMBSTONES_KEY = 'th_contract_tombstones';
function thLoadContractTombstones() { return thRead(TH_CONTRACT_TOMBSTONES_KEY, []); }
function thAddContractTombstone(id) {
  let list = thLoadContractTombstones();
  list = thPruneTombstones(list);
  list.push({ id, deletedAt: new Date().toISOString() });
  thWrite(TH_CONTRACT_TOMBSTONES_KEY, list);
}

// Added alongside delete itself being added to invoices and quotes for
// the first time (2026-08-26) -- built in with the tombstone from the
// start this time, rather than added as a later fix the way jobs,
// expenses, income, contacts, and contracts all needed.
const TH_INVOICE_TOMBSTONES_KEY = 'th_invoice_tombstones';
function thLoadInvoiceTombstones() { return thRead(TH_INVOICE_TOMBSTONES_KEY, []); }
function thAddInvoiceTombstone(id) {
  let list = thLoadInvoiceTombstones();
  list = thPruneTombstones(list);
  list.push({ id, deletedAt: new Date().toISOString() });
  thWrite(TH_INVOICE_TOMBSTONES_KEY, list);
}

const TH_QUOTE_TOMBSTONES_KEY = 'th_quote_tombstones';
function thLoadQuoteTombstones() { return thRead(TH_QUOTE_TOMBSTONES_KEY, []); }
function thAddQuoteTombstone(id) {
  let list = thLoadQuoteTombstones();
  list = thPruneTombstones(list);
  list.push({ id, deletedAt: new Date().toISOString() });
  thWrite(TH_QUOTE_TOMBSTONES_KEY, list);
}

// Round 3 (2026-08-26) -- found by re-checking whether the earlier
// "every delete function in the codebase" sweep actually covered
// everything. It hadn't: deletePriceReference, deleteTemplate,
// deleteKnownIssue, deletePrUnitType, and deletePrIssue all had the
// identical union-merge resurrection gap, still open.
const TH_PRICE_REF_TOMBSTONES_KEY = 'th_price_ref_tombstones';
function thLoadPriceRefTombstones() { return thRead(TH_PRICE_REF_TOMBSTONES_KEY, []); }
function thAddPriceRefTombstone(id) {
  let list = thLoadPriceRefTombstones();
  list = thPruneTombstones(list);
  list.push({ id, deletedAt: new Date().toISOString() });
  thWrite(TH_PRICE_REF_TOMBSTONES_KEY, list);
}

// Parts inventory (closes a real audit gap: Appliance Wiki only ever
// tracked WHAT part fixes what, never what's actually on hand).
const TH_INVENTORY_TOMBSTONES_KEY = 'th_inventory_tombstones';
function thLoadInventoryTombstones() { return thRead(TH_INVENTORY_TOMBSTONES_KEY, []); }
function thAddInventoryTombstone(id) {
  let list = thLoadInventoryTombstones();
  list = thPruneTombstones(list);
  list.push({ id, deletedAt: new Date().toISOString() });
  thWrite(TH_INVENTORY_TOMBSTONES_KEY, list);
}

const TH_TEMPLATE_TOMBSTONES_KEY = 'th_template_tombstones';
function thLoadTemplateTombstones() { return thRead(TH_TEMPLATE_TOMBSTONES_KEY, []); }
function thAddTemplateTombstone(id) {
  let list = thLoadTemplateTombstones();
  list = thPruneTombstones(list);
  list.push({ id, deletedAt: new Date().toISOString() });
  thWrite(TH_TEMPLATE_TOMBSTONES_KEY, list);
}

const TH_KNOWN_ISSUE_TOMBSTONES_KEY = 'th_known_issue_tombstones';
function thLoadKnownIssueTombstones() { return thRead(TH_KNOWN_ISSUE_TOMBSTONES_KEY, []); }
function thAddKnownIssueTombstone(id) {
  let list = thLoadKnownIssueTombstones();
  list = thPruneTombstones(list);
  list.push({ id, deletedAt: new Date().toISOString() });
  thWrite(TH_KNOWN_ISSUE_TOMBSTONES_KEY, list);
}

const TH_PR_UNIT_TOMBSTONES_KEY = 'th_pr_unit_tombstones';
function thLoadPrUnitTombstones() { return thRead(TH_PR_UNIT_TOMBSTONES_KEY, []); }
function thAddPrUnitTombstone(id) {
  let list = thLoadPrUnitTombstones();
  list = thPruneTombstones(list);
  list.push({ id, deletedAt: new Date().toISOString() });
  // thWriteWiki (not thWrite) -- see its own comment above for why:
  // routes through scheduleWikiSync() instead of scheduleSync(), so
  // this doesn't also re-push every job/invoice/expense.
  thWriteWiki(TH_PR_UNIT_TOMBSTONES_KEY, list);
}

// Scoped by (unitId, issueId) rather than issueId alone -- issue ids
// are Date.now()-based and only guaranteed unique within their own
// unit's issues array (mergeRecordArrays for issues is called
// separately per unit), not globally, so a global-only tombstone
// could accidentally filter out an unrelated issue in a different
// unit that happens to share the same millisecond-based id. Also
// carries a composite `id` (unitId::issueId) since mergeRecordArrays
// needs a real keyField present on every record to deduplicate by --
// without one, these tombstones would silently never actually merge.
const TH_PR_ISSUE_TOMBSTONES_KEY = 'th_pr_issue_tombstones';
function thLoadPrIssueTombstones() { return thRead(TH_PR_ISSUE_TOMBSTONES_KEY, []); }
function thAddPrIssueTombstone(unitId, issueId) {
  let list = thLoadPrIssueTombstones();
  list = thPruneTombstones(list);
  list.push({ id: unitId + '::' + issueId, unitId, issueId, deletedAt: new Date().toISOString() });
  thWriteWiki(TH_PR_ISSUE_TOMBSTONES_KEY, list);
}

// Graveyard (2026-08-26), requested directly: "so items aren't gone
// forever in the event of a mistake." A deliberately separate
// mechanism from the tombstones above -- tombstones only ever record
// {id, deletedAt}, just enough to stop a stale device's union merge
// from resurrecting something. They were never meant to enable
// recovery and don't carry the record's actual data. The graveyard
// does: a full snapshot of the record itself, so a genuine mistake
// can actually be undone, not just prevented from silently reappearing.
//
// Capped at 200 entries (oldest dropped first) for the same reason
// th_client_errors caps itself -- bounds payload growth over time
// without needing to think about it. graveyardId is separate from the
// record's own id, since two different record types could otherwise
// collide on the same id value.
const TH_GRAVEYARD_KEY = 'th_graveyard';
const TH_GRAVEYARD_MAX = 200;
function thLoadGraveyard() { return thRead(TH_GRAVEYARD_KEY, []); }
function thAddToGraveyard(recordType, record) {
  const list = thLoadGraveyard();
  list.push({
    graveyardId: 'gy_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
    recordType,
    record,
    deletedAt: new Date().toISOString(),
  });
  while (list.length > TH_GRAVEYARD_MAX) list.shift();
  thWrite(TH_GRAVEYARD_KEY, list);
}
function thRemoveFromGraveyard(graveyardId) {
  const list = thLoadGraveyard().filter(g => g.graveyardId !== graveyardId);
  thWrite(TH_GRAVEYARD_KEY, list);
}

// "Flag this page" queue (2026-08-21), requested directly: a quick way
// to flag something to come back to later, for a moment when there
// isn't time to write a full message. Each entry: { id, page, note,
// time, resolved }. Newest first when read, so the most recent flag is
// always the first thing seen in the queue.
const TH_FLAGGED_ITEMS_KEY = 'th_flagged_items';
function thLoadFlaggedItems() {
  return thRead(TH_FLAGGED_ITEMS_KEY, []).slice().sort((a, b) => new Date(b.time) - new Date(a.time));
}
function thAddFlaggedItem(page, note) {
  const list = thRead(TH_FLAGGED_ITEMS_KEY, []);
  const entry = {
    id: 'f_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
    page: page,
    note: note || '',
    time: new Date().toISOString(),
    resolved: false,
  };
  list.push(entry);
  thWrite(TH_FLAGGED_ITEMS_KEY, list);
  return entry;
}
function thResolveFlaggedItem(id) {
  const list = thRead(TH_FLAGGED_ITEMS_KEY, []).map(item => item.id === id ? Object.assign({}, item, { resolved: true }) : item);
  thWrite(TH_FLAGGED_ITEMS_KEY, list);
  return list;
}
function thDeleteFlaggedItem(id) {
  const list = thRead(TH_FLAGGED_ITEMS_KEY, []).filter(item => item.id !== id);
  thWrite(TH_FLAGGED_ITEMS_KEY, list);
  return list;
}

// Requested directly (2026-08-21): the Client Registry had no way to
// remove a duplicate entry. Removes only the registry record itself --
// never the underlying jobs/invoices/quotes, which are separate, real
// records matched by name independently of any specific registry
// entry, so nothing else is affected by removing one. Now also records
// a tombstone (see above) so the deletion actually sticks.
function thDeleteClient(id) {
  const existing = thLoadClients();
  const target = existing.find(c => c.id === id);
  const list = existing.filter(c => c.id !== id);
  thSaveClients(list);
  if (target) {
    thAddClientTombstone(id, target.name);
    if (typeof thAddToGraveyard === 'function') thAddToGraveyard('client', target);
  }
  return list;
}

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

  // A record already linked to a live registry client by clientId is that
  // client, whatever its name text says now (2026-09-22) -- the Clients
  // directory runs the backfill on every load, and a job whose client
  // name was retyped differently must not spawn a second client for the
  // same person.
  const linkedIds = new Set(thLoadClients().map(c => c.id));
  const linked = (r) => !!(r && r.clientId && linkedIds.has(r.clientId));
  thRead(TH_KEYS.jobs, []).forEach(j => { if (!linked(j)) note(j.client, { phone: j.phone, address: j.address }, 'job'); });
  thRead(TH_KEYS.invoices, []).forEach(i => { if (!linked(i)) note(i.clientName, { address: i.clientAddress }, 'invoice'); });
  thRead(TH_KEYS.quotes, []).forEach(q => { if (!linked(q)) note(q.clientName, { address: q.clientAddress }, 'quote'); });
  thRead(TH_KEYS.contacts, []).forEach(c => note(c.name, { phone: c.phone, email: c.email }, 'contact'));
  thRead(TH_KEYS.contracts, []).forEach(c => {
    if (linked(c)) return;
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

  const tombstonedNames = new Set(thLoadClientTombstones().map(t => t.normalizedName));

  const discovered = thCollectClientNamesFromExistingData();
  let created = 0;

  Object.entries(discovered).forEach(([key, info]) => {
    if (byKey[key]) return; // already registered
    if (tombstonedNames.has(key)) return; // deliberately deleted -- do not recreate
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
//
// ENRICHMENT (2026-09-02): if the client already exists, any detail in
// `extras` that the record is currently MISSING gets filled in and saved,
// rather than the old behavior of returning the existing record untouched
// and silently discarding whatever was just learned. That old behavior was
// a real, load-bearing bug once the client portal existed: a client's email
// is typed on the Invoice/Quote/Job forms, but if that client already had a
// registry record (which they almost always do by then), the email was
// thrown away every single time -- leaving registry.email permanently blank
// for essentially everyone. sync-checkup-to-portal reads exactly that field
// to decide whether a check-up reminder can sync at all, so that feature was
// effectively dead until this was fixed.
//
// Deliberately FILL-ONLY, never overwrite: an existing non-empty value always
// wins over an incoming one. A blank field being filled in is unambiguously
// new information; a differing non-blank value is a genuine conflict (a typo?
// a real change of address?) that shouldn't be silently resolved by whoever
// happened to save last. Same "first non-empty value wins" rule
// thCollectClientNamesFromExistingData() above already uses for the backfill.
function thEnsureClient(name, extras) {
  const existingRecord = thFindClientByName(name);
  if (existingRecord) {
    if (extras) {
      let changed = false;
      ['phone', 'address', 'email'].forEach(field => {
        const incoming = extras[field] ? String(extras[field]).trim() : '';
        if (incoming && !existingRecord[field]) {
          existingRecord[field] = incoming;
          changed = true;
        }
      });
      if (changed) {
        const list = thLoadClients();
        const idx = list.findIndex(c => c.id === existingRecord.id);
        if (idx > -1) {
          list[idx] = existingRecord;
          thSaveClients(list);
        }
      }
    }
    return existingRecord;
  }
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

// Fills blank client contact fields on any form from the shared client
// registry, given a typed client name. The read-side counterpart to
// thEnsureClient()'s write-side enrichment (2026-09-02): together they
// mean a client's email/phone/address is typed ONCE, anywhere, and is
// then available on every other form automatically -- instead of being
// re-typed per form, where a single typo silently creates a second
// portal identity for the same person.
//
// Deliberately FILL-ONLY, matching thEnsureClient()'s own rule: never
// overwrites a field the user has already typed into. Pass a map of
// { phone, address, email } -> element id; omit any the form lacks.
// Returns the matched registry record, or null.
function thAutofillClientFields(typedName, fieldIds) {
  if (typeof thFindClientByName !== 'function') return null;
  const record = thFindClientByName(typedName);
  if (!record) return null;
  Object.entries(fieldIds || {}).forEach(([field, elId]) => {
    if (!elId) return;
    const el = document.getElementById(elId);
    if (el && !el.value.trim() && record[field]) el.value = record[field];
  });
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
      // Requested directly: "link client history and Portal clients
      // together." The registry itself is name/phone-based (built
      // from local Invoice Log / Job Tracker data); the portal is
      // email-based. This is the actual bridge between the two --
      // the most recent invoice with a real clientEmail on file,
      // since that is exactly what a portal account is keyed by.
      // Not stored ON the registry client record itself (an email
      // can change or be entered later; deriving it fresh each time
      // avoids it ever going stale).
      const emailedInvoice = bundle
        ? [...bundle.invoices].reverse().find(i => i.clientEmail)
        : null;
      return {
        ...c,
        jobCount: bundle ? bundle.jobs.length : 0,
        invoiceCount: bundle ? bundle.invoices.length : 0,
        revenue: bundle ? bundle.revenue : 0,
        lastJobDate: bundle ? bundle.lastJobDate : null,
        knownEmail: emailedInvoice ? emailedInvoice.clientEmail : null,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
}

// --- the Clients directory (2026-09-22, Workspace rework part 2) ----------
//
// thGetAllClientsWithTotals() above was written to back "the Clients hub
// page" -- that page was never built (the Clients tab opened the portal
// admin console instead). This is the query behind the directory that
// finally is: one row per registry client with what a list row needs --
// what they owe (unpaid minus partial payments), whether any of it is
// overdue, their next scheduled and last job, and when anything last
// happened -- in one pass over each collection (indexed by clientId and
// normalized name) rather than one thGetClientBundle() call per client.
//
// Money rules match workspace.html's Money Owed card exactly: a legacy
// invoice with no paidAmount counts as fully paid if `paid`, else $0;
// due date is the invoice date plus its terms (Due Upon Receipt 0, Net 15,
// Net 30; anything else 15); overdue means unpaid and past that date.
const TH_TERM_DAYS = { 'Due Upon Receipt': 0, 'Net 15': 15, 'Net 30': 30 };
function thInvoicePaidAmount(inv) {
  if (inv.paidAmount !== undefined && inv.paidAmount !== null) return Number(inv.paidAmount) || 0;
  return inv.paid ? (Number(inv.total) || 0) : 0;
}
function thInvoiceBalance(inv) {
  const cents = Math.round((Number(inv.total) || 0) * 100) - Math.round(thInvoicePaidAmount(inv) * 100);
  return cents > 0 ? cents / 100 : 0;
}
function thInvoiceDueDate(inv) {
  const base = new Date((inv.date || '') + 'T00:00:00');
  if (isNaN(base.getTime())) return null;
  const days = TH_TERM_DAYS[inv.terms] !== undefined ? TH_TERM_DAYS[inv.terms] : 15;
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}
function thInvoiceIsOverdue(inv, now) {
  if (thInvoiceBalance(inv) <= 0) return false;
  const due = thInvoiceDueDate(inv);
  if (!due) return false;
  const today = new Date((now || new Date()).toDateString());
  return due < today;
}

function thLocalDateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function thGetClientDirectory(now) {
  const clients = thLoadClients();
  const todayStr = thLocalDateStr(now || new Date());
  const byId = {};
  const byName = {};
  const rows = clients.map(c => {
    const row = {
      id: c.id, name: c.name || '', phone: c.phone || '', email: c.email || '', address: c.address || '',
      jobCount: 0, openJobCount: 0, lastJobDate: null, nextJobDate: null,
      owed: 0, overdueOwed: 0, unpaidCount: 0, revenue: 0,
      lastActivity: (c.createdAt || '').slice(0, 10) || null,
    };
    byId[c.id] = row;
    const key = thNormalizeClientName(c.name);
    if (key && !byName[key]) byName[key] = row;
    return row;
  });
  function rowFor(clientId, name) {
    return (clientId && byId[clientId]) || byName[thNormalizeClientName(name)] || null;
  }
  function touch(row, date) {
    if (date && (!row.lastActivity || date > row.lastActivity)) row.lastActivity = date;
  }

  thRead(TH_KEYS.jobs, []).forEach(j => {
    const row = rowFor(j.clientId, j.client);
    if (!row) return;
    row.jobCount++;
    if (j.status !== 'done') row.openJobCount++;
    if (j.date) {
      if (j.date <= todayStr && (!row.lastJobDate || j.date > row.lastJobDate)) row.lastJobDate = j.date;
      if (j.date >= todayStr && j.status !== 'done' && (!row.nextJobDate || j.date < row.nextJobDate)) row.nextJobDate = j.date;
    }
    touch(row, j.date);
  });
  thRead(TH_KEYS.invoices, []).forEach(i => {
    const row = rowFor(i.clientId, i.clientName);
    if (!row) return;
    row.revenue += Number(i.total) || 0;
    const bal = thInvoiceBalance(i);
    if (bal > 0) {
      row.owed += bal;
      row.unpaidCount++;
      if (thInvoiceIsOverdue(i, now)) row.overdueOwed += bal;
    }
    touch(row, i.date);
  });
  thRead(TH_KEYS.quotes, []).forEach(q => {
    const row = rowFor(q.clientId, q.clientName);
    if (row) touch(row, q.date);
  });
  rows.forEach(r => {
    r.owed = Math.round(r.owed * 100) / 100;
    r.overdueOwed = Math.round(r.overdueOwed * 100) / 100;
  });
  return rows;
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

// The money side of a job (2026-09-22, Workspace rework part 5): where it
// is between booked and paid, worked out from records that already exist --
// its status, the invoices carrying its jobRefId, and any payment logged
// against it by hand in Finance (cash, a check, a transfer). The only new
// field is job.noInvoice, the "No charge" opt-out (a warranty callback, a
// favor), set from the Dashboard or the job's own sheet.
//   booked     -- not started            working  -- in progress
//   to-invoice -- done, nothing billed or paid (the one that slips)
//   no-charge  -- done, marked as not needing an invoice
//   invoiced   -- billed, still owed, not past due
//   overdue    -- billed, still owed, past due
//   paid       -- billed and paid in full, or paid by hand in Finance
// A job can be invoiced before it's done (a deposit); the stage follows the
// money, and thJobSteps() below keeps the work and the money apart.
function thJobMoneyStage(job, invoices, manualIncome, now) {
  const id = String(job.id);
  const linked = (invoices || []).filter(inv => String(inv.jobRefId) === id);
  const payments = (manualIncome || []).filter(e => String(e.jobRefId) === id);
  const balanceCents = linked.reduce((sum, inv) => sum + Math.round(thInvoiceBalance(inv) * 100), 0);
  const billed = linked.reduce((sum, inv) => sum + (Number(inv.total) || 0), 0) + payments.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  let stage;
  if (linked.length) {
    if (balanceCents <= 0) stage = 'paid';
    else stage = linked.some(inv => thInvoiceIsOverdue(inv, now)) ? 'overdue' : 'invoiced';
  } else if (payments.length) {
    stage = 'paid';
  } else if (job.status === 'done') {
    stage = job.noInvoice ? 'no-charge' : 'to-invoice';
  } else {
    stage = job.status === 'in-progress' ? 'working' : 'booked';
  }
  return { stage, invoices: linked, payments, billed, balance: balanceCents / 100 };
}

// Booked -> Working -> Done -> Invoiced -> Paid, for Job Detail's tracker.
// `current` is the first step not yet reached (null once all are); a
// no-charge job ends at Done.
function thJobSteps(job, money) {
  const worked = job.status === 'in-progress' || job.status === 'done';
  const done = job.status === 'done';
  const billed = money.invoices.length > 0 || money.payments.length > 0;
  const steps = [
    { key: 'booked', label: 'Booked', reached: true },
    { key: 'working', label: 'Working', reached: worked || done },
    { key: 'done', label: 'Done', reached: done },
  ];
  if (money.stage !== 'no-charge') {
    steps.push({ key: 'invoiced', label: 'Invoiced', reached: billed });
    steps.push({ key: 'paid', label: 'Paid', reached: money.stage === 'paid' });
  }
  const next = steps.find(s => !s.reached);
  return { steps, current: next ? next.key : null };
}

// When a job was finished: the moment its status last changed to Done
// (statusChangedAt, written by every status change since 2026-08), else its
// own date for jobs finished before that field existed.
function thJobDoneDate(job) {
  if (job.statusChangedAt) {
    const d = new Date(job.statusChangedAt);
    if (!isNaN(d.getTime())) return new Date(d.toDateString());
  }
  const d = new Date((job.date || '') + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}

// Done jobs nobody has billed (2026-09-22, rework part 5): the Dashboard's
// "Ready to invoice" and Job Tracker's "To invoice" filter. Only jobs
// finished in the last `days` (60 by default) -- older history from before
// invoicing moved into this app would otherwise bury this week's job --
// oldest first, since the oldest is the one closest to being forgotten.
const TH_TO_INVOICE_DAYS = 60;
function thJobsToInvoice(jobs, invoices, manualIncome, now, days) {
  const today = new Date((now || new Date()).toDateString());
  const windowDays = days || TH_TO_INVOICE_DAYS;
  return (jobs || [])
    .filter(j => j.status === 'done')
    .map(j => ({ job: j, doneDate: thJobDoneDate(j) }))
    .filter(r => r.doneDate && Math.round((today - r.doneDate) / 86400000) <= windowDays)
    .filter(r => thJobMoneyStage(r.job, invoices, manualIncome, now).stage === 'to-invoice')
    .map(r => ({ job: r.job, doneDate: r.doneDate, daysAgo: Math.max(0, Math.round((today - r.doneDate) / 86400000)) }))
    .sort((a, b) => a.doneDate - b.doneDate);
}

// The one write for the "No charge" opt-out, shared by every page that
// offers it. Blob only: the relational jobs mirror has no column for it and
// nothing reads it from there.
function thSetJobNoInvoice(jobId, value) {
  const jobs = thRead(TH_KEYS.jobs, []);
  const job = jobs.find(j => String(j.id) === String(jobId));
  if (!job) return false;
  job.noInvoice = !!value; // false, not deleted: the sync merge is per field, and a deleted field can come back from a stale device
  job.lastEditedBy = (typeof getCurrentUserEmail === 'function' && getCurrentUserEmail()) || job.lastEditedBy;
  return thWrite(TH_KEYS.jobs, jobs);
}

// ---------- Job clock (2026-09-23, Workspace rework part 9) ----------
// Tap Start on a job and its clock runs: on that page, on every other page
// (the shell's On the clock bar), and on any other device once it syncs,
// because "running" is just a field on the job (clockSince). Stop adds the
// time to hoursWorked -- the number part 6's From this job panel already
// turns into the invoice's Labor line -- and keeps each visit in timeLog.
// One clock at a time: starting another job stops the first, keeping its
// time. Under a minute is a mis-tap and adds nothing; the rest rounds to
// the nearest 0.1 h (6 minutes).
const TH_CLOCK_MIN_MS = 60 * 1000;

function thJobClockSince(job) {
  if (!job || !job.clockSince) return null;
  const t = new Date(job.clockSince).getTime();
  return isNaN(t) ? null : t;
}
function thJobClockElapsedMs(job, now) {
  const since = thJobClockSince(job);
  if (since === null) return 0;
  return Math.max(0, (now === undefined ? Date.now() : new Date(now).getTime()) - since);
}
function thRunningJobClock(jobs) {
  let best = null;
  (jobs || []).forEach(j => {
    const since = thJobClockSince(j);
    if (since !== null && (!best || since > thJobClockSince(best))) best = j;
  });
  return best;
}
function thClockHours(ms) {
  if (!(ms >= TH_CLOCK_MIN_MS)) return 0;
  return Math.max(0.1, Math.round(ms / 360000) / 10);
}
function thClockChanged(jobId) {
  try { window.dispatchEvent(new CustomEvent('th-clock-change', { detail: { jobId: jobId } })); } catch (e) { /* ignore */ }
}
function thSaveClockJobs(jobs) {
  const ok = thWrite(TH_KEYS.jobs, jobs);
  // Status can change here, and status is a relational column.
  if (ok && typeof mirrorJobsToRelational === 'function') mirrorJobsToRelational(jobs);
  return ok;
}
// Stops one job's clock in place (no save): its time goes on the job.
function thCommitJobClock(job, nowMs) {
  const ms = thJobClockElapsedMs(job, nowMs);
  const hours = thClockHours(ms);
  const start = job.clockSince;
  job.clockSince = null; // null, not deleted: the sync merge is per field
  if (hours > 0) {
    job.hoursWorked = Math.round(((Number(job.hoursWorked) || 0) + hours) * 100) / 100;
    job.timeLog = (Array.isArray(job.timeLog) ? job.timeLog : []).concat([{ start: start, end: new Date(nowMs).toISOString(), hours: hours }]);
  }
  return { ms: ms, hours: hours };
}
function thStartJobClock(jobId, now) {
  const nowMs = now === undefined ? Date.now() : new Date(now).getTime();
  const jobs = thRead(TH_KEYS.jobs, []);
  const job = jobs.find(j => String(j.id) === String(jobId));
  if (!job) return null;
  if (thJobClockSince(job) !== null) return { job: job, stopped: null };
  let stopped = null;
  jobs.forEach(other => {
    if (other !== job && thJobClockSince(other) !== null) stopped = Object.assign({ job: other }, thCommitJobClock(other, nowMs));
  });
  job.clockSince = new Date(nowMs).toISOString();
  // Starting the clock is starting the job.
  if (!job.status || job.status === 'not-started') {
    job.status = 'in-progress';
    job.statusChangedAt = job.clockSince;
  }
  job.lastEditedBy = (typeof getCurrentUserEmail === 'function' && getCurrentUserEmail()) || job.lastEditedBy;
  if (!thSaveClockJobs(jobs)) return null;
  thClockChanged(job.id);
  return { job: job, stopped: stopped };
}
// Returns what Stop did, plus `undo` -- the fields as they were, for
// thUndoStopJobClock() when Stop was a mis-tap.
function thStopJobClock(jobId, now) {
  const nowMs = now === undefined ? Date.now() : new Date(now).getTime();
  const jobs = thRead(TH_KEYS.jobs, []);
  const job = jobs.find(j => String(j.id) === String(jobId));
  if (!job || thJobClockSince(job) === null) return null;
  const undo = { clockSince: job.clockSince, hoursWorked: job.hoursWorked === undefined ? null : job.hoursWorked, timeLog: Array.isArray(job.timeLog) ? job.timeLog.slice() : [] };
  const result = thCommitJobClock(job, nowMs);
  job.lastEditedBy = (typeof getCurrentUserEmail === 'function' && getCurrentUserEmail()) || job.lastEditedBy;
  if (!thSaveClockJobs(jobs)) return null;
  thClockChanged(job.id);
  return { job: job, ms: result.ms, hours: result.hours, totalHours: Number(job.hoursWorked) || 0, undo: undo };
}
function thUndoStopJobClock(jobId, undo) {
  if (!undo) return false;
  const jobs = thRead(TH_KEYS.jobs, []);
  const job = jobs.find(j => String(j.id) === String(jobId));
  if (!job) return false;
  job.clockSince = undo.clockSince;
  job.hoursWorked = undo.hoursWorked;
  job.timeLog = undo.timeLog;
  if (!thSaveClockJobs(jobs)) return false;
  thClockChanged(job.id);
  return true;
}
// Done from the clock's Stop sheet: stops a still-running clock first, so
// no time is lost, then marks the job done the way the Jobs list does.
function thFinishJob(jobId, now) {
  const nowMs = now === undefined ? Date.now() : new Date(now).getTime();
  const jobs = thRead(TH_KEYS.jobs, []);
  const job = jobs.find(j => String(j.id) === String(jobId));
  if (!job) return null;
  if (thJobClockSince(job) !== null) thCommitJobClock(job, nowMs);
  if (job.status !== 'done') {
    job.status = 'done';
    job.statusChangedAt = new Date(nowMs).toISOString();
  }
  job.lastEditedBy = (typeof getCurrentUserEmail === 'function' && getCurrentUserEmail()) || job.lastEditedBy;
  if (!thSaveClockJobs(jobs)) return null;
  thClockChanged(job.id);
  return job;
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

  const money = thJobMoneyStage(job, invoices, income);
  return { job, margin, linkedInvoices, linkedQuotes, linkedExpenses, client, money };
}

