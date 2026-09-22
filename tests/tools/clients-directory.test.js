// Workspace rework part 2 (2026-09-22): the Clients tab is a real client
// directory. clients.html opens on a list of every registry client --
// what they owe, their next or last job, a Call button -- with the portal
// admin console moved under a Portal tab that renders lazily. The query
// behind it is thGetClientDirectory() in data-layer.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const read = (f) => fs.readFileSync(path.join(TOOLS, f), 'utf8');
const DATA_LAYER = read('data-layer.js');
const DIALOGS = read('tools-dialogs.js');
const CLIENTS = read('clients.html');

function iso(offsetDays) {
  const d = new Date(); d.setDate(d.getDate() + offsetDays);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// A bare context with a working localStorage, running data-layer.js.
function dataLayer(store) {
  const mem = Object.assign({}, store);
  const ctx = {
    localStorage: {
      getItem: (k) => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
      removeItem: (k) => { delete mem[k]; },
    },
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(DATA_LAYER + '\n;this.__api = { thGetClientDirectory, thInvoiceBalance, thInvoiceIsOverdue, thBackfillClients };', ctx);
  return { api: ctx.__api, mem };
}

const CLIENT_ROWS = [
  { id: 'c1', name: 'Sarah Miller', phone: '435-555-0101', email: '', address: '' },
  { id: 'c2', name: 'Bill Adams', phone: '435-555-0107', email: 'bill@example.com', address: '12 Dixie Dr, St. George, UT' },
  { id: 'c3', name: 'Jen Park', phone: '', email: 'jen@example.com', address: '' },
];
function seed() {
  return {
    th_clients: JSON.stringify(CLIENT_ROWS),
    th_tracker_jobs: JSON.stringify([
      { id: 1, title: 'Dishwasher', client: 'sarah  miller', date: iso(0), status: 'not-started' },
      { id: 2, title: 'Ice maker', clientId: 'c1', client: 'Someone Renamed', date: iso(-6), status: 'done' },
      { id: 3, title: 'Washer', client: 'Bill Adams', date: iso(-2), status: 'done' },
      { id: 4, title: 'Fan', client: 'Jen Park', date: iso(3), status: 'not-started' },
    ]),
    th_invoices: JSON.stringify([
      { id: 11, clientName: 'Bill Adams', total: 285, paid: false, paidAmount: 0, date: iso(-40), terms: 'Net 15' },
      { id: 12, clientName: 'Sarah Miller', total: 200, paid: false, paidAmount: 40, date: iso(-3), terms: 'Net 30' },
      { id: 13, clientName: 'Jen Park', total: 95, paid: true, date: iso(-12), terms: 'Due Upon Receipt' },
    ]),
  };
}

test('thGetClientDirectory: owed is unpaid minus partial payments, overdue follows the terms, jobs match by clientId or normalized name', () => {
  const { api } = dataLayer(seed());
  const rows = api.thGetClientDirectory();
  const by = Object.fromEntries(rows.map(r => [r.name, r]));
  assert.equal(by['Sarah Miller'].owed, 160, '200 total minus a 40 partial payment');
  assert.equal(by['Sarah Miller'].overdueOwed, 0, 'Net 30 from 3 days ago is not due yet');
  assert.equal(by['Bill Adams'].owed, 285);
  assert.equal(by['Bill Adams'].overdueOwed, 285, 'Net 15 from 40 days ago is overdue');
  assert.equal(by['Jen Park'].owed, 0, 'a legacy paid:true invoice with no paidAmount is fully paid');
  assert.equal(by['Jen Park'].revenue, 95);
  assert.equal(by['Sarah Miller'].jobCount, 2, 'one job by normalized name, one by clientId even though its name drifted');
  assert.equal(by['Sarah Miller'].nextJobDate, iso(0));
  assert.equal(by['Sarah Miller'].lastJobDate, iso(0), 'today counts as the last job too');
  assert.equal(by['Jen Park'].nextJobDate, iso(3));
  assert.equal(by['Jen Park'].lastJobDate, null, 'a future job is never the "last" one');
  assert.equal(by['Bill Adams'].lastJobDate, iso(-2));
  assert.equal(by['Jen Park'].lastActivity, iso(3), 'recency includes what is coming up');
});

test('the invoice money helpers match the dashboard rules: Due Upon Receipt is due today, unknown terms fall back to 15 days, fully paid is never overdue', () => {
  const { api } = dataLayer({});
  assert.equal(api.thInvoiceBalance({ total: 100, paidAmount: 100 }), 0);
  assert.equal(api.thInvoiceBalance({ total: 100.1, paidAmount: 0.05 }), 100.05);
  assert.equal(api.thInvoiceBalance({ total: 50, paid: true }), 0);
  assert.equal(api.thInvoiceIsOverdue({ total: 50, paidAmount: 0, date: iso(-1), terms: 'Due Upon Receipt' }), true);
  assert.equal(api.thInvoiceIsOverdue({ total: 50, paidAmount: 0, date: iso(-10), terms: 'Something else' }), false);
  assert.equal(api.thInvoiceIsOverdue({ total: 50, paidAmount: 0, date: iso(-16), terms: 'Something else' }), true);
  assert.equal(api.thInvoiceIsOverdue({ total: 50, paidAmount: 50, date: iso(-90), terms: 'Net 15' }), false);
});

// clients.html in jsdom, with data-layer.js and tools-dialogs.js inlined
// (jsdom does not fetch <script src>) and the portal renderers stubbed.
function loadClientsPage({ url = 'https://example.com/tools/clients.html', store = seed(), role } = {}) {
  // Function replacers: a replacement *string* would expand the "$&" in
  // tools-dialogs.js's money() into the matched tag and break the script.
  let html = CLIENTS
    .replace(/<script src="\/tools\/data-layer\.js\?v=[^"]*"[^>]*><\/script>/, () => '<script>' + DATA_LAYER + '</script>')
    .replace(/<script src="\/tools\/tools-dialogs\.js\?v=[^"]*"[^>]*><\/script>/, () => '<script>' + DIALOGS + '</script>');
  const portalCalls = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url,
    beforeParse(w) {
      w.requireAuth = () => {};
      w.initAppTour = () => {};
      for (const [k, v] of Object.entries(store)) w.localStorage.setItem(k, v);
      w.getCurrentUserRole = () => role || null;
      w.canManageInvoices = () => !!(role && role.canManageInvoices);
    },
  });
  const w = dom.window;
  for (const fn of ['renderPortalBugReports', 'renderPortalClientErrors', 'renderReferralCredits', 'renderPortalAccounts', 'renderPortalInvoices', 'renderPortalQuotes', 'renderPortalWorkOrders', 'renderEmailList', 'renderPortalJobsForMessages']) {
    w[fn] = () => portalCalls.push(fn);
  }
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  return { w, portalCalls };
}
const titles = (w) => [...w.document.querySelectorAll('#clientDirList .th-row-title')].map(e => e.textContent);

