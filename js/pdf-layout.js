// pdf-layout.js -- the one shared jsPDF document system for every PDF a
// Triple H client can end up holding: invoices, estimates, receipts,
// quotes, job sheets, contracts, service histories, and the account
// summary. Lives in /js/ (not /tools/) so the client portal can load it
// without pulling in any internal tool script.
//
// 2026-09-24 redesign: the documents used to open with a 100pt solid
// near-black band -- the app's dark UI transplanted onto paper. That
// band burned toner on every printed invoice, and four portal/client
// documents each carried their own hand-copied version of it that had
// already drifted. This file now draws a print letterhead on white
// (logo, wordmark, trade line, full contact block, a hairline rule with
// an orange accent), a document title block (big Anton title + a
// label/value meta grid), and one table, totals, note-box, stamp and
// footer design that every document shares.
//
// Type: Anton (display), Oswald (labels, all caps), Archivo (body) --
// the same families the site loads -- embedded from /fonts/pdf/ as
// Latin subsets (~100 KB total, fetched once per page load). If the
// fonts can't be fetched, every call falls back to Helvetica and the
// layout still holds (widths are always measured, never assumed).
//
// Drawing only uses text / line / rect / addImage and the set* calls,
// so the recording fakes the test suite uses keep working. Optional
// jsPDF calls (addFileToVFS, addFont) are feature-checked.
//
// No module system, same as every other shared script here: a plain
// <script src> tag, and everything below becomes a plain global.

// Print palette. ORANGE is the brand token (#ff8000); on white paper it
// is used for rules, fills and large type only. Small orange text uses
// ORANGE_DARK (#c96400, the site's --orange-dark), which reads on paper.
// NAVY/GRAY/LIGHTGRAY are kept as aliases for older callers.
const PDF_COLORS = {
  INK: [28, 28, 28],
  BODY: [52, 52, 52],
  MUTED: [104, 104, 104],
  FAINT: [150, 150, 150],
  RULE: [214, 214, 214],
  ZEBRA: [248, 246, 243],
  ORANGE: [255, 128, 0],
  ORANGE_DARK: [201, 100, 0],
  ORANGE_TINT: [255, 243, 230],
  GREEN: [28, 125, 72],
  GREEN_TINT: [236, 247, 240],
  RED: [184, 40, 36],
  RED_TINT: [252, 238, 237],
  NAVY: [28, 28, 28],
  GRAY: [104, 104, 104],
  LIGHTGRAY: [214, 214, 214],
};

// The business facts every document prints. No street address, on
// any document: the LLC's registered address is Steve's home, so the
// letterhead carries the city line only (decided 2026-09-24; the public
// site follows the same rule, tests/seo/local-business-schema.test.js).
const PDF_BRAND = {
  legalName: 'Triple H Enterprises LLC',
  trade: 'HANDYMAN & APPLIANCE REPAIR',
  tagline: 'Honesty. Hustle. Helpfulness.',
  cityLine: 'St. George, Utah 84790',
  phone: '(435) 414-1667',
  email: 'steve@triplehenterprisesllc.biz',
  web: 'triplehenterprisesllc.biz',
  logoSrc: '/images/logo-signature-orange.png',
};

// Letter, in points. Every document uses the same margins and the same
// content floor, so the footer can never be drawn over.
const PDF_GEOM = {
  MARGIN: 48,
  CONT_TOP: 78,       // where content starts on a continuation page
  FOOTER_RULE: 46,    // footer rule sits this far above the page bottom
  CONTENT_FLOOR: 74,  // content never goes below pageH - this
};

const PDF_FONT_FILES = [
  { file: 'Anton-Regular.ttf', family: 'Anton', style: 'normal' },
  { file: 'Oswald-Medium.ttf', family: 'Oswald', style: 'normal' },
  { file: 'Archivo-Regular.ttf', family: 'Archivo', style: 'normal' },
  { file: 'Archivo-SemiBold.ttf', family: 'Archivo', style: 'bold' },
];

// role -> [brand family, style] / [fallback family, style]
const PDF_FONT_ROLES = {
  display: [['Anton', 'normal'], ['helvetica', 'bold']],
  label: [['Oswald', 'normal'], ['helvetica', 'bold']],
  body: [['Archivo', 'normal'], ['helvetica', 'normal']],
  bold: [['Archivo', 'bold'], ['helvetica', 'bold']],
};

// ---------------------------------------------------------------------
// Loading: logo + fonts. Both optional; a document still renders
// without either.
// ---------------------------------------------------------------------

function pdfLoadImageAsDataURL(src, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Image load timed out')), timeoutMs);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      clearTimeout(timer);
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => { clearTimeout(timer); reject(new Error('Image failed to load')); };
    img.src = src;
  });
}

