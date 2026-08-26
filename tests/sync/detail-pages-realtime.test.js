const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS_DIR = path.join(__dirname, '..', '..', 'tools');

function waitFor(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Loads a real detail page with a mocked fetch standing in for Supabase --
// initSyncOnLoad() calls loadCurrentUserRole() then pullSync(), both real
// network calls this intercepts, then returns whatever workspace_sync
// "data" the test currently has configured (mutable via getSyncData so a
// test can simulate a remote change happening after the initial load).
//
// sync.js and data-layer.js are inlined directly into the HTML string
// before construction -- jsdom does not fetch external <script src> tags
// without a real, working resource loader, confirmed directly as the
// actual cause of an early failed run here (thGetJobBundle silently
// didn't exist at all, so the page just kept its static default title
// rather than throwing). auth.js is skipped since its functions are
// already provided directly via the beforeParse overrides below.
function loadDetailPage(pageName, queryString, getSyncData) {
  const htmlPath = path.join(TOOLS_DIR, pageName);
  let html = fs.readFileSync(htmlPath, 'utf8');
  const syncSrc = fs.readFileSync(path.join(TOOLS_DIR, 'sync.js'), 'utf8');
  const dataLayerSrc = fs.readFileSync(path.join(TOOLS_DIR, 'data-layer.js'), 'utf8');
  html = html.replace(/<script src="\/tools\/sync\.js\?v=[^"]*"[^>]*><\/script>/, '<script>' + syncSrc + '</script>');
  html = html.replace(/<script src="\/tools\/data-layer\.js\?v=[^"]*"[^>]*><\/script>/, '<script>' + dataLayerSrc + '</script>');

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: `https://www.triplehenterprisesllc.biz/tools/${pageName}${queryString}`,
    beforeParse(w) {
      w.requireAuth = () => {};
      w.canManageRoles = () => true;
      w.getAuthToken = () => 'fake-token';
      w.ensureFreshToken = async () => true;
      w.loadCurrentUserRole = async () => {};
      w.SUPABASE_URL = 'https://example.supabase.co';
      w.SUPABASE_ANON_KEY = 'anon-key';
      w.getSupabaseClient = () => null; // no real realtime channel needed -- tests call the callbacks directly
      w.escapeHtml = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      w.money = (v) => '$' + (v || 0).toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,');
      w.fetch = async (url) => {
        if (String(url).includes('workspace_sync')) {
          return { ok: true, json: async () => ([{ data: getSyncData(), updated_at: String(Date.now()) }]) };
        }
        return { ok: true, json: async () => ([]) };
      };
    },
  });
  return dom.window;
}

test('job-detail.html shows a real, correct job and updates live when the underlying data genuinely changes', async () => {
  const syncData = { th_tracker_jobs: JSON.stringify([{ id: '1', title: 'Original Job', status: 'not-started' }]) };
  const window = loadDetailPage('job-detail.html', '?id=1', () => syncData);
  await waitFor(200);
  assert.match(window.document.title, /^Original Job \|/);

  syncData.th_tracker_jobs = JSON.stringify([{ id: '1', title: 'Updated Job (live)', status: 'done' }]);
  await window.pullSync();
  window.onJobRealtimeChange();
  assert.match(window.document.title, /^Updated Job \(live\) \|/);
});

test('job-detail.html correctly switches to "not found" if the job is deleted (with its tombstone) while the page is open', async () => {
  const syncData = { th_tracker_jobs: JSON.stringify([{ id: '1', title: 'Original Job', status: 'not-started' }]), th_job_tombstones: JSON.stringify([]) };
  const window = loadDetailPage('job-detail.html', '?id=1', () => syncData);
  await waitFor(200);
  assert.equal(window.document.getElementById('jobDetailView').style.display, '');

  // The real deletion path: the job is gone AND a tombstone was recorded --
  // exactly what deleteJob() now does together, not just the job vanishing.
  syncData.th_tracker_jobs = JSON.stringify([]);
  syncData.th_job_tombstones = JSON.stringify([{ id: '1', deletedAt: new Date().toISOString() }]);
  await window.pullSync();
  window.onJobRealtimeChange();

  assert.equal(window.document.getElementById('jobDetailView').style.display, 'none');
  assert.equal(window.document.getElementById('jobNotFound').style.display, '');
});

test('client-detail.html shows a real, correct client and updates live when the underlying data genuinely changes', async () => {
  const syncData = { th_clients: JSON.stringify([{ id: 'c1', name: 'Original Client' }]) };
  const window = loadDetailPage('client-detail.html', '?id=c1', () => syncData);
  await waitFor(200);
  assert.match(window.document.title, /^Original Client \|/);

  syncData.th_clients = JSON.stringify([{ id: 'c1', name: 'Updated Client (live)' }]);
  await window.pullSync();
  window.onClientRealtimeChange();
  assert.match(window.document.title, /^Updated Client \(live\) \|/);
});

test('client-detail.html correctly switches to "not found" if the client is deleted (with its tombstone) while the page is open', async () => {
  const syncData = { th_clients: JSON.stringify([{ id: 'c1', name: 'Original Client' }]), th_client_tombstones: JSON.stringify([]) };
  const window = loadDetailPage('client-detail.html', '?id=c1', () => syncData);
  await waitFor(200);
  assert.equal(window.document.getElementById('clientDetailView').style.display, '');

  syncData.th_clients = JSON.stringify([]);
  syncData.th_client_tombstones = JSON.stringify([{ id: 'c1', normalizedName: 'original client', deletedAt: new Date().toISOString() }]);
  await window.pullSync();
  window.onClientRealtimeChange();

  assert.equal(window.document.getElementById('clientDetailView').style.display, 'none');
  assert.equal(window.document.getElementById('clientNotFound').style.display, '');
});

test('both detail pages carry the realtime status badge elements the shared updateRealtimeBadge() function needs, matching every other synced tool page', () => {
  for (const page of ['job-detail.html', 'client-detail.html']) {
    const html = fs.readFileSync(path.join(TOOLS_DIR, page), 'utf8');
    assert.match(html, /id="realtimeBadge"/, page + ' missing the realtime badge container');
    assert.match(html, /id="realtimeDot"/, page + ' missing the realtime dot');
    assert.match(html, /id="realtimeText"/, page + ' missing the realtime status text');
    assert.match(html, /startRealtimeSync\(/, page + ' never actually subscribes to realtime sync');
  }
});
