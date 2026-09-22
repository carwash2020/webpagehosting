// Workspace rework part 7 (2026-09-22): quick add. Type or say it --
// "sink leak for Sarah tomorrow 2pm" -- in the Create sheet (or search) and
// the right form opens filled in: thParseQuickEntry() makes the guess from
// what this device already knows (clients, vendors, jobs), thQuickEntryHref()
// turns it into a deep link, and each page's own form does the saving.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const read = (f) => fs.readFileSync(path.join(TOOLS, f), 'utf8');
const NAV = read('tools-nav-pwa.js');
const PALETTE = read('tools-command-palette.js');
const JT = read('job-tracker.html');
const INV = read('invoice-generator.html');
const FIN = read('finance.html');
const DL = read('data-layer.js');

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'expected function ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced ' + name);
}

// The quick-add section of tools-nav-pwa.js runs standalone.
const QA_SRC = NAV.slice(NAV.lastIndexOf('// ----', NAV.indexOf('// QUICK ADD (2026-09-22')));
function qa(store) {
  const mem = store || {};
  const ctx = { URLSearchParams, console, Date, Math, JSON, String, Number, Object, localStorage: { getItem: (k) => (k in mem ? mem[k] : null) } };
  vm.createContext(ctx);
  vm.runInContext(QA_SRC + ';this.api = { parse: thParseQuickEntry, href: thQuickEntryHref, context: thQuickAddContext };', ctx);
  return ctx.api;
}
const NOW = new Date(2026, 8, 22, 10); // Tuesday, Sep 22 2026
const CLIENTS = [
  { id: 'c1', name: 'Sarah Miller', phone: '435-555-0101', address: '123 Red Cliffs Dr' },
  { id: 'c2', name: 'Tom Nguyen' }, { id: 'c3', name: 'Bill Adams' }, { id: 'c4', name: 'Will Parker' },
];
const OPTS = { now: NOW, clients: CLIENTS, vendors: ['Home Depot', 'Chevron'], jobs: [
  { id: 101, title: 'Dishwasher not draining', client: 'Sarah Miller', status: 'not-started', date: '2026-09-22' },
  { id: 105, title: 'Fridge ice maker', client: 'Sarah Miller', status: 'done', date: '2026-09-16', statusChangedAt: '2026-09-20T18:00:00Z' },
  { id: 107, title: 'Washer leaking', client: 'Bill Adams', status: 'in-progress', date: '2026-09-20' },
] };
const { parse, href, context } = qa();
const pick = (r) => ({ intent: r.intent, title: r.title, client: r.client && (r.client.name + (r.client.known ? '' : ' (new)')), date: r.date, time: r.timeLabel || null, amount: r.amount, phone: r.phone, address: r.address, priority: r.priority, vendor: r.vendor, jobId: r.jobId });

test('jobs: title, known client (full or first name), relative dates, times, phone, address and urgency come out of one sentence', () => {
  const cases = [
    ['Sink leak for Sarah tomorrow 2pm', { intent: 'job', title: 'Sink leak', client: 'Sarah Miller', date: '2026-09-23', time: '2:00 PM' }],
    ['Replace garbage disposal at 88 Sunset Blvd for Tom Friday at 2:30', { title: 'Replace garbage disposal', client: 'Tom Nguyen', date: '2026-09-25', time: '2:30 PM', address: '88 Sunset Blvd' }],
    ['urgent water heater leaking 435-555-0199 for Jen Park at 300 Bluff St, St. George', { title: 'Water heater leaking', client: 'Jen Park (new)', phone: '(435) 555-0199', address: '300 Bluff St, St. George', priority: 'high' }],
    ['fix sun room screen door on thu', { title: 'Fix sun room screen door', date: '2026-09-24' }],
    ['Fence gate latch 9/30', { title: 'Fence gate latch', date: '2026-09-30' }],
    ['Deck stain sept 3', { title: 'Deck stain', date: '2027-09-03' }],
    ['New job: gutter cleaning in 2 weeks for Maria', { title: 'Gutter cleaning', client: 'Maria (new)', date: '2026-10-06' }],
    ['paint 2 doors at 45 Oak Ave next monday', { title: 'Paint 2 doors', address: '45 Oak Ave', date: '2026-09-28' }],
    ["fix sarah's garbage disposal today at noon", { title: 'Fix garbage disposal', client: 'Sarah Miller', date: '2026-09-22', time: '12:00 PM' }],
    ['will need parts for disposal', { title: 'Will need parts for disposal', client: null }],
  ];
  for (const [text, want] of cases) {
    const got = pick(parse(text, OPTS));
    for (const [k, v] of Object.entries(want)) assert.deepEqual(got[k], v, text + ' -> ' + k);
  }
});