let pdfFontFetch = null;
function pdfArrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
// Fetched once per page load and shared by every document generated
// after it. A failed fetch is not cached, so the next PDF tries again.
function pdfFetchBrandFonts(timeoutMs = 4000) {
  if (pdfFontFetch) return pdfFontFetch;
  if (typeof fetch !== 'function') return Promise.resolve(null);
  const all = Promise.all(PDF_FONT_FILES.map(f =>
    fetch('/fonts/pdf/' + f.file).then(r => {
      if (!r || !r.ok) throw new Error('font ' + f.file + ' HTTP ' + (r && r.status));
      return r.arrayBuffer();
    }).then(buf => Object.assign({}, f, { b64: pdfArrayBufferToBase64(buf) }))
  ));
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('font load timed out')), timeoutMs));
  pdfFontFetch = Promise.race([all, timeout]).catch(() => { pdfFontFetch = null; return null; });
  return pdfFontFetch;
}

// Per-document state: whether brand fonts are registered on THIS doc,
// the logo, and what the running header on page 2+ should say.
function pdfState(doc) {
  if (!doc.__thPdf) doc.__thPdf = { fonts: false, logo: null, typeLabel: '', ref: '', letterheadDrawn: false };
  return doc.__thPdf;
}

// Call (and await) once per document before drawing. Safe to call more
// than once; later calls only update the running-header text.
async function pdfPrepareDoc(doc, opts) {
  opts = opts || {};
  const st = pdfState(doc);
  if (opts.typeLabel !== undefined) st.typeLabel = opts.typeLabel || '';
  if (opts.ref !== undefined) st.ref = opts.ref || '';
  if (opts.logoDataUrl) st.logo = opts.logoDataUrl;
  if (st.prepared) return st;
  const [fonts, logo] = await Promise.all([
    pdfFetchBrandFonts(),
    st.logo ? Promise.resolve(st.logo) : pdfLoadImageAsDataURL(PDF_BRAND.logoSrc).catch(() => null),
  ]);
  st.logo = logo;
  if (fonts && typeof doc.addFileToVFS === 'function' && typeof doc.addFont === 'function') {
    try {
      fonts.forEach(f => { doc.addFileToVFS(f.file, f.b64); doc.addFont(f.file, f.family, f.style); });
      st.fonts = true;
    } catch (e) { st.fonts = false; }
  }
  st.prepared = true;
  return st;
}

function pdfSetFont(doc, role, size, color) {
  const pair = PDF_FONT_ROLES[role] || PDF_FONT_ROLES.body;
  const [family, style] = pdfState(doc).fonts ? pair[0] : pair[1];
  doc.setFont(family, style);
  if (size) doc.setFontSize(size);
  if (color) doc.setTextColor(...color);
}

function pdfMoney(n) {
  const v = Number(n) || 0;
  const s = Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (v < 0 ? '-$' : '$') + s;
}

// Letter-spaced text. jsPDF's own charSpace option doesn't play well
// with align:'right', so width is measured here and alignment is done
// by hand. `spacing` is extra points between characters.
function pdfSpacedWidth(doc, text, spacing) {
  const t = String(text);
  return doc.getTextWidth(t) + (spacing || 0) * Math.max(0, t.length - 1);
}
function pdfSpacedText(doc, text, x, y, spacing, align) {
  const t = String(text);
  const w = pdfSpacedWidth(doc, t, spacing);
  const startX = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  if (spacing) doc.text(t, startX, y, { charSpace: spacing });
  else doc.text(t, startX, y);
  return w;
}

function pdfContentBottom(doc) {
  return doc.internal.pageSize.getHeight() - PDF_GEOM.CONTENT_FLOOR;
}

// Wraps text to a width and never hands a single-line array back to
// the caller as one string -- each line is drawn on its own.
function pdfLines(doc, text, width) {
  const s = String(text == null ? '' : text);
  if (!s) return [];
  return [].concat(...s.split('\n').map(p => (p === '' ? [''] : doc.splitTextToSize(p, width))));
}

// ---------------------------------------------------------------------
// Letterhead (page 1) and running header (page 2+)
// ---------------------------------------------------------------------

function pdfDrawWordmark(doc, x, baseline, size) {
  const { INK, ORANGE } = PDF_COLORS;
  pdfSetFont(doc, 'display', size, INK);
  doc.text('TRIPLE H', x, baseline);
  const w = doc.getTextWidth('TRIPLE H ');
  doc.setTextColor(...ORANGE);
  doc.text('ENTERPRISES', x + w, baseline);
  return w + doc.getTextWidth('ENTERPRISES');
}

