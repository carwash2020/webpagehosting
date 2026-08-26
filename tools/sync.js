// ===========================================================================
// TRIPLE H WORKSPACE — CLOUD SYNC
// ===========================================================================
// This syncs your Workspace data (Jobs, Contacts, Notes, Expenses, Price
// Reference, Mileage Rate) across devices using a free Supabase project
// that belongs to Triple H Enterprises ONLY.
//
// Sync runs automatically in the background once set up below -- there's
// no code to type in or button to press day-to-day. Every device that
// loads these pages uses the same built-in DEFAULT_SYNC_CODE further
// down this file, so as long as all your devices are pointed at the same
// Supabase project (below), they stay in sync with zero manual steps.
//
// SETUP (one-time, ~3 minutes):
// 1. Go to https://supabase.com, sign up free, create a new project
//    (name it something like "triple-h-workspace").
// 2. In the Supabase dashboard, open the SQL Editor and run:
//
//      create table if not exists workspace_sync (
//        code text primary key,
//        data jsonb not null,
//        updated_at timestamptz not null default now()
//      );
//      alter table workspace_sync enable row level security;
//      create policy "allow anon read/write by code"
//        on workspace_sync for all to anon using (true) with check (true);
//
//    Note on that policy: it's intentionally permissive (anyone who knows
//    the row's "code" can read/write it) because the sync code itself IS
//    the access control here, same idea as a shared PIN. This is fine for
//    operational data like jobs/expenses/notes, but don't store anything
//    more sensitive (like full card numbers) through this path.
//
// 3. In Project Settings > API, copy the "Project URL" and the "anon
//    public" key (NOT the service_role/secret key — never paste that
//    anywhere client-side).
// 4. Paste both below, replacing the placeholder strings.
// 5. Re-upload this file to your GitHub repo root, replacing the old one.
//
// Until you do this, sync is simply inactive — every tool still works
// fine locally, just without cross-device syncing.
// ===========================================================================

// SUPABASE_URL and SUPABASE_ANON_KEY are declared in auth.js, which
// loads before this file on every page that uses sync.js. Not
// re-declared here to avoid a duplicate-const error.
// Site audit improvement #5 (2026-08-20): a reusable debug-trace
// utility, replacing the diagnostic panel pattern hand-built from
// scratch twice this past week (invoice-generator.html,
// runway-dashboard.html) to track down hard-to-reproduce issues.
// Placed here specifically -- sync.js is one of only two files
// (alongside auth.js) genuinely loaded on every single tool page,
// including runway-dashboard.html, which is deliberately self-
// contained and doesn't load most of the other shared scripts. That
// was exactly the page where a one-off trace had to be hand-built
// this week; this makes the same capability available everywhere
// without writing it again.
//
// Usage: add ?debug=1 to any tool page's URL once -- the flag
// persists in sessionStorage from then on, so a multi-step flow (like
// the app tour moving across several pages) can be traced end to end
// without needing to re-add the query param on every navigation.
// Then call debugTrace('some message') anywhere in that page's own
// code. Anchored to the TOP of the screen specifically, not the
// bottom -- a bottom-anchored version of this exact idea once ended
// up covering the very thing it was built to help diagnose (a real
// mistake made and fixed on Runway Dashboard earlier this session).
function isDebugModeOn() {
  try {
    if (new URLSearchParams(window.location.search).get('debug') === '1') {
      sessionStorage.setItem('th_debug_mode', '1');
    }
    return sessionStorage.getItem('th_debug_mode') === '1';
  } catch (e) { return false; }
}

function debugTrace(msg) {
  if (!isDebugModeOn()) return;
  let panel = document.getElementById('__debugTracePanel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = '__debugTracePanel';
    panel.style.cssText = 'position:fixed; left:8px; right:8px; top:8px; z-index:99999; background:#0a0a0a; border:2px solid #ffb020; border-radius:8px; padding:10px 12px; color:#ffd580; font-size:11px; font-family:monospace; white-space:pre-wrap; max-height:40vh; overflow-y:auto;';
    document.body.appendChild(panel);
    panel.textContent = 'DEBUG TRACE (?debug=1) -- screenshot this box\n';
  }
  panel.textContent += '[' + new Date().toLocaleTimeString() + '] ' + msg + '\n';
}

const SYNC_TABLE = 'workspace_sync';

const SYNC_DATA_KEYS = [
  // Must come before th_tracker_jobs, same reasoning as
  // th_client_tombstones below: applySyncData's th_tracker_jobs branch
  // reads this key fresh from localStorage right after merging it.
  'th_job_tombstones',
  'th_tracker_jobs',
  // Must come before th_clients: applySyncData's th_clients branch reads
  // this key fresh from localStorage right after merging it, to filter
  // out any client a tombstone says was deliberately deleted -- that
  // only works if this key's own merge has already run and been
  // written by the time th_clients is processed.
  'th_client_tombstones',
  'th_clients',
  // th_expense_tombstones/th_income_tombstones must come before their
  // respective logs, same reasoning as above -- extended 2026-08-26
  // after finding the same union-merge resurrection bug already fixed
  // for clients and jobs was still open for expenses, income,
  // contracts, and contacts. Financial records prioritized first: a
  // resurrected deleted expense or income entry would silently skew
  // real profit numbers, not just show a stray row.
  'th_expense_tombstones',
  'th_expense_log',
  'th_income_tombstones',
  'th_income_log',
  'th_contact_tombstones',
  'th_tracker_contacts',
  'th_tracker_notes_v2',
  'th_mileage_rate',
  'th_price_ref_tombstones',
  'th_price_reference',
  // Delete added to invoices and quotes for the first time (2026-08-26)
  // -- built in with the tombstone from the start, same reasoning as
  // every entry above, rather than added as a later fix.
  'th_invoice_tombstones',
  'th_invoices',
  'th_quote_tombstones',
  'th_quotes',
  'th_tax_rate',
  'th_tax_labor',
  'th_tax_parts',
  'th_compliance',
  'th_template_tombstones',
  'th_job_templates',
  'th_contract_tombstones',
  'th_contracts',
  // Appliance Wiki's model/issue reference data. Added so it actually
  // participates in cross-device sync -- it was loading sync.js and
  // calling scheduleSync() after every save, which looked like it was
  // syncing, but this key was never on the list scheduleSync() actually
  // pushes, so every entry only ever lived on whichever single device
  // it was typed into.
  'th_pr_unit_tombstones',
  'th_pr_issue_tombstones',
  'th_parts_reference_units',
  // Client-side error log from tools-media-sharing.js. Small and naturally
  // self-capping (see mergeClientErrorLog below), so this doesn't risk
  // repeating the payload-size lesson from adding the Wiki data above.
  'th_client_errors',
  // Known Issues checklist -- migrated from a hardcoded array to a
  // real synced list so both accounts can add/check off items and see
  // each other's, rather than only Connor being able to log a new one
  // (by editing this file).
  'th_known_issue_tombstones',
  'th_known_issues',
  // "Flag this page" queue (2026-08-21), requested directly: a quick
  // way to flag something to come back to later without writing a
  // full message -- just the page, an optional note, and a timestamp.
  // Synced for the same reason as Known Issues above: flagged on the
  // phone, reviewed later in Dev Tools on any device.
  'th_flagged_items',
  'th_setaside_rate',
  // Runway Dashboard's own data -- personal budget, business-month
  // rollups, emergency fund, and the readiness checklist. Deliberately
  // riding in the SAME blob as everything above (one shared Supabase
  // project, by explicit choice) rather than a separate project. Worth
  // remembering: anyone with access to this Supabase project can now see
  // real mortgage/debt/family expense data alongside operational business
  // data -- fine for a single owner-operator, worth revisiting if this
  // business ever brings on an employee or bookkeeper with sync access.
  'rd_personal-expenses',
  'rd_personal-income',
  'rd_budget-settings',
  'rd_business-months',
  'rd_emergency-fund',
  'rd_debts',
];

