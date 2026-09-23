// Workspace rework part 10 (2026-09-23): Get paid. A late invoice gets a
// reminder that writes itself -- who, which invoice, how much, how late,
// and the portal's pay link when the invoice is on the portal -- a notch
// firmer each time one is sent. It goes out through the phone's own
// Messages or Mail, and is logged on the invoice so every money view can
// say when the client was last reminded.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const read = (f) => fs.readFileSync(path.join(TOOLS, f), 'utf8');
const DL = read('data-layer.js');
const NAV = read('tools-nav-pwa.js');
const WS = read('workspace.html');
const INV = read('invoice-generator.html');
const JD = read('job-detail.html');
const CSS = read('styles-tools.css');

function extractFn(src, name) {
  const start = src.search(new RegExp('(?:async )?function ' + name + '\\('));
  assert.ok(start >= 0, 'expected function ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced ' + name);
}
const DAY = 86400000;
const NOW = new Date(2026, 8, 23, 10); // Wed Sep 23
const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const daysAgo = (n) => ymd(new Date(NOW.getTime() - n * DAY));

function dataLayer(store) {
  const mem = {};
  Object.keys(store || {}).forEach(k => { mem[k] = JSON.stringify(store[k]); });
  const ctx = {
    console, Date, Math, JSON, Number, String, Object, Array, Set, Map, isNaN,
    localStorage: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } },
  };
  vm.createContext(ctx);
  vm.runInContext(DL.replace(/^const /gm, 'var ') + '\n;this.api = { thInvoiceReminderStep, thInvoiceReminderText, thLogInvoiceReminder, thInvoiceRemindedLabel, thInvoiceNeedsReminder, thInvoiceReminders, TH_PORTAL_PAY_URL };', ctx);
  return { api: ctx.api, invoices: () => JSON.parse(mem.th_invoices || '[]') };
}
// Net 15 invoice whose due date is `lateDays` days before NOW.
const invoice = (lateDays, extra) => Object.assign({ id: 1, invoiceNumber: 'INV-1041', clientName: 'Bill Adams', total: 1285, paidAmount: 0, date: daysAgo(15 + lateDays), terms: 'Net 15' }, extra || {});

test('each reminder is a notch firmer, and never gentler than how late it is', () => {
  const { thInvoiceReminderStep } = dataLayer().api;
  const sent = (n) => Array.from({ length: n }, (_, i) => ({ at: new Date(NOW.getTime() - (n - i) * DAY).toISOString() }));
  assert.equal(thInvoiceReminderStep(invoice(5), NOW), 1);
  assert.equal(thInvoiceReminderStep(invoice(5, { reminders: sent(1) }), NOW), 2);
  assert.equal(thInvoiceReminderStep(invoice(5, { reminders: sent(2) }), NOW), 3);
  assert.equal(thInvoiceReminderStep(invoice(5, { reminders: sent(5) }), NOW), 3);
  assert.equal(thInvoiceReminderStep(invoice(14), NOW), 2, 'two weeks late starts at "following up"');
  assert.equal(thInvoiceReminderStep(invoice(30), NOW), 3, 'a month late is firm from the start');
  assert.equal(thInvoiceReminderStep(invoice(25, { reminders: [{ at: new Date(NOW.getTime() - DAY).toISOString(), step: 2 }] }), NOW), 3,
    'the first one sent was already "following up" (it was late), so the next is firm');
});

test('the reminder writes itself: first name, the invoice, what\'s still owed, when it was due, and the portal pay link when the invoice is on the portal', () => {
  const { thInvoiceReminderText, TH_PORTAL_PAY_URL } = dataLayer().api;
  assert.equal(TH_PORTAL_PAY_URL, 'https://www.triplehenterprisesllc.biz/portal/login.html');
  const due = new Date(NOW.getTime() - 5 * DAY).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const one = thInvoiceReminderText(invoice(5, { clientEmail: 'bill@example.com', paidAmount: 285 }), NOW);
  assert.equal(one.step, 1);
  assert.equal(one.body, 'Hi Bill, this is Triple H Enterprises. Just a friendly reminder that invoice INV-1041 for $1,000.00 was due ' + due + '. You can pay online at ' + TH_PORTAL_PAY_URL + ' (sign in with your email). Thank you!');
  assert.equal(one.subject, 'Reminder: invoice INV-1041 ($1,000.00)');
  assert.doesNotMatch(thInvoiceReminderText(invoice(5), NOW).body, /portal/, 'not on the portal (no client email): no pay link');
  assert.match(thInvoiceReminderText(invoice(0), NOW).body, /for \$1,285\.00 is due today\./);
  const two = thInvoiceReminderText(invoice(25), NOW);
  assert.equal(two.step, 2);
  assert.equal(two.body, 'Hi Bill, Triple H Enterprises here, following up on invoice INV-1041 for $1,285.00, now 25 days past due. If anything about the bill looks wrong, just reply and let me know.');
  const three = thInvoiceReminderText(invoice(40, { clientEmail: 'b@x.co' }), NOW);
  assert.equal(three.body, 'Hi Bill, invoice INV-1041 for $1,285.00 from Triple H Enterprises is now 40 days past due. Please arrange payment this week at ' + TH_PORTAL_PAY_URL + ', or reply so we can sort it out. Thank you.');
});