function pdfDrawLetterhead(doc) {
  const { INK, BODY, MUTED, ORANGE, ORANGE_DARK, RULE } = PDF_COLORS;
  const st = pdfState(doc);
  const pageW = doc.internal.pageSize.getWidth();
  const L = PDF_GEOM.MARGIN, R = pageW - PDF_GEOM.MARGIN;

  // A thin brand bar across the very top edge -- the only full-bleed
  // colour on the page.
  doc.setFillColor(...ORANGE);
  doc.rect(0, 0, pageW, 5, 'F');

  const logoW = 54, logoH = 54 * (506 / 550);
  let textX = L;
  if (st.logo) {
    try { doc.addImage(st.logo, 'PNG', L, 24, logoW, logoH); textX = L + logoW + 12; } catch (e) { /* logo optional */ }
  }
  pdfDrawWordmark(doc, textX, 47, 21);
  pdfSetFont(doc, 'label', 7.5, ORANGE_DARK);
  pdfSpacedText(doc, PDF_BRAND.trade, textX, 61, 1.1);
  pdfSetFont(doc, 'body', 8, MUTED);
  doc.text(PDF_BRAND.tagline, textX, 73);

  // Contact block, right-aligned, each value with a small label.
  const rows = [
    ['', PDF_BRAND.cityLine],
    ['PHONE', PDF_BRAND.phone],
    ['EMAIL', PDF_BRAND.email],
    ['WEB', PDF_BRAND.web],
  ];
  let cy = 33;
  rows.forEach(([label, value]) => {
    pdfSetFont(doc, 'body', 8.5, BODY);
    const vw = doc.getTextWidth(value);
    doc.text(value, R - vw, cy);
    if (label) {
      pdfSetFont(doc, 'label', 6.5, MUTED);
      pdfSpacedText(doc, label, R - vw - 7, cy, 0.8, 'right');
    }
    cy += 12.5;
  });

  // Hairline rule with a short orange lead-in.
  doc.setDrawColor(...RULE); doc.setLineWidth(0.75);
  doc.line(L, 96, R, 96);
  doc.setDrawColor(...ORANGE); doc.setLineWidth(2.5);
  doc.line(L, 96, L + 72, 96);
  doc.setLineWidth(0.75);
  doc.setDrawColor(...INK);
  st.letterheadDrawn = true;
  return 122;
}

function pdfDrawContinuationHeader(doc) {
  const { MUTED, ORANGE, RULE } = PDF_COLORS;
  const st = pdfState(doc);
  const pageW = doc.internal.pageSize.getWidth();
  const L = PDF_GEOM.MARGIN, R = pageW - PDF_GEOM.MARGIN;
  doc.setFillColor(...ORANGE);
  doc.rect(0, 0, pageW, 5, 'F');
  let x = L;
  if (st.logo) {
    try { doc.addImage(st.logo, 'PNG', L, 21, 24, 24 * (506 / 550)); x = L + 31; } catch (e) { /* optional */ }
  }
  pdfDrawWordmark(doc, x, 38, 12);
  const right = [st.typeLabel, st.ref].filter(Boolean).join(' \u00b7 ');
  if (right) {
    pdfSetFont(doc, 'label', 8, MUTED);
    pdfSpacedText(doc, right, R, 38, 0.6, 'right');
  }
  doc.setDrawColor(...RULE); doc.setLineWidth(0.75);
  doc.line(L, 52, R, 52);
  return PDF_GEOM.CONT_TOP;
}

// Starts a new page with the running header; returns the y content
// should resume at.
function pdfNewPage(doc) {
  doc.addPage();
  return pdfDrawContinuationHeader(doc);
}

// If `needed` points don't fit below y on this page, move to a new
// page. Returns the (possibly new) y.
function pdfEnsureSpace(doc, y, needed) {
  if (y + needed <= pdfContentBottom(doc)) return y;
  return pdfNewPage(doc);
}

// Title block under the letterhead: the document type in Anton on the
// left (auto-shrunk to fit beside the meta), an optional subtitle, and
// a right-aligned grid of label/value pairs (number, date, terms...).
// meta: [{ label, value, tone? }] -- tone 'green' | 'red' | 'orange'.
function pdfDrawDocTitle(doc, { y, title, subtitle, meta }) {
  const { INK, MUTED, ORANGE, ORANGE_DARK, GREEN, RED } = PDF_COLORS;
  const pageW = doc.internal.pageSize.getWidth();
  const L = PDF_GEOM.MARGIN, R = pageW - PDF_GEOM.MARGIN;
  const cells = (meta || []).filter(m => m && m.value !== undefined && m.value !== null && String(m.value) !== '');

  // Lay meta cells out right-to-left, wrapping to a second row if the
  // first would crowd the title.
  const gap = 22;
  const measured = cells.map(c => {
    pdfSetFont(doc, 'label', 7, MUTED);
    const lw = pdfSpacedWidth(doc, String(c.label).toUpperCase(), 0.8);
    pdfSetFont(doc, 'bold', 10, INK);
    const vw = doc.getTextWidth(String(c.value));
    return Object.assign({}, c, { w: Math.max(lw, vw) });
  });
  // Meta gets whatever the title (at full size) leaves, never less
  // than a bit over a third of the page; a long title shrinks instead.
  pdfSetFont(doc, 'display', 30);
  const maxRowW = Math.max((R - L) * 0.38, (R - L) - doc.getTextWidth(String(title)) - 40);
  const rows = [[]];
  let rowW = 0;
  measured.forEach(c => {
    if (rows[rows.length - 1].length && rowW + c.w + gap > maxRowW) { rows.push([]); rowW = 0; }
    rows[rows.length - 1].push(c);
    rowW += c.w + gap;
  });
  const widestRow = Math.max(0, ...rows.map(r => r.reduce((s, c) => s + c.w, 0) + gap * Math.max(0, r.length - 1)));

  let my = y + 8;
  rows.forEach(row => {
    let x = R;
    for (let i = row.length - 1; i >= 0; i--) {
      const c = row[i];
      pdfSetFont(doc, 'label', 7, MUTED);
      pdfSpacedText(doc, String(c.label).toUpperCase(), x, my, 0.8, 'right');
      const toneColor = c.tone === 'green' ? GREEN : c.tone === 'red' ? RED : c.tone === 'orange' ? ORANGE_DARK : INK;
      pdfSetFont(doc, 'bold', 10, toneColor);
      doc.text(String(c.value), x - doc.getTextWidth(String(c.value)), my + 14);
      x -= c.w + gap;
    }
    my += 32;
  });
  const metaBottom = rows[0].length ? my - 32 + 14 : y;

  // Title, shrunk until it clears the meta grid.
  const titleRoom = Math.max(160, (R - L) - widestRow - 28);
  let size = 30;
  pdfSetFont(doc, 'display', size, INK);
  while (size > 16 && doc.getTextWidth(String(title)) > titleRoom) {
    size -= 1;
    doc.setFontSize(size);
  }
  const titleBase = y + 4 + size * 0.72;
  doc.text(String(title), L, titleBase);
  doc.setFillColor(...ORANGE);
  doc.rect(L, titleBase + 7, 34, 3, 'F');
  let ty = titleBase + 10;
  if (subtitle) {
    pdfSetFont(doc, 'body', 9, MUTED);
    const lines = pdfLines(doc, subtitle, titleRoom);
    ty += 13;
    lines.forEach(line => { doc.text(line, L, ty); ty += 12; });
    ty -= 12;
  }
  return Math.max(ty, metaBottom) + 26;
}