const SYNC_CODE_KEY = 'th_sync_code';
const SYNC_KNOWN_AT_KEY = 'th_sync_known_at';

// Single-business, single-owner tool -- no need for a user-facing PIN.
// Every device auto-uses this same fixed code so sync just works silently.
const DEFAULT_SYNC_CODE = 'tripleh-workspace-2026';

function isSyncConfigured() {
  return !SUPABASE_URL.startsWith('PASTE_') && !SUPABASE_ANON_KEY.startsWith('PASTE_');
}

function getSyncCode() {
  // Always use the fixed default -- this is deliberate, not a fallback.
  // Earlier versions of this tool let you type in your own code via a
  // visible UI (since removed). Any device that used that UI still has
  // its own typed code sitting in localStorage from back then, which
  // would silently sync it to a DIFFERENT row than every other device
  // now using the automatic default -- two devices, two silos, no data
  // ever crossing between them. Ignoring the old stored value and always
  // returning DEFAULT_SYNC_CODE guarantees every device converges on the
  // same row regardless of what it had saved previously.
  if (localStorage.getItem(SYNC_CODE_KEY) !== DEFAULT_SYNC_CODE) {
    localStorage.setItem(SYNC_CODE_KEY, DEFAULT_SYNC_CODE);
  }
  return DEFAULT_SYNC_CODE;
}
function setSyncCode(code) { localStorage.setItem(SYNC_CODE_KEY, code.trim()); }
function clearSyncCode() { localStorage.removeItem(SYNC_CODE_KEY); }

function collectSyncData() {
  const out = {};
  SYNC_DATA_KEYS.forEach(k => { out[k] = localStorage.getItem(k); });
  return out;
}

// Maps each array-shaped sync key to its unique-record field. Used to
// merge by individual record on pull instead of blindly replacing the
// whole array -- the root cause of "my new entry vanished": two devices
// each editing their own in-memory snapshot, and whichever one pushes
// last silently wins with no idea what the other one just added.
const MERGE_KEY_FIELD = {
  th_tracker_jobs: 'id',
  th_clients: 'id',
  th_client_tombstones: 'id',
  th_job_tombstones: 'id',
  th_expense_tombstones: 'id',
  th_income_tombstones: 'id',
  th_contact_tombstones: 'id',
  th_contract_tombstones: 'id',
  th_invoice_tombstones: 'id',
  th_quote_tombstones: 'id',
  th_price_ref_tombstones: 'id',
  th_template_tombstones: 'id',
  th_known_issue_tombstones: 'id',
  th_pr_unit_tombstones: 'id',
  th_pr_issue_tombstones: 'id',
  th_tracker_contacts: 'id',
  th_tracker_notes_v2: 'id',
  th_expense_log: 'id',
  th_income_log: 'id',
  th_invoices: 'id',
  th_quotes: 'id',
  th_job_templates: 'id',
  th_contracts: 'id',
  th_price_reference: 'id',
  th_parts_reference_units: 'id',
  th_client_errors: 'id',
  th_known_issues: 'id',
  th_flagged_items: 'id',
  'rd_personal-expenses': 'id',
  'rd_personal-income': 'id',
  'rd_business-months': 'month',
  'rd_debts': 'id',
};

// Takes the union of both sides by their unique field, rather than
// letting one side's snapshot silently drop what the other added. If
// the SAME record exists on both sides (an actual edit to that one
// record, not just an add elsewhere), the incoming remote copy wins --
// still "last write wins," just scoped to the one record that actually
// changed instead of the entire array.
//
// The real tradeoff, worth knowing: a deletion made on one device can
// resurface if another device's stale in-memory copy (from before it
// pulled that deletion) gets pushed later, since a union merge can't
// distinguish "never existed here" from "existed and was deleted here."
// Chose this over building full tombstone tracking because the reported
// problem was specifically entries silently vanishing on add, not
// deletions failing to stick -- solving the actual complaint without
// taking on a much larger rework for a failure mode that hasn't
// actually been reported.
function mergeRecordArrays(localArr, remoteArr, keyField) {
  const merged = new Map();
  (localArr || []).forEach(item => { if (item && item[keyField] !== undefined) merged.set(item[keyField], item); });
  (remoteArr || []).forEach(item => { if (item && item[keyField] !== undefined) merged.set(item[keyField], item); });
  return Array.from(merged.values());
}

// Appliance Wiki units nest an `issues` array inside each unit -- a
// plain unit-level merge (like every other record type above) would
// treat two people adding DIFFERENT new issues to the SAME existing
// model as a conflict on that one unit, and just keep whichever side
// synced last, silently dropping the other person's newly-logged issue.
// That's the exact failure mode the merge system above exists to
// prevent, just one level deeper -- so this merges twice: once across
// units by unit id, and again across each matching unit's issues by
// issue id, unioning both instead of one side winning outright.
function mergePartsReferenceUnits(localArr, remoteArr) {
  const byId = new Map();
  (localArr || []).forEach(u => { if (u && u.id !== undefined) byId.set(u.id, u); });
  (remoteArr || []).forEach(remoteUnit => {
    if (!remoteUnit || remoteUnit.id === undefined) return;
    const localUnit = byId.get(remoteUnit.id);
    if (!localUnit) { byId.set(remoteUnit.id, remoteUnit); return; }
    // Same unit exists on both sides -- take the remote unit's own
    // fields (model name, links, pinned) as the base, same "remote wins
    // for that record" rule as everywhere else, but union the issues
    // sub-array by issue id instead of overwriting it wholesale.
    const mergedIssues = mergeRecordArrays(localUnit.issues, remoteUnit.issues, 'id');
    byId.set(remoteUnit.id, Object.assign({}, remoteUnit, { issues: mergedIssues }));
  });
  return Array.from(byId.values());
}

// Each device caps its OWN error log at 20 entries (see tools-media-sharing.js)
// before it ever reaches here -- but merging two already-capped-at-20
// lists together can produce up to 40, so this re-caps the COMBINED
// result too, keeping only the 20 most recent overall rather than
// letting the list grow every time two devices sync. 20 is duplicated
// here rather than shared with tools-media-sharing.js's CLIENT_ERROR_LOG_MAX
// constant -- top-level const/let in one <script> tag isn't visible to
// a different <script> tag, only var/function declarations are, so
// there's no way to reference it directly. Keep both in sync by hand
// if this number ever changes.
const CLIENT_ERROR_LOG_MAX_AFTER_MERGE = 20;
function mergeClientErrorLog(localArr, remoteArr) {
  const merged = mergeRecordArrays(localArr, remoteArr, 'id');
  merged.sort((a, b) => new Date(b.time) - new Date(a.time));
  return merged.slice(0, CLIENT_ERROR_LOG_MAX_AFTER_MERGE);
}