test('sending logs it on the invoice, so the next one is firmer and the lists can say when; Remind shows once it\'s due', () => {
  const dl = dataLayer({ th_invoices: [invoice(5)] });
  const { thLogInvoiceReminder, thInvoiceReminderText, thInvoiceRemindedLabel, thInvoiceNeedsReminder } = dl.api;
  thLogInvoiceReminder(1, 'text', new Date(NOW.getTime() - 3 * DAY));
  const inv = dl.invoices()[0];
  assert.equal(inv.reminders.length, 1);
  assert.deepEqual(Object.keys(inv.reminders[0]).sort(), ['at', 'channel', 'step']);
  assert.equal(inv.reminders[0].channel, 'text');
  assert.equal(inv.reminders[0].step, 1);
  assert.equal(thInvoiceReminderText(inv, NOW).step, 2);
  assert.equal(thInvoiceRemindedLabel(inv, NOW), 'Reminded 3 days ago');
  assert.equal(thInvoiceRemindedLabel(inv, new Date(NOW.getTime() - 2 * DAY)), 'Reminded yesterday');
  assert.equal(thInvoiceRemindedLabel(invoice(5), NOW), '');
  assert.equal(thInvoiceNeedsReminder(invoice(0), NOW), true, 'due today');
  assert.equal(thInvoiceNeedsReminder(invoice(-3), NOW), false, 'not due yet: a reminder is just nagging');
  assert.equal(thInvoiceNeedsReminder(invoice(9, { paidAmount: 1285 }), NOW), false, 'paid');
  assert.equal(dl.api.thLogInvoiceReminder(999, 'text'), null);
});

// --- the sheet ---------------------------------------------------------

function page(store, setup) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div class="hub-header"><div class="hub-header-right"></div></div><button id="opener" data-remind-invoice="1">Remind</button></body></html>', {
    runScripts: 'dangerously', url: 'https://example.com/tools/workspace.html',
    beforeParse(w) {
      Object.keys(store).forEach(k => w.localStorage.setItem(k, JSON.stringify(store[k])));
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      w.requestAnimationFrame = (f) => f();
      w.toasts = [];
      w.showToast = (m) => w.toasts.push(m);
      if (setup) setup(w);
    },
  });
  const w = dom.window;
  for (const src of [DL, NAV]) { const s = w.document.createElement('script'); s.textContent = src; w.document.body.appendChild(s); }
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  // Messages / Mail would open here; jsdom can't navigate, so stop the tap there.
  w.document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('.th-remind-send')) e.preventDefault(); });
  return w;
}
const lateInvoice = { id: 1, invoiceNumber: 'INV-1041', clientName: 'Bill Adams', clientEmail: 'bill@example.com', total: 285, paidAmount: 0, date: ymd(new Date(Date.now() - 40 * DAY)), terms: 'Net 15' };