test('the page opens on the client list, most recent activity first, and the portal panels do not load until the Portal tab opens', () => {
  const { w, portalCalls } = loadClientsPage();
  assert.ok(w.document.getElementById('tab-directory').classList.contains('is-active'));
  assert.deepEqual(titles(w), ['Jen Park', 'Sarah Miller', 'Bill Adams']);
  assert.match(w.document.getElementById('clientDirSummary').textContent, /3 clients · 2 owe you \$445\.00/);
  assert.deepEqual(portalCalls, [], 'no portal-admin request just to show the list');
  w.activateClientsTab('portal');
  assert.ok(w.document.getElementById('tab-portal').classList.contains('is-active'));
  assert.equal(portalCalls.length, 9);
  w.activateClientsTab('directory'); w.activateClientsTab('portal');
  assert.equal(portalCalls.length, 9, 'rendered once, not on every tab switch');
  assert.equal(w.localStorage.getItem('th_clients_tab'), 'portal', 'the tab is remembered per device');
});

test('each row: initials, the next/last job line, the phone as a Call button outside the link, and a red "due" pill only for an overdue balance', () => {
  const { w } = loadClientsPage();
  const rows = [...w.document.querySelectorAll('#clientDirList .th-row')];
  const bill = rows.find(r => r.textContent.includes('Bill Adams'));
  const sarah = rows.find(r => r.textContent.includes('Sarah Miller'));
  const jen = rows.find(r => r.textContent.includes('Jen Park'));
  assert.equal(bill.querySelector('.th-row-avatar').textContent, 'BA');
  assert.match(bill.querySelector('.th-pill').className, /is-danger/);
  assert.equal(bill.querySelector('.th-pill').textContent, '$285.00 due');
  assert.equal(sarah.querySelector('.th-pill').textContent, '$160.00');
  assert.doesNotMatch(sarah.querySelector('.th-pill').className, /is-danger/);
  assert.equal(jen.querySelector('.th-pill'), null, 'nothing owed, no pill');
  assert.match(sarah.querySelector('.th-row-sub').textContent, /^Job today/);
  assert.match(bill.querySelector('.th-row-sub').textContent, /^Last job /);
  assert.match(jen.querySelector('.th-row-sub').textContent, /^Next job /);
  assert.equal(bill.querySelector('a.th-icon-btn').getAttribute('href'), 'tel:4355550107');
  assert.ok(!bill.querySelector('.th-row-link').contains(bill.querySelector('a.th-icon-btn')), 'Call never also opens the record');
  assert.equal(jen.querySelector('a.th-icon-btn'), null, 'no phone, no Call button');
  assert.equal(bill.querySelector('.th-row-link').getAttribute('href'), '/tools/client-detail.html?id=c2');
});