function applySyncData(obj) {
  if (!obj) return;
  SYNC_DATA_KEYS.forEach(k => {
    if (obj[k] === undefined || obj[k] === null) return;
    const keyField = MERGE_KEY_FIELD[k];
    if (!keyField) {
      // Settings/scalar/object keys (tax rate, compliance info, etc.)
      // have no per-record merge concept -- stays a plain overwrite,
      // same as before this fix.
      localStorage.setItem(k, obj[k]);
      return;
    }
    try {
      const remoteArr = JSON.parse(obj[k]);
      const localArr = JSON.parse(localStorage.getItem(k) || '[]');
      if (!Array.isArray(remoteArr) || !Array.isArray(localArr)) {
        localStorage.setItem(k, obj[k]);
        return;
      }
      const mergedArr = k === 'th_parts_reference_units'
        ? mergePartsReferenceUnits(localArr, remoteArr)
        : k === 'th_client_errors'
        ? mergeClientErrorLog(localArr, remoteArr)
        : mergeRecordArrays(localArr, remoteArr, keyField);

      // The actual fix for a real, reported bug: a union merge alone
      // can't tell "never existed" apart from "existed and was
      // deleted" -- a stale device pushing back its old copy of a
      // deleted client would otherwise resurrect it right here. This
      // reads th_client_tombstones fresh from localStorage rather than
      // from any variable in this closure, specifically because it's
      // listed earlier in SYNC_DATA_KEYS and has therefore already
      // been merged and written by the time this branch runs.
      let finalArr = mergedArr;
      if (k === 'th_clients') {
        let tombstonedIds = [];
        try { tombstonedIds = JSON.parse(localStorage.getItem('th_client_tombstones') || '[]').map(t => t.id); } catch (e) { tombstonedIds = []; }
        if (tombstonedIds.length) {
          const tombstoneSet = new Set(tombstonedIds);
          finalArr = mergedArr.filter(c => !tombstoneSet.has(c.id));
        }
      } else if (k === 'th_tracker_jobs') {
        let tombstonedIds = [];
        try { tombstonedIds = JSON.parse(localStorage.getItem('th_job_tombstones') || '[]').map(t => t.id); } catch (e) { tombstonedIds = []; }
        if (tombstonedIds.length) {
          const tombstoneSet = new Set(tombstonedIds);
          finalArr = mergedArr.filter(j => !tombstoneSet.has(j.id));
        }
      } else if (k === 'th_expense_log') {
        let tombstonedIds = [];
        try { tombstonedIds = JSON.parse(localStorage.getItem('th_expense_tombstones') || '[]').map(t => t.id); } catch (e) { tombstonedIds = []; }
        if (tombstonedIds.length) {
          const tombstoneSet = new Set(tombstonedIds);
          finalArr = mergedArr.filter(e => !tombstoneSet.has(e.id));
        }
      } else if (k === 'th_income_log') {
        let tombstonedIds = [];
        try { tombstonedIds = JSON.parse(localStorage.getItem('th_income_tombstones') || '[]').map(t => t.id); } catch (e) { tombstonedIds = []; }
        if (tombstonedIds.length) {
          const tombstoneSet = new Set(tombstonedIds);
          finalArr = mergedArr.filter(i => !tombstoneSet.has(i.id));
        }
      } else if (k === 'th_tracker_contacts') {
        let tombstonedIds = [];
        try { tombstonedIds = JSON.parse(localStorage.getItem('th_contact_tombstones') || '[]').map(t => t.id); } catch (e) { tombstonedIds = []; }
        if (tombstonedIds.length) {
          const tombstoneSet = new Set(tombstonedIds);
          finalArr = mergedArr.filter(c => !tombstoneSet.has(c.id));
        }
      } else if (k === 'th_contracts') {
        let tombstonedIds = [];
        try { tombstonedIds = JSON.parse(localStorage.getItem('th_contract_tombstones') || '[]').map(t => t.id); } catch (e) { tombstonedIds = []; }
        if (tombstonedIds.length) {
          const tombstoneSet = new Set(tombstonedIds);
          finalArr = mergedArr.filter(c => !tombstoneSet.has(c.id));
        }
      } else if (k === 'th_invoices') {
        let tombstonedIds = [];
        try { tombstonedIds = JSON.parse(localStorage.getItem('th_invoice_tombstones') || '[]').map(t => t.id); } catch (e) { tombstonedIds = []; }
        if (tombstonedIds.length) {
          const tombstoneSet = new Set(tombstonedIds);
          finalArr = mergedArr.filter(i => !tombstoneSet.has(i.id));
        }
      } else if (k === 'th_quotes') {
        let tombstonedIds = [];
        try { tombstonedIds = JSON.parse(localStorage.getItem('th_quote_tombstones') || '[]').map(t => t.id); } catch (e) { tombstonedIds = []; }
        if (tombstonedIds.length) {
          const tombstoneSet = new Set(tombstonedIds);
          finalArr = mergedArr.filter(q => !tombstoneSet.has(q.id));
        }
      } else if (k === 'th_price_reference') {
        let tombstonedIds = [];
        try { tombstonedIds = JSON.parse(localStorage.getItem('th_price_ref_tombstones') || '[]').map(t => t.id); } catch (e) { tombstonedIds = []; }
        if (tombstonedIds.length) {
          const tombstoneSet = new Set(tombstonedIds);
          finalArr = mergedArr.filter(r => !tombstoneSet.has(r.id));
        }
      } else if (k === 'th_job_templates') {
        let tombstonedIds = [];
        try { tombstonedIds = JSON.parse(localStorage.getItem('th_template_tombstones') || '[]').map(t => t.id); } catch (e) { tombstonedIds = []; }
        if (tombstonedIds.length) {
          const tombstoneSet = new Set(tombstonedIds);
          finalArr = mergedArr.filter(t => !tombstoneSet.has(t.id));
        }
      } else if (k === 'th_known_issues') {
        let tombstonedIds = [];
        try { tombstonedIds = JSON.parse(localStorage.getItem('th_known_issue_tombstones') || '[]').map(t => t.id); } catch (e) { tombstonedIds = []; }
        if (tombstonedIds.length) {
          const tombstoneSet = new Set(tombstonedIds);
          finalArr = mergedArr.filter(i => !tombstoneSet.has(i.id));
        }
      } else if (k === 'th_parts_reference_units') {
        let tombstonedUnitIds = [];
        try { tombstonedUnitIds = JSON.parse(localStorage.getItem('th_pr_unit_tombstones') || '[]').map(t => t.id); } catch (e) { tombstonedUnitIds = []; }
        let tombstonedIssueIds = [];
        try { tombstonedIssueIds = JSON.parse(localStorage.getItem('th_pr_issue_tombstones') || '[]').map(t => t.id); } catch (e) { tombstonedIssueIds = []; }
        const unitTombstoneSet = new Set(tombstonedUnitIds);
        const issueTombstoneSet = new Set(tombstonedIssueIds);
        finalArr = mergedArr
          .filter(u => !unitTombstoneSet.has(u.id))
          .map(u => (u.issues && u.issues.length)
            ? Object.assign({}, u, { issues: u.issues.filter(iss => !issueTombstoneSet.has(u.id + '::' + iss.id)) })
            : u);
      }

      localStorage.setItem(k, JSON.stringify(finalArr));
    } catch (e) {
      localStorage.setItem(k, obj[k]); // malformed JSON on either side -- fall back to the old behavior rather than throw
    }
  });
}

const SYNC_HISTORY_KEY = 'th_sync_history';
const SYNC_HISTORY_MAX = 20; // capped so this can't grow unbounded on a device that's been running a long time