test('any data-remind-invoice button opens the sheet: which reminder, who, what\'s owed, the message to edit, then Text / Email / Copy', () => {
  const w = page({ th_invoices: [lateInvoice], th_clients: [{ id: 'c1', name: 'Bill Adams', phone: '(435) 555-0107' }] });
  w.document.getElementById('opener').click();
  const sheet = w.document.querySelector('.th-remind-sheet');
  assert.ok(sheet, 'the sheet is open');
  assert.equal(sheet.getAttribute('role'), 'dialog');
  assert.equal(sheet.querySelector('.th-remind-kicker').textContent, 'Following up', '25 days late starts at two; the first one sent has no count');
  assert.equal(sheet.querySelector('.th-remind-title').textContent, 'Remind Bill Adams');
  assert.equal(sheet.querySelector('.th-remind-meta').textContent, '#INV-1041 · $285.00 owed · 25 days overdue');
  assert.match(sheet.querySelector('.th-remind-text').value, /^Hi Bill, Triple H Enterprises here, following up on invoice INV-1041 for \$285\.00, now 25 days past due\. You can pay online/);
  assert.deepEqual(Array.from(sheet.querySelectorAll('.th-remind-send'), b => b.textContent), ['Text Bill', 'Email', 'Copy'], 'the phone comes from the client registry');
  assert.equal(w.document.activeElement, sheet.querySelector('.th-remind-send'), 'focus on Text, not the box (no keyboard popping up)');

  sheet.querySelector('.th-remind-text').value = 'Hi Bill, just checking on INV-1041. Thanks!';
  const text = sheet.querySelector('[data-channel="text"]');
  text.click();
  assert.equal(text.getAttribute('href'), 'sms:14355550107?body=' + encodeURIComponent('Hi Bill, just checking on INV-1041. Thanks!'), 'the edited message goes out');
  const inv = JSON.parse(w.localStorage.getItem('th_invoices'))[0];
  assert.equal(inv.reminders.length, 1);
  assert.equal(inv.reminders[0].channel, 'text');
  assert.equal(inv.reminders[0].step, 2);
  assert.match(w.toasts[0], /Reminder logged/);
  w.document.getElementById('opener').click();
  const next = Array.from(w.document.querySelectorAll('.th-remind-kicker')).pop();
  assert.equal(next.textContent, 'Firm reminder · reminder 2', 'the next one is a notch firmer, and counted');
  w.close();
});

