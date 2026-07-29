// ===========================================================================
// TRIPLE H WORKSPACE — CLOUD SYNC
// ===========================================================================
// This syncs your Workspace data (Jobs, Contacts, Notes, Expenses, Price
// Reference, Mileage Rate) across devices using a free Supabase project
// that belongs to Triple H Enterprises ONLY — never Tagg-N-Go's account.
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
];

const SYNC_CODE_KEY = 'th_sync_code';
const SYNC_KNOWN_AT_KEY = 'th_sync_known_at';

function isSyncConfigured() {
  return !SUPABASE_URL.startsWith('PASTE_') && !SUPABASE_ANON_KEY.startsWith('PASTE_');
}

function getSyncCode() { return localStorage.getItem(SYNC_CODE_KEY) || ''; }
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

async function pushSync() {
  if (!isSyncConfigured()) return { ok: false, error: 'not-configured' };
  const code = getSyncCode();
  if (!code) return { ok: false, error: 'no-code' };

  const nowIso = new Date().toISOString();
  const body = [{ code, data: collectSyncData(), updated_at: nowIso }];

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${SYNC_TABLE}?on_conflict=code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, error: 'http-' + res.status };
    localStorage.setItem(SYNC_KNOWN_AT_KEY, nowIso);
    return { ok: true };
  } catch (e) {
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
    if (!res.ok) return { ok: false, error: 'http-' + res.status };
    const rows = await res.json();
    if (!rows.length) return { ok: false, error: 'no-data-yet' };

    applySyncData(rows[0].data);
    localStorage.setItem(SYNC_KNOWN_AT_KEY, rows[0].updated_at);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'network' };
  }
}

// Debounced auto-push: call scheduleSync() from any tool's save function.
let _syncTimer = null;
function scheduleSync() {
  if (!isSyncConfigured() || !getSyncCode()) return;
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => { pushSync(); }, 2500);
}

// Auto-pull once per page load, before the page's own render functions run
// their first pass, so freshly-synced data shows up immediately. Tools call
// `await initSyncOnLoad()` at the top of their init sequence.
async function initSyncOnLoad() {
  if (!isSyncConfigured() || !getSyncCode()) return;
  await pullSync();
}