function recordSyncStatus(type, ok, error) {
  const status = { type, ok, error: error || null, time: new Date().toISOString() };
  try { localStorage.setItem('th_sync_last', JSON.stringify(status)); } catch (e) { /* ignore */ }
  try {
    let history = [];
    try { history = JSON.parse(localStorage.getItem(SYNC_HISTORY_KEY) || '[]'); } catch (e) { history = []; }
    history.unshift(status); // most recent first
    if (history.length > SYNC_HISTORY_MAX) history.length = SYNC_HISTORY_MAX;
    localStorage.setItem(SYNC_HISTORY_KEY, JSON.stringify(history));
  } catch (e) { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent('th-sync-status', { detail: status })); } catch (e) { /* ignore */ }
}

function loadSyncHistory() {
  try { return JSON.parse(localStorage.getItem(SYNC_HISTORY_KEY) || '[]'); } catch (e) { return []; }
}

// Shared retry helper (2026-08-20), extending the same resilience
// pattern already proven for startRealtimeSync/startLeadsRealtime's
// CHANNEL_ERROR retry to pushSync/pullSync below -- both had zero
// retry logic at all despite running on every page load and every
// save. Only retries genuinely transient conditions: a network-level
// exception (a bad connection moment, a DNS blip) or a 5xx server
// error. Deliberately does NOT retry 4xx client errors -- those mean
// something is actually wrong (bad auth, a malformed request), and
// retrying would just fail identically again, wasting time instead of
// surfacing the real problem.
async function fetchWithRetry(url, options, maxRetries = 2, delayMs = 1500) {
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok || (res.status >= 400 && res.status < 500)) return res; // success, or a real client error -- either way, stop here
      lastError = new Error('http-' + res.status); // a 5xx -- worth retrying
      if (attempt < maxRetries) { await new Promise(r => setTimeout(r, delayMs)); continue; }
      return res; // out of retries -- return the last (failing) response so the caller's existing http-status handling still applies
    } catch (e) {
      lastError = e;
      if (attempt < maxRetries) { await new Promise(r => setTimeout(r, delayMs)); continue; }
      throw e; // out of retries -- let the caller's existing catch block handle it exactly as before
    }
  }
  throw lastError;
}

async function pushSync() {
  if (!isSyncConfigured()) return { ok: false, error: 'not-configured' };
  const code = getSyncCode();
  if (!code) return { ok: false, error: 'no-code' };
  if (typeof ensureFreshToken === 'function') {
    const fresh = await ensureFreshToken();
    if (!fresh) { recordSyncStatus('push', false, 'session-expired'); return { ok: false, error: 'session-expired' }; }
  }

  const nowIso = new Date().toISOString();
  const body = [{ code, data: collectSyncData(), updated_at: nowIso }];

  try {
    const res = await fetchWithRetry(`${SUPABASE_URL}/rest/v1/${SYNC_TABLE}?on_conflict=code`, {
      method: 'POST',
      // NOT keepalive: true anymore -- that flag caps the total request
      // body at a hard 64 KiB (part of the Fetch spec itself, not a
      // Supabase or CSP thing), and the combined synced payload now
      // regularly exceeds that once Appliance Wiki's data was added to
      // it. Every push was silently failing with a generic "Failed to
      // fetch" and zero console detail -- keepalive wasn't protecting
      // anything at that point anyway, since the oversized request
      // failed outright regardless of whether the tab was closing or
      // not. The real tradeoff being accepted by removing it: a push
      // that's in flight at the exact instant the tab closes may now
      // get cancelled instead of completing in the background. That's
      // a rare edge case; failing every single push was not.
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${getAuthToken()}`,
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) { recordSyncStatus('push', false, 'http-' + res.status); return { ok: false, error: 'http-' + res.status }; }
    localStorage.setItem(SYNC_KNOWN_AT_KEY, nowIso);
    recordSyncStatus('push', true);
    return { ok: true };
  } catch (e) {
    // Was previously a hardcoded 'network' string for every possible
    // failure -- a genuine outage, a CORS block, a CSP violation, a DNS
    // failure, all looked identical and impossible to diagnose remotely.
    // Capturing the real message means the next failure is actually
    // readable instead of just "network."
    const detail = 'network: ' + (e && e.message ? e.message : String(e));
    recordSyncStatus('push', false, detail);
    return { ok: false, error: detail };
  }
}

async function pullSync() {
  if (!isSyncConfigured()) return { ok: false, error: 'not-configured' };
  const code = getSyncCode();
  if (!code) return { ok: false, error: 'no-code' };
  if (typeof ensureFreshToken === 'function') {
    const fresh = await ensureFreshToken();
    if (!fresh) { recordSyncStatus('pull', false, 'session-expired'); return { ok: false, error: 'session-expired' }; }
  }

  try {
    const res = await fetchWithRetry(`${SUPABASE_URL}/rest/v1/${SYNC_TABLE}?code=eq.${encodeURIComponent(code)}&select=data,updated_at`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${getAuthToken()}`,
      },
    });
    if (!res.ok) { recordSyncStatus('pull', false, 'http-' + res.status); return { ok: false, error: 'http-' + res.status }; }
    const rows = await res.json();
    if (!rows.length) { recordSyncStatus('pull', false, 'no-data-yet'); return { ok: false, error: 'no-data-yet' }; }

    applySyncData(rows[0].data);
    localStorage.setItem(SYNC_KNOWN_AT_KEY, rows[0].updated_at);
    recordSyncStatus('pull', true);
    return { ok: true };
  } catch (e) {
    const detail = 'network: ' + (e && e.message ? e.message : String(e));
    recordSyncStatus('pull', false, detail);
    return { ok: false, error: detail };
  }
}

// Shared "Refresh synced data now" link handler. Used to be copy-pasted
// with slight drift between workspace.html and job-tracker.html -- one
// page's link showed a friendlier "nothing in the cloud yet" message,
// the other silently did nothing in that case. This version always shows
// it, since that's strictly more informative either way. Each page passes
// its own onDone callback for whatever it needs to re-render afterward;
// this function only owns the link text, the network call, and the
// shared error messaging.
async function manualRefreshSync(onDone) {
  const link = document.getElementById('refreshSyncLink');
  if (link) link.classList.add('is-syncing');
  const result = await pullSync();
  if (link) link.classList.remove('is-syncing');

  if (!result.ok) {
    if (result.error === 'no-data-yet') {
      await showAlert("Nothing in the cloud yet for this device to pull -- push something first from wherever you last edited.");
    } else {
      await showAlert('Could not refresh: ' + result.error);
    }
  }
  if (typeof onDone === 'function') onDone(result);
}

// Debounced auto-push: call scheduleSync() from any tool's save function.
let _syncTimer = null;

// The background auto-sync above is deliberately silent on success --
// nobody needs a toast every time they save a field. But it was ALSO
// silent on FAILURE, which is the real problem: a sync can fail for
// reasons that have nothing to do with the session-expiry bug just
// fixed (a bad network moment, a temporary outage), and someone could
// keep working for hours with no idea their changes never left the
// device. This warns, but throttled -- a bad connection would otherwise
// re-fail on every single edit and spam a toast after each one.
let _lastSyncFailureWarningAt = 0;
const SYNC_FAILURE_WARNING_COOLDOWN_MS = 5 * 60 * 1000; // once every 5 minutes at most
function warnIfSyncFailed(result) {
  if (!result || result.ok) return;
  if (result.error === 'not-configured' || result.error === 'no-code') return; // sync isn't set up at all -- not a failure, nothing to warn about
  const now = Date.now();
  if (now - _lastSyncFailureWarningAt < SYNC_FAILURE_WARNING_COOLDOWN_MS) return;
  _lastSyncFailureWarningAt = now;
  if (typeof showToast !== 'function') return;
  const message = result.error === 'session-expired'
    ? "Couldn't back up to the cloud \u2014 your login session expired. Log out and back in to fix this."
    : "Couldn't back up to the cloud just now. Your changes are still saved on this device, and it'll retry automatically.";
  showToast(message, { type: 'error', duration: 6000 });
}

