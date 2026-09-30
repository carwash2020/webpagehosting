// Batch 2 (2026-09-30): every form field on the Workspace and portal has
// a name a screen reader can announce, and three loading fixes -- jsPDF
// on demand in the portal, the orange logo precached at the URL pages
// really use, and blog lead images fetched early.
//
// axe (WCAG A/AA) was already clean on all 32 pages it can see, but it
// only checks what's rendered: 159 fields in closed dialogs, collapsed
// sections and later wizard steps had a visible <label> that wasn't tied
// to them, or no label at all.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const read = (...p) => fs.readFileSync(repo(...p), 'utf8');
const LAYOUT = read('js', 'pdf-layout.js');

function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  const braceStart = src.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

const PAGES = ['tools', 'portal'].flatMap((dir) => fs.readdirSync(repo(dir)).filter((f) => f.endsWith('.html')).map((f) => `${dir}/${f}`));

test('every field in the Workspace and portal markup has an accessible name', () => {
  const unnamed = [];
  for (const page of PAGES) {
    const doc = new JSDOM(read(page)).window.document;
    for (const el of doc.querySelectorAll('input, select, textarea')) {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) continue;
      // A display:none file input behind its own visible button (the portal's
      // photo picker) is reached through that button, not the input.
      if (type === 'file' && /display:\s*none/.test(el.getAttribute('style') || '') && !el.getAttribute('aria-label')) {
        const btn = el.parentElement.querySelector('button');
        if (btn) continue;
      }
      const named = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title')
        || (el.id && doc.querySelector(`label[for="${el.id}"]`)) || el.closest('label');
      if (!named) unnamed.push(`${page} ${el.tagName.toLowerCase()}#${el.id}`);
    }
  }
  assert.deepEqual(unnamed, []);
});

test('tied labels point at the right field (a sample from each kind of form)', () => {
  const cases = [
    ['tools/job-tracker.html', 'jobTitle', 'Job Title / Description'],
    ['tools/invoice-generator.html', 'invoiceTerms', 'Terms'],
    ['tools/finance.html', 'entryMiles', 'Miles'],
    ['tools/runway-dashboard.html', 'inc-frequency', 'Frequency'],
    ['tools/contract-generator.html', 'stpa_contactPicker', 'Use an existing contact'],
  ];
  for (const [page, id, text] of cases) {
    const doc = new JSDOM(read(page)).window.document;
    const label = doc.querySelector(`label[for="${id}"]`);
    assert.ok(label, `${page} label[for=${id}]`);
    assert.ok(label.textContent.trim().startsWith(text), `${page}: "${label.textContent.trim().slice(0, 40)}"`);
    assert.ok(doc.getElementById(id), `${page} #${id} exists`);
  }
  // Code fields with no visible label say what they want.
  for (const page of ['tools/login.html', 'portal/login.html']) {
    const doc = new JSDOM(read(page)).window.document;
    assert.equal(doc.getElementById('mfaChallengeCodeInput').getAttribute('aria-label'), '6-digit code from your authenticator app', page);
  }
});

test('portal Invoices, Visits and Estimates no longer load jsPDF with the page', () => {
  for (const page of ['portal/dashboard.html', 'portal/jobs.html', 'portal/quotes.html']) {
    const html = read(page);
    assert.doesNotMatch(html, /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/jspdf@/, page);
    assert.doesNotMatch(html, /if \(!window\.jspdf\) \{ showToast\('Still finishing loading/, page);
    assert.equal((html.match(/try \{ await pdfLoadJsPdf\(\); \} catch \(e\) \{ showToast\('Couldn\\'t load the PDF maker/g) || []).length, 1, page);
    assert.match(html, /<script src="\/js\/pdf-layout\.js\?v=[0-9a-f]+" defer><\/script>/, `${page} loads the loader`);
  }
});

test('pdfLoadJsPdf adds one pinned, SRI-checked script, shares it across clicks, and retries after a failure', async () => {
  const w = new JSDOM('<!doctype html><head></head>', { runScripts: 'outside-only' }).window;
  w.eval(LAYOUT.match(/const PDF_JSPDF_SRC = [^\n]+\nconst PDF_JSPDF_INTEGRITY = [^\n]+\n/)[0].replace(/const /g, 'var ')
    + 'var pdfJsPdfLoading = null;\n' + extractFn(LAYOUT, 'pdfLoadJsPdf'));
  const scripts = () => Array.from(w.document.head.querySelectorAll('script'));

  const a = w.pdfLoadJsPdf();
  const b = w.pdfLoadJsPdf();
  assert.equal(scripts().length, 1, 'two quick clicks, one request');
  const s = scripts()[0];
  assert.equal(s.src, 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js');
  assert.equal(s.integrity, 'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk');
  assert.equal(s.crossOrigin, 'anonymous');

  // A failed download rejects, removes the tag, and the next click tries again.
  s.onerror();
  await assert.rejects(a, /could not be downloaded/);
  await assert.rejects(b, /could not be downloaded/);
  assert.equal(scripts().length, 0);
  const c = w.pdfLoadJsPdf();
  assert.equal(scripts().length, 1);
  w.jspdf = { jsPDF: function () {} };
  scripts()[0].onload();
  assert.equal(await c, w.jspdf);
  // Once loaded (or on a tools page that loads it itself), no new request.
  assert.equal(await w.pdfLoadJsPdf(), w.jspdf);
  assert.equal(scripts().length, 1);
});

test('both service workers precache the orange logo at the exact URL pages request', () => {
  const used = new Set();
  for (const page of PAGES) for (const m of read(page).matchAll(/\/images\/logo-signature-orange\.webp(\?v=[0-9]+)?/g)) used.add(m[0]);
  assert.deepEqual([...used], ['/images/logo-signature-orange.webp?v=202608142300'], 'one URL across the Workspace and portal');
  for (const sw of ['service-worker.js', 'portal/service-worker.js']) {
    const src = read(sw);
    assert.ok(src.includes("'/images/logo-signature-orange.webp?v=202608142300'"), sw);
    assert.ok(!src.includes("'/images/logo-signature-orange.webp'"), `${sw}: no bare copy nobody requests`);
  }
});

test('each blog post fetches its lead image early instead of lazily', () => {
  const posts = fs.readdirSync(repo('blog')).filter((f) => f.endsWith('.html') && f !== 'index.html');
  assert.equal(posts.length, 16);
  for (const f of posts) {
    const img = new JSDOM(read('blog', f)).window.document.querySelector('.post-hero img.blog-diagram');
    assert.ok(img, f);
    assert.equal(img.getAttribute('loading'), null, `${f}: not lazy (it sits in the first screen)`);
    assert.equal(img.getAttribute('fetchpriority'), 'high', f);
  }
});