test('search matches name, email, or street, and phone digits however they are typed; filters are Owes you (overdue first) and A-Z with letter headers', () => {
  const { w } = loadClientsPage();
  const input = w.document.getElementById('clientDirSearch');
  input.value = '(435) 555-0107'; w.renderClientDirectory();
  assert.deepEqual(titles(w), ['Bill Adams']);
  input.value = 'dixie'; w.renderClientDirectory();
  assert.deepEqual(titles(w), ['Bill Adams']);
  input.value = 'jen@'; w.renderClientDirectory();
  assert.deepEqual(titles(w), ['Jen Park']);
  input.value = 'nobody'; w.renderClientDirectory();
  assert.match(w.document.getElementById('clientDirList').textContent, /No client matches .nobody./);
  assert.ok(w.document.querySelector('#clientDirList button[onclick*="openAddClient"]'), 'a no-match search offers to add that name');
  input.value = '';
  w.setClientDirFilter('owes');
  assert.deepEqual(titles(w), ['Bill Adams', 'Sarah Miller'], 'overdue balance first, then the rest by amount');
  assert.equal(w.document.getElementById('clientDirOwesCount').textContent, '2');
  w.setClientDirFilter('az');
  assert.deepEqual(titles(w), ['Bill Adams', 'Jen Park', 'Sarah Miller']);
  assert.deepEqual([...w.document.querySelectorAll('#clientDirList .th-list-letter')].map(e => e.textContent), ['B', 'J', 'S']);
  assert.equal(w.localStorage.getItem('th_clients_filter'), 'az');
});

test('clients typed on any form appear on their own: the registry backfill runs on load and never recreates a deleted client', () => {
  const store = seed();
  store.th_clients = JSON.stringify([]);
  store.th_client_tombstones = JSON.stringify([{ id: 'x', normalizedName: 'jen park', deletedAt: new Date().toISOString() }]);
  const { w } = loadClientsPage({ store });
  // With an empty registry, job 2's clientId points at nobody, so its own
  // name text is what there is to go on.
  assert.deepEqual(titles(w).sort(), ['Bill Adams', 'Someone Renamed', 'sarah  miller'], 'jobs/invoices produced records; the tombstoned name did not come back');
});

test('a record already linked to a live client by clientId never spawns a second client, even when its name text drifted', () => {
  const { w } = loadClientsPage();
  assert.ok(!titles(w).includes('Someone Renamed'));
  assert.equal(JSON.parse(w.localStorage.getItem('th_clients')).length, 3);
});

test('an empty registry gets a real empty state with an Add button, not a blank page', () => {
  const { w } = loadClientsPage({ store: { th_clients: '[]' } });
  assert.match(w.document.getElementById('clientDirList').textContent, /No clients yet/);
  assert.ok(w.document.querySelector('#clientDirList .cd-empty button'));
});