// Item #7 (2026-08-16): sync-pending indicator, distinct from the
// existing live-sync connection dot (which only shows whether realtime
// is CONNECTED, not whether THIS device has local edits it hasn't
// successfully pushed yet). Purely observational -- doesn't change when
// scheduleSync/pushSync actually run or what they do, just tracks and
// broadcasts the state so any page can show it.
let _hasPendingLocalChanges = false;
function setSyncPending(pending) {
  _hasPendingLocalChanges = pending;
  try { window.dispatchEvent(new CustomEvent('th-sync-pending-change', { detail: { pending } })); } catch (e) { /* ignore */ }
}
function hasPendingLocalChanges() { return _hasPendingLocalChanges; }

function scheduleSync() {
  if (!isSyncConfigured() || !getSyncCode()) return;
  setSyncPending(true);
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => {
    _syncTimer = null;
    pushSync().then((result) => {
      // Left pending on failure -- the edit genuinely hasn't made it to
      // the cloud yet, so showing "synced" would be inaccurate. The
      // existing warnIfSyncFailed() toast already covers alerting on
      // the failure itself; this indicator is a separate, quieter signal
      // for "is there anything not yet backed up right now."
      if (result && result.ok) setSyncPending(false);
      warnIfSyncFailed(result);
    });
  }, 2500);
}

// Safety net: if the page is closed/backgrounded/navigated away from
// before the 2.5s debounce above fires, the scheduled push would
// otherwise be silently lost (a quick edit followed by immediately
// switching devices could look like "it didn't save"). Flushing
// immediately on visibilitychange/pagehide covers most of that gap on
// its own. This USED to also rely on `keepalive: true` on the fetch
// itself to let the request survive the tab actually closing -- that
// was removed from pushSync() once the combined synced payload grew
// past keepalive's hard 64 KiB body-size cap and started failing
// every push outright, tab-closing or not. So the real remaining gap:
// a push that's genuinely in flight at the exact instant the tab
// closes can still get cancelled now. Rare, and a better tradeoff than
// the alternative (every push failing, all the time), but a real gap.
function flushSyncNow() {
  if (_syncTimer) {
    clearTimeout(_syncTimer);
    _syncTimer = null;
    pushSync().then((result) => {
      if (result && result.ok) setSyncPending(false);
      warnIfSyncFailed(result);
    });
  }
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSyncNow();
  });
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushSyncNow);
}

// ---------------------------------------------------------------------------
// LEADS INBOX — separate from the workspace_sync blob above. Leads come
// from the public website's contact form and accumulate as real growing
// rows (not "current device state" like everything else), so they get
// their own table (`th_leads`) and their own simple REST helpers here.
// ---------------------------------------------------------------------------

async function fetchLeads() {
  if (!isSyncConfigured()) return { ok: false, error: 'not-configured', leads: [] };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/th_leads?select=*&order=created_at.desc&limit=50`, {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${getAuthToken()}` },
    });
    if (!res.ok) return { ok: false, error: 'http-' + res.status, leads: [] };
    const leads = await res.json();
    return { ok: true, leads };
  } catch (e) {
    return { ok: false, error: 'network', leads: [] };
  }
}

async function markLeadHandled(id, handled) {
  if (!isSyncConfigured()) return { ok: false, error: 'not-configured' };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/th_leads?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${getAuthToken()}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ handled }),
    });
    if (!res.ok) return { ok: false, error: 'http-' + res.status };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'network' };
  }
}

async function deleteLead(id) {
  if (!isSyncConfigured()) return { ok: false, error: 'not-configured' };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/th_leads?id=eq.${id}`, {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${getAuthToken()}`,
        'Prefer': 'return=minimal',
      },
    });
    if (!res.ok) return { ok: false, error: 'http-' + res.status };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'network' };
  }
}

// Requested directly, as part of connecting the new booking system
// (replacing Cal.com) to the Job Tracker and Dev Tools. Only ever
// fetches unconverted, confirmed bookings from today onward -- a
// booking that's already become a job (job_id set), is cancelled, or
// is in the past has nothing left to do here.
async function fetchUnconvertedBookings() {
  if (!isSyncConfigured()) return { ok: false, error: 'not-configured', bookings: [] };
  try {
    const todayMidnightUtc = new Date();
    todayMidnightUtc.setHours(0, 0, 0, 0);
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/th_bookings?select=*&status=eq.confirmed&job_id=is.null&start_at=gte.${encodeURIComponent(todayMidnightUtc.toISOString())}&order=start_at.asc&limit=50`,
      { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${getAuthToken()}` } },
    );
    if (!res.ok) return { ok: false, error: 'http-' + res.status, bookings: [] };
    const bookings = await res.json();
    return { ok: true, bookings };
  } catch (e) {
    return { ok: false, error: 'network', bookings: [] };
  }
}

// Sets job_id on a booking once it's been turned into a real Job
// Tracker entry -- this is what keeps fetchUnconvertedBookings() from
// showing the same booking again on the next load.
async function markBookingConverted(id, jobId) {
  if (!isSyncConfigured()) return { ok: false, error: 'not-configured' };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/th_bookings?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${getAuthToken()}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ job_id: jobId }),
    });
    if (!res.ok) return { ok: false, error: 'http-' + res.status };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'network' };
  }
}

async function deleteBooking(id) {
  if (!isSyncConfigured()) return { ok: false, error: 'not-configured' };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/th_bookings?id=eq.${id}`, {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${getAuthToken()}`,
        'Prefer': 'return=minimal',
      },
    });
    if (!res.ok) return { ok: false, error: 'http-' + res.status };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'network' };
  }
}

// ---------------------------------------------------------------------------
// JOB PHOTOS — actual image files live in Supabase Storage (a bucket named
// `job-photos`), which is a different thing from the database tables above.
// Metadata (which job a photo belongs to, before/after tag, etc.) lives in
// its own small table, `th_job_photos`, same pattern as leads.
// ---------------------------------------------------------------------------

const JOB_PHOTOS_BUCKET = 'job-photos';
const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8MB client-side cap

// getJobPhotoUrl() (the old public-URL version, for when the bucket was
// still set to "Public") was removed 2026-08-14. It had zero call sites
// left in this file and the matching "anon can read job-photos"/"anon
// can read receipts" RLS policies on storage.objects were still live in
// the database, silently letting anyone with the public anon key read
// customer job photos and financial receipts directly, regardless of
// this function being unused client-side. Both the dead function and
// the stale policies are gone now. getSignedStorageUrl() below is the
// only path left, and it only works for the 'authenticated' role.