// Letterhead + (optionally) the title block. The first call on a
// document draws the full letterhead; every later call (a contract
// page break, say) draws the compact running header instead.
//
// Kept async and with the original (doc, pageW, typeLabel, logo)
// shape so older call sites still work; opts carries the title block.
async function drawPdfHeader(doc, pageW, typeLabel, preloadedLogoDataUrl, opts) {
  opts = opts || {};
  const st = await pdfPrepareDoc(doc, {
    typeLabel: opts.runningLabel || typeLabel,
    ref: opts.ref,
    logoDataUrl: preloadedLogoDataUrl || undefined,
  });
  if (st.letterheadDrawn) return pdfDrawContinuationHeader(doc);
  const y = pdfDrawLetterhead(doc);
  if (opts.title === false) return y;
  return pdfDrawDocTitle(doc, { y, title: opts.title || typeLabel, subtitle: opts.subtitle, meta: opts.meta });
}

// ---------------------------------------------------------------------
// Content blocks
// ---------------------------------------------------------------------

// Small all-caps section label with a hairline running to the margin.
function pdfSectionLabel(doc, text, y, opts) {
  opts = opts || {};
  const { ORANGE_DARK, RULE } = PDF_COLORS;
  const pageW = doc.internal.pageSize.getWidth();
  const L = opts.x !== undefined ? opts.x : PDF_GEOM.MARGIN;
  const R = opts.right !== undefined ? opts.right : pageW - PDF_GEOM.MARGIN;
  pdfSetFont(doc, 'label', opts.size || 8, opts.color || ORANGE_DARK);
  const w = pdfSpacedText(doc, String(text).toUpperCase(), L, y, 1);
  if (opts.rule !== false && L + w + 10 < R) {
    doc.setDrawColor(...RULE); doc.setLineWidth(0.6);
    doc.line(L + w + 8, y - 2.5, R, y - 2.5);
  }
  return y + (opts.after !== undefined ? opts.after : 16);
}

// Side-by-side labelled blocks (BILL TO / JOB SITE / PREPARED BY...).
// columns: [{ label, lines: [string | { text, bold, muted }] }].
// Each column wraps to its own width; returns y below the tallest.
function pdfDrawInfoColumns(doc, { y, columns, gap }) {
  const { INK, MUTED } = PDF_COLORS;
  const pageW = doc.internal.pageSize.getWidth();
  const L = PDF_GEOM.MARGIN, R = pageW - PDF_GEOM.MARGIN;
  const cols = (columns || []).filter(c => c && (c.lines || []).some(l => (typeof l === 'string' ? l : l && l.text)));
  if (!cols.length) return y;
  gap = gap || 26;
  const colW = ((R - L) - gap * (cols.length - 1)) / cols.length;

  // Measure first so the whole row can move to a new page together.
  const layouts = cols.map(c => {
    const out = [];
    (c.lines || []).forEach(l => {
      const item = typeof l === 'string' ? { text: l } : l;
      if (!item || !item.text) return;
      pdfSetFont(doc, item.bold ? 'bold' : 'body', item.bold ? 10.5 : 9.5);
      pdfLines(doc, item.text, colW).forEach(line => out.push({ line, bold: !!item.bold, muted: !!item.muted }));
    });
    return out;
  });
  const height = 14 + Math.max(...layouts.map(l => l.reduce((s, it) => s + (it.bold ? 14 : 12.5), 0)));
  y = pdfEnsureSpace(doc, y, height);

  let bottom = y;
  cols.forEach((c, i) => {
    const x = L + i * (colW + gap);
    let cy = pdfSectionLabel(doc, c.label, y, { x, right: x + colW, after: 15 });
    layouts[i].forEach(it => {
      pdfSetFont(doc, it.bold ? 'bold' : 'body', it.bold ? 10.5 : 9.5, it.muted ? MUTED : INK);
      doc.text(it.line, x, cy);
      cy += it.bold ? 14 : 12.5;
    });
    bottom = Math.max(bottom, cy);
  });
  return bottom + 14;
}

