// pdf-layout.js -- the shared jsPDF layout renderer for every generated
// business document: invoices, estimates, job sheets, and contracts.
//
// U15/W18 fix (High-Impact Upgrades, Master Audit, 2026-09-08): "The
// generators already share a block-based PDF builder, so this is a
// layout pass rather than a rewrite." Before this file existed, four
// separate pages (invoice-generator.html for both invoices and
// estimates, job-detail.html's job sheet, and contract-generator.html)
// each carried their own near-identical copy of the same masthead,
// footer, and color constants -- invoice-generator.html and
// job-detail.html's copies were already pixel-identical (deliberately
// copied that way when the job sheet was built), while
// contract-generator.html's masthead had drifted into a visibly
// smaller, one-line, no-type-label version with no shared source to
// keep it in step. One real masthead now, loaded by all four.
//
// No module system, matching every other shared script in this
// project: loaded via a plain <script src> tag, everything here
// becomes a plain global for whichever page loaded it.

const PDF_COLORS = {
  NAVY: [26, 26, 26],
  ORANGE: [224, 123, 30],
  ORANGE_DARK: [179, 95, 19],
  ORANGE_TINT: [253, 238, 219],
  GRAY: [90, 90, 90],
  LIGHTGRAY: [236, 236, 236],
};

// Canonical loader: an Image + canvas draw, not fetch+blob+FileReader
// (contract-generator.html's own prior version) -- the Image approach
// is the one of the two prior copies that actually guarded against a
// slow/stalled load with a timeout, so switching to it is a real
// robustness improvement, not just a style choice.
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

// The one real masthead every document now shares: a 100px navy band,
// the two-tone "TRIPLE H ENTERPRISES" wordmark, the motto, a document
// type label top-right, and contact info in three stacked lines
// beneath it. Call once per page (contract's multi-page documents call
// it again on every page break, same as before).
//
// preloadedLogoDataUrl is optional: a caller that redraws this header
// many times on one document (a multi-page contract) should load the
// logo ONCE up front and pass the cached data URL through every
// subsequent call, rather than re-fetching the same image on every
// page break -- this function still awaits fine either way (a
// preloaded call simply has no real async work left to do).
async function drawPdfHeader(doc, pageW, typeLabel, preloadedLogoDataUrl) {
  const { NAVY, ORANGE } = PDF_COLORS;
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, pageW, 100, 'F');
  try {
    const logoData = preloadedLogoDataUrl || await pdfLoadImageAsDataURL('/images/logo-signature-orange.webp');
    doc.addImage(logoData, 'PNG', 40, 15, 65, 60);
  } catch (e) { /* logo optional if it fails to load */ }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(255, 255, 255);
  doc.text('TRIPLE H', 118, 45);
  doc.setTextColor(...ORANGE);
  doc.text('ENTERPRISES', 118 + doc.getTextWidth('TRIPLE H ') + 4, 45);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(207, 207, 207);
  doc.text('Honesty.  Hustle.  Helpfulness.', 118, 62);
  if (typeLabel) {
    // Same auto-shrink guard drawPdfTotalsBlock already uses below --
    // contract type labels ("SHORT-TERM PROJECT AGREEMENT") are
    // genuinely longer than "PROGRESS PAYMENT" ever was, and nothing
    // here previously checked whether a label actually fit before the
    // wordmark text starts.
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...ORANGE);
    let labelSize = 13;
    doc.setFontSize(labelSize);
    while (labelSize > 8 && doc.getTextWidth(typeLabel) > pageW - 260) {
      labelSize -= 1;
      doc.setFontSize(labelSize);
    }
    doc.text(typeLabel, pageW - 40, 30, { align: 'right' });
  }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(255, 255, 255);
  doc.text('(435) 414-1667', pageW - 40, 46, { align: 'right' });
  doc.text('steve@triplehenterprisesllc.biz', pageW - 40, 58, { align: 'right' });
  doc.text('www.triplehenterprisesllc.biz', pageW - 40, 70, { align: 'right' });
  return 130; // y position content should start at on this page
}