// Generates a time-limited URL that works even when a bucket is private
// -- the actual fix for job photos and receipts needing to stay private
// while the app can still display them. Uses the single-file sign
// endpoint (one request per file) rather than the batch endpoint, since
// the single-file endpoint's request/response shape is clearly
// documented in Supabase's own API reference and the batch endpoint's
// isn't -- trades a little efficiency for certainty about the actual
// contract, which matters more here than shaving off a few requests.
//
// Per Supabase's docs, the response's signedURL comes back as a path
// relative to /storage/v1 (e.g. "/object/sign/bucket/path?token=..."),
// not a full URL -- has to be prefixed with SUPABASE_URL + /storage/v1
// to actually be usable.
async function getSignedStorageUrl(bucket, path, expiresInSeconds) {
  if (!path) return '';
  if (typeof ensureFreshToken === 'function') { await ensureFreshToken(); }
  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${bucket}/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${getAuthToken()}`,
      },
      body: JSON.stringify({ expiresIn: expiresInSeconds || 3600 }),
    });
    if (!res.ok) return '';
    const data = await res.json();
    return data.signedURL ? `${SUPABASE_URL}/storage/v1${data.signedURL}` : '';
  } catch (e) {
    return '';
  }
}

async function getSignedJobPhotoUrl(storagePath) {
  return getSignedStorageUrl(JOB_PHOTOS_BUCKET, storagePath, 3600);
}

// Signs a whole batch of job photos in parallel and returns a lookup
// map keyed by storage path -- for rendering a gallery grid, where every
// thumbnail needs its own signed URL before the grid can be built.
async function getSignedJobPhotoUrls(storagePaths) {
  const unique = [...new Set((storagePaths || []).filter(Boolean))];
  const signed = await Promise.all(unique.map(p => getSignedJobPhotoUrl(p)));
  const map = {};
  unique.forEach((p, i) => { map[p] = signed[i]; });
  return map;
}

async function uploadJobPhoto(file, jobId, jobTitle, photoType) {
  if (!isSyncConfigured()) return { ok: false, error: 'not-configured' };
  if (file.size > MAX_PHOTO_BYTES) return { ok: false, error: 'too-large' };
  if (typeof ensureFreshToken === 'function') {
    const fresh = await ensureFreshToken();
    if (!fresh) return { ok: false, error: 'session-expired', detail: 'Your login session has expired and could not be refreshed automatically. Log out and back in, then try again.' };
  }

  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `job-${jobId}/${Date.now()}.${ext}`;

  try {
    const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${JOB_PHOTOS_BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${getAuthToken()}`,
        'Content-Type': file.type || 'image/jpeg',
      },
      body: file,
    });
    if (!uploadRes.ok) return { ok: false, error: 'upload-http-' + uploadRes.status };

    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/th_job_photos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${getAuthToken()}`,
        'Prefer': 'return=representation',
      },
      body: JSON.stringify([{ job_id: jobId, job_title: jobTitle, storage_path: path, photo_type: photoType || 'photo' }]),
    });
    if (!insertRes.ok) return { ok: false, error: 'metadata-http-' + insertRes.status };
    const rows = await insertRes.json();
    return { ok: true, photo: rows[0] };
  } catch (e) {
    return { ok: false, error: 'network' };
  }
}

async function fetchJobPhotos(jobId) {
  if (!isSyncConfigured()) return { ok: false, error: 'not-configured', photos: [] };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/th_job_photos?job_id=eq.${jobId}&select=*&order=created_at.desc`, {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${getAuthToken()}` },
    });
    if (!res.ok) return { ok: false, error: 'http-' + res.status, photos: [] };
    const photos = await res.json();
    return { ok: true, photos };
  } catch (e) {
    return { ok: false, error: 'network', photos: [] };
  }
}

async function deleteJobPhoto(photoId, storagePath) {
  if (!isSyncConfigured()) return { ok: false, error: 'not-configured' };
  try {
    await fetch(`${SUPABASE_URL}/storage/v1/object/${JOB_PHOTOS_BUCKET}/${storagePath}`, {
      method: 'DELETE',
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${getAuthToken()}` },
    });
    // Delete the metadata row regardless of the storage-delete result above,
    // so a partial failure doesn't leave an orphaned row the UI still shows.
    const delRow = await fetch(`${SUPABASE_URL}/rest/v1/th_job_photos?id=eq.${photoId}`, {
      method: 'DELETE',
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${getAuthToken()}`, 'Prefer': 'return=minimal' },
    });
    if (!delRow.ok) return { ok: false, error: 'http-' + delRow.status };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'network' };
  }
}

// Marks/unmarks a job photo as a candidate for the public website gallery.
// This does NOT publish it anywhere -- it just queues it for review. Actual
// publishing means downloading the image, adding it to images/gallery/ in
// the repo, and adding an entry to the galleryItems array in index.html --
// a deliberate, separate step by design (see Dashboard's Website Gallery
// Queue section for the review list).
async function toggleFeaturedPhoto(photoId, featured, caption) {
  if (!isSyncConfigured()) return { ok: false, error: 'not-configured' };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/th_job_photos?id=eq.${photoId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${getAuthToken()}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ featured, public_caption: caption }),
    });
    if (!res.ok) return { ok: false, error: 'http-' + res.status };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'network' };
  }
}

async function fetchFeaturedPhotos() {
  if (!isSyncConfigured()) return { ok: false, error: 'not-configured', photos: [] };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/th_job_photos?featured=eq.true&select=*&order=created_at.desc`, {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${getAuthToken()}` },
    });
    if (!res.ok) return { ok: false, error: 'http-' + res.status, photos: [] };
    const photos = await res.json();
    return { ok: true, photos };
  } catch (e) {
    return { ok: false, error: 'network', photos: [] };
  }
}

// Auto-pull once per page load, before the page's own render functions run
// their first pass, so freshly-synced data shows up immediately. Tools call
// `await initSyncOnLoad()` at the top of their init sequence.
async function initSyncOnLoad() {
  // Load the current account's role first (added 2026-08-14) -- cheap,
  // and every page's own load logic that checks hasDevToolsAccess() /
  // canManageRoles() needs this to have already resolved by the time
  // it runs. Runs even on pages where sync itself isn't configured.
  if (typeof loadCurrentUserRole === 'function') { await loadCurrentUserRole(); }
  if (!isSyncConfigured() || !getSyncCode()) return;
  await pullSync();
}

// ---------------------------------------------------------------------------
// REAL-TIME SYNC (optional) — requires the supabase-js CDN script to be
// loaded BEFORE this file (see the <script> tag order in each page's
// <head>). Everything above this point works fine without it; this only
// adds live updates between open tabs instead of pull-on-load-only.
// ---------------------------------------------------------------------------

let _supabaseClient = null;
let _realtimeChannel = null;
let _leadsRealtimeChannel = null;
let _bookingsRealtimeChannel = null;

function getSupabaseClient() {
  if (!isSyncConfigured()) return null;
  if (typeof window === 'undefined' || typeof window.supabase === 'undefined') return null;
  if (!_supabaseClient) {
    _supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return _supabaseClient;
}

// Subscribes to live changes on this device's sync row. When ANY device
// (including this one) pushes a change, `onRemoteChange` fires -- pull the
// latest and re-render, no page reload needed. `onStatusChange` reports
// connection state ('SUBSCRIBED', 'TIMED_OUT', 'CLOSED', 'CHANNEL_ERROR')
// so the page can show a small live/offline indicator.
function startRealtimeSync(onRemoteChange, onStatusChange) {
  const client = getSupabaseClient();
  if (!client) {
    if (onStatusChange) onStatusChange('unavailable');
    return;
  }
  const code = getSyncCode();
  let realtimeResolved = false;

  // Reliability fix (2026-08-20), based on real evidence from this
  // project's own Supabase logs: the realtime "tenant" (the backend
  // process actually handling channel subscriptions) shuts down after
  // a period of no connected clients, then has to cold-start again --
  // creating replication partitions, checking publications, starting
  // stream replication -- the next time someone connects. CHANNEL_ERROR
  // showed up as a transient condition during that window in the real
  // logs, with the tenant reaching a stable, working state shortly
  // after. This retries specifically on CHANNEL_ERROR (not TIMED_OUT,
  // which likely reflects something more persistent), cleaning up the
  // failed channel and trying again after a short delay, up to twice,
  // before giving up and surfacing the error to the page.
  function attemptSubscribe(retriesLeft) {
    _realtimeChannel = client
      .channel('workspace-sync-' + code)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'workspace_sync', filter: `code=eq.${code}` },
        async (payload) => {
          // Wrapped in try/catch and logged explicitly, rather than
          // relying on the browser's own window.onerror to catch a
          // failure in here -- this callback runs inside the supabase-js
          // library's own internals (a cross-origin script), and errors
          // originating there can get reported as a generic, detail-free
          // "Script error." with no file/line/message at all. Logging
          // explicitly here means a real failure gets a real message
          // instead of that unhelpful placeholder, added 2026-08-16 after
          // exactly that generic message kept recurring with nothing
          // useful to go on.
          try {
            const incomingUpdatedAt = payload && payload.new && payload.new.updated_at;
            const knownUpdatedAt = localStorage.getItem(SYNC_KNOWN_AT_KEY);
            if (incomingUpdatedAt && knownUpdatedAt && incomingUpdatedAt === knownUpdatedAt) return;
            await pullSync();
            if (onRemoteChange) onRemoteChange();
          } catch (e) {
            if (typeof logClientError === 'function') {
              logClientError('Realtime workspace_sync callback failed: ' + (e && e.message ? e.message : String(e)), 'sync.js', null, null, e && e.stack);
            }
          }
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' && retriesLeft > 0) {
          if (typeof logClientError === 'function') {
            logClientError('Realtime workspace_sync channel status: CHANNEL_ERROR -- retrying (' + retriesLeft + ' attempt(s) left)', 'sync.js', null, null, null);
          }
          client.removeChannel(_realtimeChannel);
          setTimeout(() => attemptSubscribe(retriesLeft - 1), 2000);
          return; // don't mark resolved or notify the page yet -- a retry is still in flight
        }
        realtimeResolved = true;
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          if (typeof logClientError === 'function') {
            logClientError('Realtime workspace_sync channel status: ' + status, 'sync.js', null, null, null);
          }
        }
        if (onStatusChange) onStatusChange(status);
      });
  }
  attemptSubscribe(2);

  // Reliability fix (2026-08-20): if the subscription never reaches ANY
  // terminal state at all, the line above never runs, and the status
  // stays stuck at whatever the page's own initial HTML said forever --
  // no indication anything is wrong, no way to retry. This gives it 12
  // seconds, then treats a still-unresolved connection as its own
  // status so the page can show something actionable instead of an
  // indefinite silent hang. Each page's existing status handler already
  // has an else-branch for an unrecognized status, so no per-page
  // changes are needed for this to surface correctly.
  setTimeout(() => {
    if (!realtimeResolved && onStatusChange) onStatusChange('timeout');
  }, 12000);
}

// Same idea, for the Leads inbox specifically -- fires when a new lead
// comes in from the website, or an existing one is updated/deleted.
function startLeadsRealtime(onChange, onStatusChange) {
  const client = getSupabaseClient();
  if (!client) {
    if (onStatusChange) onStatusChange('unavailable');
    return;
  }
  let realtimeResolved = false;

  // Same retry fix as startRealtimeSync above -- see that comment for
  // the full explanation, backed by this project's own Supabase logs.
  function attemptSubscribe(retriesLeft) {
    _leadsRealtimeChannel = client
      .channel('leads-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'th_leads' },
        () => {
          try {
            if (onChange) onChange();
          } catch (e) {
            if (typeof logClientError === 'function') {
              logClientError('Realtime th_leads callback failed: ' + (e && e.message ? e.message : String(e)), 'sync.js', null, null, e && e.stack);
            }
          }
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' && retriesLeft > 0) {
          if (typeof logClientError === 'function') {
            logClientError('Realtime th_leads channel status: CHANNEL_ERROR -- retrying (' + retriesLeft + ' attempt(s) left)', 'sync.js', null, null, null);
          }
          client.removeChannel(_leadsRealtimeChannel);
          setTimeout(() => attemptSubscribe(retriesLeft - 1), 2000);
          return;
        }
        realtimeResolved = true;
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          if (typeof logClientError === 'function') {
            logClientError('Realtime th_leads channel status: ' + status, 'sync.js', null, null, null);
          }
        }
        if (onStatusChange) onStatusChange(status);
      });
  }
  attemptSubscribe(2);

  // Same watchdog as startRealtimeSync above -- this channel was
  // missing it entirely, meaning if it ever got stuck in a non-terminal
  // state, there was no recovery path at all for it specifically.
  setTimeout(() => {
    if (!realtimeResolved && onStatusChange) onStatusChange('timeout');
  }, 12000);
}

function stopRealtimeSync() {
  if (_realtimeChannel) { _realtimeChannel.unsubscribe(); _realtimeChannel = null; }
  if (_leadsRealtimeChannel) { _leadsRealtimeChannel.unsubscribe(); _leadsRealtimeChannel = null; }
  if (_bookingsRealtimeChannel) { _bookingsRealtimeChannel.unsubscribe(); _bookingsRealtimeChannel = null; }
}

// Same idea again, for th_bookings specifically -- fires on a new
// booking, or a guest's own cancellation/reschedule. Added 2026-08-25:
// th_bookings was never in the supabase_realtime publication at all
// (see sql/add_bookings_to_realtime.sql), so a guest managing their
// own booking through manage-booking.html was invisible to staff
// watching the calendar or dashboard until a manual reload -- directly
// undercutting the point of this whole system, which is avoiding
// scheduling conflicts by keeping staff actually informed.
function startBookingsRealtime(onChange, onStatusChange) {
  const client = getSupabaseClient();
  if (!client) {
    if (onStatusChange) onStatusChange('unavailable');
    return;
  }
  let realtimeResolved = false;

  function attemptSubscribe(retriesLeft) {
    _bookingsRealtimeChannel = client
      .channel('bookings-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'th_bookings' },
        () => {
          try {
            if (onChange) onChange();
          } catch (e) {
            if (typeof logClientError === 'function') {
              logClientError('Realtime th_bookings callback failed: ' + (e && e.message ? e.message : String(e)), 'sync.js', null, null, e && e.stack);
            }
          }
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' && retriesLeft > 0) {
          if (typeof logClientError === 'function') {
            logClientError('Realtime th_bookings channel status: CHANNEL_ERROR -- retrying (' + retriesLeft + ' attempt(s) left)', 'sync.js', null, null, null);
          }
          client.removeChannel(_bookingsRealtimeChannel);
          setTimeout(() => attemptSubscribe(retriesLeft - 1), 2000);
          return;
        }
        realtimeResolved = true;
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          if (typeof logClientError === 'function') {
            logClientError('Realtime th_bookings channel status: ' + status, 'sync.js', null, null, null);
          }
        }
        if (onStatusChange) onStatusChange(status);
      });
  }
  attemptSubscribe(2);

  setTimeout(() => {
    if (!realtimeResolved && onStatusChange) onStatusChange('timeout');
  }, 12000);
}

// ---------------------------------------------------------------------------
// RECEIPTS — separate Storage bucket from job photos (different lifecycle:
// receipts attach 1:1 to an expense entry already living in the
// workspace_sync blob, so no separate metadata table is needed here --
// just the uploaded file itself, referenced by path from the expense
// record).
// ---------------------------------------------------------------------------

const RECEIPTS_BUCKET = 'receipts';

// ---------------------------------------------------------------------------
// SECURE DOCUMENTS -- unlike receipts/job-photos, this bucket is PRIVATE,
// by deliberate choice (insurance policies, LLC certificates, signed
// contracts). No separate metadata table like th_job_photos has; category
// and a human label are encoded directly in the storage path instead, so
// there's one less table+policy pair to set up and keep in sync. Since the
// bucket is private, viewing a file means generating a short-lived signed
// URL, not a permanent public one -- a public URL would defeat the entire
// point of using a private bucket in the first place.
const SECURE_DOCS_BUCKET = 'secure-documents';

// A real, reversible encoding for the label, not the space<->hyphen
// substitution this replaced -- that was lossy for any label that
// already contained a hyphen itself (like "W-9" or "2026-2027"), since
// decoding back turns EVERY hyphen into a space with no way to tell
// which ones were originally spaces. Base64url is fully reversible and
// still safe to drop directly into a storage path with no extra
// URL-encoding step, since it only ever produces letters, digits, - and _.
function labelToSlug(label) {
  const b64 = btoa(unescape(encodeURIComponent(label)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function slugToLabel(slug) {
  try {
    let b64 = slug.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const decoded = decodeURIComponent(escape(atob(b64)));
    // A real decoded label should be plain readable text. If this
    // doesn't look like that, the slug probably wasn't actually
    // base64 in the first place -- most likely a document uploaded
    // before this fix, which used the older, lossy hyphen scheme.
    if (decoded && /^[\x20-\x7E]*$/.test(decoded)) return decoded;
  } catch (e) { /* not valid base64 -- fall through to the legacy handling below */ }
  // Legacy fallback for documents uploaded before this fix: the old
  // scheme turned spaces into hyphens on save, so reverse that as a
  // best-effort display -- imperfect for old labels that had a real
  // hyphen in them, but there's nothing better to do for a file that's
  // already sitting in storage under that old name.
  return slug.replace(/-/g, ' ');
}

async function uploadSecureDocument(file, category, label) {
  if (!isSyncConfigured()) return { ok: false, error: 'not-configured' };
  if (typeof ensureFreshToken === 'function') {
    const fresh = await ensureFreshToken();
    if (!fresh) return { ok: false, error: 'session-expired', detail: 'Your login session has expired and could not be refreshed automatically. Log out and back in, then try again.' };
  }

  const safeCategory = (category || 'uncategorized').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const ext = (file.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf';
  const rawLabel = (label || file.name.replace(/\.[^.]+$/, '')).trim().slice(0, 80) || 'document';
  const labelSlug = labelToSlug(rawLabel);
  const path = `${safeCategory}/${Date.now()}_${labelSlug}.${ext}`;

  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${SECURE_DOCS_BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${getAuthToken()}`,
        'Content-Type': file.type || 'application/octet-stream',
      },
      body: file,
    });
    if (!res.ok) {
      let detail = '';
      try { const body = await res.json(); detail = body.message || body.error || ''; } catch (e) { /* not JSON */ }
      return { ok: false, error: 'upload-http-' + res.status, detail };
    }
    return { ok: true, path };
  } catch (e) {
    return { ok: false, error: 'network' };
  }
}