// A paragraph that paginates line by line. role/size/color default to
// body text.
function pdfDrawParagraph(doc, { y, text, x, width, size, color, role, lineHeight }) {
  const pageW = doc.internal.pageSize.getWidth();
  x = x !== undefined ? x : PDF_GEOM.MARGIN;
  width = width || (pageW - PDF_GEOM.MARGIN - x);
  size = size || 9.5;
  lineHeight = lineHeight || size * 1.38;
  role = role || 'body';
  color = color || PDF_COLORS.BODY;
  pdfSetFont(doc, role, size, color);
  pdfLines(doc, text, width).forEach(line => {
    if (y + lineHeight > pdfContentBottom(doc) + lineHeight * 0.6) {
      y = pdfNewPage(doc);
      pdfSetFont(doc, role, size, color);
    }
    doc.text(line, x, y);
    y += lineHeight;
  });
  return y;
}

// The generic table: every tabular block on every document.
// columns: [{ key, label, width (fraction of content width), align }]
// rows: objects keyed by column; a value may be a string or
//   { text, sub: [string | { text, color }], subColor, color, bold }.
// Rows wrap and grow; a row never splits across pages, and the column
// heads repeat under the running header on every new page.
function drawPdfTable(doc, { y, columns, rows, zebra, emptyText }) {
  const { INK, BODY, MUTED, RULE, ZEBRA } = PDF_COLORS;
  const pageW = doc.internal.pageSize.getWidth();
  const L = PDF_GEOM.MARGIN, R = pageW - PDF_GEOM.MARGIN;
  const tableW = R - L;
  const PAD = 6;
  let cx = L;
  const cols = columns.map(c => {
    const w = tableW * c.width;
    const col = Object.assign({}, c, { x: cx, w });
    cx += w;
    return col;
  });

  function head(atY) {
    pdfSetFont(doc, 'label', 7.5, MUTED);
    cols.forEach(c => {
      const t = String(c.label).toUpperCase();
      if (c.align === 'right') pdfSpacedText(doc, t, c.x + c.w - PAD, atY + 11, 0.8, 'right');
      else if (c.align === 'center') pdfSpacedText(doc, t, c.x + c.w / 2, atY + 11, 0.8, 'center');
      else pdfSpacedText(doc, t, c.x + PAD, atY + 11, 0.8);
    });
    doc.setDrawColor(...INK); doc.setLineWidth(1.1);
    doc.line(L, atY + 18, R, atY + 18);
    return atY + 18;
  }

  y = pdfEnsureSpace(doc, y, 18 + 26);
  y = head(y);

  if (!rows.length && emptyText) {
    pdfSetFont(doc, 'body', 9.5, MUTED);
    doc.text(emptyText, L + PAD, y + 17);
    y += 26;
    doc.setDrawColor(...RULE); doc.setLineWidth(0.6);
    doc.line(L, y, R, y);
    return y;
  }

  rows.forEach((row, ri) => {
    // Measure every cell first.
    const cells = cols.map(c => {
      const raw = row[c.key];
      const cell = (raw && typeof raw === 'object') ? raw : { text: raw };
      const text = cell.text === undefined || cell.text === null ? '' : String(cell.text);
      const size = c.size || 9.5;
      pdfSetFont(doc, cell.bold || c.bold ? 'bold' : 'body', size);
      const lines = c.wrap === false ? [text] : pdfLines(doc, text, c.w - PAD * 2);
      pdfSetFont(doc, 'body', 8.5);
      // sub lines: strings, or { text, color } for a line of its own colour.
      const sub = [].concat(...(cell.sub || []).map(s => {
        const it = (s && typeof s === 'object') ? s : { text: s };
        return pdfLines(doc, it.text, c.w - PAD * 2).map(line => ({ line, color: it.color }));
      }));
      const h = lines.length * 12.5 + sub.length * 11;
      return { c, cell, lines, sub, size, h };
    });
    const rowH = Math.max(...cells.map(x => x.h)) + 13;

    if (y + rowH > pdfContentBottom(doc)) {
      y = pdfNewPage(doc);
      y = head(y);
    }
    if (zebra && ri % 2 === 1) {
      doc.setFillColor(...ZEBRA);
      doc.rect(L, y, tableW, rowH, 'F');
    }
    cells.forEach(({ c, cell, lines, sub, size }) => {
      let ty = y + 16;
      const color = cell.color || (c.muted ? MUTED : INK);
      lines.forEach(line => {
        pdfSetFont(doc, cell.bold || c.bold ? 'bold' : 'body', size, color);
        if (c.align === 'right') doc.text(line, c.x + c.w - PAD - doc.getTextWidth(line), ty);
        else if (c.align === 'center') doc.text(line, c.x + c.w / 2 - doc.getTextWidth(line) / 2, ty);
        else doc.text(line, c.x + PAD, ty);
        ty += 12.5;
      });
      sub.forEach(({ line, color: subColor }) => {
        pdfSetFont(doc, 'body', 8.5, subColor || cell.subColor || BODY);
        if (c.align === 'right') doc.text(line, c.x + c.w - PAD - doc.getTextWidth(line), ty - 1.5);
        else doc.text(line, c.x + PAD, ty - 1.5);
        ty += 11;
      });
    });
    y += rowH;
    doc.setDrawColor(...RULE); doc.setLineWidth(0.6);
    doc.line(L, y, R, y);
  });
  return y;
}

