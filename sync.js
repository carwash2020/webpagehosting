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

const SUPABASE_URL = 'https://csvfqdjuobylgafgolho.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNzdmZxZGp1b2J5bGdhZmdvbGhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzNTQ3MjcsImV4cCI6MjEwMDkzMDcyN30.6GlvK-DfXf2lppS1kciZtsl4wHOpZz_yKtwsS1lyjrs';
const SYNC_TABLE = 'workspace_sync';

const SYNC_DATA_KEYS = [
  'th_tracker_jobs',
  'th_tracker_contacts',
  'th_tracker_notes_v2',
  'th_expense_log',
  'th_mileage_rate',
  'th_price_reference',
  'th_invoices',
  'th_quotes',
  'th_tax_rate',
  'th_tax_labor',
  'th_tax_parts',
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

function applySyncData(obj) {
  if (!obj) return;
  SYNC_DATA_KEYS.forEach(k => {
    if (obj[k] !== undefined && obj[k] !== null) localStorage.setItem(k, obj[k]);
  });
}

function recordSyncStatus(type, ok, error) {
  const status = { type, ok, error: error || null, time: new Date().toISOString() };
  try { localStorage.setItem('th_sync_last', JSON.stringify(status)); } catch (e) { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent('th-sync-status', { detail: status })); } catch (e) { /* ignore */ }
}

async function pushSync() {
  if (!isSyncConfigured()) return { ok: false, error: 'not-configured' };
  const code = getSyncCode();
  if (!code) return { ok: false, error: 'no-code' };

  const nowIso = new Date().toISOString();
  const body = [{ code, data: collectSyncData(), updated_at: nowIso }];

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${SYNC_TABLE}?on_conflict=code`, {
      method: 'POST',
      keepalive: true, // lets this request finish even if the tab is closing/navigating away
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) { recordSyncStatus('push', false, 'http-' + res.status); return { ok: false, error: 'http-' + res.status }; }
    localStorage.setItem(SYNC_KNOWN_AT_KEY, nowIso);
    recordSyncStatus('push', true);
    return { ok: true };
  } catch (e) {
    recordSyncStatus('push', false, 'network');
    return { ok: false, error: 'network' };
  }
}

async function pullSync() {
  if (!isSyncConfigured()) return { ok: false, error: 'not-configured' };
  const code = getSyncCode();
  if (!code) return { ok: false, error: 'no-code' };

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${SYNC_TABLE}?code=eq.${encodeURIComponent(code)}&select=data,updated_at`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
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
    recordSyncStatus('pull', false, 'network');
    return { ok: false, error: 'network' };
  }
}

// Debounced auto-push: call scheduleSync() from any tool's save function.
let _syncTimer = null;
function scheduleSync() {
  if (!isSyncConfigured() || !getSyncCode()) return;
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => { _syncTimer = null; pushSync(); }, 2500);
}

// Safety net: if the page is closed/backgrounded/navigated away from
// before the 2.5s debounce above fires, the scheduled push would
// otherwise be silently lost (a quick edit followed by immediately
// switching devices could look like "it didn't save"). Flushing
// immediately on visibilitychange/pagehide -- plus `keepalive: true`
// on the fetch itself -- means the browser will still complete the
// request even as the tab is torn down.
function flushSyncNow() {
  if (_syncTimer) {
    clearTimeout(_syncTimer);
    _syncTimer = null;
    pushSync();
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
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
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
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
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

// Auto-pull once per page load, before the page's own render functions run
// their first pass, so freshly-synced data shows up immediately. Tools call
// `await initSyncOnLoad()` at the top of their init sequence.
async function initSyncOnLoad() {
  if (!isSyncConfigured() || !getSyncCode()) return;
  await pullSync();
}