test('deep links: #portal opens Portal, ?search= (the Client Registry\'s "View in Clients" link) still lands on Portal with the search filled, #new opens Add a client', async () => {
  let { w, portalCalls } = loadClientsPage({ url: 'https://example.com/tools/clients.html#portal' });
  assert.ok(w.document.getElementById('tab-portal').classList.contains('is-active'));
  assert.equal(portalCalls.length, 9);
  ({ w } = loadClientsPage({ url: 'https://example.com/tools/clients.html?search=bill%40example.com' }));
  assert.ok(w.document.getElementById('tab-portal').classList.contains('is-active'));
  assert.equal(w.document.getElementById('portalAccountSearch').value, 'bill@example.com');
  ({ w } = loadClientsPage({ url: 'https://example.com/tools/clients.html#new' }));
  assert.ok(w.document.getElementById('tab-directory').classList.contains('is-active'));
  assert.ok(w.document.getElementById('customDialogOverlay').classList.contains('is-open'), 'the Add a client form is open');
  assert.equal(w.document.getElementById('customDialogMessage').textContent, 'Add a client');
});

test('Add a client saves through thEnsureClient (so an existing name opens that client instead of a duplicate) and opens the new profile', async () => {
  const { w } = loadClientsPage();
  const before = JSON.parse(w.localStorage.getItem('th_clients')).length;
  const p = w.openAddClient();
  w.document.getElementById('customDialogField0').value = 'Karen White';
  w.document.getElementById('customDialogField1').value = '435-555-0199';
  w.document.querySelector('#customDialogButtons .dialog-btn-primary').click();
  await p.catch(() => {}); // jsdom cannot navigate; the save already happened
  const list = JSON.parse(w.localStorage.getItem('th_clients'));
  assert.equal(list.length, before + 1);
  assert.equal(list.find(c => c.name === 'Karen White').phone, '435-555-0199');
  assert.match(CLIENTS, /const record = thEnsureClient\(values\.name, \{ phone: values\.phone, email: values\.email, address: values\.address \}\);/);
  assert.match(CLIENTS, /location\.href = '\/tools\/client-detail\.html\?id=' \+ encodeURIComponent\(record\.id\);/);
});

test('the Portal tab hides on a definite "no" from the role (an account that cannot manage invoices), and stays when the role simply failed to load', () => {
  const { w } = loadClientsPage({ url: 'https://example.com/tools/clients.html#portal' });
  w.dispatchEvent(new w.CustomEvent('th-role-loaded', { detail: null }));
  assert.ok(!w.document.getElementById('clientsPortalTabBtn').hidden, 'unknown role: leave it (RLS is the real gate)');
  w.dispatchEvent(new w.CustomEvent('th-role-loaded', { detail: { canManageInvoices: false } }));
  assert.ok(w.document.getElementById('clientsPortalTabBtn').hidden);
  assert.ok(w.document.getElementById('tab-directory').classList.contains('is-active'), 'and falls back to the client list');
  w.activateClientsTab('portal');
  assert.ok(w.document.getElementById('tab-directory').classList.contains('is-active'), 'cannot be forced open afterwards');
});