async function listSecureDocuments() {
  if (!isSyncConfigured()) return { ok: false, error: 'not-configured', documents: [] };
  if (typeof ensureFreshToken === 'function') await ensureFreshToken();
  try {
    // Storage's list endpoint is per-folder, not recursive -- list the
    // bucket root first to find category folders, then list inside each.
    const rootRes = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${SECURE_DOCS_BUCKET}`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${getAuthToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: '', limit: 200 }),
    });
    if (!rootRes.ok) return { ok: false, error: 'http-' + rootRes.status, documents: [] };
    const rootEntries = await rootRes.json();
    const categories = rootEntries.filter(e => e.id === null).map(e => e.name); // folders have a null id in Supabase Storage's listing

    const documents = [];
    for (const category of categories) {
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${SECURE_DOCS_BUCKET}`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${getAuthToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix: category + '/', limit: 200 }),
      });
      if (!res.ok) continue;
      const entries = await res.json();
      entries.filter(e => e.id !== null).forEach(e => {
        const match = e.name.match(/^(\d+)_(.+)\.[a-zA-Z0-9]+$/);
        documents.push({
          path: `${category}/${e.name}`,
          category,
          label: match ? slugToLabel(match[2]) : e.name,
          uploadedAt: match ? Number(match[1]) : null,
        });
      });
    }
    documents.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
    return { ok: true, documents };
  } catch (e) {
    return { ok: false, error: 'network', documents: [] };
  }
}