// Invoice/estimate line items: Description / Part # / Qty / Price /
// Amount. items: [{ desc, part, qty, unitLabel, price, amount, taxable }].
// Returns { y, subtotal, taxableSubtotal } like it always has.
// (pageH/tableBottom are accepted for older callers and ignored -- the
// table now paginates against the shared content floor, and the totals
// block keeps itself together on its own.)
function drawPdfLineItemsTable(doc, { y, items }) {
  let subtotal = 0;
  let taxableSubtotal = 0;
  const rows = items.map(item => {
    subtotal += item.amount;
    if (item.taxable) taxableSubtotal += item.amount;
    return {
      desc: item.desc,
      part: item.part || '\u2014',
      qty: String(item.qty) + (item.unitLabel ? ' ' + item.unitLabel : ''),
      price: pdfMoney(item.price),
      amount: pdfMoney(item.amount),
    };
  });
  y = drawPdfTable(doc, {
    y,
    rows,
    emptyText: 'No line items.',
    columns: [
      { key: 'desc', label: 'Description', width: 0.44 },
      { key: 'part', label: 'Part #', width: 0.16, muted: true, size: 8.5 },
      { key: 'qty', label: 'Qty', width: 0.12, align: 'center', muted: true },
      { key: 'price', label: 'Price', width: 0.13, align: 'right' },
      { key: 'amount', label: 'Amount', width: 0.15, align: 'right', bold: true },
    ],
  });
  return { y, subtotal, taxableSubtotal };
}

// A rotated rubber-stamp mark (PAID / OVERDUE / APPROVED / DECLINED).
// Drawn with plain lines so it works everywhere; (cx, cy) is its centre.
function pdfDrawStamp(doc, { cx, cy, text, sub, tone, angle }) {
  const color = tone === 'red' ? PDF_COLORS.RED : tone === 'orange' ? PDF_COLORS.ORANGE_DARK : PDF_COLORS.GREEN;
  const a = (angle === undefined ? 10 : angle) * Math.PI / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  // jsPDF's positive text angle turns counter-clockwise on the page; in
  // page coordinates (y down) that maps local (dx, dy) to:
  const rot = (dx, dy) => [cx + dx * cos + dy * sin, cy - dx * sin + dy * cos];

  pdfSetFont(doc, 'display', 26, color);
  const tw = doc.getTextWidth(String(text));
  let sw = 0;
  if (sub) { pdfSetFont(doc, 'label', 7.5); sw = pdfSpacedWidth(doc, sub, 1.2); }
  const bw = Math.max(tw, sw) + 30;
  const bh = sub ? 54 : 42;

  function box(inset, width) {
    const hw = bw / 2 - inset, hh = bh / 2 - inset;
    const pts = [rot(-hw, -hh), rot(hw, -hh), rot(hw, hh), rot(-hw, hh)];
    doc.setDrawColor(...color); doc.setLineWidth(width);
    for (let i = 0; i < 4; i++) {
      const p = pts[i], q = pts[(i + 1) % 4];
      doc.line(p[0], p[1], q[0], q[1]);
    }
  }
  box(0, 2.2);
  box(4, 0.7);

  const deg = angle === undefined ? 10 : angle;
  const mainBase = sub ? 5 : 9;
  pdfSetFont(doc, 'display', 26, color);
  const p1 = rot(-tw / 2, mainBase);
  doc.text(String(text), p1[0], p1[1], { angle: deg });
  if (sub) {
    pdfSetFont(doc, 'label', 7.5, color);
    const p2 = rot(-sw / 2, 18);
    doc.text(String(sub), p2[0], p2[1], { angle: deg, charSpace: 1.2 });
  }
  doc.setLineWidth(0.75);
  return { width: bw, height: bh };
}