// Draws the column header band + every row, paginating when a row
// would land past tableBottom (restarting the header band and zebra
// stripe cleanly on the new page). Returns the y just below the table's
// closing rule, plus the computed subtotal/taxable subtotal.
function drawPdfLineItemsTable(doc, { y, items, pageW, pageH, tableBottom }) {
  const { NAVY, GRAY, LIGHTGRAY } = PDF_COLORS;
  const tableW = pageW - 80;

  function drawHeaderBand(atY) {
    doc.setFillColor(...NAVY);
    doc.rect(40, atY - 14, tableW, 20, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(255, 255, 255);
    doc.text('DESCRIPTION', 46, atY);
    doc.text('PART #', 40 + tableW * 0.5, atY);
    doc.text('QTY', 40 + tableW * 0.68, atY, { align: 'center' });
    doc.text('PRICE', 40 + tableW * 0.83, atY, { align: 'right' });
    doc.text('AMOUNT', pageW - 46, atY, { align: 'right' });
  }

  drawHeaderBand(y);
  y += 8;

  let subtotal = 0;
  let taxableSubtotal = 0;
  let stripe = false;
  items.forEach(item => {
    const rowH = 22;
    if (y + rowH > tableBottom) {
      doc.addPage();
      y = 60;
      drawHeaderBand(y);
      y += 8;
      stripe = false; // restart the zebra pattern cleanly on the new page
    }
    if (stripe) { doc.setFillColor(...LIGHTGRAY); doc.rect(40, y, tableW, rowH, 'F'); }
    stripe = !stripe;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(20, 20, 20);
    doc.text(item.desc, 46, y + 14);
    doc.setFontSize(8.5); doc.setTextColor(...GRAY);
    doc.text(item.part || '—', 40 + tableW * 0.5, y + 14);
    doc.text(String(item.qty) + (item.unitLabel ? ' ' + item.unitLabel : ''), 40 + tableW * 0.68, y + 14, { align: 'center' });
    doc.setTextColor(20, 20, 20); doc.setFontSize(9.5);
    doc.text('$' + item.price.toFixed(2), 40 + tableW * 0.83, y + 14, { align: 'right' });
    doc.text('$' + item.amount.toFixed(2), pageW - 46, y + 14, { align: 'right' });
    subtotal += item.amount;
    if (item.taxable) taxableSubtotal += item.amount;
    y += rowH;
  });
  doc.setDrawColor(200, 200, 200);
  doc.line(40, y, pageW - 40, y);
  return { y, subtotal, taxableSubtotal };
}

// Draws Subtotal / Sales Tax / optional discount / the final total,
// with a soft orange-tint panel behind the total row specifically --
// every other line on the page stays plain so that one panel reads as
// the page's single point of emphasis, not just another line of text.
function drawPdfTotalsBlock(doc, { y, pageW, subtotal, tax, discount, discountLabel, totalLabel }) {
  const { ORANGE, ORANGE_DARK, ORANGE_TINT } = PDF_COLORS;
  const total = Math.max(0, subtotal + tax - discount);

  y += 24;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(20, 20, 20);
  doc.text('Subtotal', pageW - 220, y);
  doc.text('$' + subtotal.toFixed(2), pageW - 40, y, { align: 'right' });

  y += 20;
  doc.text('Sales Tax', pageW - 220, y);
  doc.text('$' + tax.toFixed(2), pageW - 40, y, { align: 'right' });

  if (discount > 0 && discountLabel.trim() !== '') {
    y += 20;
    doc.setFont('helvetica', 'italic'); doc.setFontSize(10); doc.setTextColor(...ORANGE_DARK);
    doc.text(discountLabel, pageW - 220, y);
    doc.text('-$' + discount.toFixed(2), pageW - 40, y, { align: 'right' });
  }

  y += 14;
  doc.setDrawColor(200, 200, 200);
  doc.line(pageW - 220, y, pageW - 40, y);
  y += 22;
  doc.setFillColor(...ORANGE_TINT);
  doc.roundedRect(pageW - 232, y - 17, 192, 30, 4, 4, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...ORANGE_DARK);
  let totalLabelSize = 14;
  while (totalLabelSize > 10 && doc.getTextWidth(totalLabel) > 138) {
    totalLabelSize -= 1;
    doc.setFontSize(totalLabelSize);
  }
  doc.text(totalLabel, pageW - 220, y + 3);
  doc.setTextColor(...ORANGE);
  doc.text('$' + total.toFixed(2), pageW - 40, y + 3, { align: 'right' });
  return y + 3;
}

// U15/W18 fix (2026-09-08): "the total given genuine prominence."
// contract-generator.html's own price fields ("Total Estimated Price",
// "Total Project Price") previously rendered as a plain field row --
// the same visual weight as "Estimated Labor" above it. This is the
// same orange-tint treatment drawPdfTotalsBlock gives invoices and
// estimates, adapted for a single labeled value rather than a
// subtotal/tax/discount ladder.
function drawPdfTotalHighlight(doc, { x, y, width, label, value }) {
  const { ORANGE, ORANGE_DARK, ORANGE_TINT } = PDF_COLORS;
  doc.setFillColor(...ORANGE_TINT);
  doc.roundedRect(x, y - 17, width, 30, 4, 4, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...ORANGE_DARK);
  doc.text(label, x + 12, y + 3);
  doc.setTextColor(...ORANGE);
  doc.text(value, x + width - 12, y + 3, { align: 'right' });
  return y + 13;
}

// The one footer every document shares: an orange rule, the centered
// contact line, an optional italic message beneath it (invoices and
// job sheets each have their own closing line; estimates don't), and
// an optional right-aligned "Page X of Y" (contracts only, once
// they're long enough to paginate).
function drawPdfFooter(doc, pageW, pageH, opts) {
  opts = opts || {};
  const { ORANGE, GRAY } = PDF_COLORS;
  const footerY = pageH - 40;
  doc.setDrawColor(...ORANGE); doc.setLineWidth(1.5);
  doc.line(40, footerY, pageW - 40, footerY);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GRAY);
  doc.text('Triple H Enterprises LLC   |   (435) 414-1667   |   steve@triplehenterprisesllc.biz   |   www.triplehenterprisesllc.biz', pageW / 2, footerY + 14, { align: 'center' });
  if (opts.pageInfo) {
    doc.text('Page ' + opts.pageInfo.pageNum + ' of ' + opts.pageInfo.totalPages, pageW - 40, footerY + 14, { align: 'right' });
  }
  if (opts.message) {
    doc.setFont('helvetica', 'italic');
    doc.text(opts.message, pageW / 2, footerY + 26, { align: 'center' });
  }
  return footerY;
}