test('money entries: a leading word picks invoice / quote / expense; right after it, a first name or a new "First Last" is the client; a bare number is the amount; the job is the one the words point at', () => {
  const cases = [
    ['invoice sarah $150 dishwasher repair', { intent: 'invoice', title: 'Dishwasher repair', client: 'Sarah Miller', amount: 150, jobId: 101 }],
    ['bill tom 85', { intent: 'invoice', client: 'Tom Nguyen', amount: 85 }],
    ['quote Dave Carter drywall patch 420 next tuesday', { intent: 'quote', title: 'Drywall patch', client: 'Dave Carter (new)', amount: 420, date: '2026-09-29' }],
    ['expense $48.12 Home Depot drain pump for Bill', { intent: 'expense', title: 'Drain pump', client: 'Bill Adams', amount: 48.12, vendor: 'Home Depot', jobId: 107 }],
    ['expense $1,250.50 at Ferguson Supply water heater', { intent: 'expense', amount: 1250.5, vendor: 'Ferguson Supply', title: 'Water heater' }],
    ['invoice sarah $95 ice maker', { client: 'Sarah Miller', jobId: 105 }],
  ];
  for (const [text, want] of cases) {
    const got = pick(parse(text, OPTS));
    for (const [k, v] of Object.entries(want)) assert.deepEqual(got[k], v, text + ' -> ' + k);
  }
  assert.equal(parse('will need parts', OPTS).client, null, 'a client named Will is not "will need"');
});

test('each guess becomes a deep link into the page that owns the form, and a job link says it came from quick add', () => {
  assert.equal(href(parse('Sink leak for Sarah tomorrow 2pm', OPTS)), '/tools/job-tracker.html?title=Sink+leak&client=Sarah+Miller&date=2026-09-23&notes=Time%3A+2%3A00+PM&qa=1#add-job');
  assert.equal(href(parse('invoice sarah $150 dishwasher repair', OPTS)), '/tools/invoice-generator.html?client=Sarah+Miller&item=Dishwasher+repair&price=150&jobRef=101#invoice');
  assert.equal(href(parse('quote Dave Carter drywall patch 420', OPTS)), '/tools/invoice-generator.html?client=Dave+Carter&item=Drywall+patch&price=420#quote');
  assert.equal(href(parse('expense $48.12 Home Depot drain pump for Bill', OPTS)), '/tools/finance.html?amount=48.12&vendor=Home+Depot&desc=Drain+pump&job=107#expenses');
  assert.equal(href(parse('urgent roof leak 435-555-0199', OPTS)), '/tools/job-tracker.html?title=Roof+leak&phone=%28435%29+555-0199&priority=high&qa=1#add-job');
});

test('what the parser knows comes from this device: the registry, names on jobs and contacts (deduped), and logged vendors', () => {
  const api = qa({
    th_clients: JSON.stringify([{ id: 'c1', name: 'Sarah Miller' }]),
    th_tracker_jobs: JSON.stringify([{ id: 1, client: 'sarah miller' }, { id: 2, client: 'Old Timer', phone: '1' }]),
    th_tracker_contacts: JSON.stringify([{ name: 'Supplier Sam' }]),
    th_expense_log: JSON.stringify([{ vendor: 'Home Depot' }, { vendor: 'home depot' }, { vendor: 'Ace' }]),
  });
  const c = api.context();
  assert.deepEqual(Array.from(c.clients, x => x.name), ['Sarah Miller', 'Old Timer', 'Supplier Sam']);
  assert.deepEqual(Array.from(c.vendors), ['Home Depot', 'Ace']);
  assert.equal(c.jobs.length, 2);
});

function shellPage(data, width) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div class="hub-header"><div class="hub-header-right"></div></div></body></html>', {
    runScripts: 'dangerously', url: 'https://example.com/tools/workspace.html',
    beforeParse(w) {
      for (const [k, v] of Object.entries(data || {})) w.localStorage.setItem(k, JSON.stringify(v));
      w.matchMedia = (q) => ({ matches: width >= 1024 && /min-width: 1024px/.test(q), addEventListener() {}, removeEventListener() {} });
      w.Element.prototype.scrollIntoView = function () {}; // jsdom has no layout
    },
  });
  const w = dom.window;
  for (const src of [NAV, PALETTE]) { const s = w.document.createElement('script'); s.textContent = src; w.document.body.appendChild(s); }
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  return w;
}
const DATA = { th_clients: [{ id: 'c1', name: 'Sarah Miller', phone: '435-555-0101', address: '123 Red Cliffs Dr' }], th_tracker_jobs: [], th_expense_log: [] };