test('everyone sees Clients in the nav now; the palette and Create sheet point at the directory; the tour teaches it', () => {
  const nav = read('tools-nav-pwa.js');
  const checks = nav.match(/var NAV_PERMISSION_CHECKS = \{([\s\S]*?)\};/)[1];
  assert.doesNotMatch(checks, /'\/tools\/clients\.html': function/);
  assert.match(nav, /\{ label: 'Client', +hint: 'Add to your client list', +icon: 'user-plus', href: '\/tools\/clients\.html#new' \}/);
  const palette = read('tools-command-palette.js');
  assert.match(palette, /\{ label: 'Clients', load: loadClients,/);
  assert.match(palette, /href: '\/tools\/client-detail\.html\?id=' \+ encodeURIComponent\(c\.id\)/);
  assert.match(palette, /href: '\/tools\/job-detail\.html\?id=' \+ encodeURIComponent\(j\.id\)/, 'job results open the job itself');
  assert.match(palette, /href: '\/tools\/clients\.html#portal', [^\n]*perm: 'canManageInvoices'/);
  const tour = read('tools-tour.js');
  assert.match(tour, /\{ page: '\/tools\/clients\.html', highlightSelector: '#clientDirSearch', title: 'Clients'/);
  assert.match(CLIENTS, /id="clientDirSearch"/);
});

test('"New job for" and "Invoice" a client: job-tracker.html and invoice-generator.html fill ?client= into the form the hash opens, fill-only, then drop the param', () => {
  const jt = read('job-tracker.html');
  assert.match(jt, /function applyPresetClientFromUrl\(\) \{[\s\S]*?if \(field && !field\.value\.trim\(\)\) \{\s*field\.value = name;\s*autofillJobClient\(\);/);
  assert.match(jt, /if \(initialHash === 'add-job'\) \{\s*applyPresetClientFromUrl\(\);/);
  assert.match(jt, /\} else if \(h === 'add-job'\) \{\s*activateTab\('jobs'\);\s*applyPresetClientFromUrl\(\);/);
  const ig = read('invoice-generator.html');
  assert.match(ig, /function applyClientFromUrl\(\) \{[\s\S]*?const field = document\.getElementById\(isQuote \? 'quoteClientName' : 'clientName'\);/);
  assert.match(ig, /applyJobRefFromUrl\(\);\s*applyClientFromUrl\(\);\s*applyLogSearchFromUrl\(\);/);
  // ?search= finally filters the Recent tab it has always linked to.
  assert.match(ig, /\['invoiceLogSearch', 'quoteLogSearch'\]\.forEach/);
  for (const page of ['client-detail.html', 'job-detail.html']) {
    assert.doesNotMatch(read(page), /#tab-recent/, page + ': the tab hash is #recent');
  }
});

test('client-detail.html: Call / Text / Email / Directions, New job / Invoice / Quote with the client filled in, what they owe, jobs open the job itself, a real back-to-Clients link', () => {
  const cd = read('client-detail.html');
  for (const label of ["'phone', 'Call'", "'message', 'Text'", "'inbox', 'Email'", "'navigate', 'Directions'"]) assert.ok(cd.includes(label), label);
  assert.match(cd, /\/tools\/job-tracker\.html\?client=' \+ nameParam \+ '#add-job">New job</);
  assert.match(cd, /\/tools\/invoice-generator\.html\?client=' \+ nameParam \+ '#invoice">Invoice</);
  assert.match(cd, /href: '\/tools\/job-detail\.html\?id=' \+ encodeURIComponent\(j\.id\)/);
  assert.match(cd, /Owes ' \+ money\(owed\)/);
  assert.match(cd, /<a href="\/tools\/clients\.html" class="help-btn" aria-label="Back to Clients"/);
  assert.match(cd, /<div class="client-stat-row">/);
});

test('attachLongPress: a link that opts in with data-long-press-target fires the hold and swallows the click that follows; any other link is still left alone', async () => {
  const dom = new JSDOM('<!DOCTYPE html><div id="list"><div class="row"><a id="opt" data-long-press-target href="#a">Open</a><a id="plain" href="#b">Plain</a></div></div>', { runScripts: 'dangerously', url: 'https://example.com/' });
  const w = dom.window;
  const s = w.document.createElement('script'); s.textContent = DIALOGS; w.document.head.appendChild(s);
  const fired = [];
  w.attachLongPress(w.document.getElementById('list'), '.row', (el) => fired.push(el.className));
  const press = (id) => { const ev = new w.Event('pointerdown', { bubbles: true }); ev.clientX = 5; ev.clientY = 5; w.document.getElementById(id).dispatchEvent(ev); };
  press('plain');
  await new Promise(r => setTimeout(r, 600));
  assert.deepEqual(fired, [], 'a plain link keeps its own tap');
  press('opt');
  await new Promise(r => setTimeout(r, 600));
  assert.deepEqual(fired, ['row']);
  const click = new w.MouseEvent('click', { bubbles: true, cancelable: true });
  w.document.getElementById('opt').dispatchEvent(click);
  assert.ok(click.defaultPrevented, 'letting go after the hold does not also open the link');
  const next = new w.MouseEvent('click', { bubbles: true, cancelable: true });
  w.document.getElementById('opt').dispatchEvent(next);
  assert.ok(!next.defaultPrevented, 'only that one click is swallowed');
  assert.match(CLIENTS, /class="th-row-link" data-long-press-target href=/);
});
