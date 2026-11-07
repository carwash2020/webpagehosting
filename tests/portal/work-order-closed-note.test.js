// Fix plan RP4.8 (2026-11-07): a work order Triple H closed ("declined",
// shown as "Closed") says why -- the staff note in the new nullable
// client_portal_work_orders.status_note -- or, with no note, "Questions?
// Send us a message." opening that request's own thread. The note is read
// in a separate query, only for declined rows, so the list never depends on
// the column existing. Made-up data only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'portal', 'work-orders.html'), 'utf8');
function grab(name) {
  const start = html.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  let depth = 0, i = html.indexOf('{', start);
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) { i++; break; } }
  return html.slice(start, i);
}

function page({ rows = [], error = null, throws = false } = {}) {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.queries = [];
  w.client = {
    from(table) {
      const q = { table, eqs: [] };
      w.queries.push(q);
      const chain = {
        select(cols) { q.select = cols; return chain; },
        eq(k, v) { q.eqs.push([k, v]); return chain; },
        in(k, v) { q.in = [k, v]; if (throws) return Promise.reject(new Error('net')); return Promise.resolve({ data: rows, error }); },
      };
      return chain;
    },
  };
  w.escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  w.eval('let woStatusNotes = {};\n' + ['loadWoStatusNotes', 'woClosedNoteHtml'].map(grab).join('\n') +
    ';window.loadWoStatusNotes = loadWoStatusNotes; window.woClosedNoteHtml = woClosedNoteHtml;');
  return w;
}

test('a declined request with a staff note shows it (escaped); the query is scoped to this client and to declined rows only', async () => {
  const w = page({ rows: [{ id: 4, status_note: '  Outside our service area <sorry>.  ' }] });
  const reqs = [{ id: 3, status: 'submitted' }, { id: 4, status: 'declined' }, { id: 5, status: 'completed' }];
  await w.loadWoStatusNotes(reqs, 'pat@example.com');
  assert.equal(w.queries.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(w.queries[0])), { table: 'client_portal_work_orders', eqs: [['client_email', 'pat@example.com']], select: 'id,status_note', in: ['id', [4]] });
  assert.equal(w.woClosedNoteHtml({ id: 4, status: 'declined' }), '<div class="wo-status-note"><strong>From Triple H:</strong> Outside our service area &lt;sorry&gt;.</div>');
  assert.equal(w.woClosedNoteHtml({ id: 3, status: 'submitted' }), '', 'only closed requests get a note');
  w.close();
});

test('no note (null, blank, column not there yet, or offline): "Questions? Send us a message." opening that request\'s thread', async () => {
  for (const opts of [{ rows: [{ id: 4, status_note: null }] }, { rows: [{ id: 4, status_note: '   ' }] }, { error: { code: '42703', message: 'column status_note does not exist' } }, { throws: true }]) {
    const w = page(opts);
    await w.loadWoStatusNotes([{ id: 4, status: 'declined' }], 'pat@example.com');
    assert.equal(w.woClosedNoteHtml({ id: 4, status: 'declined' }), '<div class="wo-status-note">Questions? <button type="button" class="wo-status-note-ask" onclick="openWoThread(4)">Send us a message.</button></div>', JSON.stringify(opts));
    w.close();
  }
});

test('no declined requests: no extra query at all', async () => {
  const w = page();
  await w.loadWoStatusNotes([{ id: 1, status: 'scheduled' }], 'pat@example.com');
  assert.equal(w.queries.length, 0);
  w.close();
});

test('wired in: the card renders the note, the list waits for notes, and "Send us a message." opens the thread and focuses the reply box', () => {
  assert.match(grab('renderRequestCard'), /\$\{woClosedNoteHtml\(wo\)\}/);
  const list = grab('renderMyRequests');
  assert.ok(list.indexOf('await loadWoStatusNotes(requests, session.user.email.toLowerCase());') < list.indexOf('requests.map(renderRequestCard)'));
  const open = grab('openWoThread');
  assert.match(open, /if \(!woThreadIsOpen\(workOrderId\)\) await toggleMessages\(workOrderId, btn\);/);
  assert.match(open, /getElementById\('woMessageInput-' \+ workOrderId\)/);
});