test('the Create sheet leads with the quick-add field; typing shows what will be made (and hides the tiles), with a link to the filled-in form', () => {
  const w = shellPage(DATA, 390);
  w.openCreateSheet();
  const input = w.document.getElementById('thQuickAdd');
  assert.ok(input, 'quick add field in the Create sheet');
  assert.equal(input.getAttribute('enterkeyhint'), 'go');
  input.value = 'Sink leak for Sarah tomorrow 2pm';
  input.dispatchEvent(new w.Event('input'));
  const box = w.document.getElementById('thQuickAddPreview');
  assert.match(box.textContent, /New job/);
  assert.match(box.querySelector('.th-qa-title').textContent, /^Sink leak$/);
  const chips = Array.from(box.querySelectorAll('.th-qa-chip'), c => c.textContent);
  assert.ok(chips.some(c => /Sarah Miller/.test(c)) && chips.some(c => /^Tomorrow/.test(c)) && chips.some(c => /2:00 PM/.test(c)) && chips.some(c => /123 Red Cliffs Dr/.test(c)), chips.join(' | '));
  assert.match(box.querySelector('.th-qa-go').getAttribute('href'), /^\/tools\/job-tracker\.html\?title=Sink\+leak&client=Sarah\+Miller&date=\d{4}-\d{2}-\d{2}&notes=Time%3A\+2%3A00\+PM&qa=1#add-job$/);
  assert.ok(w.document.getElementById('thCreateSheet').classList.contains('is-typing'));
  input.value = '<img src=x onerror=alert(1)> for Sarah';
  input.dispatchEvent(new w.Event('input'));
  assert.equal(box.querySelector('img'), null, 'typed text is escaped');
  input.value = '';
  input.dispatchEvent(new w.Event('input'));
  assert.equal(box.innerHTML, '');
  assert.ok(!w.document.getElementById('thCreateSheet').classList.contains('is-typing'));
  w.close();
});

test('money kinds respect the same permissions as the tiles', () => {
  const w = shellPage(DATA, 390);
  w.canManageInvoices = () => false;
  w.openCreateSheet();
  const input = w.document.getElementById('thQuickAdd');
  input.value = 'invoice sarah $150 repair';
  input.dispatchEvent(new w.Event('input'));
  const box = w.document.getElementById('thQuickAddPreview');
  assert.equal(box.querySelector('.th-qa-go'), null);
  assert.match(box.textContent, /can.t create invoices/);
  w.close();
});

test('search offers the same thing as its top result -- but a plain name search stays a search', () => {
  const w = shellPage(DATA, 1440);
  w.openCommandPalette();
  const input = w.document.getElementById('thCmdkInput');
  input.value = 'fence gate latch for sarah friday';
  input.dispatchEvent(new w.Event('input'));
  const labels = Array.from(w.document.querySelectorAll('#thCmdkResults .th-cmdk-group-label'), l => l.textContent);
  assert.equal(labels[0], 'Quick add');
  const first = w.document.querySelector('#thCmdkResults .th-cmdk-item');
  assert.match(first.textContent, /New job: Fence gate latch/);
  assert.match(first.getAttribute('href'), /job-tracker\.html\?title=Fence\+gate\+latch&client=Sarah\+Miller/);
  input.value = 'sarah miller';
  input.dispatchEvent(new w.Event('input'));
  assert.ok(!Array.from(w.document.querySelectorAll('#thCmdkResults .th-cmdk-group-label'), l => l.textContent).includes('Quick add'));
  w.close();
});

test('closing search lets go of focus, so N opens Create right after; on a computer Create opens ready to type', () => {
  assert.match(extractFn(PALETTE, 'closePalette'), /document\.activeElement\.blur\(\)/);
  assert.match(NAV, /window\.matchMedia\('\(min-width: 1024px\) and \(pointer: fine\)'\)\.matches\s*\? sheet\.querySelector\('#thQuickAdd'\)/);
  assert.match(NAV, /sheet\.querySelectorAll\('a\[href\], button:not\(\[disabled\]\):not\(\[hidden\]\), input:not\(\[type="hidden"\]\)'\)/, 'the Tab trap includes the field');
  assert.match(NAV, /rec\.interimResults = true;/, 'the microphone fills the field as you talk');
});

test('Jobs: the quick-add fields fill only blanks, before the client autofill (so a phone said aloud wins), and leave the URL', () => {
  const fields = {};
  ['jobTitle', 'jobPhone', 'jobAddress', 'jobNotes', 'jobDate', 'jobPriority', 'jobClient'].forEach(id => { fields[id] = { value: '' }; });
  fields.jobPriority.value = 'medium';
  let replaced = null, toast = null, autofilled = 0;
  const ctx = {
    URLSearchParams, location: { search: '?title=Sink+leak&client=Sarah+Miller&date=2026-09-23&phone=%28435%29+555-0199&priority=high&notes=Time%3A+2%3A00+PM&qa=1&keep=1', pathname: '/tools/job-tracker.html', hash: '#add-job' },
    document: { getElementById: (id) => fields[id] || null },
    history: { replaceState: (a, b, url) => { replaced = url; } },
    autofillJobClient: () => { autofilled++; fields.jobPhone.value = fields.jobPhone.value || 'from registry'; },
    showToast: (m) => { toast = m; },
  };
  vm.createContext(ctx);
  vm.runInContext(extractFn(JT, 'applyQuickAddFields') + '\n' + extractFn(JT, 'applyPresetClientFromUrl') + ';applyPresetClientFromUrl();', ctx);
  assert.deepEqual([fields.jobTitle.value, fields.jobClient.value, fields.jobDate.value, fields.jobPhone.value, fields.jobPriority.value, fields.jobNotes.value],
    ['Sink leak', 'Sarah Miller', '2026-09-23', '(435) 555-0199', 'high', 'Time: 2:00 PM']);
  assert.equal(autofilled, 1);
  assert.equal(replaced, '/tools/job-tracker.html?keep=1#add-job');
  assert.match(toast, /Filled in from quick add/);
});

test('Invoices: ?item= / ?price= fill the first line of the form the hash opens; ?jobRef= no longer wipes the rest of the query string', async () => {
  const load = async (search, hash) => {
    const dom = new JSDOM(INV, {
      runScripts: 'dangerously', url: 'https://example.com/tools/invoice-generator.html' + search + hash,
      beforeParse(w) {
        w.requireAuth = () => {}; w.canManageInvoices = () => true;
        w.money = (n) => '$' + Number(n || 0).toFixed(2);
        w.escapeHtml = (x) => String(x == null ? '' : x); w.escapeAttr = (x) => String(x == null ? '' : x).replace(/"/g, '&quot;');
        w.showToast = () => {}; w.haptic = () => {}; w.todayDateStrBusinessTz = () => '2026-09-22';
        w.localStorage.setItem('th_tracker_jobs', JSON.stringify([{ id: 101, title: 'Dishwasher not draining', client: 'Sarah Miller', status: 'done' }]));
        w.eval(DL.replace(/^const /gm, 'var '));
      },
    });
    await new Promise(r => setTimeout(r, 0));
    return dom.window;
  };
  const w = await load('?client=Sarah+Miller&item=Dishwasher+repair&price=150&jobRef=101', '#invoice');
  const row = w.document.querySelector('#lineItemsBody tr');
  assert.deepEqual([row.querySelector('.li-desc').value, row.querySelector('.li-price').value], ['Dishwasher repair', '150'], 'the said item replaces the job title the ?jobRef= prefill put there');
  assert.equal(w.document.getElementById('clientName').value, 'Sarah Miller');
  assert.equal(w.document.getElementById('invoiceJobRef').value, '101');
  assert.equal(w.location.search, '', 'every quick-add param is used and stripped');
  w.close();
  const q = await load('?client=Dave+Carter&item=Drywall+patch&price=420', '#quote');
  const qrow = q.document.querySelectorAll('#quoteLineItemsBody tr');
  assert.equal(qrow.length, 1);
  assert.deepEqual([qrow[0].querySelector('.qli-desc').value, qrow[0].querySelector('.qli-price').value], ['Drywall patch', '420']);
  assert.equal(q.document.querySelector('.tab-btn.is-active').dataset.tab, 'quote');
  q.close();
  assert.match(extractFn(INV, 'applyJobRefFromUrl'), /keep\.delete\('jobRef'\);/);
});

test('Finance: an expense from quick add opens the form filled in, at the receipt photo it still requires', () => {
  assert.match(FIN, /if \(initialHash === 'expenses' && \['amount', 'vendor', 'desc', 'date'\]\.some\(k => qaParams\.get\(k\)\)\) \{[\s\S]*?fillIfBlank\('entryAmount', String\(amount\)\);[\s\S]*?fillIfBlank\('entryVendor', qaParams\.get\('vendor'\)\);[\s\S]*?fillIfBlank\('entryDesc', qaParams\.get\('desc'\)\);[\s\S]*?toggleFormSection\('expenseFormSection', true\)[\s\S]*?getElementById\('entryReceipt'\)/);
});

test('the tour and the help say it', () => {
  const TOUR = read('tools-tour.js');
  const WS = read('workspace.html');
  assert.match(TOUR, /Faster still, type or say it at the top/);
  assert.match(WS, /Or type \(or say, with the microphone\) what you need at the top of it/);
});
