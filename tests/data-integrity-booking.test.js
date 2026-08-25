// Tests for the booking-system checks added to Data integrity check
// in tools/dev-tools.html (2026-08-25), requested directly as a real
// gap found by inspection: this panel covered job photos and lead
// contact info but had nothing about the booking system at all.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const DEV_TOOLS_PATH = path.join(__dirname, '..', 'tools', 'dev-tools.html');

function runCheck(bookings, realJobs) {
  const html = fs.readFileSync(DEV_TOOLS_PATH, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://example.com/tools/dev-tools.html',
    beforeParse(w) {
      w.requireAuth = () => {};
      w.getAuthToken = () => 'fake-token';
      w.ensureFreshToken = async () => {};
      w.confirmDevPassword = async () => true;
      w.escapeHtml = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      w.formatBytes = (n) => n + ' B';
      w.SUPABASE_URL = 'https://example.supabase.co';
      w.SUPABASE_ANON_KEY = 'anon-key';
      const mockFetch = async (url) => {
        if (String(url).includes('storage/v1/object/list')) return { ok: true, json: async () => ([]) };
        if (String(url).includes('th_job_photos')) return { ok: true, json: async () => ([]) };
        if (String(url).includes('th_leads')) return { ok: true, json: async () => ([]) };
        if (String(url).includes('th_bookings')) return { ok: true, json: async () => (bookings) };
        if (String(url).includes('workspace_sync')) {
          return { ok: true, json: async () => ([{ data: { th_tracker_jobs: JSON.stringify(realJobs) } }]) };
        }
        return { ok: false };
      };
      w.fetch = mockFetch;
      w.fetchWithTimeout = async (url, timeout, opts) => mockFetch(url, opts);
    },
  });
  return dom.window.runDataIntegrityCheck().then(() => dom.window.document.getElementById('dataIntegrityResults').innerHTML);
}

test('a booking linked to a job that no longer exists is flagged, by id, in the orphaned-link check', async () => {
  const html = await runCheck(
    [{ id: 2, name: 'Orphaned Link', service_label: 'Plumbing', status: 'confirmed', job_id: 'job-DELETED', start_at: '2026-09-02T15:00:00Z', end_at: '2026-09-02T16:00:00Z' }],
    [{ id: 'job-1', title: 'Real Job' }],
  );
  assert.match(html, /job_id job-DELETED not found/);
});

test('a cancelled booking still linked to a job is flagged for manual cleanup', async () => {
  const html = await runCheck(
    [{ id: 3, name: 'Cancelled Still Linked', service_label: 'Drywall', status: 'cancelled', job_id: 'job-1', start_at: '2026-09-03T15:00:00Z', end_at: '2026-09-03T18:00:00Z' }],
    [{ id: 'job-1', title: 'Real Job' }],
  );
  assert.match(html, /Cancelled Still Linked/);
});

test('a booking whose end time is at or before its start time is flagged as malformed', async () => {
  const html = await runCheck(
    [{ id: 4, name: 'Malformed', service_label: 'Assembly', status: 'confirmed', job_id: null, start_at: '2026-09-04T18:00:00Z', end_at: '2026-09-04T17:00:00Z' }],
    [],
  );
  assert.match(html, /Malformed/);
});

test('a healthy booking (real job link, confirmed, valid time range) is never flagged by any of the three checks', async () => {
  const html = await runCheck(
    [{ id: 1, name: 'Real Good', service_label: 'Inspection', status: 'confirmed', job_id: 'job-1', start_at: '2026-09-01T15:00:00Z', end_at: '2026-09-01T15:45:00Z' }],
    [{ id: 'job-1', title: 'Real Job' }],
  );
  assert.doesNotMatch(html, /Real Good/);
});