// The right-hand summary column: rows of label/value, then one
// emphasised total. The whole block (and an optional stamp drawn in the
// empty space to its left) moves to a new page together, so a total is
// never orphaned from its subtotal and a stamp can never sit on text.
// rows: [{ label, value, tone }], total: { label, value, tone }.
function pdfDrawSummary(doc, { y, rows, total, stamp }) {
  const { INK, BODY, MUTED, ORANGE, ORANGE_DARK, ORANGE_TINT, GREEN, GREEN_TINT, RULE } = PDF_COLORS;
  const pageW = doc.internal.pageSize.getWidth();
  const R = pageW - PDF_GEOM.MARGIN, L = PDF_GEOM.MARGIN;
  const colW = 236;
  const x = R - colW;
  rows = (rows || []).filter(Boolean);
  const height = 14 + rows.length * 18 + 44;
  y = pdfEnsureSpace(doc, y, Math.max(height, stamp ? 90 : 0));
  const top = y;

  let ry = y + 18;
  rows.forEach(r => {
    const color = r.tone === 'discount' ? ORANGE_DARK : r.tone === 'green' ? GREEN : INK;
    pdfSetFont(doc, 'body', 9.5, r.tone === 'discount' ? ORANGE_DARK : BODY);
    doc.text(String(r.label), x + 10, ry);
    pdfSetFont(doc, 'body', 9.5, color);
    doc.text(String(r.value), R - 10 - doc.getTextWidth(String(r.value)), ry);
    ry += 18;
  });

  if (total) {
    const green = total.tone === 'green';
    const by = ry - 4;
    doc.setFillColor(...(green ? GREEN_TINT : ORANGE_TINT));
    doc.rect(x, by, colW, 38, 'F');
    doc.setFillColor(...(green ? GREEN : ORANGE));
    doc.rect(x, by, colW, 2.5, 'F');
    pdfSetFont(doc, 'label', 9, green ? GREEN : ORANGE_DARK);
    // Long labels shrink rather than run into the amount.
    let ls = 9;
    while (ls > 6.5 && pdfSpacedWidth(doc, String(total.label).toUpperCase(), 1) > colW * 0.45) { ls -= 0.5; doc.setFontSize(ls); }
    pdfSpacedText(doc, String(total.label).toUpperCase(), x + 10, by + 24, 1);
    pdfSetFont(doc, 'display', 19, INK);
    const tv = String(total.value);
    doc.text(tv, R - 10 - doc.getTextWidth(tv), by + 26);
    ry = by + 38;
  }

  if (stamp) {
    const leftW = x - L - 16;
    pdfDrawStamp(doc, Object.assign({ cx: L + Math.min(leftW, 260) / 2 + 8, cy: top + Math.max(ry - top, 70) / 2 + 4 }, stamp));
    ry = Math.max(ry, top + 80);
  }
  doc.setDrawColor(...RULE);
  return ry + 8;
}

// Subtotal / Sales Tax / optional discount / total -- the invoice and
// estimate summary. Same signature it has always had, plus an optional
// stamp. Returns the y just below the block.
function drawPdfTotalsBlock(doc, { y, pageW, subtotal, tax, discount, discountLabel, totalLabel, stamp }) {
  const total = Math.max(0, subtotal + tax - discount);
  const rows = [
    { label: 'Subtotal', value: pdfMoney(subtotal) },
    { label: 'Sales tax', value: pdfMoney(tax) },
  ];
  if (discount > 0 && String(discountLabel || '').trim() !== '') {
    rows.push({ label: discountLabel, value: '-' + pdfMoney(discount).replace('-', ''), tone: 'discount' });
  }
  return pdfDrawSummary(doc, { y: y + 10, rows, total: { label: totalLabel, value: pdfMoney(total) }, stamp });
}

// Contracts: one labelled price given the same emphasis as an invoice
// total, full content width.
function drawPdfTotalHighlight(doc, { x, y, width, label, value }) {
  const { INK, ORANGE, ORANGE_DARK, ORANGE_TINT } = PDF_COLORS;
  y = pdfEnsureSpace(doc, y - 20, 44) + 20;
  doc.setFillColor(...ORANGE_TINT);
  doc.rect(x, y - 20, width, 34, 'F');
  doc.setFillColor(...ORANGE);
  doc.rect(x, y - 20, 2.5, 34, 'F');
  pdfSetFont(doc, 'label', 9, ORANGE_DARK);
  pdfSpacedText(doc, String(label).toUpperCase(), x + 14, y + 1, 1);
  pdfSetFont(doc, 'display', 17, INK);
  doc.text(String(value), x + width - 12 - doc.getTextWidth(String(value)), y + 3);
  return y + 14;
}