async function getSecureDocumentSignedUrl(path) {
  if (!isSyncConfigured()) return { ok: false, error: 'not-configured' };
  if (typeof ensureFreshToken === 'function') await ensureFreshToken();
  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${SECURE_DOCS_BUCKET}/${path}`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${getAuthToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 300 }), // 5 minutes -- long enough to open/download, short enough not to matter if the link is ever shared accidentally
    });
    if (!res.ok) return { ok: false, error: 'http-' + res.status };
    const data = await res.json();
    return { ok: true, url: `${SUPABASE_URL}/storage/v1${data.signedURL}` };
  } catch (e) {
    return { ok: false, error: 'network' };
  }
}

async function deleteSecureDocument(path) {
  if (!isSyncConfigured()) return { ok: false, error: 'not-configured' };
  if (typeof ensureFreshToken === 'function') await ensureFreshToken();
  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${SECURE_DOCS_BUCKET}/${path}`, {
      method: 'DELETE',
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${getAuthToken()}` },
    });
    if (!res.ok) return { ok: false, error: 'http-' + res.status };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'network' };
  }
}

// getReceiptUrl() (the old public-URL version) was removed 2026-08-15,
// found while building the storage browser below -- same dead-function
// pattern as getJobPhotoUrl() above, missed during that earlier cleanup
// since it's in a different section of this file. Zero call sites,
// confirmed by grep, and would only have worked if the bucket were
// public anyway. getSignedReceiptUrl() below is the only real path.
// Same reasoning as getSignedJobPhotoUrl above -- lets the receipts
// bucket stay private while still being viewable in the app.
async function getSignedReceiptUrl(storagePath) {
  return getSignedStorageUrl(RECEIPTS_BUCKET, storagePath, 3600);
}

async function uploadReceipt(file, expenseId) {
  if (!isSyncConfigured()) return { ok: false, error: 'not-configured' };
  if (file.size > MAX_PHOTO_BYTES) return { ok: false, error: 'too-large' };
  if (typeof ensureFreshToken === 'function') {
    const fresh = await ensureFreshToken();
    if (!fresh) return { ok: false, error: 'session-expired', detail: 'Your login session has expired and could not be refreshed automatically. Log out and back in, then try again.' };
  }

  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `expense-${expenseId}/${Date.now()}.${ext}`;

  try {
    const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${RECEIPTS_BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${getAuthToken()}`,
        'Content-Type': file.type || 'image/jpeg',
      },
      body: file,
    });
    if (!uploadRes.ok) {
      let detail = '';
      try {
        const body = await uploadRes.json();
        detail = body.message || body.error || '';
      } catch (e) { /* response wasn't JSON, fall through with no detail */ }
      return { ok: false, error: 'upload-http-' + uploadRes.status, detail };
    }
    return { ok: true, path };
  } catch (e) {
    return { ok: false, error: 'network' };
  }
}

async function deleteReceipt(storagePath) {
  if (!isSyncConfigured() || !storagePath) return { ok: true }; // nothing to delete is not an error
  try {
    await fetch(`${SUPABASE_URL}/storage/v1/object/${RECEIPTS_BUCKET}/${storagePath}`, {
      method: 'DELETE',
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${getAuthToken()}` },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'network' };
  }
}
