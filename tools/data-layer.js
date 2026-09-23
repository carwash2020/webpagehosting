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

// ---------- Payment reminders (2026-09-23, Workspace rework part 10) ----------
// A reminder that writes itself: who, which invoice, how much, how late,
// and -- for an invoice on the client portal (it has a client email) --
// where to pay by card. Each one sent is logged on the invoice
// (inv.reminders), so the next one is a notch firmer and every money view
// can say when the client was last reminded. Sending is the phone's own
// Messages or Mail app; nothing is sent from here.
const TH_PORTAL_PAY_URL = 'https://www.triplehenterprisesllc.biz/portal/login.html';

function thInvoiceReminders(inv) {
  return (inv && Array.isArray(inv.reminders) ? inv.reminders : [])
    .filter(r => r && r.at && !isNaN(new Date(r.at).getTime()))
    .slice().sort((a, b) => new Date(a.at) - new Date(b.at));
}
function thInvoiceLastReminder(inv) {
  const list = thInvoiceReminders(inv);
  return list.length ? list[list.length - 1] : null;
}
function thDaysBetween(a, b) {
  return Math.round((new Date(new Date(b).toDateString()) - new Date(new Date(a).toDateString())) / 86400000);
}
// 1 friendly, 2 following up, 3 firm: one notch past the last one sent,
// and never gentler than how late it is (two weeks late starts at 2, a
// month late at 3).
function thInvoiceReminderStep(inv, now) {
  const at = now === undefined ? new Date() : new Date(now);
  const due = thInvoiceDueDate(inv);
  const late = due ? thDaysBetween(due, at) : 0;
  const sent = thInvoiceReminders(inv);
  const lastStep = sent.length ? (Number(sent[sent.length - 1].step) || sent.length) : 0;
  let step = Math.min(3, lastStep + 1);
  if (late >= 30) step = 3;
  else if (late >= 14) step = Math.max(step, 2);
  return step;
}
function thReminderMoney(n) {
  return '$' + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function thInvoiceReminderText(inv, now) {
  const at = now === undefined ? new Date() : new Date(now);
  const first = String(inv.clientName || '').trim().split(/\s+/)[0] || 'there';
  const which = 'invoice ' + (inv.invoiceNumber ? inv.invoiceNumber + ' ' : '') + 'for ' + thReminderMoney(thInvoiceBalance(inv));
  const due = thInvoiceDueDate(inv);
  const late = due ? thDaysBetween(due, at) : 0;
  const dueWord = due ? due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  const pay = inv.clientEmail ? ' You can pay online at ' + TH_PORTAL_PAY_URL + ' (sign in with your email).' : '';
  const step = thInvoiceReminderStep(inv, at);
  let body;
  if (step === 1) {
    const when = !due ? '' : late > 0 ? ' was due ' + dueWord : late === 0 ? ' is due today' : ' is due ' + dueWord;
    body = 'Hi ' + first + ', this is Triple H Enterprises. Just a friendly reminder that ' + which + when + '.' + pay + ' Thank you!';
  } else if (step === 2) {
    body = 'Hi ' + first + ', Triple H Enterprises here, following up on ' + which + (late > 0 ? ', now ' + late + ' day' + (late === 1 ? '' : 's') + ' past due' : '') + '.' + pay +
      ' If anything about the bill looks wrong, just reply and let me know.';
  } else {
    body = 'Hi ' + first + ', ' + which + ' from Triple H Enterprises is now ' + Math.max(late, 0) + ' days past due. Please arrange payment this week' +
      (inv.clientEmail ? ' at ' + TH_PORTAL_PAY_URL : '') + ', or reply so we can sort it out. Thank you.';
  }
  return {
    step: step,
    body: body,
    subject: 'Reminder: invoice ' + (inv.invoiceNumber ? inv.invoiceNumber + ' ' : '') + '(' + thReminderMoney(thInvoiceBalance(inv)) + ')',
  };
}
function thLogInvoiceReminder(invoiceId, channel, now) {
  const invoices = thRead(TH_KEYS.invoices, []);
  const inv = invoices.find(i => String(i.id) === String(invoiceId));
  if (!inv) return null;
  const at = now === undefined ? new Date() : new Date(now);
  const step = thInvoiceReminderStep(inv, at);
  inv.reminders = thInvoiceReminders(inv).concat([{ at: at.toISOString(), channel: channel || 'text', step: step }]);
  if (!thWrite(TH_KEYS.invoices, invoices)) return null;
  return inv;
}
// Where the Remind button shows: something is still owed and it's due
// today or past due. Before that, a reminder is just nagging.
function thInvoiceNeedsReminder(inv, now) {
  if (!inv || thInvoiceBalance(inv) <= 0) return false;
  const due = thInvoiceDueDate(inv);
  return !!due && thDaysBetween(due, now === undefined ? new Date() : now) >= 0;
}
// "Reminded today", "Reminded 3 days ago" -- for the money lists.
function thInvoiceRemindedLabel(inv, now) {
  const last = thInvoiceLastReminder(inv);
  if (!last) return '';
  const d = thDaysBetween(last.at, now === undefined ? new Date() : now);
  return 'Reminded ' + (d <= 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago');
}

// ---------- Your week (2026-09-23, Workspace rework part 11) ----------
// The Dashboard's scoreboard, Monday to Sunday: hours on the clock each day
// (part 9's timeLog, plus a clock still running), jobs finished, and what
// was billed (invoices dated this week, plus income logged by hand), each
// beside last week's. Billed, not collected: a card payment through the
// portal has no local payment date to count by.
function thWeekStart(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
function thWeekSummary(now, data) {
  const at = now === undefined ? new Date() : new Date(now);
  data = data || {};
  const jobs = data.jobs || thRead(TH_KEYS.jobs, []);
  const invoices = data.invoices || thRead(TH_KEYS.invoices, []);
  const income = (data.income || thRead(TH_KEYS.income, [])).filter(e => e && e.origin !== 'invoice');
  const start = thWeekStart(at);
  const dayAt = (n) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + n);
  const end = dayAt(7), prevStart = dayAt(-7);
  const today = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const days = names.map((name, i) => {
    const d = dayAt(i);
    return { date: thLocalDateStr(d), name: name, hours: 0, isToday: d.getTime() === today.getTime(), isFuture: d > today };
  });
  const indexOf = (d) => {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return day < start || day >= end ? -1 : Math.round((day - start) / 86400000);
  };
  const out = { start: start, end: dayAt(6), days: days, hours: 0, prevHours: 0, jobsDone: 0, prevJobsDone: 0, billed: 0, prevBilled: 0, running: false };
  const addHours = (when, h) => {
    if (!(h > 0) || isNaN(when.getTime())) return;
    const i = indexOf(when);
    if (i >= 0) { days[i].hours += h; out.hours += h; }
    else if (when >= prevStart && when < start) out.prevHours += h;
  };
  (jobs || []).forEach(j => {
    (Array.isArray(j.timeLog) ? j.timeLog : []).forEach(v => { if (v) addHours(new Date(v.start), Number(v.hours) || 0); });
    const since = thJobClockSince(j);
    if (since !== null) { out.running = true; addHours(new Date(since), thJobClockElapsedMs(j, at) / 3600000); }
    if (j.status === 'done') {
      const done = thJobDoneDate(j);
      if (done && indexOf(done) >= 0) out.jobsDone++;
      else if (done && done >= prevStart && done < start) out.prevJobsDone++;
    }
  });
  const addMoney = (dateStr, amount) => {
    const d = new Date((dateStr || '') + 'T00:00:00');
    const n = Number(amount) || 0;
    if (isNaN(d.getTime()) || !n) return;
    if (indexOf(d) >= 0) out.billed += n;
    else if (d >= prevStart && d < start) out.prevBilled += n;
  };
  (invoices || []).forEach(inv => { if (inv) addMoney(inv.date, inv.total); });
  income.forEach(e => addMoney(e.date, e.amount));
  const r1 = (n) => Math.round(n * 10) / 10;
  days.forEach(d => { d.hours = r1(d.hours); });
  out.hours = r1(out.hours);
  out.prevHours = r1(out.prevHours);
  out.billed = Math.round(out.billed * 100) / 100;
  out.prevBilled = Math.round(out.prevBilled * 100) / 100;
  return out;
}

// ---------- Shift clock (2026-09-23) ----------
// Start my day / End my day: a whole-shift punch for each person, beside the
// job clock above rather than instead of it. The job clock answers "how long
// did this job take" (job costing, the invoice's Labor line); this answers
// "how long did I work today", driving, estimates and the time between jobs
// included. The two are independent: a job clock never needs a shift, since
// forgetting to punch in mustn't cost a job its billable hours.
//
// Each shift is its own record in th_shift_log, kept lean because the whole
// blob is pushed on every edit:
//   { id, email, start, end, hours }                    always
//   startSource 'entered' | 'job-clock', endSource 'entered'   only when typed or back-dated
//   editedBy                                             only when someone else changed it
// A list of records, not an object keyed by email: sync.js merges arrays per
// record and per field, but overwrites plain objects whole, so two people
// punching in on two phones would erase each other. On shift means end is
// null -- null, never deleted, for the same merge reason as clockSince.
// Hours round like the job clock's (thClockHours: 0.1 h, under a minute is a
// mis-tap and counts 0) and land on the day the shift started.
//
// A forgotten End my day: a shift still open TH_SHIFT_MAX_HOURS after it
// began needs an end time. It counts 0 h until someone says when they
// finished, and End my day on it asks for that time instead of recording
// now, so a punch left running overnight can't turn an 8-hour day into 24.
// So does an older open shift left behind when two devices each started one
// offline: only the latest open shift is the current one.
const TH_SHIFTS_KEY = 'th_shift_log';
const TH_SHIFT_TOMBSTONES_KEY = 'th_shift_tombstones';
const TH_SHIFT_MAX_HOURS = 14;
const TH_SHIFT_ENTRY_MAX_HOURS = 24; // the longest shift a typed-in time can make
const TH_HOUR_MS = 3600000;

function thLoadShiftTombstones() { return thRead(TH_SHIFT_TOMBSTONES_KEY, []); }
function thAddShiftTombstone(id) {
  let list = thLoadShiftTombstones();
  list = thPruneTombstones(list);
  list.push({ id, deletedAt: new Date().toISOString() });
  thWrite(TH_SHIFT_TOMBSTONES_KEY, list);
}

// Whose shift: the signed-in email, read from the stored session first -- it
// stays there when the access token expires (hourly), when
// getCurrentUserEmail() returns null (see tools-tour.js's appTourSeenKey).
function thShiftEmail() {
  let email = null;
  try {
    const s = typeof getStoredSession === 'function' ? getStoredSession() : null;
    email = (s && s.email) || null;
  } catch (e) { /* ignore */ }
  if (!email && typeof getCurrentUserEmail === 'function') email = getCurrentUserEmail();
  return email ? String(email).trim().toLowerCase() : null;
}
function thShiftTime(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return isNaN(t) ? null : t;
}
function thShiftNowMs(now) { return now === undefined ? Date.now() : new Date(now).getTime(); }
function thRawShifts() {
  const list = thRead(TH_SHIFTS_KEY, []);
  return Array.isArray(list) ? list : [];
}
function thLoadShifts() {
  return thRawShifts().filter(s => s && s.id && thShiftTime(s.start) !== null);
}
function thShiftsFor(email, shifts) {
  const who = String(email || '').trim().toLowerCase();
  if (!who) return [];
  return (shifts || thLoadShifts()).filter(s => s && s.id && String(s.email || '').toLowerCase() === who && thShiftTime(s.start) !== null);
}
// The latest-started open shift. Can be stale -- see thActiveShift.
function thCurrentShift(email, shifts) {
  let best = null;
  thShiftsFor(email, shifts).forEach(s => {
    if (!s.end && (!best || thShiftTime(s.start) > thShiftTime(best.start))) best = s;
  });
  return best;
}
function thShiftIsStale(shift, now) {
  if (!shift || shift.end) return false;
  return thShiftNowMs(now) - thShiftTime(shift.start) > TH_SHIFT_MAX_HOURS * TH_HOUR_MS;
}
// On shift right now: the current shift, unless it's been open too long.
function thActiveShift(email, shifts, now) {
  const s = thCurrentShift(email, shifts);
  return s && !thShiftIsStale(s, now) ? s : null;
}
// Open shifts that count nothing until they get an end time, oldest first.
function thShiftsNeedingEnd(email, shifts, now) {
  const list = shifts || thLoadShifts();
  const current = thCurrentShift(email, list);
  return thShiftsFor(email, list)
    .filter(s => !s.end && (!current || s.id !== current.id || thShiftIsStale(s, now)))
    .sort((a, b) => thShiftTime(a.start) - thShiftTime(b.start));
}
// "7:40 AM", or "Sep 22, 7:40 AM" when it isn't today.
function thShiftClockLabel(ms, now) {
  const d = new Date(ms);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date(thShiftNowMs(now)).toDateString()
    ? time
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + time;
}
// Why a start/end pair can't be saved, in plain words, or '' if it can.
// Shared by a back-dated Start, an entered End time, and Edit. endMs null
// means still open; `id` is the shift being changed, left out of the
// overlap check. An open neighbour runs until whenever it ends.
function thShiftTimesProblem(email, id, startMs, endMs, now, shifts) {
  const nowMs = thShiftNowMs(now);
  if (startMs === null || isNaN(startMs)) return 'Pick a start time.';
  if (startMs > nowMs + 60000) return 'The start can’t be in the future.';
  if (endMs !== null) {
    if (isNaN(endMs)) return 'Pick an end time.';
    if (endMs <= startMs) return 'The end has to be after the start.';
    if (endMs > nowMs + 60000) return 'The end can’t be in the future.';
    if (endMs - startMs > TH_SHIFT_ENTRY_MAX_HOURS * TH_HOUR_MS) return 'That’s over ' + TH_SHIFT_ENTRY_MAX_HOURS + ' hours. Check the times.';
  } else if (nowMs - startMs > TH_SHIFT_MAX_HOURS * TH_HOUR_MS) {
    return 'That’s more than ' + TH_SHIFT_MAX_HOURS + ' hours ago. Add an end time too.';
  }
  const myEnd = endMs === null ? Infinity : endMs;
  const clash = thShiftsFor(email, shifts).find(s => {
    if (String(s.id) === String(id)) return false;
    const a = thShiftTime(s.start);
    const b = s.end ? thShiftTime(s.end) : null;
    return startMs < (b === null ? Infinity : b) && a < myEnd;
  });
  return clash ? 'That overlaps the shift from ' + thShiftClockLabel(thShiftTime(clash.start), nowMs) + '.' : '';
}
function thShiftChanged(shift) {
  try { window.dispatchEvent(new CustomEvent('th-shift-change', { detail: { shiftId: shift ? shift.id : null, email: shift ? shift.email : null } })); } catch (e) { /* ignore */ }
}
function thShiftMarkEditor(shift) {
  const me = thShiftEmail();
  if (me && me !== shift.email) shift.editedBy = me;
}

// Start my day. opts: { now, start (a back-dated start), source, email }.
// Returns { shift } when started, { shift, already: true } when already on
// shift, { needsEnd: shift } when an older shift has to be closed first, or
// { error } with the reason.
function thStartShift(opts) {
  opts = opts || {};
  const nowMs = thShiftNowMs(opts.now);
  const email = opts.email ? String(opts.email).trim().toLowerCase() : thShiftEmail();
  if (!email) return { error: 'Sign in again to start your day.' };
  const list = thRawShifts();
  const active = thActiveShift(email, list, nowMs);
  if (active) return { shift: active, already: true };
  const waiting = thShiftsNeedingEnd(email, list, nowMs);
  if (waiting.length) return { needsEnd: waiting[0] };
  const backDated = opts.start !== undefined && opts.start !== null;
  const startMs = backDated ? new Date(opts.start).getTime() : nowMs;
  const problem = thShiftTimesProblem(email, null, startMs, null, nowMs, list);
  if (problem) return { error: problem };
  const shift = {
    id: 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
    email: email,
    start: new Date(startMs).toISOString(),
    end: null,
    hours: null,
  };
  if (backDated) shift.startSource = opts.source === 'job-clock' ? 'job-clock' : 'entered';
  thShiftMarkEditor(shift);
  list.push(shift);
  if (!thWrite(TH_SHIFTS_KEY, list)) return { error: 'Could not save.' };
  thShiftChanged(shift);
  return { shift: shift };
}

// End my day. opts: { now, end (an entered finish time), id, email } -- id
// picks a shift other than the current one. Returns { shift, ms, hours,
// undo }, { needsEnd: shift } when there's no telling when it ended (too
// long open, or an older duplicate), { error }, or null with nothing to end.
function thEndShift(opts) {
  opts = opts || {};
  const nowMs = thShiftNowMs(opts.now);
  const list = thRawShifts();
  const email = opts.email ? String(opts.email).trim().toLowerCase() : thShiftEmail();
  const shift = opts.id !== undefined
    ? list.find(s => s && String(s.id) === String(opts.id))
    : thCurrentShift(email, list);
  if (!shift || shift.end || thShiftTime(shift.start) === null) return null;
  const entered = opts.end !== undefined && opts.end !== null;
  if (!entered && thShiftsNeedingEnd(shift.email, list, nowMs).some(s => s.id === shift.id)) return { needsEnd: shift };
  const startMs = thShiftTime(shift.start);
  const endMs = entered ? new Date(opts.end).getTime() : nowMs;
  const problem = thShiftTimesProblem(shift.email, shift.id, startMs, endMs, nowMs, list);
  if (problem) return { error: problem };
  const undo = { end: null, hours: null, endSource: shift.endSource, editedBy: shift.editedBy };
  shift.end = new Date(endMs).toISOString();
  shift.hours = thClockHours(endMs - startMs);
  if (entered) shift.endSource = 'entered';
  else if (shift.endSource !== undefined) shift.endSource = null;
  thShiftMarkEditor(shift);
  if (!thWrite(TH_SHIFTS_KEY, list)) return { error: 'Could not save.' };
  thShiftChanged(shift);
  return { shift: shift, ms: endMs - startMs, hours: shift.hours, undo: undo };
}
// Undo an End my day tapped by mistake: the shift runs again from when it
// really started. Refused once a newer shift has begun.
function thUndoEndShift(id, undo) {
  if (!undo) return false;
  const list = thRawShifts();
  const shift = list.find(s => s && String(s.id) === String(id));
  if (!shift || !shift.end) return false;
  const startMs = thShiftTime(shift.start);
  if (thShiftsFor(shift.email, list).some(s => s.id !== shift.id && thShiftTime(s.start) > startMs)) return false;
  shift.end = null;
  shift.hours = null;
  if (undo.endSource !== undefined || shift.endSource !== undefined) shift.endSource = undo.endSource === undefined ? null : undo.endSource;
  if (undo.editedBy !== undefined || shift.editedBy !== undefined) shift.editedBy = undo.editedBy === undefined ? null : undo.editedBy;
  if (!thWrite(TH_SHIFTS_KEY, list)) return false;
  thShiftChanged(shift);
  return true;
}
// Fix a shift's times. changes: { start, end } -- either may be left out.
// Returns { shift } or { error }, or null for an unknown id.
function thEditShift(id, changes, now) {
  changes = changes || {};
  const nowMs = thShiftNowMs(now);
  const list = thRawShifts();
  const shift = list.find(s => s && String(s.id) === String(id));
  if (!shift) return null;
  const hasStart = changes.start !== undefined && changes.start !== null;
  const hasEnd = changes.end !== undefined && changes.end !== null;
  const startMs = hasStart ? new Date(changes.start).getTime() : thShiftTime(shift.start);
  const endMs = hasEnd ? new Date(changes.end).getTime() : (shift.end ? thShiftTime(shift.end) : null);
  const problem = thShiftTimesProblem(shift.email, shift.id, startMs, endMs, nowMs, list);
  if (problem) return { error: problem };
  if (hasStart) {
    shift.start = new Date(startMs).toISOString();
    shift.startSource = 'entered';
  }
  if (hasEnd) {
    shift.end = new Date(endMs).toISOString();
    shift.endSource = 'entered';
  }
  if (endMs !== null) shift.hours = thClockHours(endMs - startMs);
  thShiftMarkEditor(shift);
  if (!thWrite(TH_SHIFTS_KEY, list)) return { error: 'Could not save.' };
  thShiftChanged(shift);
  return { shift: shift };
}
function thDeleteShift(id) {
  const list = thRawShifts();
  const target = list.find(s => s && String(s.id) === String(id));
  if (!target) return false;
  if (!thWrite(TH_SHIFTS_KEY, list.filter(s => s !== target))) return false;
  thAddShiftTombstone(target.id);
  thAddToGraveyard('shift', target);
  thShiftChanged(target);
  return true;
}

// Forgot to punch in: the earliest job-clock start today -- after your last
// shift ended and within a shift's length of now -- as the likely start of
// the day. The job clock isn't anyone's in particular, so this is offered,
// never applied.
function thShiftSuggestedStart(email, now, jobs, shifts) {
  const nowMs = thShiftNowMs(now);
  let floor = Math.max(new Date(new Date(nowMs).toDateString()).getTime(), nowMs - TH_SHIFT_MAX_HOURS * TH_HOUR_MS);
  thShiftsFor(email, shifts).forEach(s => {
    const e = s.end ? thShiftTime(s.end) : null;
    if (e !== null && e > floor && e <= nowMs) floor = e;
  });
  let best = null;
  (jobs || thRead(TH_KEYS.jobs, [])).forEach(j => {
    if (!j) return;
    const consider = (ms) => { if (ms !== null && ms >= floor && ms < nowMs && (!best || ms < best.at)) best = { at: ms, job: j }; };
    (Array.isArray(j.timeLog) ? j.timeLog : []).forEach(v => { if (v) consider(thShiftTime(v.start)); });
    consider(thJobClockSince(j));
  });
  return best;
}
// Forgot to punch out: when the last job clock inside the shift stopped --
// the last sign of work. Nothing to go on, nothing suggested.
function thShiftSuggestedEnd(shift, now, jobs, shifts) {
  const startMs = shift ? thShiftTime(shift.start) : null;
  if (startMs === null) return null;
  let ceiling = Math.min(thShiftNowMs(now), startMs + TH_SHIFT_MAX_HOURS * TH_HOUR_MS);
  thShiftsFor(shift.email, shifts).forEach(s => {
    const t = thShiftTime(s.start);
    if (s.id !== shift.id && t > startMs && t < ceiling) ceiling = t;
  });
  let best = null;
  (jobs || thRead(TH_KEYS.jobs, [])).forEach(j => {
    (j && Array.isArray(j.timeLog) ? j.timeLog : []).forEach(v => {
      const e = thShiftTime(v && v.end);
      if (e !== null && e > startMs && e <= ceiling && (!best || e > best.at)) best = { at: e, job: j };
    });
  });
  return best;
}

// One person's hours worked, Monday to Sunday (thWeekStart, the same week
// as Your week), with last week beside it. A closed shift counts its hours
// on the day it started; the shift you're on counts its time so far; a
// shift waiting for an end time counts nothing and is listed in needsEnd.
function thShiftWeekSummary(email, now, shifts) {
  const at = now === undefined ? new Date() : new Date(now);
  const list = shifts || thLoadShifts();
  const who = String(email || '').trim().toLowerCase();
  const start = thWeekStart(at);
  const dayAt = (n) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + n);
  const end = dayAt(7), prevStart = dayAt(-7);
  const today = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((name, i) => {
    const d = dayAt(i);
    return { date: thLocalDateStr(d), name: name, hours: 0, isToday: d.getTime() === today.getTime(), isFuture: d > today };
  });
  const active = thActiveShift(who, list, at);
  const needsEnd = thShiftsNeedingEnd(who, list, at);
  const out = {
    email: who, start: start, end: dayAt(6), days: days, hours: 0, prevHours: 0, today: 0,
    onShift: !!active, active: active, since: active ? active.start : null, needsEnd: needsEnd,
  };
  thShiftsFor(who, list).forEach(s => {
    let h;
    if (s.end) h = Number(s.hours) || 0;
    else if (active && s.id === active.id) h = Math.max(0, at.getTime() - thShiftTime(s.start)) / TH_HOUR_MS;
    else return;
    if (!(h > 0)) return;
    const began = new Date(thShiftTime(s.start));
    const day = new Date(began.getFullYear(), began.getMonth(), began.getDate());
    if (day >= start && day < end) {
      const i = Math.round((day - start) / 86400000);
      days[i].hours += h;
      out.hours += h;
    } else if (day >= prevStart && day < start) out.prevHours += h;
  });
  const r1 = (n) => Math.round(n * 10) / 10;
  days.forEach(d => { d.hours = r1(d.hours); });
  const todayRow = days.find(d => d.isToday);
  out.today = todayRow ? todayRow.hours : 0;
  out.hours = r1(out.hours);
  out.prevHours = r1(out.prevHours);
  return out;
}
// Everyone's week, for the team view: one row per account with a shift this
// week or last, on shift now, or waiting for an end time. On shift first,
// then the most hours this week.
function thShiftTeamSummary(now, shifts) {
  const list = shifts || thLoadShifts();
  const emails = [];
  list.forEach(s => {
    const e = s && String(s.email || '').trim().toLowerCase();
    if (e && emails.indexOf(e) === -1) emails.push(e);
  });
  return emails
    .map(e => thShiftWeekSummary(e, now, list))
    .filter(r => r.hours || r.prevHours || r.onShift || r.needsEnd.length)
    .sort((a, b) => (a.onShift === b.onShift ? b.hours - a.hours : (a.onShift ? -1 : 1)));
}

// ---------- Client texts (2026-09-23, Workspace rework part 12) ----------
// The texts sent every day, written from the job: On my way (with a time),
// Running late, Confirming the visit, a quick parts run, All done. Which
// ones lead follows the job -- a booked job leads with On my way (or, for
// a later day, the confirmation), one under way with Running late, a done
// one with All done. They go out through the phone's own Messages; each is
// logged on the job (job.texts, the last 20) so the sheet can say what was
// sent last and when.
const TH_TEXT_ETAS = [10, 20, 30, 45];
function thJobVisitWhen(job, now) {
  const at = now === undefined ? new Date() : new Date(now);
  const d = new Date((job && job.date ? job.date : '') + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  const days = thDaysBetween(at, d);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 0) return '';
  return 'on ' + d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}
function thJobTextTemplates(job, opts) {
  opts = opts || {};
  const eta = TH_TEXT_ETAS.indexOf(Number(opts.eta)) > -1 ? Number(opts.eta) : 20;
  const first = String(job.client || '').trim().split(/\s+/)[0];
  const hi = (first ? 'Hi ' + first : 'Hi') + ", it's Triple H Enterprises. ";
  const street = String(job.address || '').split(',')[0].trim();
  const when = thJobVisitWhen(job, opts.now);
  const all = {
    onmyway: { label: 'On my way', eta: true, body: hi + "I'm on my way and should be there in about " + eta + ' minutes.' },
    late: { label: 'Running late', eta: true, body: hi + "I'm running about " + eta + ' minutes behind. Sorry about that, see you soon.' },
    confirm: { label: 'Confirm the visit', eta: false, body: hi + 'Just confirming your appointment ' + when + (street ? ' at ' + street : '') + '. Reply here if anything changes.' },
    parts: { label: 'Parts run', eta: true, body: hi + 'I need to pick up a part and will be back in about ' + eta + ' minutes.' },
    done: { label: 'All done', eta: false, body: hi + 'All done' + (street ? ' at ' + street : '') + '! Your invoice is on its way. Thanks for choosing Triple H.' },
  };
  let order;
  if (job.status === 'done') order = ['done'];
  else if (job.status === 'in-progress') order = ['late', 'parts', 'done'];
  else if (when && when !== 'today') order = ['confirm', 'onmyway', 'late'];
  else order = ['onmyway', 'late'].concat(when ? ['confirm'] : []);
  return order.map(key => Object.assign({ key: key }, all[key]));
}
function thLogJobText(jobId, key, now) {
  const jobs = thRead(TH_KEYS.jobs, []);
  const job = jobs.find(j => String(j.id) === String(jobId));
  if (!job) return null;
  const at = now === undefined ? new Date() : new Date(now);
  job.texts = (Array.isArray(job.texts) ? job.texts : []).concat([{ at: at.toISOString(), key: key }]).slice(-20);
  if (!thWrite(TH_KEYS.jobs, jobs)) return null;
  return job;
}
function thJobLastText(job) {
  const list = (job && Array.isArray(job.texts) ? job.texts : []).filter(t => t && t.at && !isNaN(new Date(t.at).getTime()));
  return list.length ? list[list.length - 1] : null;
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