// A boxed note: payment instructions, warranty, estimate terms, the
// contract's review note. tone: 'orange' | 'green' | 'neutral'.
// Kept together on one page; returns y below it.
function pdfDrawNoteBox(doc, { y, label, text, lines, tone, x, width }) {
  const { BODY, MUTED, ORANGE, ORANGE_DARK, ORANGE_TINT, GREEN, GREEN_TINT, RULE, ZEBRA } = PDF_COLORS;
  const pageW = doc.internal.pageSize.getWidth();
  x = x !== undefined ? x : PDF_GEOM.MARGIN;
  width = width || (pageW - PDF_GEOM.MARGIN - x);
  const accent = tone === 'green' ? GREEN : tone === 'neutral' ? RULE : ORANGE;
  const labelColor = tone === 'green' ? GREEN : tone === 'neutral' ? MUTED : ORANGE_DARK;
  const fill = tone === 'green' ? GREEN_TINT : tone === 'neutral' ? ZEBRA : ORANGE_TINT;
  const textW = width - 30;

  pdfSetFont(doc, 'body', 9);
  const body = [];
  if (text) pdfLines(doc, text, textW).forEach(l => body.push({ line: l }));
  (lines || []).forEach(l => {
    const item = typeof l === 'string' ? { text: l } : l;
    if (!item || !item.text) return;
    pdfSetFont(doc, 'body', item.small ? 8 : 9);
    pdfLines(doc, item.text, textW).forEach(line => body.push({ line, small: !!item.small, bold: !!item.bold }));
  });
  const h = 14 + (label ? 14 : 0) + body.reduce((s, b) => s + (b.small ? 11 : 12.5), 0) + 6;
  y = pdfEnsureSpace(doc, y, h);

  doc.setFillColor(...fill);
  doc.rect(x, y, width, h, 'F');
  doc.setFillColor(...accent);
  doc.rect(x, y, 3, h, 'F');
  let ty = y + 16;
  if (label) {
    pdfSetFont(doc, 'label', 7.5, labelColor);
    pdfSpacedText(doc, String(label).toUpperCase(), x + 15, ty, 1);
    ty += 14;
  }
  body.forEach(b => {
    pdfSetFont(doc, b.bold ? 'bold' : 'body', b.small ? 8 : 9, b.small ? MUTED : BODY);
    doc.text(b.line, x + 15, ty);
    ty += b.small ? 11 : 12.5;
  });
  return y + h + 16;
}

// The footer every page gets: a hairline, the business line on the
// left, "Page X of Y" on the right, and an optional closing message
// centred above the rule.
function drawPdfFooter(doc, pageW, pageH, opts) {
  opts = opts || {};
  const { MUTED, ORANGE_DARK, RULE } = PDF_COLORS;
  const L = PDF_GEOM.MARGIN, R = pageW - PDF_GEOM.MARGIN;
  const footerY = pageH - PDF_GEOM.FOOTER_RULE;
  if (opts.message) {
    pdfSetFont(doc, 'body', 8.5, ORANGE_DARK);
    const m = String(opts.message);
    doc.text(m, pageW / 2 - doc.getTextWidth(m) / 2, footerY - 9);
  }
  doc.setDrawColor(...RULE); doc.setLineWidth(0.75);
  doc.line(L, footerY, R, footerY);
  pdfSetFont(doc, 'body', 7.5, MUTED);
  doc.text([PDF_BRAND.legalName, 'St. George, Utah', PDF_BRAND.phone, PDF_BRAND.email, PDF_BRAND.web].join('  \u00b7  '), L, footerY + 14);
  if (opts.pageInfo) {
    pdfSetFont(doc, 'label', 7.5, MUTED);
    const t = 'Page ' + opts.pageInfo.pageNum + ' of ' + opts.pageInfo.totalPages;
    doc.text(t, R - doc.getTextWidth(t), footerY + 14);
  }
  return footerY;
}

// Footer on every page, once the page count is final. The closing
// message only goes on the last page.
function pdfFinalize(doc, opts) {
  opts = opts || {};
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    drawPdfFooter(doc, pageW, pageH, {
      message: p === totalPages ? opts.message : null,
      pageInfo: { pageNum: p, totalPages },
    });
  }
}

// Paragraph wrap + pagination for long-form documents (contracts).
// drawHeaderFn (optional, may be async) draws the new page's header and
// returns the y to resume at; without one, the shared running header is
// used. restoreFont: { role, size, color } (or the older
// { name, style, size, color }).
async function pdfWrapAndDraw(doc, text, x, y, maxWidth, lineHeight, pageBottom, drawHeaderFn, restoreFont) {
  const floor = Math.min(pageBottom, pdfContentBottom(doc));
  const paragraphs = String(text).split('\n');
  for (let i = 0; i < paragraphs.length; i++) {
    const lines = doc.splitTextToSize(paragraphs[i], maxWidth);
    for (const line of lines) {
      if (y > floor) {
        if (drawHeaderFn) { doc.addPage(); y = await drawHeaderFn(); }
        else y = pdfNewPage(doc);
        if (restoreFont) {
          if (restoreFont.role) pdfSetFont(doc, restoreFont.role, restoreFont.size, restoreFont.color);
          else { doc.setFont(restoreFont.name, restoreFont.style); doc.setFontSize(restoreFont.size); doc.setTextColor(...restoreFont.color); }
        }
      }
      doc.text(line, x, y);
      y += lineHeight;
    }
    if (i < paragraphs.length - 1) y += lineHeight * 0.3;
  }
  return y;
}
