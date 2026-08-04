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
const SYNC_TABLE = 'workspace_sync';

const SYNC_DATA_KEYS = [
  'th_tracker_jobs',
  'th_tracker_contacts',
  'th_tracker_notes_v2',
  'th_expense_log',
  'th_income_log',
  'th_mileage_rate',
  'th_price_reference',
  'th_invoices',
  'th_quotes',
  'th_tax_rate',
  'th_tax_labor',
  'th_tax_parts',
  'th_compliance',
  'th_job_templates',
  'th_contracts',
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
  th_tracker_contacts: 'id',
  th_tracker_notes_v2: 'id',
  th_expense_log: 'id',
  th_income_log: 'id',
  th_invoices: 'id',
  th_quotes: 'id',
  th_job_templates: 'id',
  th_contracts: 'id',
  th_price_reference: 'id',
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
      localStorage.setItem(k, JSON.stringify(mergeRecordArrays(localArr, remoteArr, keyField)));
    } catch (e) {
      localStorage.setItem(k, obj[k]); // malformed JSON on either side -- fall back to the old behavior rather than throw
    }
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
    recordSyncStatus('pull', false, 'network');
    return { ok: false, error: 'network' };
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
  const originalText = link ? link.textContent : null;
  if (link) link.textContent = 'Refreshing...';
  const result = await pullSync();
  if (link) link.textContent = originalText;

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

// ---------------------------------------------------------------------------
// JOB PHOTOS — actual image files live in Supabase Storage (a bucket named
// `job-photos`), which is a different thing from the database tables above.
// Metadata (which job a photo belongs to, before/after tag, etc.) lives in
// its own small table, `th_job_photos`, same pattern as leads.
// ---------------------------------------------------------------------------

const JOB_PHOTOS_BUCKET = 'job-photos';
const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8MB client-side cap

function getJobPhotoUrl(storagePath) {
  return `${SUPABASE_URL}/storage/v1/object/public/${JOB_PHOTOS_BUCKET}/${storagePath}`;
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
  _realtimeChannel = client
    .channel('workspace-sync-' + code)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'workspace_sync', filter: `code=eq.${code}` },
      async (payload) => {
        // A realtime event fires for EVERY change to this row, including
        // ones this same device just made -- pushing, then immediately
        // re-pulling and re-applying data it already has is pure
        // unnecessary churn, and one clear source of the race window
        // that could make a just-saved entry flicker or appear to
        // vanish. If the incoming row's updated_at matches what this
        // device already recorded as the last known state, skip the
        // pull entirely rather than redo work that changes nothing.
        const incomingUpdatedAt = payload && payload.new && payload.new.updated_at;
        const knownUpdatedAt = localStorage.getItem(SYNC_KNOWN_AT_KEY);
        if (incomingUpdatedAt && knownUpdatedAt && incomingUpdatedAt === knownUpdatedAt) return;
        await pullSync();
        if (onRemoteChange) onRemoteChange();
      }
    )
    .subscribe((status) => {
      if (onStatusChange) onStatusChange(status);
    });
}

// Same idea, for the Leads inbox specifically -- fires when a new lead
// comes in from the website, or an existing one is updated/deleted.
function startLeadsRealtime(onChange, onStatusChange) {
  const client = getSupabaseClient();
  if (!client) {
    if (onStatusChange) onStatusChange('unavailable');
    return;
  }
  _leadsRealtimeChannel = client
    .channel('leads-realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'th_leads' },
      () => { if (onChange) onChange(); }
    )
    .subscribe((status) => {
      if (onStatusChange) onStatusChange(status);
    });
}

function stopRealtimeSync() {
  if (_realtimeChannel) { _realtimeChannel.unsubscribe(); _realtimeChannel = null; }
  if (_leadsRealtimeChannel) { _leadsRealtimeChannel.unsubscribe(); _leadsRealtimeChannel = null; }
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

function getReceiptUrl(storagePath) {
  return `${SUPABASE_URL}/storage/v1/object/public/${RECEIPTS_BUCKET}/${storagePath}`;
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