test('Email builds a mailto with the subject; no phone and no email leaves Copy and says so; Escape closes', () => {
  const w = page({ th_invoices: [lateInvoice] });
  let heard = null;
  w.addEventListener('th-invoice-reminded', (e) => { heard = e.detail; });
  w.document.getElementById('opener').click();
  const email = w.document.querySelector('[data-channel="email"]');
  assert.equal(email.className, 'primary-btn th-remind-send', 'no phone on file: Email leads');
  email.click();
  assert.match(email.getAttribute('href'), /^mailto:bill@example\.com\?subject=Reminder%3A%20invoice%20INV-1041%20\(%24285\.00\)&body=Hi%20Bill/);
  assert.deepEqual({ ...heard }, { invoiceId: 1, channel: 'email' });
  w.close();

  const bare = page({ th_invoices: [{ ...lateInvoice, clientEmail: '' }] });
  bare.document.getElementById('opener').click();
  assert.deepEqual(Array.from(bare.document.querySelectorAll('.th-remind-send'), b => b.textContent), ['Copy']);
  assert.match(bare.document.querySelector('.th-remind-note').textContent, /No phone or email on file for Bill/);
  bare.document.dispatchEvent(new bare.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.ok(!bare.document.querySelector('.quick-actions-overlay.is-shown'), 'Escape closes it');
  assert.equal(JSON.parse(bare.localStorage.getItem('th_invoices'))[0].reminders, undefined, 'closing sends nothing and logs nothing');
  bare.close();
});

// --- where Remind shows ------------------------------------------------

test('Dashboard Money Owed: a Remind pill beside Mark paid on due and late invoices, and when they were last reminded', () => {
  const store = [
    { id: 1, invoiceNumber: 'INV-1', clientName: 'Bill', total: 285, date: ymd(new Date(Date.now() - 40 * DAY)), terms: 'Net 15', reminders: [{ at: new Date(Date.now() - 2 * DAY).toISOString(), channel: 'text', step: 1 }] },
    { id: 2, invoiceNumber: 'INV-2', clientName: 'Sarah', total: 160, date: ymd(new Date()), terms: 'Net 30' },
  ];
  const el = { classList: { toggle() {} }, innerHTML: '' };
  const ctx = {
    Date, Math, Number, String, JSON, isNaN,
    localStorage: { getItem: (k) => (k === 'th_invoices' ? JSON.stringify(store) : null) },
    document: { getElementById: (id) => (id === 'todayMoney' ? el : null) },
    loadInvoices: () => store, invoicePaymentStatus: () => 'unpaid',
    getDueDate: (i) => new Date(new Date(i.date + 'T00:00:00').getTime() + (i.terms === 'Net 30' ? 30 : 15) * DAY),
    getRemainingCents: (i) => i.total * 100, money: (n) => '$' + n, escapeHtml: (x) => String(x), escapeAttr: (x) => String(x),
    invoiceMarkPaidButtonHtml: () => '<button>Mark paid</button>', readyToInvoiceRows: () => [],
  };
  ctx.isOverdue = (i) => ctx.getDueDate(i) < new Date(new Date().toDateString());
  vm.createContext(ctx);
  vm.runInContext(DL.replace(/^const /gm, 'var ') + '\n' + extractFn(WS, 'renderTodayMoney') + ';this.f = renderTodayMoney;', ctx);
  ctx.f({ overdueCount: 1, overdueTotal: 285, currentTotal: 160 });
  assert.match(el.innerHTML, /<button type="button" class="paid-toggle-btn is-remind" data-remind-invoice="1">Remind<\/button>/);
  assert.equal((el.innerHTML.match(/data-remind-invoice/g) || []).length, 1, 'not on Sarah\'s, which isn\'t due yet');
  assert.match(el.innerHTML, /<span class="today-money-reminded">Reminded 2 days ago<\/span>/);
  assert.match(WS, /window\.addEventListener\('th-invoice-reminded', renderMetrics\);/);
});

test('Invoices: the sheet offers Send a reminder (saying when the last went), the row says reminded, and the list refreshes after', () => {
  let shown = null;
  const inv = { id: 7, invoiceNumber: 'INV-7', clientName: 'Bill', total: 285, reminders: [{ at: new Date(Date.now() - 3 * DAY).toISOString() }] };
  const ctx = {
    Date, Math, String, Number, isNaN,
    invoicesForDisplay: () => [inv], invoiceState: () => ({ status: 'overdue', balance: 285 }), invoiceClientHref: () => '',
    money: (n) => '$' + n, escapeHtml: (x) => x, showQuickActionSheet: (t, a) => { shown = a.map(x => x.label); },
    thOpenReminderSheet() {},
  };
  vm.createContext(ctx);
  vm.runInContext(extractFn(DL, 'thDaysBetween') + extractFn(DL, 'thInvoiceReminders') + extractFn(DL, 'thInvoiceLastReminder') + extractFn(DL, 'thInvoiceRemindedLabel') + extractFn(INV, 'openInvoiceActions') + ';this.f = openInvoiceActions;', ctx);
  ctx.f(7);
  assert.equal(shown[1], 'Send a reminder (reminded 3 days ago)');
  assert.match(extractFn(INV, 'invoiceRowHtml'), /\(reminded \? ' &middot; ' \+ reminded\.toLowerCase\(\) : ''\)/);
  assert.match(INV, /window\.addEventListener\('th-invoice-reminded', \(\) => renderInvoiceLog\(\)\);/);
});

test('Job detail: an overdue job\'s line leads with Send a reminder for the invoice due first, and says when it was last sent', () => {
  const ctx = {
    console, Date, Math, String, Number, encodeURIComponent, JSON, isNaN,
    localStorage: { getItem: () => null },
    money: (n) => '$' + Number(n).toFixed(2), escapeHtml: (x) => String(x), escapeAttr: (x) => String(x),
    thOpenReminderSheet() {},
  };
  vm.createContext(ctx);
  vm.runInContext(DL.replace(/^const /gm, 'var ') + '\n' + extractFn(JD, 'jobTrackHtml') + ';this.f = jobTrackHtml; this.stage = thJobMoneyStage;', ctx);
  const job = { id: 5, status: 'done', client: 'Bill' };
  const invs = [{ id: 44, jobRefId: '5', total: 285, paidAmount: 0, date: ymd(new Date(Date.now() - 40 * DAY)), terms: 'Net 15', reminders: [{ at: new Date(Date.now() - 3 * DAY).toISOString() }] }];
  const html = ctx.f({ job, money: ctx.stage(job, invs, []) }, () => true);
  assert.match(html, /<strong>\$285\.00 owed<\/strong> &middot; 25 days overdue &middot; reminded 3 days ago\./);
  assert.match(html, /<button type="button" class="primary-btn job-next-btn" data-remind-invoice="44">Send a reminder<\/button>/);
  assert.match(html, />See invoice<\/a>/);
  assert.match(JD, /window\.addEventListener\('th-invoice-reminded', onJobRealtimeChange\);/);
});

test('the look: a mail icon in the sprite, and the sheet\'s message box and side-by-side buttons', () => {
  assert.match(NAV, /<symbol id="icon-mail"/);
  assert.match(CSS, /body \.th-remind-text, body \.th-remind-text:focus \{[\s\S]*?min-height: 136px;/);
  assert.match(CSS, /\.th-remind-actions > \* \{[\s\S]*?flex: 1 1 0;[\s\S]*?min-height: 48px;/);
  assert.match(WS, /\.paid-toggle-btn\.is-remind \{ color: #1a0d02;/);
});