// contract-generator.html's own generic paragraph-wrapping + pagination
// helper, unchanged in behavior -- exposed here so it's one shared copy
// rather than a fourth document type reinventing it. Not currently used
// by the line-item documents (invoice/estimate/job sheet), which don't
// need free-flowing paragraph pagination the same way a multi-page
// contract does.
//
// drawHeaderFn is async (it's expected to be a closure over
// drawPdfHeader) and MUST be awaited here, not fire-and-forgotten --
// this function is itself async specifically so a page break mid-
// paragraph can't race ahead and draw text before the new page's
// masthead (and the logo image inside it) has actually finished.
async function pdfWrapAndDraw(doc, text, x, y, maxWidth, lineHeight, pageBottom, drawHeaderFn, restoreFont) {
  const paragraphs = String(text).split('\n');
  for (let i = 0; i < paragraphs.length; i++) {
    const lines = doc.splitTextToSize(paragraphs[i], maxWidth);
    for (const line of lines) {
      if (y > pageBottom) {
        doc.addPage();
        y = await drawHeaderFn();
        // The header draw above changes font/size/color to render its
        // own white/orange text -- restore whatever this paragraph was
        // using before the break, so its remaining lines don't
        // silently continue in the header's styling.
        if (restoreFont) doc.setFont(restoreFont.name, restoreFont.style);
        if (restoreFont) doc.setFontSize(restoreFont.size);
        if (restoreFont) doc.setTextColor(...restoreFont.color);
      }
      doc.text(line, x, y);
      y += lineHeight;
    }
    if (i < paragraphs.length - 1) y += lineHeight * 0.3;
  }
  return y;
}
